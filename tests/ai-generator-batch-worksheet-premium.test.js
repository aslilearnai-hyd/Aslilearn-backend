import {
  finalizeWorksheetStructuredContent,
  validateToolSpecificStructuredContent,
} from '../services/ai-content-engine-service.js';
import { runAiGeneratorQualityGate } from '../services/ai-generator-quality-gate.js';

const emptyWorksheet = {
  title: 'Bases — Worksheet',
  learning_objectives: [],
  instructions: '',
  sections: [],
};

const meta = {
  subject: 'Chemistry',
  topic: 'Chapter 3 - The World of Acids, Bases and Salts',
  subTopic: 'Bases',
  batchOrchestrator: true,
  strictValidation: true,
  generationVariant: 1,
  variantAngle: 'concept understanding',
  variantScenario: 'a kitchen example',
};

const finalized = finalizeWorksheetStructuredContent(emptyWorksheet, {
  ...meta,
  strictValidation: false,
});

const validation = validateToolSpecificStructuredContent(
  'worksheet-mcq-generator',
  finalized,
  'Worksheet',
  '',
  { ...meta, requireAllCanonicalFields: false },
);

if (!validation.valid) {
  console.error('FAIL ai batch worksheet validation:', validation.message);
  process.exit(1);
}

const quality = runAiGeneratorQualityGate('worksheet-mcq-generator', validation.normalizedStructuredContent, {
  ...meta,
  topicGroundedFallback: Boolean(validation.normalizedStructuredContent?.topicGroundedFallback),
});

if (!quality.valid) {
  console.error('FAIL ai batch worksheet quality:', quality.errors.join('; '));
  process.exit(1);
}

const qCount = (validation.normalizedStructuredContent?.sections || []).reduce(
  (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
  0,
);

if (qCount < 5) {
  console.error('FAIL: expected 5 topic-grounded questions, got', qCount);
  process.exit(1);
}

console.log('OK: AI Generator premium batch worksheet repair with', qCount, 'questions');
