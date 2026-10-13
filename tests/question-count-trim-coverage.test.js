import assert from 'node:assert/strict';
import test from 'node:test';

import { trimUsableQuestionsToCount } from '../utils/v2-structured-to-legacy.js';

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
