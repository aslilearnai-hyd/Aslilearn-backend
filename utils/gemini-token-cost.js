/** Gemini 2.5 Flash paid-tier list prices (USD per 1M tokens). */
export const GEMINI_25_FLASH_INPUT_USD_PER_M = 0.3;
export const GEMINI_25_FLASH_OUTPUT_USD_PER_M = 2.5;
/** Gemini 2.5 Flash-Lite — used for AI Generator batch variants (lower cost). */
export const GEMINI_25_FLASH_LITE_INPUT_USD_PER_M = 0.1;
export const GEMINI_25_FLASH_LITE_OUTPUT_USD_PER_M = 0.4;

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
  if (lower.includes('pro')) {
    return lower.includes('3.1') ? 'gemini-3.1-pro-preview' : raw;
  }
  if (lower.includes('flash-lite') || lower.includes('flash_lite')) {
    return 'gemini-3.1-flash-lite';
  }
  if (lower.includes('3.5')) return 'gemini-3.5-flash';
  if (lower.includes('3.1') && lower.includes('flash')) return 'gemini-3.1-flash-lite';
  if (lower.startsWith('gemini-1.5') || lower.startsWith('gemini-1.0') || lower.startsWith('gemini-2.5')) {
    return 'gemini-3.1-flash-lite (legacy env model)';
  }
  if (lower.includes('flash')) return 'gemini-3.1-flash-lite';
  return raw;
}

export function resolveGeminiPricing(modelName = '') {
  const model = String(modelName || '').toLowerCase();
  const displayModel = normalizeGeminiModelLabel(modelName);
  if (model.includes('pro')) {
    return {
      model: model.includes('3.1') ? 'gemini-3.1-pro-preview' : model,
      inputUsdPerM: GEMINI_31_PRO_INPUT_USD_PER_M,
      outputUsdPerM: GEMINI_31_PRO_OUTPUT_USD_PER_M,
      pricingNote: 'Estimated from Pro list pricing (input $2/M, output $12/M).',
    };
  }
  if (model.includes('flash-lite') || model.includes('flash_lite')) {
    return {
      model: displayModel || 'gemini-3.1-flash-lite',
      inputUsdPerM: GEMINI_25_FLASH_LITE_INPUT_USD_PER_M,
      outputUsdPerM: GEMINI_25_FLASH_LITE_OUTPUT_USD_PER_M,
      pricingNote:
        'Estimated from Flash-Lite list pricing (input $0.10/M, output $0.40/M).',
    };
  }
  return {
    model: displayModel || 'gemini-3.5-flash',
    inputUsdPerM: GEMINI_25_FLASH_INPUT_USD_PER_M,
    outputUsdPerM: GEMINI_25_FLASH_OUTPUT_USD_PER_M,
    pricingNote: 'Estimated from Flash list pricing (input $0.30/M, output $2.50/M).',
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
