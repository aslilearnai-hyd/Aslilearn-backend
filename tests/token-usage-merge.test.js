import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeTokenUsageSnapshots } from '../utils/token-usage-merge.js';

test('expanded book batches retain token totals and calls from every scope', () => {
  const merged = mergeTokenUsageSnapshots([
    {
      calls: [{ model: 'gemini-3.1-flash-lite', promptTokens: 100, completionTokens: 40 }],
      totals: { promptTokens: 100, completionTokens: 40, totalTokens: 140, callCount: 1 },
    },
    {
      calls: [{ model: 'gemini-3.1-flash-lite', promptTokens: 200, completionTokens: 80 }],
      totals: { promptTokens: 200, completionTokens: 80, totalTokens: 280, callCount: 1 },
    },
  ]);

  assert.deepEqual(merged.totals, {
    promptTokens: 300,
    completionTokens: 120,
    totalTokens: 420,
    callCount: 2,
  });
  assert.equal(merged.calls.length, 2);
});

test('merge derives totals from legacy call-only snapshots', () => {
  const merged = mergeTokenUsageSnapshots([
    {
      calls: [{ promptTokens: 50, completionTokens: 20, totalTokens: 70 }],
    },
  ]);
  assert.deepEqual(merged.totals, {
    promptTokens: 50,
    completionTokens: 20,
    totalTokens: 70,
    callCount: 1,
  });
});
