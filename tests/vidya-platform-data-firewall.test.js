import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPlatformDataQuestion,
  enforceGroundingResult,
} from '../services/vidya-platform-data-firewall.js';

const protectedCases = [
  ['student', 'show my marks'],
  ['student', 'what is my exam result'],
  ['student', 'where am I weak'],
  ['student', 'what should I study today'],
  ['student', 'show my homework'],
  ['student', 'how many videos have I watched'],
  ['student', 'my attendance'],
  ['teacher', 'list my students'],
  ['teacher', 'tell me about a student by name'],
  ['teacher', 'student report'],
  ['teacher', 'how many students do I have'],
  ['teacher', 'list the latest exams'],
  ['teacher', 'exams last month'],
  ['teacher', 'show my classes'],
  ['teacher', 'class performance'],
  ['admin', 'show my school students'],
  ['admin', 'school analytics'],
  ['super-admin', 'show active users'],
];

for (const [role, question] of protectedCases) {
  test(`${role} platform data is protected: ${question}`, () => {
    assert.equal(classifyPlatformDataQuestion(question, role).protected, true);
  });
}

const knowledgeCases = [
  ['student', 'explain photosynthesis'],
  ['student', 'derive the quadratic formula'],
  ['teacher', 'what is the meaning of student'],
  ['teacher', 'explain Newton laws'],
  ['admin', 'define formative assessment'],
  ['student', 'hello'],
];

for (const [role, question] of knowledgeCases) {
  test(`${role} knowledge remains available: ${question}`, () => {
    assert.equal(classifyPlatformDataQuestion(question, role).protected, false);
  });
}

test('protected data cannot leave with general-knowledge grounding', () => {
  const result = enforceGroundingResult(
    { message: 'invented', groundingStatus: 'general_knowledge', facts: { private: true } },
    { protected: true },
  );
  assert.equal(result.groundingStatus, 'grounding_blocked');
  assert.equal(result.facts, null);
  assert.doesNotMatch(result.message, /invented/);
});

test('database-grounded protected answers pass', () => {
  const source = { message: 'verified', groundingStatus: 'application', facts: { count: 3 } };
  assert.equal(enforceGroundingResult(source, { protected: true }), source);
});
