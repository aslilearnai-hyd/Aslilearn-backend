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

assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Chemistry', 'CBSE', 'Class 9'), [
  'Matter in Our Surroundings',
  'Chapter 1 - Particulate Nature of Matter',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Physics', 'CBSE', 'Class 9'), [
  'Motion',
  'Chapter 1 - Force and Pressure',
  'Chapter 2 - FRICTION',
  'Force and Laws of Motion',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Biology', 'CBSE', 'Class 9'), [
  'Chapter 2 - Cell Structure and Functions',
  'The Fundamental Unit of Life',
]);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Science', 'CBSE', 'Class 9'), mixed);
assert.deepEqual(filterTopicsForSplitScienceSubject(mixed, 'Physics', 'IIT/NEET', 'Class 6'), mixed);

const class6Science = [
  'Sorting Materials into Groups',
  'Motion and Measurement of Distances',
  'Getting to Know Plants',
  'Chapter 2 - Diversity in the Living World',
];
assert.deepEqual(
  filterTopicsForSplitScienceSubject(class6Science, 'Chemistry', 'CBSE', 'Class 6'),
  ['Sorting Materials into Groups'],
);
assert.deepEqual(
  filterTopicsForSplitScienceSubject(class6Science, 'Biology', 'CBSE', 'Class 6'),
  ['Getting to Know Plants', 'Chapter 2 - Diversity in the Living World'],
);
// Middle-school empty branch falls back to the Science list instead of "No data available".
assert.deepEqual(
  filterTopicsForSplitScienceSubject(
    ['Chapter 2 - Diversity in the Living World'],
    'Chemistry',
    'CBSE',
    'Class 6',
  ),
  ['Chapter 2 - Diversity in the Living World'],
);

console.log('Split Science topic filtering tests passed');
