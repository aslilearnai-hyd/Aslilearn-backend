/**
 * Lightweight Gemini helper (legacy services). Uses @google/genai for AQ. auth keys.
 */
import { generateContentCompat } from '../ai/providers/google-genai-compat.js';
import { resolveAllowedGeminiModel, GEMINI_LITE_MODEL } from '../ai/providers/gemini-models.js';

const apiKey = process.env.GEMINI_API_KEY || process.env.VIDYA_AI_GEMINI_API_KEY || '';
if (!apiKey) {
  console.warn('[gemini] GEMINI_API_KEY is not set — GeminiService will fail closed.');
}

class GeminiService {
  constructor() {
    this.modelName = resolveAllowedGeminiModel(process.env.VIDYA_AI_GEMINI_MODEL || GEMINI_LITE_MODEL);
  }

  async generateEducationalContent(prompt, context = '') {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    const fullPrompt = context
      ? `Context: ${context}\n\nRequest: ${prompt}`
      : String(prompt || '');
    const result = await generateContentCompat({
      apiKey,
      model: this.modelName,
      contents: fullPrompt,
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    });
    return result.text;
  }

  async analyzeImage(imageBase64, prompt = 'Describe this educational image.') {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    const result = await generateContentCompat({
      apiKey,
      model: this.modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: String(prompt || '') },
            { inlineData: { mimeType: 'image/jpeg', data: String(imageBase64 || '') } },
          ],
        },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    });
    return result.text;
  }
}

export default new GeminiService();
