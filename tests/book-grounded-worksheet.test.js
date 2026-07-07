import { finalizeWorksheetStructuredContent } from '../services/ai-content-engine-service.js';
import { runAiGeneratorQualityGate } from '../services/ai-generator-quality-gate.js';
import { validateToolSpecificStructuredContent } from '../services/ai-content-engine-service.js';

const ragContext = `[Chunk 1]
The human nervous system coordinates body activities. The central nervous system includes the brain and spinal cord.
Neurons transmit electrical impulses between body parts. Reflex actions protect the body from harm quickly.

[Chunk 2]
The peripheral nervous system connects the CNS to limbs and organs. Sensory neurons carry signals to the brain.
Motor neurons carry commands from the brain to muscles.`;

const emptyWorksheet = {
  title: 'Human Nervous System — Worksheet',
  learning_objectives: ['Understand the CNS and PNS'],
  instructions: '',
  sections: [],
};

const meta = {
  subject: 'Science',
  topic: 'Control and Coordination',
  subTopic: 'Human Nervous System',
  bookGenerator: true,
  pdfContext: ragContext,
  generationVariant: 2,
};

const finalized = finalizeWorksheetStructuredContent(emptyWorksheet, meta);
const questionCount = (finalized.sections || []).reduce(
  (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
  0,
);

if (questionCount < 5) {
  console.error('FAIL: expected at least 5 book-grounded worksheet questions, got', questionCount);
  process.exit(1);
}

const validation = validateToolSpecificStructuredContent(
  'worksheet-mcq-generator',
  finalized,
  'Worksheet',
  ragContext,
  meta,
);

if (!validation.valid) {
  console.error('FAIL: worksheet validation:', validation.message);
  process.exit(1);
}

const quality = runAiGeneratorQualityGate('worksheet-mcq-generator', validation.normalizedStructuredContent, {
  ...meta,
  bookGroundedFallback: Boolean(validation.normalizedStructuredContent?.bookGroundedFallback),
});

if (!quality.valid) {
  console.error('FAIL: quality gate:', quality.errors.join('; '));
  process.exit(1);
}

console.log('OK: book-grounded worksheet fallback produced', questionCount, 'questions');
