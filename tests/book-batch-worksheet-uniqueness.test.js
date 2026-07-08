import {
  finalizeWorksheetStructuredContent,
  repairWorksheetBatchDuplicates,
  rebuildWorksheetBatchVariant,
} from '../services/ai-content-engine-service.js';
import { validateRecordUniqueness } from '../services/ai-generator-uniqueness-engine.js';

const ragContext = `[Chunk 1]
Waves transfer energy without transferring matter. The amplitude of a wave determines its energy.
Frequency and wavelength are inversely related for a given medium.
Transverse waves oscillate perpendicular to the direction of propagation.

[Chunk 2]
Longitudinal waves compress and rarefy the medium. Sound is a longitudinal wave.
Echo is the reflection of sound. The speed of sound depends on temperature.`;

const meta = {
  subject: 'Physics',
  topic: 'Waves',
  subTopic: 'Waves and Wave Motion',
  bookGenerator: true,
  batchOrchestrator: true,
  strictValidation: false,
  pdfContext: ragContext,
};

const batchTexts = [];

for (let variant = 1; variant <= 5; variant += 1) {
  let structured = finalizeWorksheetStructuredContent(
    { title: `Waves Worksheet ${variant}`, sections: [] },
    {
      ...meta,
      generationVariant: variant,
      uniqueSeed: `book-batch-test-v${variant}`,
      avoidQuestionTexts: batchTexts,
    },
  );

  let uniqueness = validateRecordUniqueness('worksheet-mcq-generator', structured, {
    batchTexts,
    batchTitles: [],
    historicalTexts: [],
    historicalTitles: [],
  });

  if (!uniqueness.valid) {
    structured = repairWorksheetBatchDuplicates(structured, {
      ...meta,
      generationVariant: variant + 500,
      uniqueSeed: `book-batch-repair-v${variant}`,
      avoidQuestionTexts: batchTexts,
    });
    uniqueness = validateRecordUniqueness('worksheet-mcq-generator', structured, {
      batchTexts,
      batchTitles: [],
      historicalTexts: [],
      historicalTitles: [],
    });
  }

  if (!uniqueness.valid) {
    console.error(`FAIL variant ${variant}:`, uniqueness.errors.join('; '));
    process.exit(1);
  }

  const texts = (structured.sections || []).flatMap((s) =>
    (s.questions || []).map((q) => String(q?.question || '').trim()).filter(Boolean),
  );
  batchTexts.push(...texts);
}

// Slot 2+ rebuild must not collide with slot 1.
const slot1 = finalizeWorksheetStructuredContent(
  { title: 'Waves Worksheet 1', sections: [] },
  { ...meta, generationVariant: 1, uniqueSeed: 'slot1' },
);
const slot1Texts = (slot1.sections || []).flatMap((s) =>
  (s.questions || []).map((q) => String(q?.question || '').trim()).filter(Boolean),
);

const slot2 = rebuildWorksheetBatchVariant(
  { title: 'Waves Worksheet 2', sections: [] },
  {
    ...meta,
    generationVariant: 2,
    uniqueSeed: 'slot2',
    avoidQuestionTexts: slot1Texts,
  },
);

const slot2Uniq = validateRecordUniqueness('worksheet-mcq-generator', slot2, {
  batchTexts: slot1Texts,
  batchTitles: [],
  historicalTexts: [],
  historicalTitles: [],
});
if (!slot2Uniq.valid) {
  console.error('FAIL slot2 rebuild:', slot2Uniq.errors.join('; '));
  process.exit(1);
}

console.log('OK: 5 book-batch worksheet variants are mutually unique (+ slot2 rebuild)');
