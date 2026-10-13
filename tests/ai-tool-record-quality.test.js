import assert from 'node:assert/strict';
import test from 'node:test';

import { auditAiToolRecordQuality } from '../ai/validation/ai-tool-record-quality.js';

function v2Record() {
  const structuredContent = {
    schema: 'asli-v2-six-section',
    tool: 'exam-question-paper-generator',
    core: {
      title: 'Atoms Practice Paper',
      instructions: 'Attempt all questions. Total marks: 40.',
      sectionA_mcq: [{ question: 'What is atomic number?', options: ['A) Protons', 'B) Neutrons'], answer: 'A) Protons', marks: 1 }],
      sectionB_fib: [{ question: 'A neutral atom has equal ___ and electrons.', answer: 'protons', marks: 1 }],
      sectionC_short: [{ question: 'Define isotope.', answer: 'Atoms of one element with different mass numbers.', marks: 2 }],
      sectionD_application: [{ question: 'Find neutrons for mass 23 and atomic number 11.', answer: '12', marks: 3 }],
      sectionE_long: [{ question: 'Explain atomic structure.', answer: 'Complete explanation.', marks: 5 }],
    },
    objectives: { items: ['Explain atomic structure'] },
    differentiation: { tiers: [{ label: 'Support', value: 'Use a particle table.' }] },
    assessment: {
      answerKey: [
        { q: '1', answer: 'A) Protons' },
        { q: '2', answer: 'protons' },
        { q: '3', answer: 'Atoms of one element with different mass numbers.' },
        { q: '4', answer: '12', working: '23 - 11 = 12' },
        { q: '5', answer: 'Nucleus contains protons and neutrons; electrons occupy shells.', working: 'Five-mark response.' },
      ],
    },
    teacher: { items: ['Review particle notation.'] },
    reallife: { items: ['Discuss medical isotopes.'] },
  };
  const content = JSON.stringify(structuredContent);
  return {
    toolName: 'exam-question-paper-generator',
    board: 'CBSE',
    classLabel: 'Class 8',
    subject: 'Chemistry',
    topic: 'Atoms',
    subtopic: 'Atomic Structure',
    content,
    generatedContent: content,
    metadata: { board: 'CBSE', subject: 'Chemistry', topic: 'Atoms', structuredContent },
  };
}

test('AI Tool Data audit produces a deterministic marks repair', () => {
  const result = auditAiToolRecordQuality(v2Record());
  assert.ok(result.issues.some((item) => item.code === 'DECLARED_MARKS_MISMATCH'));
  assert.match(result.repair.structuredContent.core.instructions, /Total marks: 12\b/);
});

test('AI Tool Data audit detects curriculum and placeholder mismatches', () => {
  const row = v2Record();
  row.metadata.subject = 'Physics';
  row.metadata.structuredContent.assessment.answerKey[0].answer = 'Use chapter evidence.';
  row.content = JSON.stringify(row.metadata.structuredContent);
  row.generatedContent = row.content;
  const result = auditAiToolRecordQuality(row);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((item) => item.code === 'CURRICULUM_SUBJECT_MISMATCH'));
  assert.ok(result.issues.some((item) => item.code === 'V2_QUESTION_QUALITY'));
});

