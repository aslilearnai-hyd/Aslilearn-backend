import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MASTER_SYSTEM_PROMPT } from '../ai/prompt-versioning/master-prompt.js';
import {
  EXAM_MATH_FIELD_DESCRIPTION,
  EXAM_PDF_MATH_FIDELITY_RULES,
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
});
