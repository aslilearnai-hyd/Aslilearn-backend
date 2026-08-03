/**
 * Thin helpers around the current Google Gen AI SDK (@google/genai).
 * Supports both legacy AIzaSy traffic keys and new AQ. auth keys from AI Studio.
 */
import { GoogleGenAI } from '@google/genai';
import { buildGeminiEndpoint } from '../../services/gemini-auth.js';

const clientByKey = new Map();

export function getGoogleGenAI(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Gemini API key is missing');
  let client = clientByKey.get(key);
  if (!client) {
    client = new GoogleGenAI({ apiKey: key });
    clientByKey.set(key, client);
  }
  return client;
}

/**
 * Build SDK config from legacy generationConfig shape.
 * @param {Record<string, unknown>} [generationConfig]
 * @param {string} [systemInstruction]
 */
export function toGenAIConfig(generationConfig = {}, systemInstruction = '') {
  const cfg = {};
  const systemText = String(systemInstruction || '').trim();
  if (systemText) cfg.systemInstruction = systemText;

  if (Number.isFinite(generationConfig.temperature)) cfg.temperature = generationConfig.temperature;
  if (Number.isFinite(generationConfig.topP)) cfg.topP = generationConfig.topP;
  if (Number.isFinite(generationConfig.topK)) cfg.topK = generationConfig.topK;
  if (Number.isFinite(generationConfig.maxOutputTokens)) {
    cfg.maxOutputTokens = generationConfig.maxOutputTokens;
  }
  if (generationConfig.responseMimeType) {
    cfg.responseMimeType = generationConfig.responseMimeType;
  }
  if (generationConfig.responseSchema && typeof generationConfig.responseSchema === 'object') {
    cfg.responseSchema = generationConfig.responseSchema;
  }
  if (Array.isArray(generationConfig.responseModalities)) {
    cfg.responseModalities = generationConfig.responseModalities;
  }
  return cfg;
}

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   contents: unknown,
 *   systemInstruction?: string,
 *   generationConfig?: Record<string, unknown>,
 * }} params
 */
export async function generateContentCompat(params) {
  const apiKey = String(params.apiKey || '').trim();
  const model = String(params.model || '').trim();
  if (!apiKey) throw new Error('Gemini API key is missing');
  if (!model) throw new Error('Gemini model is missing');

  const ai = getGoogleGenAI(apiKey);
  const response = await ai.models.generateContent({
    model,
    contents: params.contents,
    config: toGenAIConfig(params.generationConfig || {}, params.systemInstruction || ''),
  });

  const text = String(response?.text || '').trim();
  return {
    text,
    response: {
      text: () => text,
      candidates: response?.candidates,
      usageMetadata: response?.usageMetadata,
    },
    usageMetadata: response?.usageMetadata,
    candidates: response?.candidates,
    raw: response,
  };
}

/**
 * @param {{ apiKey: string, model: string, text: string }} params
 * @returns {Promise<number[]>}
 */
export async function embedContentCompat({ apiKey, model, text }) {
  const key = String(apiKey || '').trim();
  const modelName = String(model || '').trim();
  if (!key) throw new Error('Gemini API key is missing');
  if (!modelName) throw new Error('Gemini embedding model is missing');

  const ai = getGoogleGenAI(key);
  const response = await ai.models.embedContent({
    model: modelName,
    contents: String(text || ''),
  });

  const values =
    response?.embeddings?.[0]?.values ||
    response?.embedding?.values ||
    null;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini embedding returned empty vector');
  }
  return values;
}

/**
 * Native REST generateContent.
 *
 * Auth transport depends on the key format — x-goog-api-key does NOT work for
 * AQ keys (Google answers 401 ACCESS_TOKEN_TYPE_UNSUPPORTED, "Expected OAuth 2
 * access token"); those must go in an Authorization: Bearer header.
 * buildGeminiEndpoint picks the right one.
 */
export async function fetchGeminiGenerateContent({
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  apiKey,
  model,
  body,
  signal,
  timeoutMs,
}) {
  const key = String(apiKey || '').trim();
  const modelName = String(model || '').trim();
  if (!key) throw new Error('Gemini API key is missing');
  if (!modelName) throw new Error('Gemini model is missing');

  const root = String(baseUrl || '').replace(/\/+$/, '');
  const endpoint = buildGeminiEndpoint({ baseUrl: root, model: modelName, apiKey: key });
  const url = endpoint.url;

  let controller = null;
  let timer = null;
  let effectiveSignal = signal;
  if (!effectiveSignal && Number(timeoutMs) > 0) {
    controller = new AbortController();
    effectiveSignal = controller.signal;
    timer = setTimeout(() => controller.abort(), Number(timeoutMs));
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify(body || {}),
      signal: effectiveSignal,
    });
    return response;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
