import { extractWorksheetItemsFromPdfText } from '../../services/pdf-worksheet-extract.js';

const mcqs = Array.from({ length: 40 }, (_, i) => {
  const n = i + 1;
  return `${n}. Which map symbol ${n} represents feature type ${n}?
(a) Option A${n}
(b) Option B${n}
(c) Option C${n}
(d) Option D${n}
Answer: (b)`;
}).join('\n\n');

const fibs = Array.from({ length: 30 }, (_, i) => `${i + 1}. The direction at the top of most maps is ________ (${i + 1}).`).join('\n');

const vsas = Array.from({ length: 20 }, (_, i) => `${i + 1}. What is landmark number ${i + 1}?`).join('\n');

const sample = `
Theme A Chapter 1 - Locating Places on the Earth
Section A: MCQs
${mcqs}
Section B: Fill in the Blanks
${fibs}
Section C: Very Short Answer Questions
${vsas}
`;

const items = extractWorksheetItemsFromPdfText(sample, 500);
console.log('extracted:', items.length);
const bySection = {};
for (const q of items) {
  const s = q.section || 'unknown';
  bySection[s] = (bySection[s] || 0) + 1;
}
console.log('by section:', bySection);

if (items.length < 80) {
  console.error('Expected at least 80 questions from theme-style sample, got', items.length);
  process.exit(1);
}

console.log('theme A worksheet sample OK');
