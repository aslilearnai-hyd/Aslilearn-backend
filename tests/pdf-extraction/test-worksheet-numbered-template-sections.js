/**
 * Worksheet PDFs using numbered template sections (Section 1–8) per generation chunk.
 */
import {
  extractWorksheetItemsFromPdfText,
  consolidateWorksheetExtractItems,
  extractWorksheetShellFromNumberedPdfText,
} from '../../services/pdf-worksheet-extract.js';
import { canonicalizeWorksheetExtractedItem } from '../../services/ai-content-engine-service.js';

const gen2Chunk = `Generation 2 - Photosynthesis (Science)
Worksheet & MCQ Generator
Section 1
Fables Worksheet 2
Section 2
- Understand photosynthesis basics
Section 3
Read each question carefully.
Section 4
What is photosynthesis?
Why is sunlight important?
Name the green pigment in leaves.
Section 5
Plants make food by ___________.
Section 6
What is chlorophyll?
Section 7
Explain how plants prepare food using sunlight, water and carbon dioxide.
Section 8
How would you design a small experiment to show that sunlight is needed for plant growth?`;

const shell = extractWorksheetShellFromNumberedPdfText(gen2Chunk);
if (!String(shell.title || '').includes('Photosynthesis') && !String(shell.title || '').includes('Worksheet 2')) {
  console.error('FAIL: expected title from section 1 or generation line, got', shell.title);
  process.exit(1);
}

const items = extractWorksheetItemsFromPdfText(gen2Chunk, 80);
const bySection = new Map();
for (const q of items) {
  const s = q.section || 'unknown';
  bySection.set(s, (bySection.get(s) || 0) + 1);
}
console.log('by section:', Object.fromEntries(bySection));

if (!bySection.has('Section A: MCQs')) {
  console.error('FAIL: Section 4 questions should map to Section A');
  process.exit(1);
}
if (!bySection.has('Section B: Fill in the Blanks')) {
  console.error('FAIL: Section 5 should map to Section B');
  process.exit(1);
}

const consolidated = consolidateWorksheetExtractItems([{ title: 'x' }], {
  rawPdfText: gen2Chunk,
  generationTitle: 'Photosynthesis (Science)',
  forceSingleDocument: true,
})[0];

if (String(consolidated.title || '').includes('Question 1')) {
  console.error('FAIL: title should not be Question 1, got', consolidated.title);
  process.exit(1);
}

const normalized = canonicalizeWorksheetExtractedItem(consolidated, gen2Chunk);
const sectionCounts = (normalized.sections || []).map((s) => ({
  name: s.sectionName,
  n: (s.questions || []).length,
}));
console.log('normalized sections:', sectionCounts);

const totalQ = sectionCounts.reduce((n, s) => n + s.n, 0);
if (totalQ < 4) {
  console.error('FAIL: expected questions across sections, got', totalQ);
  process.exit(1);
}

const dQ = (normalized.sections || []).find((s) => s.sectionName?.includes('Section D'))?.questions?.[0];
if (dQ && /Section\s+\d+/i.test(String(dQ.question || ''))) {
  console.error('FAIL: question text leaked section headers:', dQ.question);
  process.exit(1);
}

const gen1Chunk = `Generation 1 - Square Numbers (Maths)
Worksheet & MCQ Generator
Section 1
Square Numbers Worksheet
Section 2
Understand square numbers
Section 3
Read carefully.
Section 4
What is a square number?
Is 144 a perfect square?
Explain.
Write the first 10 square numbers.
Section 5
A square number ends with ___________.
Section 6
What is 5 squared?
Section 7
Explain why 16 is a square number.
Section 8
How would you use square numbers in daily life?`;

const gen1Items = extractWorksheetItemsFromPdfText(gen1Chunk, 80);
if (gen1Items.length < 5) {
  console.error('FAIL: expected multiple questions from gen1 chunk, got', gen1Items.length);
  process.exit(1);
}
const gen1Mcq = gen1Items.filter((q) => q.section === 'Section A: MCQs');
if (gen1Mcq.length < 2) {
  console.error('FAIL: Section 4 should yield multiple MCQ/VSA prompts, got', gen1Mcq.length);
  process.exit(1);
}
if (String(gen1Mcq[0]?.question || '').includes('Is 144') && String(gen1Mcq[0]?.question || '').includes('Write the first')) {
  console.error('FAIL: questions should not be merged into one blob');
  process.exit(1);
}

console.log('PASS: worksheet numbered template sections');
