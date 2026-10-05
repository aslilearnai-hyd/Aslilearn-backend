import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_SYSTEM_PROMPT } from '../ai/prompt-versioning/master-prompt.js';
import {
  EXAM_MATH_FIELD_DESCRIPTION,
  EXAM_PDF_MATH_FIDELITY_RULES,
  flagWordMathTranscriptionConflicts,
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
    assert.equal(isMathAuditCandidate({ subject: '', option1: 'n² + 2²' }), true);
    assert.equal(isMathAuditCandidate({ subject: '', option1: '(n+2)(n+3)' }), true);
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

  it('uses the independently solved audit answer after repairing a fraction', () => {
    const original = [{
      questionNumber: 1,
      subject: 'maths',
      questionText: 'Which expression is always a natural number?',
      option1: '$n^2+2^2$',
      option2: '$n^2-1$',
      option3: '$\\frac{n+2}{n+3^2}$',
      option4: '$\\frac{n(n+1)}{4}$',
      correctAnswer: '$n^2+2^2$',
      explanation: 'The first-pass OCR chose A.',
    }];
    const audited = [{
      questionNumber: 1,
      questionText: 'Which expression is always a natural number?',
      option1: '$\\frac{n^2+2}{2}$',
      option2: '$n^2-1$',
      option3: '$\\frac{(n+2)(n+3)}{2}$',
      option4: '$\\frac{n(n+1)}{4}$',
      correctAnswer: '$\\frac{(n+2)(n+3)}{2}$',
      explanation: 'One of two consecutive integers is even.',
    }];

    const [merged] = mergeMathAuditRows(original, audited);
    assert.equal(merged.option1, '$\\frac{n^2+2}{2}$');
    assert.equal(merged.option3, '$\\frac{(n+2)(n+3)}{2}$');
    assert.equal(merged.correctAnswer, '$\\frac{(n+2)(n+3)}{2}$');
    assert.equal(merged.explanation, 'One of two consecutive integers is even.');
  });

  it('flags a Word fraction that the extraction changed into an exponent', () => {
    const source = '1. Which expression is always natural?\na) $\\frac{n^{2}+2}{2}$\nb) $n^{2}-1$\nc) $\\frac{(n+2)(n+3)}{2}$\nd) $\\frac{n(n+1)}{4}$\n2. Next question';
    const rows = [{
      questionNumber: 1,
      questionText: 'Which expression is always natural?',
      option1: '$n^2+2^2$',
      option2: '$n^2-1$',
      option3: '$\\frac{n+2}{n+3^2}$',
      option4: '$\\frac{n(n+1)}{4}$',
      correctAnswer: '$n^2+2^2$',
    }];
    const [flagged] = flagWordMathTranscriptionConflicts(rows, source);
    assert.equal(flagged.answerConflict, true);
    assert.equal(flagged.conflictReason, 'math_transcription');
    assert.equal(flagged.option1, rows[0].option1);
    const [faithful] = flagWordMathTranscriptionConflicts([{
      ...rows[0],
      option1: '$\\frac{n^2+2}{2}$',
      option3: '$\\frac{(n+2)(n+3)}{2}$',
    }], source);
    assert.equal(faithful.answerConflict, undefined);
  });
});
