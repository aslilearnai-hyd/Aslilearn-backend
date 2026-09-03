import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCurriculumRequest, resolveVidyaCurriculum } from '../services/vidya-curriculum.js';
const userId = '507f1f77bcf86cd799439011';
const scope = { board: 'IIT/NEET', track: 'ALPHA', classNumber: '6', subject: 'mathematics' };
const rows = [
  { topicName: 'Chapter 2 - Lines and Angles', subTopic: 'Angles', sortOrder: 2 },
  { topicName: 'Chapter 1 - Pattern In Mathematics', subTopic: 'Patterns in Numbers and their Visualization', sortOrder: 1 },
  { topicName: 'Chapter 1 - Pattern In Mathematics', subTopic: 'Relations among Number Sequences', sortOrder: 1 },
];
function topics(data, check = () => {}) {
  return { find(filter) { check(filter); return { select: () => ({ limit: () => ({ lean: async () => data }) }) }; } };
}
test('screenshot request resolves exact Alpha chapter 1 and subtopics', async () => {
  const result = await resolveVidyaCurriculum({ question: 'Teach me 6th maths alpha 1st chapter', userId, role: 'teacher', load: async () => [scope], Topics: topics(rows, filter => {
    assert.ok(filter.productCategory.test('ALPHA'));
    assert.equal(filter.productCategory.test('BETA'), false);
    assert.ok(filter.subject.test('Mathematics'));
    assert.equal(filter.board.$in.some(r => r.test('CBSE')), false);
  }) });
  assert.match(result.context, /Chapter 1 - Pattern In Mathematics/);
  assert.match(result.context, /Relations among Number Sequences/);
  assert.doesNotMatch(result.context, /Knowing Our Numbers|Lines and Angles/);
});
test('ordinal chapter must not become class number', () => {
  assert.equal(parseCurriculumRequest('teach alpha 1st chapter').classNumber, '');
  assert.equal(parseCurriculumRequest('class 6 maths first chapter').chapter, 1);
});
test('unavailable, ambiguous and unauthorized curriculum asks instead of guessing', async () => {
  for (const scopes of [[], [scope, { ...scope, board: 'CBSE' }]]) {
    const result = await resolveVidyaCurriculum({ question: 'maths chapter 1', userId, load: async () => scopes, Topics: topics(rows) });
    assert.ok(result.clarification);
  }
  const result = await resolveVidyaCurriculum({ question: 'alpha maths chapter 9', userId, load: async () => [scope], Topics: topics(rows) });
  assert.equal(result.clarification, undefined);
  assert.equal(result.topicsMissing, true);
  assert.equal(result.request.chapter, 9);
  assert.deepEqual(result.scopes, [scope]);
});
test('follow-up after a maths chapter ask keeps the maths subject', () => {
  const request = parseCurriculumRequest('how do inverse operations work?', [
    { role: 'user', content: 'Teach me chapter 2 alpha iit maths' },
  ]);
  assert.equal(request.subject, 'maths');
  assert.equal(request.chapter, 2);
  assert.equal(request.track, 'ALPHA');
});
test('learning follow-up keeps only the asked subject scopes', async () => {
  const maths = { board: 'IIT/NEET', track: 'ALPHA', classNumber: '7', subject: 'mathematics' };
  const result = await resolveVidyaCurriculum({
    question: 'how do inverse operations work?',
    history: [{ role: 'user', content: 'Teach me chapter 2 alpha iit maths' }],
    userId,
    forLearning: true,
    load: async () => [maths, { ...maths, subject: 'chemistry' }, { ...maths, subject: 'physics' }],
    Topics: topics(rows),
  });
  assert.equal(result.clarification, undefined);
  assert.deepEqual(result.scopes.map(s => s.subject), ['mathematics']);
  assert.equal(result.request.subject, 'maths');
});
test('general concept needs no curriculum database lookup', async () => {
  const result = await resolveVidyaCurriculum({ question: 'what is a magnetic field?', load: () => { throw new Error('should not load'); } });
  assert.equal(result.context, '');
});
