import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizeWorksheetStructuredContent,
  validateToolSpecificStructuredContent,
} from '../services/ai-content-engine-service.js';
import { runAiGeneratorQualityGate } from '../services/ai-generator-quality-gate.js';

test('premium AI batch worksheets reject scaffold-heavy fallback content', () => {
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

assert.equal(validation.valid, true, validation.message);

const quality = runAiGeneratorQualityGate('worksheet-mcq-generator', validation.normalizedStructuredContent, {
  ...meta,
  topicGroundedFallback: Boolean(validation.normalizedStructuredContent?.topicGroundedFallback),
});

assert.equal(quality.valid, false);
assert.ok(quality.errors.some((error) => error.includes('Scaffold')));

const qCount = (validation.normalizedStructuredContent?.sections || []).reduce(
  (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
  0,
);

assert.ok(qCount >= 5, `expected at least 5 repaired questions, got ${qCount}`);
});
