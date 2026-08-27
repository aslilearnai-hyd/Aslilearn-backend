import assert from 'node:assert/strict';
import { filterTopicsForSplitScienceSubject } from '../ai/shared/ai-tool-topic-taxonomy.js';

const mixed = [
  'Chapter 1 - Exploration: Entering the World of Secondary Science',
  'Matter in Our Surroundings',
  'Motion',
  'Force and Laws of Motion',
  'The Fundamental Unit of Life',
];

assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Chemistry', 'CBSE'), [
  'Matter in Our Surroundings',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Physics', 'CBSE'), [
  'Motion',
  'Force and Laws of Motion',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Biology', 'CBSE'), [
  'The Fundamental Unit of Life',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Science', 'CBSE'), mixed);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Physics', 'IIT/NEET'), mixed);

console.log('Split Science topic filtering tests passed');
