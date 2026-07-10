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
  const raw = await geminiService.generateStructuredContent(assembled.prompt, 'json', {
    primaryModel: model,
    temperature: 0.55,
    maxTokens: 9000,
  });

  const json = extractJsonObject(raw);
  if (!hasAllSixSections(json)) {
    return { ok: false, error: 'Model did not return all six sections.', raw };
  }

  // Attach a stable schema version + the six sections in canonical order.
  const structuredContent = {
    schema: 'asli-v2-six-section',
    tool: toolSlug,
    ...Object.fromEntries(V2_SECTION_IDS.map((id) => [id, json[id]])),
  };
  return { ok: true, structuredContent };
}

export default generateSixSectionContent;
