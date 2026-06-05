import { extractCanonicalPdfDocument } from '../../services/pdf-canonical-extract.js';
import { mapCanonicalPdfToToolBulkItems } from '../../services/pdf-canonical-mapper.js';

const sample = `
Worksheet — Large Numbers Around Us
Learning Objectives
- Read and write numbers up to one lakh

Section D: Short Answer Questions
7. 1 A Lakh Varieties! Worksheet & MCQ Generator | NEP-NCF aligned | Page 6
8. An election booth has 1,00,000 registered voters. Before lunch, 64,875 people voted; after lunch, 29,640 people voted. How many registered voters did not vote?
Answer: 5,485

9. Write 'six lakh forty thousand nine hundred six' in numerals.
Answer: 6,40,906
`;

const canonical = extractCanonicalPdfDocument(sample);
console.log('canonical questions:', canonical.stats.questionCount);
if (canonical.stats.questionCount < 2) {
  console.error('Expected at least 2 questions in canonical JSON');
  process.exit(1);
}

const ws = mapCanonicalPdfToToolBulkItems('worksheet-mcq-generator', canonical, sample, {
  topic: 'Large Numbers',
});
if (!ws.items.length) {
  console.error('Worksheet mapping failed');
  process.exit(1);
}

const hw = mapCanonicalPdfToToolBulkItems('homework-creator', canonical, sample, { topic: 'HW' });
if (!hw.items[0]?.practice_questions?.length) {
  console.error('Homework mapping failed');
  process.exit(1);
}

console.log('canonical PDF JSON pipeline OK');
