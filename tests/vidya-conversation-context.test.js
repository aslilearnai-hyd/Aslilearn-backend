import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareConversationHistory } from '../ai/shared/conversation-history.js';
import { parseCurriculumRequest, resolveVidyaCurriculum } from '../services/vidya-curriculum.js';
import { textbookSourceFooter } from '../services/vidya-textbook-context.js';
import { answerByTopicAndShape } from '../services/vidya-student/student-app-query-router.js';
import { buildContentsFromHistory } from '../ai/providers/model-router.js';

test('history retains early turns beyond the old eight/twelve message limits', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Turn ${i}` }));
  assert.deepEqual(prepareConversationHistory(rows), rows);
  assert.equal(buildContentsFromHistory({ history: rows, userMessage: 'Now' }).length, 41);
});
test('chapter follow-up inherits user context', () => {
  const r = parseCurriculumRequest('how many lessons in there?', [{ role: 'user', content: 'Teach class 7 maths alpha chapter 5' }]);
  assert.equal(r.chapter, 5);
  assert.equal(r.track, 'ALPHA');
});
test('named book disambiguates authorized boards and restricts subsequent retrieval', async () => {
  const cbse = { board: 'CBSE', track: '', classNumber: '7', subject: 'mathematics' };
  const result = await resolveVidyaCurriculum({ question: 'Ganitha Prakesh Part-1 Maths 7th — Chapter 5 how many lessons in there', userId: '507f1f77bcf86cd799439011', load: async () => [cbse, { ...cbse, board: 'IIT/NEET', track: 'ALPHA' }], Books: { find: () => ({ select: () => ({ lean: async () => [{ _id: 'book1', title: 'Ganitha Prakesh Part-1 Maths 7th', board: 'CBSE', class: '7', subject: 'Mathematics', productCategory: '' }] }) }) } });
  assert.equal(result.scope.board, 'CBSE');
  assert.deepEqual(result.bookIds, ['book1']);
});
test('sources omit unused passages and list each citation separately', () => {
  const sources = [1, 2, 3].map(i => ({ id: `B${i}`, title: 'Maths', chapter: 'Chapter 5', section: i }));
  assert.equal(textbookSourceFooter(sources, 'Answer [B1] [B2]'), '\n\nSources:\n• [B1] Maths — Chapter 5\n• [B2] Maths — Chapter 5');
});
test('IIT count never substitutes aggregate completion totals', () => {
  assert.match(answerByTopicAndShape('in iit how many videos', { desk: { totals: { videos: 0 } } }), /couldn’t load/);
});
