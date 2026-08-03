/** Gemini 2.5 Flash paid-tier list prices (USD per 1M tokens). LEGACY — 2.5 is retired
 *  per gemini-models.js; kept only so historical records can be re-priced correctly. */
export const GEMINI_25_FLASH_INPUT_USD_PER_M = 0.3;
export const GEMINI_25_FLASH_OUTPUT_USD_PER_M = 2.5;
/** Gemini 2.5 Flash-Lite. LEGACY — see above. */
export const GEMINI_25_FLASH_LITE_INPUT_USD_PER_M = 0.1;
export const GEMINI_25_FLASH_LITE_OUTPUT_USD_PER_M = 0.4;

/**
 * Gemini 3.1 Flash-Lite list pricing (USD per 1M tokens) — the model actually
 * used for every AI Generator run (see gemini-models.js GEMINI_LITE_MODEL).
 *
 * BUGFIX (July 2026): resolveGeminiPricing was charging flash-lite traffic at the
 * 2.5 Flash-Lite rate ($0.10/$0.40) while labelling it 'gemini-3.1-flash-lite'.
 * Real 3.1 Flash-Lite is $0.25/$1.50 — 2.5x input and 3.75x output. Because these
 * generations are output-dominant, every cost figure the platform has reported
 * (per-record metadata.tokenUsage, batch totals, admin cost views) understated
 * actual spend by roughly 3.5x.
 */
export const GEMINI_31_FLASH_LITE_INPUT_USD_PER_M = 0.25;
export const GEMINI_31_FLASH_LITE_OUTPUT_USD_PER_M = 1.5;

export function getUsdToInrRate() {
  const rate = Number(process.env.USD_TO_INR_RATE);
  return Number.isFinite(rate) && rate > 0 ? rate : 95.11;
}

/** Gemini 3.1 Pro preview list pricing (USD per 1M tokens). */
export const GEMINI_31_PRO_INPUT_USD_PER_M = 2;
export const GEMINI_31_PRO_OUTPUT_USD_PER_M = 12;

