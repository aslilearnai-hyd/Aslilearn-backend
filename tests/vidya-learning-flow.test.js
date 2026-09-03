import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// No database access or paid provider requests in this regression suite.
let fail = false;
let received;
mock.module('../services/model-router.js', { namedExports: {
  callModel: async (payload) => {
    received = payload;
    if (fail) throw new Error('provider unavailable');
    return { text: 'A magnetic field is the region where magnetic forces act.' };
  },
  buildContentsFromHistory: ({ history = [], userMessage }) => [...history, { role: 'user', content: userMessage }],
} });
mock.module('../services/vidya-teacher/teacher-app-desk-facts.js', { namedExports: {
  buildTeacherAppDeskFacts: async () => ({ classes: [{ classNumber: '6' }, { classNumber: '8' }], students: [], totals: {} }),
  teacherAppOnlyReply: () => 'DASHBOARD SNAPSHOT',
} });
const { runHybridTeacherVidyaChat } = await import('../services/vidya-teacher/teacher-hybrid-chat-controller.js');

test('teacher learning and follow-ups use model history, not dashboard', async () => {
  const history = [{ role: 'user', content: 'Teach me magnetic field' }, { role: 'assistant', content: 'Magnetic fields exert forces.' }];
  for (const question of ['Teach me magnetic field', 'make it simpler', 'photosynthesis']) {
    const result = await runHybridTeacherVidyaChat({ viewerUserId: 'test', question, history });
    assert.equal(result.mode, 'general');
    assert.match(result.message, /magnetic field/);
    assert.deepEqual(received.contents.slice(0, 2), history);
    assert.doesNotMatch(received.systemInstruction, /Class 6 students/);
  }
});
test('teacher provider failure never becomes a dashboard success', async () => {
  fail = true;
  try {
    const result = await runHybridTeacherVidyaChat({ viewerUserId: 'test', question: 'Teach me magnetic field' });
    assert.equal(result.groundingStatus, 'ai_error');
    assert.doesNotMatch(result.message, /DASHBOARD/);
    assert.equal(result.facts, null);
  } finally { fail = false; }
});
test('selected teacher subject overrides a different subject in earlier chat', async () => {
  const history = [{ role: 'user', content: 'Teach chemistry mixtures' }];
  const result = await runHybridTeacherVidyaChat({
    viewerUserId: 'test', question: 'Explain this topic with examples', history,
    context: { currentSubject: 'BIO - 7' },
  });
  assert.equal(result.mode, 'general');
  assert.match(received.contents.at(-1).content, /Selected subject: BIO - 7/);
  assert.match(received.systemInstruction, /Indian/);
});
