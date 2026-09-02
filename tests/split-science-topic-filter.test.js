import assert from 'node:assert/strict';
import { filterTopicsForSplitScienceSubject } from '../ai/shared/ai-tool-topic-taxonomy.js';

const mixed = [
  'Chapter 1 - Exploration: Entering the World of Secondary Science',
  'Matter in Our Surroundings',
  'Chapter 1 - Particulate Nature of Matter',
  'Motion',
  'Chapter 1 - Force and Pressure',
  'Chapter 2 - FRICTION',
  'Force and Laws of Motion',
  'Chapter 2 - Cell Structure and Functions',
  'The Fundamental Unit of Life',
];

assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Chemistry', 'CBSE'), [
  'Matter in Our Surroundings',
  'Chapter 1 - Particulate Nature of Matter',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Physics', 'CBSE'), [
  'Motion',
  'Chapter 1 - Force and Pressure',
  'Chapter 2 - FRICTION',
  'Force and Laws of Motion',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Biology', 'CBSE'), [
  'Chapter 2 - Cell Structure and Functions',
  'The Fundamental Unit of Life',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Science', 'CBSE'), mixed);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Physics', 'IIT/NEET'), mixed);

console.log('Split Science topic filtering tests passed');
