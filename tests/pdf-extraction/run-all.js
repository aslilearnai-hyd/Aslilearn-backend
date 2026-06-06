/**
 * Run all PDF extraction smoke tests for the 11 AI tools.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractToolItemsFromPdfText, listPdfExtractTools } from '../../services/pdf-tool-extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_FILES = [
  'test-quick-assignment-square-numbers.js',
  'test-pdf-generation-splitter.js',
  'test-knowledge-base-pipeline.js',
  'test-quick-assignment-generation-boundary.js',
  'test-tool-formatters.js',
  'test-pdf-content-engine.js',
  'test-pdf-content-classifier.js',
  'test-canonical-pdf-json.js',
  'test-activity.js',
  'test-worksheet.js',
  'test-concept-mastery.js',
  'test-lesson-planner.js',
  'test-homework.js',
  'test-rubric.js',
  'test-story.js',
  'test-shortnotes.js',
  'test-flashcards.js',
  'test-dailyplan.js',
  'test-exam.js',
];

console.log('PDF extraction registry tools:', listPdfExtractTools().join(', '));

let failed = 0;
for (const file of TEST_FILES) {
  const result = spawnSync(process.execPath, [join(__dirname, file)], {
    stdio: 'inherit',
    cwd: join(__dirname, '..', '..'),
  });
  if (result.status !== 0) failed += 1;
}

console.log('\n--- Registry smoke check ---');
const registryOk = extractToolItemsFromPdfText('flashcard-generator', 'Card 1\nFront: A\nBack: B').length >= 1;
console.log(registryOk ? 'PASS: extractToolItemsFromPdfText registry' : 'FAIL: registry');
if (!registryOk) failed += 1;

console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `FAILED: ${failed} test file(s)`}`);
process.exit(failed === 0 ? 0 : 1);
