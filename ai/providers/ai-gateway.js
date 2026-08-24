/**
 * Unified AI gateway for Vidya + control plane.
 * Chat/stream/vision → model-router; structured JSON → gemini-service.
 */
import { callModel, streamGeminiModel, getRouterConfig } from './model-router.js';
import geminiService from './gemini-service.js';

export { callModel, streamGeminiModel, getRouterConfig };

export async function gatewayChat(params) {
  return callModel(params);
}

export async function gatewayStructured(prompt, format = 'json', options = {}) {
  return geminiService.generateStructuredContent(prompt, format, options);
}

export async function gatewayStream(params) {
  return streamGeminiModel(params);
}
