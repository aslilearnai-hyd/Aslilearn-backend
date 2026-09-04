/**
 * Security regression tests (no DB required).
 * Run: node --test tests/security-regression.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeAssessmentAttempt } from '../utils/grade-assessment.js';
import { hostnameMatchesAllowlist, assertAllowedFetchUrl } from '../utils/url-allowlist.js';
import { pickAllowedFields, SAFE_VIDEO_UPDATE_FIELDS } from '../utils/safe-update-fields.js';
import { hashOpaqueToken, generateOpaqueToken } from '../models/AuthSession.js';
import {
  isPublicUploadPath,
  roleMayAccessUpload,
  signUploadPath,
  verifyUploadSignature,
} from '../utils/upload-access.js';
import { createCsrfOriginGuard } from '../middleware/csrf-origin.js';
import {
  collectAttendanceEntries,
  normalizeAttendanceStatus,
  summarizeAttendanceCounts,
} from '../utils/attendance-helpers.js';
import { validateRazorpayCheckoutEvidence } from '../services/razorpayService.js';
import { INDIVIDUAL_TRIAL_DAYS, normalizeIndividualSignupBody } from '../utils/individualAccount.js';
import { escapeAuditSearchRegex } from '../controllers/auditLogController.js';

describe('Razorpay entitlement binding', () => {
  const order = {
    id: 'order_secure123',
    amount: 99900,
    currency: 'INR',
    notes: {
      userId: '507f1f77bcf86cd799439011',
      role: 'student',
      packageType: 'both',
      period: 'year',
      track: 'ALPHA',
    },
  };
  const payment = {
    id: 'pay_secure123',
    order_id: order.id,
    amount: order.amount,
    currency: 'INR',
    status: 'captured',
  };

  it('derives the entitlement only from the Razorpay order notes', () => {
    const trusted = validateRazorpayCheckoutEvidence({
      order,
      payment,
      accountId: order.notes.userId,
      role: 'student',
    });
    assert.equal(trusted.packageType, 'both');
    assert.equal(trusted.period, 'year');
    assert.equal(trusted.amountPaise, 99900);
  });

  it('rejects cross-account, cross-order, amount, and uncaptured payment evidence', () => {
    assert.throws(
      () => validateRazorpayCheckoutEvidence({ order, payment, accountId: 'other', role: 'student' }),
      /does not belong/
    );
    assert.throws(
      () => validateRazorpayCheckoutEvidence({ order, payment: { ...payment, order_id: 'order_other' }, accountId: order.notes.userId, role: 'student' }),
      /does not belong/
    );
    assert.throws(
      () => validateRazorpayCheckoutEvidence({ order, payment: { ...payment, amount: 100 }, accountId: order.notes.userId, role: 'student' }),
      /amount/
    );
    assert.throws(
      () => validateRazorpayCheckoutEvidence({ order, payment: { ...payment, status: 'authorized' }, accountId: order.notes.userId, role: 'student' }),
      /captured/
    );
  });
});

describe('tenant and signup boundaries', () => {
  it('does not let school admins select another OMR tenant', () => {
    const source = readFileSync(new URL('../controllers/omrResultsController.js', import.meta.url), 'utf8');
    assert.match(source, /explicit && role === 'super-admin'/);
  });

  it('ignores client-controlled trial duration', () => {
    const result = normalizeIndividualSignupBody({
      role: 'student', fullName: 'Trial User', email: 'trial@example.com', password: 'secret1',
      schoolName: 'Example', phone: '9876543210', classNumber: '8',
      interestedCourses: ['CBSE'], interestedSubjects: ['Maths'], trialDays: 365,
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.trialDays, INDIVIDUAL_TRIAL_DAYS);
  });

  it('blocks repeat trial claims across rotated email addresses', () => {
    const source = readFileSync(new URL('../controllers/authController.js', import.meta.url), 'utf8');
    const handler = source.slice(source.indexOf('export async function register'), source.indexOf('export async function login'));
    assert.match(handler, /phone: d\.phone, isIndividualAccount: true/);
    assert.match(handler, /free trial has already been claimed/i);
  });

  it('escapes audit-search regular expression syntax', () => {
    assert.equal(escapeAuditSearchRegex('a.*(b)'), 'a\\.\\*\\(b\\)');
  });
});

describe('student data retention safeguards', () => {
  it('makes bulk removal tenant-scoped, confirmed, and recoverable', () => {
    const source = readFileSync(new URL('../routes/admin/users.js', import.meta.url), 'utf8');
    const route = source.slice(
      source.indexOf("router.delete('/users/delete-all'"),
      source.indexOf('// Teacher management endpoints'),
    );
    assert.match(route, /assignedAdmin: tenantAdminId/);
    assert.match(route, /DELETE \$\{actualCount\} STUDENTS/);
    assert.match(route, /User\.updateMany/);
    assert.match(route, /deletedAt/);
    assert.match(route, /student\.archive_all/);
    assert.doesNotMatch(route, /User\.deleteMany/);
  });

  it('soft-deactivates individual students instead of deleting user documents', () => {
    const source = readFileSync(new URL('../controllers/adminController.js', import.meta.url), 'utf8');
    const handler = source.slice(
      source.indexOf('export const deleteStudent'),
      source.indexOf('// Teacher Management'),
    );
    assert.match(handler, /findOneAndUpdate/);
    assert.match(handler, /deletedAt/);
    assert.doesNotMatch(handler, /findOneAndDelete/);
  });

  it('blocks permanent school deletion', () => {
    const source = readFileSync(new URL('../controllers/superAdminController.js', import.meta.url), 'utf8');
    const handler = source.slice(
      source.indexOf('export const deleteAdmin'),
      source.indexOf('// Get All Users'),
    );
    assert.match(handler, /school\.hard_delete_blocked/);
    assert.match(handler, /Permanent school deletion is disabled/);
  });
});

describe('gradeAssessmentAttempt', () => {
  it('computes score server-side and ignores client score concept', () => {
    const quiz = {
      questions: [
        { question: '2+2?', correctAnswer: '4', points: 2 },
        { question: 'Capital?', correctAnswer: 'Delhi', points: 1 },
      ],
    };
    const result = gradeAssessmentAttempt(quiz, ['4', 'Mumbai']);
    assert.equal(result.graded, true);
    assert.equal(result.score, 2);
    assert.equal(result.totalPoints, 3);
  });
});

describe('url-allowlist', () => {
  it('rejects lookalike hosts', () => {
    assert.equal(hostnameMatchesAllowlist('ncert.nic.in.evil.com'), false);
    assert.equal(hostnameMatchesAllowlist('ncert.nic.in'), true);
    assert.equal(hostnameMatchesAllowlist('pdf.ncert.nic.in'), true);
  });

  it('blocks private hosts', () => {
    assert.throws(() => assertAllowedFetchUrl('http://127.0.0.1/secret'), /not allowed|Invalid|Only/i);
  });
});

describe('safe update fields', () => {
  it('strips privilege fields from video updates', () => {
    const picked = pickAllowedFields(
      { title: 'Ok', adminId: 'evil', role: 'super-admin', videoUrl: 'https://x' },
      SAFE_VIDEO_UPDATE_FIELDS,
    );
    assert.equal(picked.title, 'Ok');
    assert.equal(picked.videoUrl, 'https://x');
    assert.equal(picked.adminId, undefined);
    assert.equal(picked.role, undefined);
  });

  it('strips ownership fields from exam and question updates', async () => {
    const { SAFE_EXAM_UPDATE_FIELDS, SAFE_QUESTION_UPDATE_FIELDS } = await import('../utils/safe-update-fields.js');
    const unsafe = { title: 'Allowed', questionText: 'Allowed', adminId: 'evil', createdBy: 'evil', role: 'super-admin' };
    assert.deepEqual(pickAllowedFields(unsafe, SAFE_EXAM_UPDATE_FIELDS), { title: 'Allowed' });
    assert.deepEqual(pickAllowedFields(unsafe, SAFE_QUESTION_UPDATE_FIELDS), { questionText: 'Allowed' });
  });
});

describe('opaque tokens', () => {
  it('hashes refresh tokens', () => {
    const raw = generateOpaqueToken();
    const a = hashOpaqueToken(raw);
    const b = hashOpaqueToken(raw);
    assert.equal(a, b);
    assert.notEqual(a, raw);
  });
});

describe('upload access ACL', () => {
  it('treats school logos as public', () => {
    assert.equal(isPublicUploadPath('/schools/logos/x.png'), true);
    assert.equal(isPublicUploadPath('/content/secret.pdf'), false);
  });

  it('requires resource authorization even for school-shared paths', () => {
    assert.equal(roleMayAccessUpload('/content/a.pdf', { role: 'student' }), false);
    assert.equal(roleMayAccessUpload('/timetables/7c.jpg', { role: 'student' }), false);
  });

  it('blocks students from pdf-knowledge and orders', () => {
    assert.equal(roleMayAccessUpload('/pdf-knowledge/a.pdf', { role: 'student' }), false);
    assert.equal(roleMayAccessUpload('/orders/documents/a.pdf', { role: 'student' }), false);
    assert.equal(roleMayAccessUpload('/content/a.pdf', { role: 'student' }), false);
  });

  it('does not give school admins global file access', () => {
    assert.equal(roleMayAccessUpload('/orders/documents/a.pdf', { role: 'admin' }), false);
    assert.equal(roleMayAccessUpload('/orders/documents/a.pdf', { role: 'super-admin' }), true);
  });

  it('round-trips signed upload URLs', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
    const { exp, sig, path } = signUploadPath('/uploads/content/demo.pdf', 600);
    assert.equal(verifyUploadSignature(path, exp, sig), true);
    assert.equal(verifyUploadSignature(path, exp, 'deadbeef'), false);
  });

  it('withSignedUploadUrl appends exp+sig for question figures', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
    const { withSignedUploadUrl, normalizeUploadUrlForStorage } = await import('../utils/upload-access.js');
    const signed = withSignedUploadUrl('/uploads/questions/fig.png', 600);
    assert.match(signed, /^\/uploads\/questions\/fig\.png\?exp=\d+&sig=[a-f0-9]+$/);
    const u = new URL(signed, 'https://api.aslilearn.ai');
    assert.equal(
      verifyUploadSignature(u.pathname, u.searchParams.get('exp'), u.searchParams.get('sig')),
      true
    );

    // Stale signatures in DB must be replaced (not returned as-is)
    const stale = '/uploads/questions/fig.png?exp=1000&sig=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const refreshed = withSignedUploadUrl(stale, 600);
    assert.match(refreshed, /^\/uploads\/questions\/fig\.png\?exp=\d+&sig=[a-f0-9]+$/);
    assert.notEqual(refreshed, stale);
    assert.equal(
      normalizeUploadUrlForStorage(
        'https://localhost:5000/uploads/questions/fig.png?exp=1&sig=abc'
      ),
      '/uploads/questions/fig.png'
    );
  });

  it('signs local content media fields without changing external URLs', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
    const { signContentMediaFields } = await import('../utils/upload-access.js');
    const signed = signContentMediaFields({
      fileUrl: '/uploads/content/book.pdf',
      fileUrls: ['/uploads/content/book.pdf', 'https://example.com/book.pdf'],
      thumbnailUrl: '/uploads/content/thumbnails/book.jpg',
    }, 600);
    assert.match(signed.fileUrl, /^\/uploads\/content\/book\.pdf\?exp=\d+&sig=[a-f0-9]+$/);
    assert.match(signed.thumbnailUrl, /^\/uploads\/content\/thumbnails\/book\.jpg\?exp=\d+&sig=[a-f0-9]+$/);
    assert.equal(signed.fileUrls[1], 'https://example.com/book.pdf');
  });
});

describe('csrf origin guard', () => {
  it('allows Bearer mutating requests without Origin', () => {
    const guard = createCsrfOriginGuard(['https://aslilearn.ai']);
    let nextCalled = false;
    guard(
      { method: 'POST', headers: { authorization: 'Bearer abc.def.ghi' } },
      { status: () => ({ json: () => {} }) },
      () => {
        nextCalled = true;
      },
    );
    assert.equal(nextCalled, true);
  });

  it('blocks disallowed Origin on cookie POSTs', () => {
    const guard = createCsrfOriginGuard(['https://aslilearn.ai']);
    let statusCode = 0;
    guard(
      { method: 'POST', headers: { origin: 'https://evil.example' } },
      {
        status(code) {
          statusCode = code;
          return { json: () => {} };
        },
      },
      () => {
        throw new Error('should not next');
      },
    );
    assert.equal(statusCode, 403);
  });
});

describe('attendance helpers', () => {
  it('normalizes both mobile POST shapes', () => {
    const entries = collectAttendanceEntries({
      students: [{ _id: 'a', status: 'late' }],
      records: [{ studentId: 'b', status: 'Absent' }],
    });
    assert.equal(entries.length, 2);
    assert.equal(normalizeAttendanceStatus('Present'), 'present');
    const counts = summarizeAttendanceCounts([
      { status: 'present' },
      { status: 'absent' },
      { status: 'late' },
    ]);
    assert.deepEqual(counts, { presentCount: 1, absentCount: 1, lateCount: 1 });
  });
});
