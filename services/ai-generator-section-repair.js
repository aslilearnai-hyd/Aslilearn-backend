import geminiService from './gemini-service.js';
import { getAiToolTemplate } from '../config/aiToolTemplates.js';
import { getAiGeneratorGeminiModel } from '../utils/ai-generator-batch-config.js';
import { buildCanonicalFieldsRetryHint } from '../utils/ai-generator-section-pad.js';
import { extractJsonObject } from '../utils/ai-json-extract.js';
import { buildStoryPassageLanguagePromptBlock, buildStoryPassageContentPromptBlock, buildStoryPassageMonolingualOverrideBlock } from '../utils/story-passage-subject.js';
import { buildPromptEngineRepairPrompt, isPromptEngineEnabled } from '../prompts/registry.js';

function deepMergeStructured(base, patch) {
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
  for (const [key, val] of Object.entries(patch)) {
    if (val == null) continue;
    if (Array.isArray(val) && val.length) {
      out[key] = val;
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      out[key] = { ...(out[key] && typeof out[key] === 'object' ? out[key] : {}), ...val };
    } else if (String(val).trim()) {
      out[key] = val;
    }
  }
  return out;
}

/**
 * LLM repair pass — generate ONLY missing canonical sections (no local scaffold).
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 * @param {string[]} missingSections
 * @param {Record<string, unknown>} meta
 * @param {string} historicalBlock
 */
export async function repairMissingSectionsViaLlm(
  toolSlug,
  structured,
  missingSections = [],
  meta = {},
  historicalBlock = '',
) {
  const slug = String(toolSlug || '').trim();
  const missing = Array.isArray(missingSections) ? missingSections.filter(Boolean) : [];
  if (!missing.length) return structured;

  const t = getAiToolTemplate(slug);
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const hint = buildCanonicalFieldsRetryHint(slug, missing);
  const storyLanguageBlock =
    slug === 'reading-practice-room' || slug === 'story-passage-creator'
      ? [
          buildStoryPassageLanguagePromptBlock(subject),
          buildStoryPassageContentPromptBlock(),
          buildStoryPassageMonolingualOverrideBlock(subject),
        ]
          .filter(Boolean)
          .join('\n\n')
      : '';

  const engineRepairBlock = isPromptEngineEnabled()
    ? buildPromptEngineRepairPrompt(slug, {
        ...meta,
        subject,
        topic: meta.topic || '',
        subTopic: topic,
        missingSections: missing,
      })
    : '';

  const prompt = `You are a senior CBSE educator repairing incomplete ${t?.title || slug} JSON for Super Admin AI Generator.

CURRICULUM: ${subject} | Topic: ${meta.topic || ''} | Subtopic: ${topic} | Class: ${meta.classLabel || ''}
${storyLanguageBlock ? `\n${storyLanguageBlock}\n` : ''}

EXISTING structuredContent (preserve all filled fields — do NOT rewrite them):
${JSON.stringify(structured, null, 2)}

MISSING SECTIONS ONLY (generate real, original educational content for each):
${missing.map((m, i) => `${i + 1}. ${m}`).join('\n')}

${hint}

${engineRepairBlock ? `\n${engineRepairBlock}\n` : ''}

${historicalBlock}

Return ONLY valid JSON:
{
  "structuredContent": { ...complete merged object with ALL missing sections filled ... }
}

Rules:
- Fill ONLY missing sections with substantive educator-written content (not placeholders).
- Do NOT repeat questions or activities from the historical index.
- Worksheet tools: ensure Section A MCQs, B Fill blanks, C VSA, D Short answer, E Application each have unique questions.
- Never use banned generic phrases: "Explain the concept", "Discuss with students", "Conduct activity", "Students understand".
- Teacher instructions must include WHO does WHAT with timing and expected student responses.`;

  const model = getAiGeneratorGeminiModel();
  const raw = await geminiService.generateStructuredContent(prompt, 'json', {
    primaryModel: model,
    flashLiteOnly: true,
    temperature: 0.65,
    maxTokens: 8000,
  });
  const json = extractJsonObject(raw);
  const patch =
    json?.structuredContent && typeof json.structuredContent === 'object'
      ? json.structuredContent
      : json && typeof json === 'object'
        ? json
        : {};
  return deepMergeStructured(structured, patch);
}

export { deepMergeStructured };
