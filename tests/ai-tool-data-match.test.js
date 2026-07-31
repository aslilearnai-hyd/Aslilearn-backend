import assert from 'node:assert/strict';
import {
  buildSubtopicNameVariants,
  buildTopicNameVariants,
  buildSubjectMongoFilter,
  subtopicTextMatches,
  topicTextMatches,
} from '../utils/ai-tool-data-match.js';

assert.deepEqual(buildTopicNameVariants('Chapter 3 - Plant Life'), [
  'Chapter 3 - Plant Life',
  'Chapter 3',
  'Plant Life',
]);

assert.ok(
  topicTextMatches('Plant Life', 'Chapter 3 - Plant Life'),
  'topic should match chapter-prefixed query',
);

assert.ok(
  topicTextMatches(
    'We Distribute, Yet Things Multiply',
    'Book 1: Ganita Prakash - 1 - We Distribute, Yet Things Multiply',
  ),
  'multi-dash book topic should match stored chapter title',
);

assert.ok(
  buildTopicNameVariants(
    'Book 1: Ganita Prakash - 1 - We Distribute, Yet Things Multiply',
  ).includes('We Distribute, Yet Things Multiply'),
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

const mathFilter = buildSubjectMongoFilter('Mathematics');
assert.equal(mathFilter.subject.$options, 'i');
assert.match(mathFilter.subject.$regex, /math/i);

console.log('ai-tool-data-match tests passed');
