import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { isAiGeneratorCompleteOnlySaveEnabled } from '../ai/generators/shared/ai-generator-batch-config.js';
import { getAiGeneratorMaxTokens } from '../ai/generators/shared/ai-generator-llm-budget.js';

test('generation defaults reject incomplete records', () => {
  const previous = process.env.AI_GENERATOR_COMPLETE_ONLY_SAVE;
  delete process.env.AI_GENERATOR_COMPLETE_ONLY_SAVE;
  try {
    assert.equal(isAiGeneratorCompleteOnlySaveEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.AI_GENERATOR_COMPLETE_ONLY_SAVE;
    else process.env.AI_GENERATOR_COMPLETE_ONLY_SAVE = previous;
  }
});

test('premium token budget is not reduced by global cost-saver mode', () => {
  const previous = process.env.AI_GENERATOR_COST_SAVER;
  process.env.AI_GENERATOR_COST_SAVER = 'true';
  try {
    assert.equal(getAiGeneratorMaxTokens('smart-qa-practice-generator', { qualityTier: 'premium' }), 10_000);
  } finally {
    if (previous === undefined) delete process.env.AI_GENERATOR_COST_SAVER;
    else process.env.AI_GENERATOR_COST_SAVER = previous;
  }
});

test('batch orchestrators do not contain duplicate soft-pass saves', () => {
  const generic = fs.readFileSync(
    new URL('../ai/generators/_batch/ai-generator-batch-orchestrator.js', import.meta.url),
    'utf8',
  );
  const book = fs.readFileSync(
    new URL('../ai/generators/_batch/book-generator-batch-orchestrator.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(generic, /uniqueness soft-pass/i);
  assert.doesNotMatch(book, /duplicate soft-pass|uniqueness soft-pass/i);
});
