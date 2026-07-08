import {
  finalizeWorksheetStructuredContent,
  validateToolSpecificStructuredContent,
} from '../services/ai-content-engine-service.js';
import { runAiGeneratorQualityGate } from '../services/ai-generator-quality-gate.js';

const ragContext = `[Chunk 1]
The central nervous system (CNS) includes the brain and spinal cord. Neurons carry impulses.
Reflex actions are rapid responses that protect the body from harm.

[Chunk 2]
The peripheral nervous system connects the CNS to muscles and organs. Sensory neurons detect stimuli.
Motor neurons carry commands to effectors.`;

const placeholderWorksheet = {
  title: 'Human Nervous System — Worksheet',
  learning_objectives: [],
  instructions: 'Read each section carefully. Answer all questions on Human Nervous System in your notebook.',
  sections: [
    {
      sectionName: 'Section A: MCQs',
      questions: [
        {
          question: 'Which statement about Human Nervous System is most accurate?',
          options: ['A) guess', 'B) evidence', 'C) tradition', 'D) opinion'],
          answer: 'B) evidence',
        },
      ],
    },
  ],
};

const meta = {
  subject: 'Science',
  topic: 'Control and Coordination',
  subTopic: 'Human Nervous System',
  bookGenerator: true,
  strictValidation: true,
  pdfContext: ragContext,
  generationVariant: 3,
};

const finalized = finalizeWorksheetStructuredContent(placeholderWorksheet, {
  ...meta,
  strictValidation: false,
});

const validation = validateToolSpecificStructuredContent(
  'worksheet-mcq-generator',
  finalized,
  'Worksheet',
  ragContext,
  { ...meta, requireAllCanonicalFields: false },
);

if (!validation.valid) {
  console.error('FAIL premium book validation:', validation.message);
  process.exit(1);
}

const quality = runAiGeneratorQualityGate(
  'worksheet-mcq-generator',
  validation.normalizedStructuredContent,
  {
    ...meta,
    bookGroundedFallback: Boolean(validation.normalizedStructuredContent?.bookGroundedFallback),
  },
);

if (!quality.valid) {
  console.error('FAIL premium book quality gate:', quality.errors.join('; '));
  process.exit(1);
}

const qCount = (validation.normalizedStructuredContent?.sections || []).reduce(
  (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
  0,
);

if (qCount < 5) {
  console.error('FAIL: expected repaired worksheet with 5+ questions, got', qCount);
  process.exit(1);
}

console.log('OK: premium book worksheet repair saved path with', qCount, 'questions');
