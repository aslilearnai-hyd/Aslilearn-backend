import { extractStoryPassageItemsFromPdfText } from '../../services/pdf-story-extract.js';
import { runExtractTest } from './_helpers.js';

const sample = `
Story 1
Title: The Honest Boy

Once there was a boy who found a wallet on the road. He returned it to the owner.
The villagers praised his honesty.

Questions:
1. What did the boy learn?
2. Why is honesty important?

Story 2
Title: The Red Tree

A tree helped villagers during a drought by providing shade and fruit.
`;

const ok = runExtractTest('story-passage-creator', extractStoryPassageItemsFromPdfText, sample, {
  minCount: 2,
});
process.exit(ok ? 0 : 1);
