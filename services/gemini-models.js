/**
 * Single source of truth for Gemini model fallback order.
 * Do not use gemini-1.5-* ids — they often return 404 on the v1 generateContent API.
 * Omit gemini-2.5-pro: free tier often has quota limit 0 for Pro; use Flash-only unless billing enables Pro.
 */
export const GEMINI_MODELS_FALLBACK = Object.freeze([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
]);
