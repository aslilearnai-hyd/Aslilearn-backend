/**
 * Generation quality tiers — Fast / Balanced / Premium (RAG Fix Brief §10).
 * Controls Gemini model tier, temperature, dedup, historical prompts, section pad, and retries.
 */

import {
  GEMINI_FLASH_FALLBACK_MODEL,
  GEMINI_FLASH_MODEL,
  GEMINI_LITE_MODEL,
  GEMINI_PREMIUM_OVERFLOW_DEFAULT,
  GEMINI_PREMIUM_MODEL,
} from '../services/gemini-models.js';

export const QUALITY_TIERS = Object.freeze(['fast', 'balanced', 'premium']);

function resolvePremiumGeminiModel() {
  return String(process.env.AI_GENERATOR_PREMIUM_GEMINI_MODEL || GEMINI_PREMIUM_MODEL).trim();
}

export function getPremiumGeminiFallbackCsv() {
  return String(process.env.AI_GENERATOR_PREMIUM_GEMINI_OVERFLOW || GEMINI_PREMIUM_OVERFLOW_DEFAULT).trim();
}

function resolveBalancedGeminiModel() {
  return String(process.env.AI_GENERATOR_BALANCED_GEMINI_MODEL || GEMINI_FLASH_MODEL).trim();
}

function resolveFastGeminiModel() {
  return String(process.env.AI_GENERATOR_FAST_GEMINI_MODEL || GEMINI_LITE_MODEL).trim();
}

export function normalizeQualityTier(input) {
  const raw = String(input || process.env.AI_GENERATOR_QUALITY_TIER || 'premium')
    .trim()
    .toLowerCase();
  if (QUALITY_TIERS.includes(raw)) return raw;
  return 'premium';
}

export function resolveQualityTierSettings(tierInput, overrides = {}) {
  const tier = normalizeQualityTier(overrides.qualityTier ?? tierInput);

  const base = {
    tier,
    temperatureCreative: 0.8,
    temperatureFactual: 0.25,
    enforceBatchUniqueness: true,
    useHistoricalPrompt: true,
    useResponseSchema: true,
    /** Premium never bypasses validation via cost-saver or silent section-pad saves. */
    strictValidation: true,
    sectionPadEnabled: false,
    maxValidationAttempts: 3,
    maxSlotAttempts: 2,
    geminiRetriesPerModel: 2,
    hotsHedgingRegen: false,
    primaryGeminiModel: resolvePremiumGeminiModel(),
    modelOverflow: getPremiumGeminiFallbackCsv(),
    flashLiteOnly: true,
    batchConcurrency: 3,
    slotStaggerMs: 0,
    skipUltraEconomyCaps: true,
  };

  const batchSize = Number(overrides.batchSize);
  const smallBatch = Number.isFinite(batchSize) && batchSize > 0 && batchSize <= 10;

  if (tier === 'fast') {
    return {
      ...base,
      tier,
      temperatureCreative: 0.72,
      enforceBatchUniqueness: false,
      useHistoricalPrompt: false,
      strictValidation: false,
      sectionPadEnabled: true,
      maxValidationAttempts: 2,
      maxSlotAttempts: 2,
      geminiRetriesPerModel: 1,
      hotsHedgingRegen: false,
      primaryGeminiModel: resolveFastGeminiModel(),
      flashLiteOnly: true,
      batchConcurrency: 1,
      slotStaggerMs: 0,
    };
  }

  if (tier === 'balanced') {
    return {
      ...base,
      tier,
      temperatureCreative: 0.8,
      enforceBatchUniqueness: true,
      useHistoricalPrompt: true,
      strictValidation: false,
      sectionPadEnabled: true,
      maxValidationAttempts: smallBatch ? 3 : 3,
      maxSlotAttempts: smallBatch ? 2 : 3,
      geminiRetriesPerModel: 2,
      hotsHedgingRegen: false,
      primaryGeminiModel: resolveBalancedGeminiModel(),
      flashLiteOnly: false,
      batchConcurrency: smallBatch ? 3 : 2,
      slotStaggerMs: smallBatch ? 0 : 200,
    };
  }

  // Premium — strict full validation; Lite model + schema; parallel slots
  return {
    ...base,
    batchConcurrency: smallBatch ? 3 : 3,
    slotStaggerMs: 0,
    modelOverflow: getPremiumGeminiFallbackCsv(),
  };
}

/** Creative bulk tools vs factual extraction tools. */
export function isFactualExtractionToolSlug(toolSlug) {
  const slug = String(toolSlug || '').trim();
  return slug === 'key-points-formula-extractor';
}

export function getQualityTierBatchConcurrency(tierSettings, batchSize = 25) {
  const fromTier = Number(tierSettings?.batchConcurrency);
  if (Number.isFinite(fromTier) && fromTier > 0) {
    return Math.min(6, fromTier);
  }
  const env = Number(process.env.AI_GENERATOR_BATCH_CONCURRENCY);
  if (Number.isFinite(env) && env > 0) return Math.min(env, 6);
  const n = Number(batchSize);
  if (Number.isFinite(n) && n <= 10) return 3;
  return tierSettings?.tier === 'fast' ? 1 : 2;
}

export function getQualityTierModelLabel(tierSettings) {
  return String(tierSettings?.primaryGeminiModel || resolvePremiumGeminiModel()).trim();
}

export function getTemperatureForTool(toolSlug, tierSettings) {
  const s = tierSettings || resolveQualityTierSettings('premium');
  return isFactualExtractionToolSlug(toolSlug) ? s.temperatureFactual : s.temperatureCreative;
}
