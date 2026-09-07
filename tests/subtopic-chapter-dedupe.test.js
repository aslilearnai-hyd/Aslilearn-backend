import assert from 'node:assert/strict';
import {
  chapterNumberFromTopicLabel,
  orderedUniqueSubTopics,
  dedupeChapterWiseTopicLabels,
} from '../ai/shared/ai-tool-topic-order.js';

assert.equal(chapterNumberFromTopicLabel('Chapter 1 - The Wonderful World of Science'), 1);
assert.equal(chapterNumberFromTopicLabel('1 Title'), 1);
assert.equal(chapterNumberFromTopicLabel('1.6 Scientists of India and Their Contributions'), null);
assert.equal(chapterNumberFromTopicLabel('1.1 What is Science?'), null);
assert.equal(chapterNumberFromTopicLabel('2.5 Biodiversity in Different Habitats'), null);

const rows = [
  { subTopic: '1.1 What is Science?', sortOrder: 1 },
  { subTopic: '1.2 The Domain of Science', sortOrder: 2 },
  { subTopic: '1.3 How Do Scientists Study Science?', sortOrder: 3 },
  { subTopic: '1.4 Branches of Science', sortOrder: 4 },
  { subTopic: '1.5 Science in Everyday Life', sortOrder: 5 },
  { subTopic: '1.6 Scientists of India and Their Contributions', sortOrder: 6 },
];
const subs = orderedUniqueSubTopics(rows);
assert.equal(subs.length, 6);
assert.equal(subs[0], '1.1 What is Science?');
assert.equal(subs[5], '1.6 Scientists of India and Their Contributions');

const topics = dedupeChapterWiseTopicLabels([
  'Chapter 1',
  'Chapter 1 - The Wonderful World of Science',
  '1.6 Scientists of India and Their Contributions',
]);
assert.ok(topics.includes('Chapter 1 - The Wonderful World of Science'));
assert.ok(topics.includes('1.6 Scientists of India and Their Contributions'));

console.log('subtopic chapter-dedupe regression tests passed');
