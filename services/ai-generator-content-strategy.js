import { computeTopicSaturation } from './ai-generator-topic-saturation.js';
import { selectRandomUniqueRecords } from './ai-generator-random-retrieval.js';

/**
 * Decide generation strategy for a curriculum slot.
 *
 * 0–100: generate new
 * 101–500: generate with stronger uniqueness
 * 501–1000: generate only if uniqueness passes (strict)
 * 1000+: random retrieval (unless forceGenerate)
 */
export async function resolveContentStrategy(scope, opts = {}) {
  const forceGenerate = opts.forceGenerate === true || opts.forceGenerateNew === true;
  const batchSize = Number(opts.batchSize) > 0 ? Number(opts.batchSize) : 25;

  const saturation = await computeTopicSaturation(scope);

  if (forceGenerate) {
    return {
      action: 'generate',
      mode: 'force_generate',
      saturation,
      strictUniqueness: false,
      batchSize,
    };
  }

  if (saturation.shouldUseRandomRetrieval) {
    return {
      action: 'random_retrieval',
      mode: 'saturated_pool',
      saturation,
      strictUniqueness: false,
      batchSize,
    };
  }

  if (saturation.totalGenerations > saturation.thresholds.highMax) {
    return {
      action: 'generate',
      mode: 'strict_generate',
      saturation,
      strictUniqueness: false,
      batchSize,
    };
  }

  if (saturation.totalGenerations > saturation.thresholds.healthyMax) {
    return {
      action: 'generate',
      mode: 'strong_uniqueness',
      saturation,
      strictUniqueness: false,
      batchSize,
    };
  }

  return {
    action: 'generate',
    mode: 'standard_generate',
    saturation,
    strictUniqueness: false,
    batchSize,
  };
}

export async function executeRandomRetrievalBatch(scope, opts = {}) {
  const result = await selectRandomUniqueRecords(scope, opts);
  return {
    success: result.records.length === (opts.batchSize || 25),
    savedCount: result.records.length,
    failedCount: Math.max(0, (opts.batchSize || 25) - result.records.length),
    records: result.records,
    mode: result.mode,
    geminiGenerationsAvoided: result.geminiGenerationsAvoided,
    tokenSavingsEstimate: result.tokenSavingsEstimate,
    totalPoolSize: result.total,
    failures: [],
    existingCountBefore: result.total,
    tokenUsage: null,
    cost: null,
  };
}
