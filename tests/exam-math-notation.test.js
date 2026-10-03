import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_SYSTEM_PROMPT } from '../ai/prompt-versioning/master-prompt.js';
import {
  EXAM_MATH_FIELD_DESCRIPTION,
  EXAM_PDF_MATH_FIDELITY_RULES,
  isMathAuditCandidate,
  mergeMathAuditRows,
} from '../utils/exam-math-notation.js';

describe('exam math notation contracts', () => {
  it('requires lossless stacked fractions during PDF extraction', () => {
    assert.match(EXAM_PDF_MATH_FIDELITY_RULES, /\\frac\{numerator\}\{denominator\}/);
    assert.match(EXAM_PDF_MATH_FIDELITY_RULES, /\\frac\{n\^2\+2\}\{2\}/);
    assert.match(EXAM_PDF_MATH_FIDELITY_RULES, /never omit the denominator/i);
    assert.match(EXAM_PDF_MATH_FIDELITY_RULES, /visually compare every math-bearing stem and option/i);
    assert.match(EXAM_MATH_FIELD_DESCRIPTION, /preserve all grouping\/operators/i);
  });

  it('requires the generation pipeline to emit renderable, unambiguous math', () => {
    assert.match(MASTER_SYSTEM_PROMPT, /LOSSLESS MATHEMATICAL EXPRESSIONS/);
    assert.match(MASTER_SYSTEM_PROMPT, /\\frac\{numerator\}\{denominator\}/);
    assert.match(MASTER_SYSTEM_PROMPT, /never drop a denominator\/operator\/bracket/i);
  });

  it('selects math rows for a second visual audit', () => {
    assert.equal(isMathAuditCandidate({ subject: 'maths', questionText: 'Natural numbers' }), true);
    assert.equal(isMathAuditCandidate({ subject: '', option1: '$\\frac{n+1}{2}$' }), true);
    assert.equal(isMathAuditCandidate({ subject: 'english', questionText: 'Choose the noun.' }), false);
  });

  it('merges audited math without detaching the correct answer from its option', () => {
    const original = [{
      questionNumber: 1,
      subject: 'maths',
      questionText: 'Choose.',
      option1: '$n^2+2^2$',
      option2: '$n^2-1$',
      option3: '$\\frac{n+2n+3}{2}$',
      option4: '$\\frac{n(n+1)}{4}$',
      correctAnswer: '$\\frac{n+2n+3}{2}$',
      marks: 1,
    }];
    const audited = [{
      questionNumber: 1,
      questionText: 'Choose.',
      option1: '$\\frac{n^2+2}{2}$',
      option2: '$n^2-1$',
      option3: '$\\frac{(n+2)(n+3)}{2}$',
      option4: '$\\frac{n(n+1)}{4}$',
    }];
    const [merged] = mergeMathAuditRows(original, audited);
    assert.equal(merged.option1, '$\\frac{n^2+2}{2}$');
    assert.equal(merged.option3, '$\\frac{(n+2)(n+3)}{2}$');
    assert.equal(merged.correctAnswer, '$\\frac{(n+2)(n+3)}{2}$');
    assert.equal(merged.marks, 1);
  });
});
