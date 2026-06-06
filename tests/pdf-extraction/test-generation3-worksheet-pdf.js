/**
 * Matches Generation_Split_Test_PDF.pdf — Generation 3 page (11 numbered sections).
 */
import {
  extractWorksheetItemsFromPdfText,
  consolidateWorksheetExtractItems,
  extractWorksheetShellFromNumberedPdfText,
} from '../../services/pdf-worksheet-extract.js';
import { cleanPdfEducationalContent } from '../../services/pdf-content-cleaner.js';
import { canonicalizeWorksheetExtractedItem } from '../../services/ai-content-engine-service.js';

const gen3Raw = `Generation 3 - Nouns (English)
Worksheet & MCQ Generator
Section 1
Generation 3 - Nouns (English)
Section 2
Content unique to Generation 3 - Nouns (English)
Section 3
Content unique to Generation 3 - Nouns (English)
Section 4
What is a noun?
Give three examples of proper nouns.
Identify the noun in: The dog barked loudly.
Section 5
Content unique to Generation 3 - Nouns (English)
Section 6
Content unique to Generation 3 - Nouns (English)
Section 7
Content unique to Generation 3 - Nouns (English)
Section 8
Content unique to Generation 3 - Nouns (English)
Section 9
A naming word.
India, Ravi, Hyderabad.
Dog
Section 10
Content unique to Generation 3 - Nouns (English)
Section 11
Content unique to Generation 3 - Nouns (English)`;

const deduped = cleanPdfEducationalContent(gen3Raw, { stripTrailer: false, dedupeParagraphs: true });
const preserved = cleanPdfEducationalContent(gen3Raw, { stripTrailer: false, dedupeParagraphs: false });
if (!deduped.includes('Section 5') || (deduped.match(/Content unique to Generation 3/gi) || []).length < 4) {
  console.log('note: dedupe collapses repeated section bodies (bad for split)');
}
if ((preserved.match(/Content unique to Generation 3/gi) || []).length < 6) {
  console.error('FAIL: preserved clean should keep all unique section bodies');
  process.exit(1);
}

const items = extractWorksheetItemsFromPdfText(preserved, 80);
const sectionA = items.filter((q) => q.section === 'Section A: MCQs' && !q._sectionBody);
if (sectionA.length !== 3) {
  console.error('FAIL: Section 4 should yield 3 questions, got', sectionA.length, sectionA);
  process.exit(1);
}

const sectionB = items.find((q) => q.section === 'Section B: Fill in the Blanks');
if (!sectionB || !String(sectionB.question || '').includes('Content unique to Generation 3')) {
  console.error('FAIL: Section 5 body missing from Section B');
  process.exit(1);
}

if (!sectionA[0].answer || !sectionA[2].answer) {
  console.error('FAIL: Section 9 answers should attach to questions', sectionA.map((q) => q.answer));
  process.exit(1);
}

const shell = extractWorksheetShellFromNumberedPdfText(preserved);
if (!shell.learning_objectives?.length || !String(shell.instructions || '').includes('Content unique')) {
  console.error('FAIL: section 2/3 shell fields missing', shell);
  process.exit(1);
}

const consolidated = consolidateWorksheetExtractItems([{}], {
  rawPdfText: preserved,
  generationTitle: 'Nouns (English)',
  forceSingleDocument: true,
})[0];

const normalized = canonicalizeWorksheetExtractedItem(consolidated, preserved);
const counts = Object.fromEntries(
  (normalized.sections || []).map((s) => [s.sectionName, (s.questions || []).length]),
);
console.log('section counts:', counts);

if ((counts['Section A: MCQs'] || 0) < 3) {
  console.error('FAIL: normalized Section A count');
  process.exit(1);
}
if ((counts['Section B: Fill in the Blanks'] || 0) < 1) {
  console.error('FAIL: normalized Section B count');
  process.exit(1);
}

console.log('PASS: generation 3 worksheet PDF structure');
