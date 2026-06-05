import {
  extractWorksheetItemsFromPdfText,
  worksheetTextForPatternExtract,
} from '../../services/pdf-worksheet-extract.js';

const mcqs = Array.from({ length: 50 }, (_, i) => {
  const n = i + 1;
  return `${n}. Which item ${n} is correct? (a) A${n} (b) B${n} (c) C${n} (d) D${n} Answer: (a)`;
}).join(' ');

const fibs = Array.from({ length: 30 }, (_, i) => `${i + 1}. The blank number ${i + 1} is ________.`).join(' ');

const dense = `Section A: MCQs ${mcqs} Section B: Fill in the Blanks ${fibs} Section C: Very Short Answer Questions ${Array.from({ length: 20 }, (_, i) => `${i + 1}. What is term ${i + 1}?`).join(' ')}`;

const normalized = worksheetTextForPatternExtract(dense);

console.log('dense raw:', extractWorksheetItemsFromPdfText(dense, 500).length);
console.log(
  'dense normalized lines:',
  normalized.split('\n').length,
  'extracted:',
  extractWorksheetItemsFromPdfText(normalized, 500).length,
);

if (extractWorksheetItemsFromPdfText(normalized, 500).length < 80) {
  console.error('FAIL: expected 80+ from dense worksheet after line breaks');
  process.exit(1);
}

console.log('dense worksheet test OK (prototype)');
