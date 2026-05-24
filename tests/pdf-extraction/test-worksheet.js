import { extractWorksheetItemsFromPdfText } from '../../services/pdf-worksheet-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Worksheet 1
Section A
1. What is gravity?
A. Force
B. Energy
Answer: A

2. Earth revolves around?
A. Moon
B. Sun
Answer: B

Worksheet 2
Section B
1. Plants make food by ___________.
2. The process is called ___________.
`;

const ok = runExtractTest('worksheet-mcq-generator', extractWorksheetItemsFromPdfText, sample, {
  minCount: 2,
});
process.exit(ok ? 0 : 1);
