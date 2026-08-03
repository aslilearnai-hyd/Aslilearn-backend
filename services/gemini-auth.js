/**
 * How a Gemini credential must be sent depends on which kind it is.
 *
 * Google issues two formats:
 *   AIza…  legacy "traffic key"  → query parameter  ?key=…
 *   AQ.…   newer auth key        → Authorization: Bearer …
 *
 * Sending an AQ key as ?key= returns 401 ACCESS_TOKEN_TYPE_UNSUPPORTED
 * ("Expected OAuth 2 access token"), which reads like a dead key but is only
 * the wrong transport. Google is retiring unrestricted AIza keys, so both
 * formats have to work.
 */

/** AQ keys are bearer credentials, not query-string API keys. */
export function isBearerStyleGeminiKey(apiKey) {
  return String(apiKey || '').trim().startsWith('AQ.');
}

/**
 * URL + headers for a Generative Language REST call, authenticated the way this
 * particular key requires.
 *
 * @param {object} args
 * @param {string} args.baseUrl  e.g. https://generativelanguage.googleapis.com/v1beta
 * @param {string} args.model    e.g. gemini-3.1-flash-lite
 * @param {string} args.apiKey
 * @param {string} [args.method] defaults to generateContent
 */
export function buildGeminiEndpoint({ baseUrl, model, apiKey, method = 'generateContent' }) {
  const key = String(apiKey || '').trim();
  const root = `${String(baseUrl || '').replace(/\/+$/, '')}/models/${model}:${method}`;
  if (isBearerStyleGeminiKey(key)) {
    return {
      url: root,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    };
  }
  return {
    url: `${root}?key=${encodeURIComponent(key)}`,
    headers: { 'Content-Type': 'application/json' },
  };
}
