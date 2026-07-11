/**
 * V2 six-section content generator (pilot).
 * Assembles the master/tool/board/RAG/IIT prompt, calls Gemini for strict JSON,
 * parses it, and returns semantic structuredContent (six sections). Rendering is
 * the frontend's job (SixSectionViewer) — this service does content only.
 */

import geminiService from './gemini-service.js';
import { extractJsonObject } from '../utils/ai-json-extract.js';
import { getAiGeneratorGeminiModel } from '../utils/ai-generator-batch-config.js';
import { assembleSixSectionPrompt } from '../prompts/v2/assemble.js';
import { V2_SECTION_IDS } from '../prompts/v2/master-prompt.js';

function hasAllSixSections(json) {
  if (!json || typeof json !== 'object') return false;
  return V2_SECTION_IDS.every((id) => json[id] && typeof json[id] === 'object');
}

/**
 * @param {string} toolSlug
 * @param {object} params { board, classLabel, subject, topic, subTopic }
 * @param {{ ragContext?:string, primaryModel?:string }} [opts]
 * @returns {Promise<{ ok:boolean, structuredContent?:object, error?:string }>}
 */
export async function generateSixSectionContent(toolSlug, params = {}, opts = {}) {
  const assembled = assembleSixSectionPrompt(toolSlug, params, opts);
  if (!assembled.supported) {
    return { ok: false, error: `Tool "${toolSlug}" is not V2-enabled yet.` };
  }

  const model = opts.primaryModel || getAiGeneratorGeminiModel();
  const baseTemp =
    Number.isFinite(opts.temperature) && opts.temperature > 0 && opts.temperature <= 1.2
      ? opts.temperature
      : 0.55;
  // Ceiling only — you pay for tokens actually generated, so a high cap just
  // prevents truncated JSON on large outputs (e.g. a 25-question worksheet with a
  // full answer key). Overridable per call.
  const maxTokens =
    Number.isFinite(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : 14000;

  // Lighter models (gemini-3.1-flash-lite) intermittently return incomplete JSON
  // (a missing section). Retry a few times — cheap on Flash-Lite (~₹0.1/call) — and
  // lower the temperature on retries for more reliable structure. This keeps the
  // cheapest model usable without ever falling to a costlier one.
  const maxTries = Number.isFinite(opts.maxTries) && opts.maxTries > 0 ? opts.maxTries : 3;
  let lastRaw = '';
  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const temperature =
      attempt === 1 ? baseTemp : Math.max(0.3, baseTemp - 0.2 * (attempt - 1));
    const raw = await geminiService.generateStructuredContent(assembled.prompt, 'json', {
      primaryModel: model,
      temperature,
      maxTokens,
    });
    lastRaw = raw;
    const json = extractJsonObject(raw);
    if (hasAllSixSections(json)) {
      return {
        ok: true,
        structuredContent: {
          schema: 'asli-v2-six-section',
          tool: toolSlug,
          ...Object.fromEntries(V2_SECTION_IDS.map((id) => [id, json[id]])),
        },
      };
    }
  }
  return { ok: false, error: 'Model did not return all six sections.', raw: lastRaw };
}

export default generateSixSectionContent;