export function normalizeGeminiModelLabel(modelName = '') {
  const raw = String(modelName || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  // Pro is blocked platform-wide — always label as Flash-Lite 3.1.
  if (lower.includes('pro') && !lower.includes('flash')) {
    return 'gemini-3.1-flash-lite';
  }
  if (lower.includes('flash-lite') || lower.includes('flash_lite')) {
    if (lower.includes('2.5')) return 'gemini-2.5-flash-lite (legacy)';
    return 'gemini-3.1-flash-lite';
  }
  if (lower.includes('3.1') && lower.includes('flash')) return 'gemini-3.1-flash-lite';
  if (lower.startsWith('gemini-1.5') || lower.startsWith('gemini-1.0') || lower.startsWith('gemini-2.5')) {
    return 'gemini-3.1-flash-lite';
  }
  if (lower.includes('flash')) return 'gemini-3.1-flash-lite';
  return 'gemini-3.1-flash-lite';
}

export function resolveGeminiPricing(modelName = '') {
  const model = String(modelName || '').toLowerCase();
  // Never price as Pro — platform only runs Flash-Lite 3.1.
  if (model.includes('pro') && !model.includes('flash')) {
    return {
      model: 'gemini-3.1-flash-lite',
      inputUsdPerM: GEMINI_31_FLASH_LITE_INPUT_USD_PER_M,
      outputUsdPerM: GEMINI_31_FLASH_LITE_OUTPUT_USD_PER_M,
      pricingNote: 'Estimated from Gemini 3.1 Flash-Lite list pricing (input $0.25/M, output $1.50/M).',
    };
  }
  // Legacy 2.5 Flash-Lite records — price at the rate that actually applied when
  // they were generated, so historical spend is not retroactively inflated.
  if (model.includes('2.5') && (model.includes('flash-lite') || model.includes('flash_lite'))) {
    return {
      model: 'gemini-2.5-flash-lite (legacy)',
      inputUsdPerM: GEMINI_25_FLASH_LITE_INPUT_USD_PER_M,
      outputUsdPerM: GEMINI_25_FLASH_LITE_OUTPUT_USD_PER_M,
      pricingNote:
        'Legacy Gemini 2.5 Flash-Lite list pricing (input $0.10/M, output $0.40/M).',
    };
  }
  if (model.includes('flash-lite') || model.includes('flash_lite')) {
    return {
      model: 'gemini-3.1-flash-lite',
      inputUsdPerM: GEMINI_31_FLASH_LITE_INPUT_USD_PER_M,
      outputUsdPerM: GEMINI_31_FLASH_LITE_OUTPUT_USD_PER_M,
      pricingNote:
        'Gemini 3.1 Flash-Lite list pricing (input $0.25/M, output $1.50/M).',
    };
  }
  // Fallback. NOTE: this labels output 'gemini-3.5-flash' but prices it at the
  // Gemini 2.5 Flash rate — the 3.5 Flash rate has NOT been verified, so the
  // number is a placeholder, not a source of truth. In practice this branch
  // should be unreachable: resolveAllowedGeminiModel in gemini-models.js remaps
  // everything to 3.1 Flash-Lite. If this note shows up in real cost
  // reports, a non-allowlisted model is being called and the price is wrong.
  return {
    model: 'gemini-3.1-flash-lite',
    inputUsdPerM: GEMINI_31_FLASH_LITE_INPUT_USD_PER_M,
    outputUsdPerM: GEMINI_31_FLASH_LITE_OUTPUT_USD_PER_M,
    pricingNote:
      'Fallback priced at Gemini 3.1 Flash-Lite list rates (input $0.25/M, output $1.50/M).',
  };
}

/**
 * @param {{ promptTokens?: number; completionTokens?: number; totalTokens?: number }} totals
 * @param {string} [modelName]
 */
export function computeGeminiFlashCost(totals = {}, modelName = '') {
  const promptTokens = Math.max(0, Number(totals.promptTokens || 0));
  const completionTokens = Math.max(0, Number(totals.completionTokens || 0));
  const pricing = resolveGeminiPricing(modelName);
  const inputUsd = (promptTokens / 1_000_000) * pricing.inputUsdPerM;
  const outputUsd = (completionTokens / 1_000_000) * pricing.outputUsdPerM;
  const usd = inputUsd + outputUsd;
  const exchangeRateInr = getUsdToInrRate();
  return {
    usd: Number(usd.toFixed(6)),
    inr: Number((usd * exchangeRateInr).toFixed(2)),
    inputUsd: Number(inputUsd.toFixed(6)),
    outputUsd: Number(outputUsd.toFixed(6)),
    exchangeRateInr,
    model: pricing.model,
    pricingNote: pricing.pricingNote,
  };
}

/** Pick dominant model from token session calls for cost estimate. */
export function dominantModelFromTokenUsage(tokenUsage) {
  const calls = Array.isArray(tokenUsage?.calls) ? tokenUsage.calls : [];
  if (!calls.length) {
    return String(process.env.AI_GENERATOR_GEMINI_MODEL || 'gemini-3.1-flash-lite').trim();
  }
  const counts = new Map();
  for (const call of calls) {
    const key = String(call?.model || '').trim() || 'unknown';
    counts.set(key, (counts.get(key) || 0) + Number(call?.totalTokens || 0));
  }
  let best = '';
  let bestTokens = -1;
  for (const [model, tokens] of counts.entries()) {
    if (tokens > bestTokens) {
      best = model;
      bestTokens = tokens;
    }
  }
  return best;
}

/** Human-readable model line from token session (actual API model ids). */
export function formatModelsUsedFromTokenUsage(tokenUsage = {}) {
  const calls = Array.isArray(tokenUsage?.calls) ? tokenUsage.calls : [];
  const labels = [];
  const seen = new Set();
  for (const call of calls) {
    const label = normalizeGeminiModelLabel(call?.model || '');
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  if (!labels.length) {
    return normalizeGeminiModelLabel(
      dominantModelFromTokenUsage(tokenUsage) ||
        process.env.AI_GENERATOR_GEMINI_MODEL ||
        'gemini-3.1-flash-lite',
    );
  }
  if (labels.length === 1) return labels[0];
  return `mixed (${labels[0]} + ${labels.length - 1} other${labels.length > 2 ? 's' : ''})`;
}

/**
 * Accurate cost: sum each LLM call at its model rate (Flash-Lite vs Flash may differ in one variant).
 * @param {{ calls?: Array<{ model?: string; promptTokens?: number; completionTokens?: number }>; totals?: object }} tokenUsage
 * @param {number} [exchangeRateOverride]
 */
export function computeGeminiCostFromTokenUsage(tokenUsage = {}, exchangeRateOverride) {
  const exchangeRateInr =
    Number.isFinite(exchangeRateOverride) && exchangeRateOverride > 0
      ? exchangeRateOverride
      : getUsdToInrRate();
  const calls = Array.isArray(tokenUsage?.calls) ? tokenUsage.calls : [];

  if (calls.length > 0) {
    let inputUsd = 0;
    let outputUsd = 0;
    const modelTokenCounts = new Map();

    for (const call of calls) {
      const promptTokens = Math.max(0, Number(call?.promptTokens || 0));
      const completionTokens = Math.max(0, Number(call?.completionTokens || 0));
      const pricing = resolveGeminiPricing(call?.model || '');
      inputUsd += (promptTokens / 1_000_000) * pricing.inputUsdPerM;
      outputUsd += (completionTokens / 1_000_000) * pricing.outputUsdPerM;
      modelTokenCounts.set(
        pricing.model,
        (modelTokenCounts.get(pricing.model) || 0) + promptTokens + completionTokens,
      );
    }

    let dominantModel = resolveGeminiPricing('').model;
    let bestTokens = -1;
    for (const [model, tokens] of modelTokenCounts.entries()) {
      if (tokens > bestTokens) {
        dominantModel = model;
        bestTokens = tokens;
      }
    }

    const usd = inputUsd + outputUsd;
    const modelLabel = formatModelsUsedFromTokenUsage(tokenUsage);

    return {
      usd: Number(usd.toFixed(6)),
      inr: Number((usd * exchangeRateInr).toFixed(2)),
      inputUsd: Number(inputUsd.toFixed(6)),
      outputUsd: Number(outputUsd.toFixed(6)),
      exchangeRateInr,
      model: modelLabel,
      pricingNote:
        'Estimated from Gemini list pricing per LLM call (input + output tokens × each model rate).',
    };
  }

  return computeGeminiFlashCost(tokenUsage.totals || {}, dominantModelFromTokenUsage(tokenUsage));
}
