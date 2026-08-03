/**
 * Single source of truth for Gemini model IDs.
 *
 * Product rule: ALL traffic uses Gemini 3.1 Flash-Lite. Never call Pro.
 * Any Pro / unknown model id is remapped to gemini-3.1-flash-lite.
 *
 * Do not use gemini-1.5-* or gemini-2.0 — retired.
 */

/** Only model used for generation (Fast / Balanced / Premium / Vidya / OCR). */
export const GEMINI_LITE_MODEL = 'gemini-3.1-flash-lite';

/** Optional secondary Flash if lite is unavailable for a key/project. */
export const GEMINI_FLASH_PREVIEW_MODEL = 'gemini-3-flash-preview';

export const GEMINI_LITE_FALLBACK_MODEL = GEMINI_LITE_MODEL;
export const GEMINI_FLASH_MODEL = GEMINI_LITE_MODEL;
export const GEMINI_FLASH_FALLBACK_MODEL = GEMINI_LITE_MODEL;

/** @deprecated Alias — Premium is Flash-Lite. */
export const GEMINI_PREMIUM_MODEL = GEMINI_LITE_MODEL;

export const GEMINI_PREMIUM_OVERFLOW_DEFAULT = GEMINI_LITE_MODEL;
export const GEMINI_LITE_OVERFLOW_DEFAULT = GEMINI_LITE_MODEL;

export const GEMINI_MODELS_FALLBACK = Object.freeze([GEMINI_LITE_MODEL]);

/** True if this id is a Gemini Pro family model (blocked). */
export function isGeminiProModel(m) {
  const s = String(m || '').trim().toLowerCase();
  if (!s) return false;
  if (s.includes('flash')) return false;
  return (
    s.includes('pro-preview') ||
    s === 'gemini-pro' ||
    s === 'gemini-pro-vision' ||
    /(^|[^a-z])pro([^a-z]|$)/.test(s) ||
    s.startsWith('gemini-3.1-pro') ||
    s.startsWith('gemini-3-pro') ||
    s.startsWith('gemini-2.5-pro') ||
    s.startsWith('gemini-1.5-pro')
  );
}

/**
 * Models that must never be called (retired, unsupported, Pro, or blocked by policy).
 */
export function isRetiredOrUnsupportedGeminiModel(m) {
  const s = String(m || '').trim().toLowerCase();
  if (!s) return true;
  if (isGeminiProModel(s)) return true;
  if (
    s.startsWith('gemini-1.5') ||
    s.startsWith('gemini-1.0') ||
    s.startsWith('gemini-1.1')
  ) {
    return true;
  }
  if (s.startsWith('gemini-2.0')) return true;
  if (s.includes('flash-lite-preview')) return true;
  return false;
}

function isAllowedGeminiModel(m) {
  const s = String(m || '').trim().toLowerCase();
  if (!s || isRetiredOrUnsupportedGeminiModel(s)) return false;
  if (s === GEMINI_LITE_MODEL) return true;
  if (s === GEMINI_FLASH_PREVIEW_MODEL) return true;
  if (s.startsWith('gemini-3.1-flash-lite')) return true;
  if (s.startsWith('gemini-3-flash')) return true;
  return false;
}

/**
 * Normalize any model id to an allowed one.
 * Pro and unknown ids → gemini-3.1-flash-lite. Never returns Pro.
 */
export function resolveAllowedGeminiModel(modelName) {
  const m = String(modelName || '').trim();
  if (!m || isRetiredOrUnsupportedGeminiModel(m) || isGeminiProModel(m)) {
    return GEMINI_LITE_MODEL;
  }
  const lower = m.toLowerCase();
  if (lower === GEMINI_FLASH_PREVIEW_MODEL || lower.startsWith('gemini-3-flash')) {
    // Prefer lite even for flash-preview aliases.
    return GEMINI_LITE_MODEL;
  }
  if (lower.startsWith('gemini-3.1-flash-lite') || lower === GEMINI_LITE_MODEL) {
    return GEMINI_LITE_MODEL;
  }
  if (isAllowedGeminiModel(lower)) return GEMINI_LITE_MODEL;
  return GEMINI_LITE_MODEL;
}

/** Strip Pro ids from a comma-separated model chain. */
export function sanitizeGeminiModelChain(csvOrList) {
  const parts = Array.isArray(csvOrList)
    ? csvOrList
    : String(csvOrList || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    const resolved = resolveAllowedGeminiModel(raw);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out.length ? out : [GEMINI_LITE_MODEL];
}
