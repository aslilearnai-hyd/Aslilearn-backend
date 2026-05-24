import { extractExamPaperItemsFromPdfText } from '../../services/pdf-exam-paper-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Section A

1. Define atom.
2. What is photosynthesis?

Section B

3. Explain Newton's laws.
4. Draw water cycle.

Answer Key
1. Smallest particle
2. Process by plants
`;

const ok = runExtractTest('exam-question-paper-generator', extractExamPaperItemsFromPdfText, sample, {
  minCount: 1,
});
process.exit(ok ? 0 : 1);
