import assert from 'node:assert/strict';
import { stripAiGeneratorLeakage } from '../ai/shared/sanitize-ai-question-display.js';
import { cleanPdfEducationalContent } from '../ai/rag/pdf/pdf-content-cleaner.js';

const answer =
  'Chilling onions or cutting them under water can reduce the gas release and minimize tears.';
const promo =
  'The Beta version of ASLI PREP FOUNDATION Material is designed to help young learners build strong fundamentals.';

assert.equal(stripAiGeneratorLeakage(`${answer} ${promo}`), answer.replace(/\.$/, ''));
assert.equal(cleanPdfEducationalContent(`${answer}\n${promo}\nMore promotional copy.`), answer);

console.log('Asli Prep source promotion sanitizer tests passed');
