/**
 * Generation quality tiers — Fast / Balanced / Premium (RAG Fix Brief §10).
 * Controls temperature, dedup, historical prompts, section pad, and retry budgets.
 */

export const QUALITY_TIERS = Object.freeze(['fast', 'balanced', 'premium']);

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
    temperatureCreative: 0.85,
    temperatureFactual: 0.25,
    enforceBatchUniqueness: true,
    useHistoricalPrompt: true,
    useResponseSchema: true,
    sectionPadEnabled: false,
    maxValidationAttempts: 4,
    maxSlotAttempts: 4,
    geminiRetriesPerModel: 3,
    hotsHedgingRegen: true,
  };

  if (tier === 'fast') {
    return {
      ...base,
      tier,
      temperatureCreative: 0.72,
      enforceBatchUniqueness: false,
      useHistoricalPrompt: false,
      sectionPadEnabled: true,
      maxValidationAttempts: 2,
      maxSlotAttempts: 2,
      geminiRetriesPerModel: 1,
      hotsHedgingRegen: false,
    };
  }

  if (tier === 'balanced') {
    return {
      ...base,
      tier,
      temperatureCreative: 0.8,
      enforceBatchUniqueness: true,
      useHistoricalPrompt: true,
      sectionPadEnabled: true,
      maxValidationAttempts: 3,
      maxSlotAttempts: 3,
      geminiRetriesPerModel: 2,
      hotsHedgingRegen: false,
    };
  }

  return { ...base, geminiRetriesPerModel: 3 };
}

/** Creative bulk tools vs factual extraction tools. */
export function isFactualExtractionToolSlug(toolSlug) {
  const slug = String(toolSlug || '').trim();
  return slug === 'key-points-formula-extractor';
}

export function getTemperatureForTool(toolSlug, tierSettings) {
  const s = tierSettings || resolveQualityTierSettings('premium');
  return isFactualExtractionToolSlug(toolSlug) ? s.temperatureFactual : s.temperatureCreative;
}
