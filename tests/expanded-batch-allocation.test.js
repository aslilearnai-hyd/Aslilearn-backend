import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateExpandedBatchTargets } from '../utils/expanded-batch-allocation.js';

const targets = [
  { subtopicName: 'Square Numbers', chapterScope: false },
  { subtopicName: 'Square Roots', chapterScope: false },
  { subtopicName: 'Cube Numbers', chapterScope: false },
  { subtopicName: 'Cube Roots', chapterScope: false },
  { subtopicName: 'Whole chapter', chapterScope: true },
];

test('expanded generation treats record count as a total, not a per-scope multiplier', () => {
  const allocated = allocateExpandedBatchTargets(targets, 4);
  assert.equal(allocated.length, 4);
  assert.equal(allocated.reduce((sum, row) => sum + row.batchSize, 0), 4);
  assert.deepEqual(allocated.map((row) => row.subtopicName), [
    'Square Numbers',
    'Square Roots',
    'Cube Numbers',
    'Cube Roots',
  ]);
});

test('expanded generation distributes larger totals without exceeding the request', () => {
  const allocated = allocateExpandedBatchTargets(targets, 7);
  assert.deepEqual(allocated.map((row) => row.batchSize), [2, 2, 1, 1, 1]);
  assert.equal(allocated.reduce((sum, row) => sum + row.batchSize, 0), 7);
});
