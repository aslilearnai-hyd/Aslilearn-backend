import { finalizeWorksheetStructuredContent } from '../services/ai-content-engine-service.js';
import { collectQuestionTextsFromStructured } from '../services/ai-generator-uniqueness-engine.js';

const baseMeta = {
  subject: 'Chemistry',
  topic: 'Chapter 1 - Particulate Nature of Matter',
  subTopic: 'Matter is Made of Particles',
  batchOrchestrator: true,
  strictValidation: false,
};

const variants = [1, 6, 8, 10];
const allTexts = [];
for (const v of variants) {
  const out = finalizeWorksheetStructuredContent({ title: `Worksheet ${v}`, sections: [] }, {
    ...baseMeta,
    generationVariant: v,
    variantAngle: `angle-${v}`,
    variantScenario: `scenario-${v}`,
    uniqueSeed: `seed-${v}`,
  });
  allTexts.push(...collectQuestionTextsFromStructured(out, 'worksheet-mcq-generator'));
}

const unique = new Set(allTexts.map((t) => t.toLowerCase().trim()));
if (unique.size < allTexts.length * 0.75) {
  console.error('FAIL: variants produced too many duplicate stems', unique.size, '/', allTexts.length);
  console.error([...unique].slice(0, 5));
  process.exit(1);
}

console.log('OK: variant worksheet stems are diverse enough', unique.size, 'unique of', allTexts.length);
