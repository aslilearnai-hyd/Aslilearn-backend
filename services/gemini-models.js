/**
 * Single source of truth for Gemini model IDs.
 *
 * Policy: Gemini 3.1 Flash-Lite only for AI generation (stable, no 3.5/2.5 escalation).
 * Do not use gemini-1.5-* or gemini-2.0/2.5 — retired or blocked.
 */

/** Economy / batch / premium default. */
export const GEMINI_LITE_MODEL = 'gemini-3.1-flash-lite';

/** Kept for API compatibility — same as lite (no separate overflow model). */
export const GEMINI_LITE_FALLBACK_MODEL = GEMINI_LITE_MODEL;

/** General Flash alias — maps to lite-only policy. */
export const GEMINI_FLASH_MODEL = GEMINI_LITE_MODEL;

/** Alternate Flash alias — maps to lite-only policy. */
export const GEMINI_FLASH_FALLBACK_MODEL = GEMINI_LITE_MODEL;

/** Premium tier. */
export const GEMINI_PREMIUM_MODEL = GEMINI_LITE_MODEL;

export const GEMINI_PREMIUM_OVERFLOW_DEFAULT = GEMINI_LITE_MODEL;

/** Full resilience chain (lite only). */
export const GEMINI_MODELS_FALLBACK = Object.freeze([GEMINI_LITE_MODEL]);

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
  if (s === 'gemini-pro' || s === 'gemini-pro-vision') return true;
  if (s.startsWith('gemini-2.0')) return true;
  if (s.startsWith('gemini-2.5')) return true;
  if (s.includes('flash-lite-preview')) return true;
  /** Block non-lite Flash models when policy is 3.1 flash-lite only. */
  if (s.includes('gemini-3.5') || (s.includes('gemini-3.') && s.includes('flash') && !s.includes('flash-lite'))) {
    return true;
  }
  return false;
}

/** Normalize any env/model id to the allowed lite model. */
export function resolveAllowedGeminiModel(modelName) {
  const m = String(modelName || '').trim();
  if (!m || isRetiredOrUnsupportedGeminiModel(m)) return GEMINI_LITE_MODEL;
  return m.toLowerCase() === GEMINI_LITE_MODEL ? GEMINI_LITE_MODEL : GEMINI_LITE_MODEL;
}
