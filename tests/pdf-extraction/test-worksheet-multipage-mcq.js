import { extractWorksheetItemsFromPdfText } from '../../services/pdf-worksheet-extract.js';

function page(n, questions) {
  const body = questions
    .map(
      (q, i) =>
        `${i + 1}. ${q}
(a) East
(b) South
(c) West
(d) North-East
Answer: (b)`,
    )
    .join('\n\n');
  return `
-- ${n} of 11 --
Section A: MCQs
${body}
-- ${n} of 11 --
`;
}

const uniqueQuestions = [];
for (let p = 1; p <= 11; p += 1) {
  for (let q = 1; q <= 14; q += 1) {
    uniqueQuestions.push(`Page ${p} question ${q}: Which direction is opposite to bearing ${p * 10 + q}?`);
  }
}

let sample = '';
for (let p = 1; p <= 11; p += 1) {
  sample += page(
    p,
    uniqueQuestions.slice((p - 1) * 14, p * 14),
  );
}

const items = extractWorksheetItemsFromPdfText(sample, 500);
console.log('extracted:', items.length);
if (items.length < 140) {
  console.error('Expected at least 140 questions from 11 pages, got', items.length);
  process.exit(1);
}

const withFooter = items.filter((q) => /--\s*\d+\s+of\s+\d+\s*--/i.test(q.question));
if (withFooter.length) {
  console.error('Page footers still in questions:', withFooter[0].question);
  process.exit(1);
}

console.log('multipage MCQ extraction OK');
