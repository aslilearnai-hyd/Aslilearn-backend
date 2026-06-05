import {
  extractWorksheetItemsFromPdfText,
  isWorksheetPdfChrome,
  cleanWorksheetQuestionText,
} from '../../services/pdf-worksheet-extract.js';

const junkLines = [
  '1 A Lakh Varieties! Worksheet & MCQ Generator | NEP-NCF aligned | Page 6',
  'Mathematics - Chapter 1: Large Numbers Around Us - Subtopic',
  '1 A Lakh Varieties! Worksheet & MCQ Generator | NEP-NCF aligned | Page 7',
];

for (const j of junkLines) {
  if (!isWorksheetPdfChrome(j)) {
    console.error('FAIL: should be chrome:', j);
    process.exit(1);
  }
}

const cleaned = cleanWorksheetQuestionText(
  'Find the number that is 1,00,000 less than 4,56,789. Section D: Short Answer Questions',
);
if (cleaned.includes('Section D')) {
  console.error('FAIL: section header not stripped:', cleaned);
  process.exit(1);
}

const userPdfSnippet = `
Section D: Short Answer Questions
7. 1 A Lakh Varieties! Worksheet & MCQ Generator | NEP-NCF aligned | Page 6
8. An election booth has 1,00,000 registered voters. Before lunch, 64,875 people voted; after lunch, 29,640 people voted. How many registered voters did not vote?
Answer: 5,485

9. A hospital has 1,20,000 masks. It distributes 38,750 masks to schools. How many masks remain?
Answer: 81,250

10. 1 A Lakh Varieties! Worksheet & MCQ Generator | NEP-NCF aligned | Page 7
11. Write 'six lakh forty thousand nine hundred six' in numerals.
Answer: 6,40,906

12. A cloud storage account had 2,50,000 photos. The user deleted 73,450 photos and then uploaded 1,28,900 new photos. How many photos are in the account now?
Answer: 3,05,450 photos.

13. Find the number that is 1,00,000 less than 4,56,789. Section D: Short Answer Questions
`;

const items = extractWorksheetItemsFromPdfText(userPdfSnippet, 50);
console.log('extracted:', items.length);
for (const it of items) {
  console.log('-', it.question.slice(0, 90), '|', it.answer || '(no answer)');
}

const chromeInOutput = items.filter((it) => isWorksheetPdfChrome(it.question));
if (chromeInOutput.length) {
  console.error('FAIL: chrome in output:', chromeInOutput.map((q) => q.question));
  process.exit(1);
}

const mergedSection = items.filter((it) => /section\s+[a-e]\s*:/i.test(it.question));
if (mergedSection.length) {
  console.error('FAIL: section header in question:', mergedSection.map((q) => q.question));
  process.exit(1);
}

if (items.length < 4) {
  console.error('FAIL: expected at least 4 real questions, got', items.length);
  process.exit(1);
}

console.log('worksheet chrome filter tests OK');
