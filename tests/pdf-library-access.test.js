import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { filterByProductCategory } from '../utils/schoolProgram.js';
let content = { _id: 'workbook', createdBy: 'super-admin', subject: { _id: 'iit-sibling' } };
let student = { role: 'student', assignedAdmin: { _id: 'school', board: 'CBSE' } };
let visible = true;
let classNumber = '7';
let loaded = false;
const query = value => { const q = { populate: () => q, lean: async () => value }; return q; };
mock.module('../models/Content.js', { defaultExport: { findOne: () => query(content) } });
mock.module('../models/HomeworkSubmission.js', { defaultExport: { findOne: () => query(null) } });
mock.module('../models/User.js', { defaultExport: { findById: () => query(student) } });
mock.module('../models/Teacher.js', { defaultExport: { findById: () => query({ adminId: 'other-school' }) } });
mock.module('../routes/student/helpers.js', { namedExports: { resolveStudentClassDoc: async () => ({ classNumber: '7' }) } });
mock.module('../utils/studentLibraryContents.js', { namedExports: { loadStudentLibraryContents: async (id, user, cls, board, options) => {
  loaded = true;
  assert.equal(id, 'student');
  assert.deepEqual(options, { contentId: 'workbook' });
  assert.equal(board, 'CBSE');
  return { studentClassNum: classNumber, contents: visible ? [content] : [] };
} } });
const { canAccessLegacyUpload } = await import('../utils/legacy-upload-access.js');
test('authorized IIT sibling workbook uses the library resource authorization', async () => {
  assert.equal(await canAccessLegacyUpload('/uploads/workbook.pdf', { userId: 'student', role: 'student' }), true);
  assert.equal(loaded, true);
});
test('resource excluded by library filters remains forbidden', async () => {
  visible = false;
  assert.equal(await canAccessLegacyUpload('/uploads/workbook.pdf', { userId: 'student', role: 'student' }), false);
  visible = true;
});
test('missing class and another school teacher upload remain forbidden', async () => {
  classNumber = '';
  assert.equal(await canAccessLegacyUpload('/uploads/workbook.pdf', { userId: 'student', role: 'student' }), false);
  classNumber = '7';
  content = { ...content, createdBy: 'teacher', teacherId: 'teacher' };
  loaded = false;
  assert.equal(await canAccessLegacyUpload('/uploads/workbook.pdf', { userId: 'student', role: 'student' }), false);
  assert.equal(loaded, false);
});
test('Alpha authorization does not grant Beta materials', () => {
  const alpha = { productCategory: 'ALPHA' }, beta = { productCategory: 'BETA' };
  assert.deepEqual(filterByProductCategory([alpha, beta], ['ALPHA']), [alpha]);
});
