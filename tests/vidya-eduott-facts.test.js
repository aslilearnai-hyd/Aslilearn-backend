import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEduOtt } from '../services/vidya-student/eduott-facts.js';
import { answerByTopicAndShape } from '../services/vidya-student/student-app-query-router.js';
const bundle = { studentClassNum: '7', programCtx: { isAsliPrepExclusive: true, iitCategories: ['ALPHA', 'BETA'] }, contents: [
  { title: 'A', type: 'Video', fileUrl: 'https://example.com/a', productCategory: 'ALPHA' },
  { title: 'A copy', type: 'Video', fileUrl: 'https://example.com/a', productCategory: 'ALPHA' },
  { title: 'B', type: 'Video', fileUrl: 'https://example.com/b', productCategory: 'BETA' },
] };
test('EduOTT counts available deduplicated videos, not watch progress', () => {
  const eduott = summarizeEduOtt(bundle, 'in iit how many videos');
  assert.equal(eduott.total, 2);
  assert.match(answerByTopicAndShape('in iit how many videos', { eduott, desk: { totals: { videos: 0 } } }), /\*\*2 IIT videos\*\*/);
});
test('requested track count is filtered', () => {
  assert.equal(summarizeEduOtt(bundle, 'alpha videos').total, 1);
});
test('disabled program differs from verified empty catalog and lookup failure', () => {
  const disabled = summarizeEduOtt({ ...bundle, programCtx: {} }, 'iit videos');
  assert.match(answerByTopicAndShape('iit videos', { eduott: disabled }), /not enabled/);
  const empty = summarizeEduOtt({ ...bundle, contents: [] }, 'iit videos');
  assert.match(answerByTopicAndShape('iit videos', { eduott: empty }), /\*\*0 IIT videos\*\*/);
  assert.match(answerByTopicAndShape('iit videos', { eduott: { verified: false } }), /couldn’t load/);
});
