import assert from 'node:assert/strict';
import {
  buildSubtopicNameVariants,
  buildTopicNameVariants,
  subtopicTextMatches,
  topicTextMatches,
} from '../utils/ai-tool-data-match.js';

assert.deepEqual(buildTopicNameVariants('Chapter 3 - Plant Life'), [
  'Chapter 3 - Plant Life',
  'Plant Life',
  'Chapter 3',
]);

assert.ok(
  topicTextMatches('Plant Life', 'Chapter 3 - Plant Life'),
  'topic should match chapter-prefixed query',
);

assert.ok(
  subtopicTextMatches('3.1 Observing Plant System', 'Observing Plant System'),
  'numbered subtopic prefix should match',
);

assert.ok(
  subtopicTextMatches('', 'Observing Plant System') === false,
  'empty stored subtopic should not fuzzy-match a specific query',
);

assert.ok(
  buildSubtopicNameVariants('Observing Plant System').includes('Observing Plant System'),
);

console.log('ai-tool-data-match tests passed');
