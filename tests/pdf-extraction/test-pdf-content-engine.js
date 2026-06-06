/**
 * PDF content engine — worksheet zero-LLM + classifier integration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePdfContentForUpload, analyzePdfContent } from '../../services/pdf-content-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name) {
  const p = path.join(fixturesDir, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

const denseSample = readFixture('worksheet-locating-places-dense.txt')
  || `Section A: Multiple Choice
1. Which direction is opposite to East?
A) West
B) North
C) South
D) East
2. What is latitude?
A) Horizontal lines
B) Vertical lines
Section B: Fill in the blanks
3. The Prime Meridian passes through ______.
Answer Key
1. A
2. A
3. Greenwich`;

const analysis = analyzePdfContent(denseSample, { toolSlug: 'worksheet-mcq-generator' });
if (!['QUESTION_BASED', 'MIXED'].includes(analysis.classification.family)) {
  console.error('FAIL: expected QUESTION_BASED or MIXED family, got', analysis.classification.family);
  process.exit(1);
}
if (!analysis.extractionOk) {
  console.error('FAIL: extractionOk should be true');
  process.exit(1);
}
console.log('PASS: analyzePdfContent worksheet family');

const result = await resolvePdfContentForUpload('worksheet-mcq-generator', denseSample, { topic: 'Test' });
const qCount = (result.bulkItems[0]?.sections || []).reduce(
  (n, s) => n + (s.questions?.length || 0),
  0,
);
if (qCount < 2) {
  console.error('FAIL: expected >= 2 worksheet questions, got', qCount);
  process.exit(1);
}
if (result.generationMeta?.generationMode !== 'canonical-json' && result.generationMeta?.generationMode !== 'regex-extract') {
  console.error('FAIL: unexpected generation mode', result.generationMeta?.generationMode);
  process.exit(1);
}
console.log(`PASS: resolvePdfContentForUpload worksheet (${qCount} questions, mode=${result.generationMeta?.generationMode})`);
