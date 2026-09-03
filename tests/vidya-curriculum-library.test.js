import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
let merged = false;
let populated;
mock.module('../models/User.js', { defaultExport: { findById: () => ({ populate: (path, fields) => { populated = fields; return { lean: async () => ({ role: 'student', classNumber: '7', assignedAdmin: { board: 'ASLI_EXCLUSIVE_SCHOOLS' } }) }; } }) } });
mock.module('../models/Subject.js', { defaultExport: { find: query => ({ select: () => ({ lean: async () => {
  assert.deepEqual(query._id.$in, ['base', 'iit-alpha']);
  return [{ name: 'Mathematics', board: 'IIT', productCategory: 'ALPHA', classNumber: '7' }];
} }) }) } });
mock.module('../routes/student/helpers.js', { namedExports: {
  resolveStudentClassDoc: async () => ({ classNumber: '7' }),
  resolveStudentSubjectIdsForLibrary: async () => ['base'],
} });
mock.module('../utils/schoolProgram.js', { namedExports: {
  getStudentSchoolProgramContext: async () => ({ isAsliPrepExclusive: true, iitCategories: ['ALPHA'] }),
  resolveIitCategoriesForContentBrowse: context => context.iitCategories,
} });
mock.module('../utils/iitCatalogSubjects.js', { namedExports: {
  mergeIitCatalogSubjectsIntoLibraryIds: async (ids, classNumber, options) => {
    assert.equal(classNumber, '7');
    assert.deepEqual(options.iitCategories, ['ALPHA']);
    merged = true;
    return [...ids, 'iit-alpha'];
  },
} });
const { loadVidyaCurriculumScopes } = await import('../services/vidya-curriculum.js');
test('student scope follows Learning Paths IIT merge instead of only generic school subjects', async () => {
  const scopes = await loadVidyaCurriculumScopes('507f1f77bcf86cd799439011', 'student');
  assert.equal(merged, true);
  assert.match(populated, /iitCategoriesByClass/);
  assert.deepEqual(scopes, [{ board: 'IIT/NEET', track: 'ALPHA', classNumber: '7', subject: 'mathematics' }]);
});
