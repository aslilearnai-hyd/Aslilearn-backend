/**
 * Single source of truth for Gemini model IDs.
 *
 * Gemini 2.0 family was shut down (June 2026). Prefer 3.x lite/flash, with
 * 2.5 as secondary while still available.
 *
 * Do not use gemini-1.5-* ids — they often return 404 on v1beta generateContent.
 * Omit gemini-2.5-pro: free tier often has quota limit 0 for Pro.
 */

/** Economy / batch default (replaces retired gemini-2.0-flash-lite). */
export const GEMINI_LITE_MODEL = 'gemini-3.1-flash-lite';

/** Secondary lite while still on the API (shutdown Oct 2026). */
export const GEMINI_LITE_FALLBACK_MODEL = 'gemini-2.5-flash-lite';

/** General-quality Flash default. */
export const GEMINI_FLASH_MODEL = 'gemini-2.5-flash';

/** Newer Flash when 2.5 is busy or unavailable. */
export const GEMINI_FLASH_FALLBACK_MODEL = 'gemini-3.5-flash';

/** Premium tier — 3.1 Flash-Lite only (stable, no 3.5/2.5 Flash 503 retries). */
export const GEMINI_PREMIUM_MODEL = GEMINI_LITE_MODEL;

/** Lite-only overflow for Premium. */
export const GEMINI_PREMIUM_OVERFLOW_DEFAULT = [
  GEMINI_LITE_MODEL,
  GEMINI_LITE_FALLBACK_MODEL,
].join(',');

/** Full resilience chain (Flash-only, v1beta-safe). */
export const GEMINI_MODELS_FALLBACK = Object.freeze([
  GEMINI_LITE_MODEL,
  GEMINI_LITE_FALLBACK_MODEL,
  GEMINI_FLASH_MODEL,
  GEMINI_FLASH_FALLBACK_MODEL,
]);

/** Comma-separated overflow for flash-lite-only batch runs. */
export const GEMINI_LITE_OVERFLOW_DEFAULT = GEMINI_LITE_FALLBACK_MODEL;

/**
 * Models that must never be called (retired or unsupported on v1beta).
 * Env overrides that still list these are rewritten to GEMINI_LITE_MODEL.
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
  // Gemini 2.0 family shut down June 2026 (incl. flash-lite).
  if (s.startsWith('gemini-2.0')) return true;
  // Shut-down preview lite ids.
  if (s.includes('flash-lite-preview')) return true;
  return false;
}
