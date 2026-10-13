import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensurePracticeQaAllSectionsFilled,
  getPracticeQaMissingSections,
  PRACTICE_QA_SECTION_LABELS,
} from '../ai/generators/core/ai-content-engine-service.js';
import { dedupeIntraRecordQuestions } from '../ai/generators/shared/ai-generator-uniqueness-engine.js';

test('premium Smart Q&A restores an omitted Section E without dropping valid sections', () => {
  const existingLabels = Object.values(PRACTICE_QA_SECTION_LABELS).filter(
    (label) => label !== PRACTICE_QA_SECTION_LABELS.E,
  );
  const source = {
    title: 'Cube Roots Practice',
    sections: existingLabels.map((sectionName, index) => ({
      sectionName,
      questions: [
        {
          question: `Specific cube-root question ${index + 1}?`,
          answer: `Specific answer ${index + 1}`,
          ...(sectionName === PRACTICE_QA_SECTION_LABELS.A
            ? { options: ['A) 2', 'B) 3', 'C) 4', 'D) 5'] }
            : {}),
        },
      ],
    })),
  };

  assert.deepEqual(getPracticeQaMissingSections(source), [PRACTICE_QA_SECTION_LABELS.E]);

  const repaired = ensurePracticeQaAllSectionsFilled(source, {
    qualityTier: 'premium',
    board: 'IIT',
    classLabel: 'Class 8',
    subject: 'Mathematics',
    topic: 'Cubes and Cube Roots',
    subTopic: 'Cube Roots',
    questionCount: 10,
  });

  assert.deepEqual(getPracticeQaMissingSections(repaired), []);
  assert.equal(repaired.sections.length, 7);
  assert.match(
    repaired.sections.find((section) => section.sectionName === PRACTICE_QA_SECTION_LABELS.E)
      .questions[0].question,
    /Cube Roots/i,
  );

  const deduped = dedupeIntraRecordQuestions('smart-qa-practice-generator', repaired);
  assert.deepEqual(getPracticeQaMissingSections(deduped), []);
  assert.equal(deduped.sections.length, 7);
  assert.equal(deduped.questions.length, 10);
});
