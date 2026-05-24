import { extractRubricItemsFromPdfText } from '../../services/pdf-rubric-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Rubric 1
Science Project Evaluation
Criteria:
Excellent - Full understanding and clear presentation
Good - Minor mistakes but good effort
Average - Needs support to complete

Rubric 2
Group Work Rubric
Criteria:
Presentation
Communication
Teamwork
`;

const ok = runExtractTest('rubrics-evaluation-generator', extractRubricItemsFromPdfText, sample, {
  minCount: 2,
});
process.exit(ok ? 0 : 1);
