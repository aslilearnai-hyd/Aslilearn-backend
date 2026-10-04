import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginTokenUsageSession,
  endTokenUsageSession,
  recordTokenUsage,
} from '../ai/providers/gemini-service.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function simulateGeneration(label, promptTokens, completionTokens, delayMs) {
  beginTokenUsageSession(label);
  await wait(delayMs);
  recordTokenUsage({
    label: 'generate',
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  });
  await wait(delayMs);
  return endTokenUsageSession();
}

test('concurrent generations keep independent token and cost sessions', async () => {
  const [student, teacher] = await Promise.all([
    simulateGeneration('student', 7000, 5000, 8),
    simulateGeneration('teacher', 3000, 1200, 3),
  ]);

  assert.equal(student.label, 'student');
  assert.deepEqual(student.totals, {
    promptTokens: 7000,
    completionTokens: 5000,
    totalTokens: 12000,
    callCount: 1,
  });
  assert.equal(teacher.label, 'teacher');
  assert.deepEqual(teacher.totals, {
    promptTokens: 3000,
    completionTokens: 1200,
    totalTokens: 4200,
    callCount: 1,
  });
});
