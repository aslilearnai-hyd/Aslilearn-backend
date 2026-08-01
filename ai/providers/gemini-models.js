/**
 * Single source of truth for Gemini model IDs.
 *
 * Fast/Balanced default: Gemini 3.1 Flash-Lite.
 * Premium: Gemini 3.1 Pro Preview (API id: gemini-3.1-pro-preview).
 *
 * Do not use gemini-1.5-* or gemini-2.0 — retired.
 */

/** Economy / batch / Fast default. */
export const GEMINI_LITE_MODEL = 'gemini-3.1-flash-lite';

/** Secondary Flash when 3.1 lite is unavailable for a project/key. */
export const GEMINI_FLASH_PREVIEW_MODEL = 'gemini-3-flash-preview';

/** Kept for API compatibility — same as lite when secondary lite unavailable. */
export const GEMINI_LITE_FALLBACK_MODEL = GEMINI_LITE_MODEL;

/** General Flash alias — maps to lite for Fast/Balanced. */
export const GEMINI_FLASH_MODEL = GEMINI_LITE_MODEL;

/** Alternate Flash alias — maps to lite. */
export const GEMINI_FLASH_FALLBACK_MODEL = GEMINI_LITE_MODEL;

/** Premium tier — official Gemini API model code (must include -preview). */
export const GEMINI_PREMIUM_MODEL = 'gemini-3.1-pro-preview';

/** Premium overflow when Pro is busy/unavailable. */
export const GEMINI_PREMIUM_OVERFLOW_DEFAULT = [GEMINI_PREMIUM_MODEL, GEMINI_LITE_MODEL].join(',');

/** Full resilience chain (lite → flash preview). */
export const GEMINI_MODELS_FALLBACK = Object.freeze([
  GEMINI_LITE_MODEL,
  GEMINI_FLASH_PREVIEW_MODEL,
]);

export const GEMINI_LITE_OVERFLOW_DEFAULT = GEMINI_LITE_MODEL;

/**
 * Models that must never be called (retired, unsupported, or blocked by policy).
 */
export function isRetiredOrUnsupportedGeminiModel(m) {
  const s = String(m || '').trim().toLowerCase();
  if (!s) return true;
  if (
    s.startsWith('gemini-1.5') ||
    s.startsWith('gemini-1.0') ||
    s.startsWith('gemini-1.1')
  ) {
    return true;
  }
  // Legacy Gemini Pro / vision (not 3.1 Pro).
  if (s === 'gemini-pro' || s === 'gemini-pro-vision') return true;
  if (s.startsWith('gemini-2.0')) return true;
  if (s.includes('flash-lite-preview')) return true;
  return false;
}

function isAllowedGeminiModel(m) {
  const s = String(m || '').trim().toLowerCase();
  if (!s || isRetiredOrUnsupportedGeminiModel(s)) return false;
  if (s === GEMINI_LITE_MODEL) return true;
  if (s === GEMINI_FLASH_PREVIEW_MODEL) return true;
  if (s === GEMINI_PREMIUM_MODEL) return true;
  if (s === 'gemini-3.1-pro') return true;
  if (s.startsWith('gemini-3.1-flash-lite')) return true;
  if (s.startsWith('gemini-3.1-pro')) return true;
  if (s.startsWith('gemini-3-flash')) return true;
  return false;
}

/**
 * Normalize env/model id.
 * Maps gemini-3.1-pro → gemini-3.1-pro-preview (API requires -preview suffix).
 * Allows 3.1 Flash-Lite; remaps everything else to lite.
 */
export function resolveAllowedGeminiModel(modelName) {
  const m = String(modelName || '').trim();
  if (!m || isRetiredOrUnsupportedGeminiModel(m)) return GEMINI_LITE_MODEL;
  const lower = m.toLowerCase();
  if (
    lower === GEMINI_PREMIUM_MODEL ||
    lower === 'gemini-3.1-pro' ||
    lower === 'gemini-3.1-pro-preview' ||
    lower.startsWith('gemini-3.1-pro')
  ) {
    return GEMINI_PREMIUM_MODEL;
  }
  if (lower === GEMINI_FLASH_PREVIEW_MODEL || lower.startsWith('gemini-3-flash')) {
    return GEMINI_FLASH_PREVIEW_MODEL;
  }
  if (isAllowedGeminiModel(lower)) return lower === GEMINI_LITE_MODEL ? GEMINI_LITE_MODEL : lower;
  return GEMINI_LITE_MODEL;
}
