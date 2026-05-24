import { extractShortNotesItemsFromPdfText } from '../../services/pdf-shortnotes-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Item 1
Photosynthesis
Photosynthesis is the process by which green plants make food using sunlight.

Key Points:
- Plants make food
- Sunlight required
- Chlorophyll is essential

Item 2
Gravity
Gravity pulls objects toward Earth.
`;

const ok = runExtractTest('short-notes-summaries-maker', extractShortNotesItemsFromPdfText, sample, {
  minCount: 2,
});
process.exit(ok ? 0 : 1);
