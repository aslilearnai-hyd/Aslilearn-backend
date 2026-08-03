import 'dotenv/config';
import { generateContentCompat } from './ai/providers/google-genai-compat.js';
import { GEMINI_LITE_MODEL } from './ai/providers/gemini-models.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.VIDYA_AI_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Set GEMINI_API_KEY in backend/.env');
  process.exit(1);
}

const models = [
  process.env.VIDYA_AI_GEMINI_MODEL || GEMINI_LITE_MODEL,
  GEMINI_LITE_MODEL,
].filter((v, i, a) => a.indexOf(v) === i);

async function main() {
  console.log('Key prefix:', String(API_KEY).slice(0, 7), 'len=', String(API_KEY).length);
  for (const modelName of models) {
    try {
      const result = await generateContentCompat({
        apiKey: API_KEY,
        model: modelName,
        contents: 'Reply with exactly one word: OK',
        generationConfig: { temperature: 0, maxOutputTokens: 16 },
      });
      console.log(`✅ ${modelName}:`, result.text.slice(0, 80));
    } catch (err) {
      console.error(`❌ ${modelName}:`, err?.message || err);
    }
  }
}

main();
