import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapV2StructuredToLegacy,
  trimUsableQuestionsToCount,
} from '../utils/v2-structured-to-legacy.js';
import {
  finalizePracticeQaStructuredContent,
  finalizeWorksheetStructuredContent,
  getPracticeQaMissingSections,
} from '../ai/generators/core/ai-content-engine-service.js';
import { validateStemQuestionSet } from '../ai/validation/stem-question-validator.js';

test('question-count trimming preserves every populated Smart Q&A section', () => {
  const sectionNames = [
    'Section A: MCQs',
    'Section B: Fill in the Blanks',
    'Section C: True or False',
    'Section D: Very Short Answer Questions',
    'Section E: Short Answer Questions',
    'Section F: Application / Case-based Questions',
    'Section G: HOTS / Analytical Questions',
  ];
  const sections = sectionNames.map((sectionName, sectionIndex) => ({
    sectionName,
    questions: Array.from({ length: sectionIndex < 3 ? 4 : 1 }, (_, questionIndex) => ({
      question: `${sectionName} specific question ${questionIndex + 1}?`,
      answer: `Answer ${sectionIndex + 1}.${questionIndex + 1}`,
    })),
  }));

  const { legacy } = trimUsableQuestionsToCount(null, { sections }, 10);
  const counts = legacy.sections.map((section) => section.questions.length);

  assert.equal(counts.reduce((sum, count) => sum + count, 0), 10);
  assert.ok(counts.every((count) => count >= 1));
  assert.equal(legacy.sections[4].sectionName, 'Section E: Short Answer Questions');
  assert.equal(legacy.sections[4].questions.length, 1);
});

test('V2 Smart Q&A fills an omitted Section F before trimming to the requested count', () => {
  const makeRows = (prefix, count, type) =>
    Array.from({ length: count }, (_, index) => ({
      question: `${prefix} cube-root question ${index + 1}?`,
      answer: `Answer ${index + 1}`,
      type,
    }));
  const v2 = {
    schema: 'asli-v2-six-section',
    tool: 'smart-qa-practice-generator',
    core: {
      title: 'Cube Roots Practice',
      instructions: 'Answer every question.',
      sectionA_mcq: makeRows('MCQ', 4, 'MCQ'),
      sectionB_fib: makeRows('Fill', 3, 'FIB'),
      sectionC_short: makeRows('True or false', 2, 'VSA'),
      sectionD_application: makeRows('Very short', 1, 'SA'),
      sectionE_long: makeRows('Short answer', 1, 'COMPETENCY'),
      sectionF_case: [],
      sectionG_hots: makeRows('HOTS', 1, 'HOTS'),
    },
    objectives: { items: ['Recognise perfect cubes', 'Find cube roots'] },
    assessment: { answerKey: [] },
  };
  const meta = {
    board: 'CBSE',
    classLabel: 'Class 8',
    subject: 'Mathematics',
    topic: 'Cubes and Cube Roots',
    subTopic: 'Cube Roots',
    questionCount: 10,
    generationVariant: 1,
  };

  const mapped = mapV2StructuredToLegacy('smart-qa-practice-generator', v2);
  const finalized = finalizePracticeQaStructuredContent(mapped, meta);
  const { legacy } = trimUsableQuestionsToCount(null, finalized, 10);

  assert.deepEqual(getPracticeQaMissingSections(legacy), []);
  assert.equal(
    legacy.sections.reduce((sum, section) => sum + section.questions.length, 0),
    10,
  );
  assert.equal(legacy.sections[5].questions.length, 1);
});

test('final pre-save pass restores Section F lost after an earlier normalization pass', () => {
  const sections = [
    'Section A: MCQs',
    'Section B: Fill in the Blanks',
    'Section C: True or False',
    'Section D: Very Short Answer Questions',
    'Section E: Short Answer Questions',
    'Section F: Application / Case-based Questions',
    'Section G: HOTS / Analytical Questions',
  ].map((sectionName, sectionIndex) => ({
    sectionName,
    questions:
      sectionIndex === 5
        ? []
        : Array.from({ length: sectionIndex < 3 ? 3 : 1 }, (_, questionIndex) => ({
            question: `${sectionName} cube-root question ${questionIndex + 1}?`,
            answer: `Answer ${sectionIndex + 1}.${questionIndex + 1}`,
          })),
  }));
  const meta = {
    board: 'CBSE',
    classLabel: 'Class 8',
    subject: 'Mathematics',
    topic: 'Cubes and Cube Roots',
    subTopic: 'Cube Roots',
    questionCount: 10,
    generationVariant: 2,
  };

  const finalized = finalizePracticeQaStructuredContent(
    { title: 'Cube Roots Practice', sections },
    meta,
  );
  const { legacy } = trimUsableQuestionsToCount(null, finalized, 10);

  assert.deepEqual(getPracticeQaMissingSections(legacy), []);
  assert.equal(
    legacy.sections.reduce((sum, section) => sum + section.questions.length, 0),
    10,
  );
  assert.match(legacy.sections[5].questions[0].question, /Cube Roots/i);
});

test('worksheet finalization expands a one-per-section response to the exact requested count', () => {
  const initial = {
    title: 'Cube Roots Worksheet',
    sections: [
      { sectionName: 'Section A: MCQs', questions: [{ type: 'MCQ', question: 'Which is a perfect cube?', options: ['A) 8', 'B) 9', 'C) 10', 'D) 12'], answer: 'A) 8' }] },
      { sectionName: 'Section B: Fill in the Blanks', questions: [{ type: 'FIB', question: 'The cube root of 27 is ___.', answer: '3' }] },
      { sectionName: 'Section C: Very Short Answer Questions', questions: [{ type: 'VSA', question: 'Define a perfect cube.', answer: 'A cube of an integer.' }] },
      { sectionName: 'Section D: Short Answer Questions', questions: [{ type: 'SA', question: 'Explain how to find a cube root.', answer: 'Use prime factorisation.' }] },
      { sectionName: 'Section E: Competency / Real-life Application Questions', questions: [{ type: 'COMPETENCY', question: 'Apply cube roots to find a cube edge.', answer: 'Take the cube root of its volume.' }] },
    ],
  };
  const finalized = finalizeWorksheetStructuredContent(initial, {
    batchOrchestrator: true,
    bookGenerator: true,
    subject: 'Mathematics',
    topic: 'Cubes and Cube Roots',
    subTopic: 'Cube Roots',
    questionCount: 20,
    generationVariant: 3,
  });
  const counts = finalized.sections.map((section) => section.questions.length);
  assert.deepEqual(counts, [8, 2, 4, 5, 1]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 20);
  assert.equal(new Set(finalized.questions.map((question) => question.question)).size, 20);
  assert.ok(finalized.sections[0].questions.every((question) => question.options.length === 4));
  const stemGate = validateStemQuestionSet(finalized, { expectedCount: 20, optionCount: 4 });
  assert.equal(stemGate.valid, true, stemGate.findings.map((finding) => finding.code).join(', '));
});
