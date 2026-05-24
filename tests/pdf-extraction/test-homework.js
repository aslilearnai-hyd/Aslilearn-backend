import { extractHomeworkItemsFromPdfText } from '../../services/pdf-homework-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Homework 1
Fractions Practice
Instructions
Solve all questions. Show working.

1. Add 1/2 + 1/4 = ?
A. 1/6
B. 3/4
Answer: B

2. Which is greater: 2/3 or 3/5?
A. 2/3
B. 3/5
Answer: A
`;

const ok = runExtractTest('homework-creator', extractHomeworkItemsFromPdfText, sample, {
  minCount: 1,
});
process.exit(ok ? 0 : 1);
