import test from 'node:test';
import assert from 'node:assert/strict';
import { detectQueryIntent } from '../services/vidya-student/query-intent-detection-engine.js';
import { classifyPlatformDataQuestion } from '../services/vidya-platform-data-firewall.js';

for (const question of ["what's my name", 'what is my name', 'who am i']) {
  test(`name questions stay on the student profile path: ${question}`, () => {
    assert.equal(detectQueryIntent(question).type, 'application');
    assert.equal(classifyPlatformDataQuestion(question, 'student').protected, true);
  });
}
for (const question of ['Teach me magnetic field', 'make it simpler', 'Explain photosynthesis today', 'Give me a quiz on photosynthesis', 'I am confused about fractions', 'Help me with my homework on fractions', 'continue']) {
  test(`learning stays out of dashboard: ${question}`, () => {
    assert.equal(detectQueryIntent(question).type, 'general');
    for (const role of ['student', 'teacher']) assert.equal(classifyPlatformDataQuestion(question, role).protected, false);
  });
}
for (const question of ['explain my marks', 'show my homework', 'explain my attendance', 'show my exam results', 'explain my progress', "what's my name", 'what is my name']) {
  test(`private records retain grounding: ${question}`, () => {
    assert.equal(classifyPlatformDataQuestion(question, 'student').protected, true);
  });
}
