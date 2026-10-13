import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyQuestionSlotMetadata,
  buildGenerationCountTelemetry,
  normalizeExamProfile,
  planQuestionSlots,
} from '../ai/planning/question-slot-planner.js';
import {
  validateChemicalEquationBalance,
  validateLatexIntegrity,
  validateStemQuestionSet,
} from '../ai/validation/stem-question-validator.js';
import { evaluateGenerationCostGuardrail } from '../ai/governance/ai-cost-guardrail.js';
import {
  identifyFailedQuestionSlots,
  mergeSelectiveQuestionRepairs,
} from '../ai/repair/selective-question-repair.js';
import {
  renderEquationMarkup,
  renderFunctionGraphSvg,
  renderLabelledDiagramSvg,
} from '../ai/rendering/stem-renderers.js';

test('exam profiles produce deterministic source-aware slots', () => {
  assert.equal(normalizeExamProfile('JEE Advanced'), 'JEE_ADVANCED');
  const first = planQuestionSlots({ count: 5, examProfile: 'JEE Advanced', subject: 'Physics', conceptIds: ['forces'] });
  const second = planQuestionSlots({ count: 5, examProfile: 'JEE Advanced', subject: 'Physics', conceptIds: ['forces'] });
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.ok(first.every((slot) => slot.difficulty === 'hard' && slot.reasoningSteps >= 4));
  assert.ok(first.some((slot) => slot.visualRequired));
});

test('historical slot signatures are excluded', () => {
  const initial = planQuestionSlots({ count: 1, examProfile: 'BOARD', subject: 'Chemistry', conceptIds: ['metals'] });
  const next = planQuestionSlots({
    count: 1,
    examProfile: 'BOARD',
    subject: 'Chemistry',
    conceptIds: ['metals'],
    forbiddenSignatures: [initial[0].signature],
  });
  assert.notEqual(next[0].signature, initial[0].signature);
});

test('slot metadata and generation telemetry distinguish attempts from saved output', () => {
  const slots = planQuestionSlots({ count: 2, subject: 'Mathematics', conceptIds: ['linear equations'] });
  const assigned = applyQuestionSlotMetadata(
    { core: { questions: [{ question: 'Solve x + 2 = 5.' }, { question: 'Plot y = 2x.' }] } },
    slots,
    { sourceChunkIds: ['chunk-1'], sourceAssetIds: ['asset-1'] },
  );
  assert.equal(assigned.assignedCount, 2);
  assert.deepEqual(assigned.structuredContent.core.questions[0].sourceChunkIds, ['chunk-1']);
  assert.deepEqual(buildGenerationCountTelemetry({ attempted: 3, generated: 2, repaired: 1 }), {
    attempt_count: 3,
    generated_count: 2,
    repaired_count: 1,
  });
});

test('STEM validation checks marks, grounding, options, LaTeX and chemistry', () => {
  assert.equal(validateChemicalEquationBalance('2H2 + O2 -> 2H2O').valid, true);
  assert.equal(validateChemicalEquationBalance('Ca(OH)2 + 2HCl -> CaCl2 + 2H2O').valid, true);
  assert.equal(validateChemicalEquationBalance('H2 + O2 -> H2O').valid, false);
  assert.equal(validateLatexIntegrity('\\frac{a}{b}').valid, true);
  assert.equal(validateLatexIntegrity('\\frac{a}{b').valid, false);

  const result = validateStemQuestionSet(
    {
      questions: [{
        slotId: 'Q1',
        question: 'Which value is correct?',
        options: ['1', '2', '3', '4'],
        answer: '2',
        marks: 2,
        stepMarks: [{ marks: 1 }, { marks: 1 }],
        sourceChunkIds: ['chunk-1'],
        difficulty: 'medium',
        bloom: 'apply',
      }],
    },
    {
      expectedCount: 1,
      totalMarks: 2,
      optionCount: 4,
      approvedChunkIds: ['chunk-1'],
      slots: [{ slotId: 'Q1', visualRequired: false }],
    },
  );
  assert.equal(result.valid, true);
});

test('cost guardrail alerts at 13 percent and blocks beyond 15 percent', () => {
  assert.equal(evaluateGenerationCostGuardrail({ currentCost: 1.12, baselineCost: 1 }).status, 'within_target');
  assert.equal(evaluateGenerationCostGuardrail({ currentCost: 1.13, baselineCost: 1 }).status, 'alert');
  const blocked = evaluateGenerationCostGuardrail({ currentCost: 1.16, baselineCost: 1 });
  assert.equal(blocked.status, 'hard_ceiling_exceeded');
  assert.equal(blocked.allowed, false);
});

test('selective repair replaces only rejected slots', () => {
  const structured = { questions: [
    { slotId: 'Q1', question: 'Keep this valid question.' },
    { slotId: 'Q2', question: 'INSUFFICIENT_CONTEXT' },
  ] };
  const failed = identifyFailedQuestionSlots(structured, [{ slotId: 'Q2', code: 'GROUNDING_SOURCE_REQUIRED' }]);
  const merged = mergeSelectiveQuestionRepairs(structured, failed, [{ slotId: 'Q2', question: 'Replacement question.' }]);
  assert.equal(merged.repairedCount, 1);
  assert.equal(merged.structuredContent.questions[0].question, 'Keep this valid question.');
  assert.equal(merged.structuredContent.questions[1].question, 'Replacement question.');
});

test('deterministic renderers emit safe SVG and canonical equation markup', () => {
  const graph = renderFunctionGraphSvg({ fn: (x) => x * x, xMin: -2, xMax: 2, yMin: 0, yMax: 4 });
  assert.match(graph, /^<svg/);
  assert.match(graph, /polyline/);
  const diagram = renderLabelledDiagramSvg({
    shapes: [{ type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }],
    labels: [{ x: 5, y: 5, text: '<force>' }],
  });
  assert.match(diagram, /&lt;force&gt;/);
  assert.equal(renderEquationMarkup({ latex: 'H2 + O2', chemistry: true }), '\\ce{H2 + O2}');
});
