import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import AiToolTopic from '../models/AiToolTopic.js';
import Book from '../models/Book.js';
import User from '../models/User.js';
import { loadVidyaCurriculumScopes } from '../services/vidya-curriculum.js';

test('superadmin curriculum combines active topics and indexed textbooks without duplicate scopes', async () => {
  const row = { _id: { board: 'IIT', track: 'ALPHA', classNumber: 'Class 6', subject: 'Mathematics' } };
  const topics = mock.method(AiToolTopic, 'aggregate', async pipeline => {
    assert.equal(pipeline[0].$match.isActive, true);
    return [row];
  });
  const books = mock.method(Book, 'aggregate', async pipeline => {
    assert.equal(pipeline[0].$match.uploadedByRole, 'super-admin');
    assert.equal(pipeline[0].$match.processingStatus, 'indexed');
    return [row];
  });
  try {
    const scopes = await loadVidyaCurriculumScopes('authenticated-superadmin', 'super-admin');
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].track, 'ALPHA');
    assert.equal(scopes[0].classNumber, '6');
  } finally { topics.mock.restore(); books.mock.restore(); }
});
test('school admin cannot use superadmin catalog scope', async () => {
  let catalogCalls = 0;
  const topics = mock.method(AiToolTopic, 'aggregate', async () => { catalogCalls++; return []; });
  const user = mock.method(User, 'findById', () => ({ populate: () => ({ lean: async () => ({ role: 'admin' }) }) }));
  try {
    assert.deepEqual(await loadVidyaCurriculumScopes('admin', 'admin'), []);
    assert.equal(catalogCalls, 0);
  } finally { topics.mock.restore(); user.mock.restore(); }
});
