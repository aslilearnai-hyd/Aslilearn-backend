import { extractConceptMasteryItemsFromPdfText } from '../../services/pdf-concept-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Item 1
Science as Curiosity
1. Simple Definition
Science is asking questions about the world.
2. Why This Concept Is Important
It helps us understand nature.
3. Prior Knowledge Needed
Basic observation skills.
4. Step-by-step Explanation
First observe. Then ask why. Then explore.

Item 2
Observation Skills
1. Simple Definition
Observation means using senses carefully.
4. Step-by-step Explanation
Look closely at objects. Note colors and shapes.
`;

const ok = runExtractTest('concept-mastery-helper', extractConceptMasteryItemsFromPdfText, sample, {
  minCount: 2,
});
process.exit(ok ? 0 : 1);
