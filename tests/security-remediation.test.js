import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveAccount } from '../utils/active-account.js';
import { canAccessPrivateUpload } from '../utils/private-upload-access.js';
import { isAllowedUploadMetadata, matchesUploadBytes } from '../utils/upload-validation.js';
import { signUploadPath, isPublicUploadPath } from '../utils/upload-access.js';
import { mock } from 'node:test';
import User from '../models/User.js';
import { RefreshToken } from '../models/AuthSession.js';
import { rotateRefreshToken } from '../utils/auth-tokens.js';
import { canAccessLegacyUpload } from '../utils/legacy-upload-access.js';
import Content from '../models/Content.js';
import HomeworkSubmission from '../models/HomeworkSubmission.js';
import Teacher from '../models/Teacher.js';

const id = '507f1f77bcf86cd799439011';
const adminId = '507f1f77bcf86cd799439012';
const query = value => ({ lean: async () => value });
function models(account, admin = null, school = null) {
  return { User: { findById: key => query(String(key) === id ? account : admin) },
    Teacher: { findById: () => query(null) }, School: { findOne: () => query(school) } };
}
test('active account is accepted; deleted, disabled, missing and changed-role accounts are rejected', async () => {
  const claims = { userId: id, role: 'student' };
  const active = { _id: id, role: 'student', isActive: true };
  assert.ok(await resolveActiveAccount(claims, models(active)));
  for (const account of [null, { ...active, isActive: false }, { ...active, deletedAt: new Date() }, { ...active, role: 'admin' }]) {
    assert.equal(await resolveActiveAccount(claims, models(account)), null);
  }
});
test('inactive school or parent admin blocks existing student session', async () => {
  const account = { _id: id, role: 'student', assignedAdmin: adminId };
  const claims = { userId: id, role: 'student' };
  const admin = { _id: adminId, role: 'admin', isActive: true };
  assert.ok(await resolveActiveAccount(claims, models(account, admin, { isActive: true })));
  assert.equal(await resolveActiveAccount(claims, models(account, { ...admin, isActive: false })), null);
  assert.equal(await resolveActiveAccount(claims, models(account, admin, { isActive: false })), null);
});
test('private files need ownership/resource authorization, not a role', async () => {
  const asset = { exists: async q => q.ownerId === id && q.path === '/uploads/content/own.pdf' };
  const deny = async () => false;
  const user = { userId: id, role: 'student' };
  assert.equal(await canAccessPrivateUpload('/uploads/content/own.pdf', user, {}, asset, deny), true);
  for (const role of ['student', 'teacher', 'admin']) {
    assert.equal(await canAccessPrivateUpload('/uploads/content/other.pdf', { ...user, role }, {}, asset, deny), false);
  }
  assert.equal(await canAccessPrivateUpload('/uploads/content/legacy.pdf', user, {}, asset, async () => true), true);
});
test('signed resource link works only for its exact path', async () => {
  process.env.UPLOAD_SIGNING_SECRET = 'test-only-upload-signing-secret';
  const path = '/uploads/content/shared.pdf';
  const signature = signUploadPath(path);
  const asset = { exists: async () => false };
  const deny = async () => false;
  assert.equal(await canAccessPrivateUpload(path, null, signature, asset, deny), true);
  assert.equal(await canAccessPrivateUpload('/uploads/content/other.pdf', null, signature, asset, deny), false);
});
test('spoofed HTML and mismatched binary uploads are rejected', () => {
  assert.equal(isPublicUploadPath('/reports/private-logo.svg'), false);
  assert.equal(isPublicUploadPath('/reports/public/private.pdf'), false);
  assert.equal(isAllowedUploadMetadata('attack.html', 'application/pdf'), false);
  assert.equal(isAllowedUploadMetadata('attack.svg', 'image/png'), false);
  assert.equal(isAllowedUploadMetadata('ok.pdf', 'image/png'), false);
  assert.equal(isAllowedUploadMetadata('ok.pdf', 'application/pdf'), true);
  assert.equal(matchesUploadBytes('fake.pdf', Buffer.from('<html>test</html>')), false);
  assert.equal(matchesUploadBytes('ok.pdf', Buffer.from('%PDF-1.7')), true);
  assert.equal(matchesUploadBytes('ok.png', Buffer.from('89504e470d0a1a0a', 'hex')), true);
});

test('refresh revokes sessions instead of issuing tokens for a deactivated account', async () => {
  let revoked = false;
  mock.method(RefreshToken, 'findOne', async () => ({ userId: id, role: 'student', expiresAt: new Date(Date.now() + 60000) }));
  mock.method(User, 'findById', () => query({ _id: id, role: 'student', isActive: false }));
  mock.method(RefreshToken, 'updateMany', async () => { revoked = true; });
  try {
    assert.equal(await rotateRefreshToken('test-refresh'), null);
    assert.equal(revoked, true);
  } finally { mock.restoreAll(); }
});

test('authentication middleware rejects inactive accounts even with a valid JWT', async () => {
  process.env.JWT_SECRET ||= 'test-only-at-least-16-characters';
  const { default: jwt } = await import('jsonwebtoken');
  const { createVerifyToken } = await import('../middleware/auth.js');
  const token = jwt.sign({ userId: id, role: 'student' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  let status;
  let continued = false;
  const res = { status(code) { status = code; return this; }, json() {} };
  await createVerifyToken(async () => null)({ headers: { authorization: `Bearer ${token}` } }, res, () => { continued = true; });
  assert.equal(status, 401);
  assert.equal(continued, false);
});

test('legacy homework does not cross school boundaries', async () => {
  mock.method(HomeworkSubmission, 'findOne', () => query(null));
  mock.method(Content, 'findOne', () => ({ populate: () => query({ createdBy: 'teacher', teacherId: adminId, subject: { _id: id } }) }));
  mock.method(Teacher, 'findById', () => query({ adminId: '507f1f77bcf86cd799439013' }));
  mock.method(User, 'findById', () => ({ populate: () => query({ assignedAdmin: adminId }) }));
  try {
    assert.equal(await canAccessLegacyUpload('/uploads/content/legacy.pdf', { userId: id, role: 'student' }), false);
    assert.equal(await canAccessLegacyUpload('/uploads/content/legacy.pdf', { userId: id, role: 'admin' }), false);
  } finally { mock.restoreAll(); }
});

test('legacy submissions allow their student and homework teacher, not another student', async () => {
  mock.method(HomeworkSubmission, 'findOne', () => query({ studentId: id, homeworkId: adminId }));
  mock.method(Content, 'findById', () => query({ teacherId: adminId }));
  try {
    assert.equal(await canAccessLegacyUpload('/uploads/content/work.pdf', { userId: id, role: 'student' }), true);
    assert.equal(await canAccessLegacyUpload('/uploads/content/work.pdf', { userId: adminId, role: 'student' }), false);
    assert.equal(await canAccessLegacyUpload('/uploads/content/work.pdf', { userId: adminId, role: 'teacher' }), true);
    assert.equal(await canAccessLegacyUpload('/uploads/content/work.pdf', { userId: id, role: 'teacher' }), false);
  } finally { mock.restoreAll(); }
});
