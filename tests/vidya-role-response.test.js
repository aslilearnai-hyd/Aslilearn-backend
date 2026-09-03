import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
let payload;
let answer = 'There are 3 pending submissions.';
mock.module('../services/model-router.js', { namedExports: {
  callModel: async value => { payload = value; return { text: answer }; },
  buildContentsFromHistory: value => value,
} });
mock.module('../services/gemini-service.js', { defaultExport: {} });
const { formatDynamicResponse } = await import('../services/vidya-ai-control/response-formatter.js');

test('teacher answers receive scoped facts, question and earlier context', async () => {
  const history = [{ role: 'user', content: 'I mean my homework queue' }];
  const reply = await formatDynamicResponse({
    userPrompt: 'How many are pending?', history, viewerRole: 'teacher',
    plan: { mode: 'teacher_desk' },
    facts: { mode: 'teacher_desk', pending: 3, fallbackMessage: '3 pending.' },
  });
  assert.equal(reply, answer);
  assert.deepEqual(payload.contents.history, history);
  assert.match(payload.systemInstruction, /"pending":3/);
});
test('invented counts are rejected in favor of the factual fallback', async () => {
  answer = 'There are 999 pending submissions.';
  const reply = await formatDynamicResponse({
    userPrompt: 'How many are pending?', viewerRole: 'teacher',
    plan: { mode: 'teacher_desk' },
    facts: { mode: 'teacher_desk', pending: 3, fallbackMessage: '3 pending.' },
  });
  assert.equal(reply, '3 pending.');
});
