import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileV2InstructionMarks,
  validateV2QuestionContent,
} from '../ai/generators/_v2/six-section-quality.js';

function fixture() {
  return {
    schema: 'asli-v2-six-section',
    core: {
      title: 'Number Systems Practice Paper',
      instructions: 'Attempt all questions. Total marks: 40. Time: 45 minutes.',
      sectionA_mcq: [{ question: 'Q1', marks: 1 }],
      sectionB_fib: [{ question: 'Q2', marks: 1 }],
      sectionC_short: [{ question: 'Q3', marks: 2 }],
      sectionD_application: [{ question: 'Q4', marks: 3 }],
      sectionE_long: [{ question: 'Q5', marks: 5 }],
    },
    objectives: {},
    differentiation: {},
    assessment: {
      answerKey: [
        { q: '1', answer: 'A' },
        { q: '2', answer: 'Term' },
        { q: '3', answer: 'Two-point answer' },
        { q: '4', answer: 'Worked application answer' },
        { q: '5', answer: 'Complete long answer' },
      ],
    },
    teacher: {},
    reallife: {},
  };
}

test('reconciles the declared total with actual question marks', () => {
  const data = fixture();
  reconcileV2InstructionMarks(data);
  assert.match(data.core.instructions, /Total marks: 12\b/);
});

test('rejects placeholder answers and printed textbook references', () => {
  const data = fixture();
  data.assessment.answerKey[0].answer = 'Use chapter evidence about number systems.';
  data.assessment.answerKey[1].working = "Le Chatelier's Principle (Page 53-54)";
  const result = validateV2QuestionContent(data);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /placeholder answer/i);
  assert.match(result.errors.join(' '), /page, exercise, or figure reference/i);
});

test('accepts complete self-contained answer keys', () => {
  const result = validateV2QuestionContent(fixture());
  assert.deepEqual(result, { valid: true, errors: [] });
});
