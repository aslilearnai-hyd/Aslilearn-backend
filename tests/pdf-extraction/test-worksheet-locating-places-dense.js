import { extractWorksheetItemsFromPdfText } from '../../services/pdf-worksheet-extract.js';

const mcqBlock = Array.from({ length: 60 }, (_, i) => {
  const n = i + 1;
  return `${n} Which map feature ${n} is opposite to North? (a) East (b) South (c) West (d) North-East Answer: (b)`;
}).join(' ');

const fibBlock = Array.from({ length: 50 }, (_, i) => {
  const n = i + 1;
  return `${n}. The top of map ${n} shows the direction ________.`;
}).join(' ');

const vsaBlock = Array.from({ length: 40 }, (_, i) => {
  const n = i + 1;
  return `${n}. What is landmark number ${n}?`;
}).join(' ');

const dense = `Theme A Chapter 1 - Locating Places on the Earth 1.1 Finding Places on the Earth Section A: MCQs ${mcqBlock} Section B: Fill in the Blanks ${fibBlock} Section C: Very Short Answer Questions ${vsaBlock}`;

const items = extractWorksheetItemsFromPdfText(dense, 500);
console.log('locating dense extracted:', items.length);

const bySection = {};
for (const q of items) {
  const s = q.section || 'unknown';
  bySection[s] = (bySection[s] || 0) + 1;
}
console.log('by section:', bySection);

if (items.length < 120) {
  console.error('Expected 120+ questions from locating-places dense sample');
  process.exit(1);
}

console.log('locating places dense OK');
