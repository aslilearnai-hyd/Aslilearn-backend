import { extractFlashcardItemsFromPdfText } from '../../services/pdf-flashcard-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Card 1
Front: What is H2O?
Back: Water

Card 2
Front: What planet do we live on?
Back: Earth

Card 3
Front: Speed formula?
Back: Distance / Time
`;

const ok = runExtractTest('flashcard-generator', extractFlashcardItemsFromPdfText, sample, {
  minCount: 3,
});
process.exit(ok ? 0 : 1);
