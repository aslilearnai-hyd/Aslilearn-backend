import {
  finalizeWorksheetStructuredContent,
  repairWorksheetBatchDuplicates,
} from '../services/ai-content-engine-service.js';
import {
  collectQuestionTextsFromStructured,
  validateRecordUniqueness,
} from '../services/ai-generator-uniqueness-engine.js';

const baseMeta = {
  subject: 'Biology',
  topic: 'Chapter 1 - The Wonderful World of Science',
  subTopic: 'Curiosity and exploration',
  batchOrchestrator: true,
  strictValidation: false,
};

const batchTexts = [];
for (let v = 1; v <= 2; v += 1) {
  const out = finalizeWorksheetStructuredContent({ title: `Worksheet ${v}`, sections: [] }, {
    ...baseMeta,
    generationVariant: v,
    variantAngle: `angle-${v}`,
    variantScenario: `scenario-${v}`,
    uniqueSeed: `seed-${v}`,
  });
  batchTexts.push(...collectQuestionTextsFromStructured(out, 'worksheet-mcq-generator'));
}

const duplicateStem = 'Describe an observation task that clarifies Curiosity and exploration.';
const batchTextsWithCollision = [...batchTexts, duplicateStem];
const colliding = finalizeWorksheetStructuredContent(
  {
    title: 'Worksheet 3',
    sections: [
      {
        sectionName: 'Section D: Short Answer Questions',
        questions: [
          {
            question_number: 1,
            type: 'SA',
            question: duplicateStem,
            answer: 'Sample',
            marks: 3,
          },
        ],
      },
    ],
  },
  { ...baseMeta, generationVariant: 3, uniqueSeed: 'seed-3' },
);

const repaired = repairWorksheetBatchDuplicates(colliding, {
  ...baseMeta,
  generationVariant: 3,
  uniqueSeed: 'seed-3-repair',
  avoidQuestionTexts: batchTextsWithCollision,
});

const uniqueness = validateRecordUniqueness('worksheet-mcq-generator', repaired, {
  batchTexts: batchTextsWithCollision,
  batchTitles: [],
  historicalTexts: [],
  historicalTitles: [],
});

if (!uniqueness.valid) {
  console.error('FAIL: repair did not clear batch duplicates', uniqueness.errors);
  process.exit(1);
}

const repairedTexts = collectQuestionTextsFromStructured(repaired, 'worksheet-mcq-generator');
if (repairedTexts.some((t) => t === duplicateStem)) {
  console.error('FAIL: duplicate stem still present after repair');
  process.exit(1);
}

console.log('OK: batch duplicate repair produces unique worksheet questions');
