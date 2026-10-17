/**
 * V2 six-section content generator (pilot).
 * Assembles the master/tool/board/RAG/IIT prompt, calls Gemini for strict JSON,
 * parses it, and returns semantic structuredContent (six sections). Rendering is
 * the frontend's job (SixSectionViewer) — this service does content only.
 */

import geminiService, { isTransientGeminiError } from '../../providers/gemini-service.js';
import { extractJsonObject } from '../../shared/ai-json-extract.js';
import { getAiGeneratorGeminiModel } from '../shared/ai-generator-batch-config.js';
import { assembleSixSectionPrompt } from '../../prompt-versioning/assemble.js';
import { V2_SECTION_IDS } from '../../prompt-versioning/master-prompt.js';
import { PLACEHOLDER_ANSWER_RE } from './six-section-quality.js';
import { GEMINI_LITE_MODEL } from '../../providers/gemini-models.js';
import { countUsableQuestionsFromV2OrLegacy, trimUsableQuestionsToCount } from '../../../utils/v2-structured-to-legacy.js';
import {
  reconcileV2InstructionMarks,
  validateV2QuestionContent,
} from './six-section-quality.js';
import { applyQuestionSlotMetadata } from '../../planning/question-slot-planner.js';
import { validateStemQuestionSet } from '../../validation/stem-question-validator.js';
import {
  buildSelectiveRepairPrompt,
  identifyFailedQuestionSlots,
  mergeSelectiveQuestionRepairs,
} from '../../repair/selective-question-repair.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasAllSixSections(json) {
  if (!json || typeof json !== 'object') return false;
  return V2_SECTION_IDS.every((id) => json[id] && typeof json[id] === 'object');
}

// Guaranteed clean math: convert Unicode math glyphs to ASCII and strip corruption
// artifacts (U+FFFD) so nothing garbles in the UI or the PDF's Helvetica font — even
// if the model ignores the ASCII-math prompt rule.
// The generation pipeline corrupts characters ABOVE Latin-1 (superscript charge
// signs ⁺⁻, subscripts, arrows →, roots √, Greek Δπθ) into garbage/mojibake, while
// Latin-1 (² ³ ° ± × ½) survives and renders fine. So: convert every above-Latin-1
// symbol to safe ASCII, KEEP Latin-1, then strip any remaining non-Latin-1 bytes
// (mojibake/replacement chars). Result stays clean even if the model emits Unicode.
const MATH_UNICODE_MAP = {
  '→': '->', '←': '<-', '↔': '<->', '⇌': '<=>', '⇋': '<=>', '⇒': '=>', '⇔': '<=>',
  '√': 'sqrt', '∛': 'cbrt', '∑': 'sum', '∏': 'product', '∫': 'integral', '∂': 'd', '∇': 'grad', '∞': 'infinity',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '≡': '=',
  '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', '⁺': '+', '⁻': '-', 'ⁿ': '^n',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-',
  'Δ': 'delta ', '∆': 'delta ', 'π': 'pi', 'θ': 'theta', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma',
  'λ': 'lambda', 'μ': 'mu', 'Ω': 'ohm', 'Σ': 'sum', 'Π': 'product',
  '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '′': "'", '″': '"',
};
// Latin-1 MATH symbols that render fine and are legitimate (° ± ² ³ µ · ¹ ¼ ½ ¾ × ÷).
// Everything else in Latin-1 (accented LETTERS À Â Ã Æ é …) is mojibake in our
// English/math content, so it is dropped.
const KEEP_LATIN1 = new Set([0xb0, 0xb1, 0xb2, 0xb3, 0xb5, 0xb7, 0xb9, 0xbc, 0xbd, 0xbe, 0xd7, 0xf7]);

function sanitizeMathString(s) {
  let t = String(s);
  for (const u of Object.keys(MATH_UNICODE_MAP)) {
    if (t.indexOf(u) !== -1) t = t.split(u).join(MATH_UNICODE_MAP[u]);
  }
  // Keep tab/newline/CR + printable ASCII + math symbols + Devanagari + Telugu.
  // Drop control chars, replacement chars, mojibake accented letters, and garbage.
  let out = '';
  for (const ch of t) {
    const c = ch.codePointAt(0);
    if (
      c === 9 || c === 10 || c === 13 ||
      (c >= 0x20 && c <= 0x7e) || // printable ASCII
      KEEP_LATIN1.has(c) || // math-only Latin-1 symbols
      (c >= 0x900 && c <= 0x97f) || // Devanagari (Hindi)
      (c >= 0xc00 && c <= 0xc7f) // Telugu
    )
      out += ch;
  }
  return out;
}

/** How much genuine garbage a raw model response has (replacement chars +
 *  un-mappable above-Latin-1 that is not Hindi/Telugu). High = a garbled generation. */
function rawGarbageScore(raw) {
  let bad = 0;
  for (const ch of String(raw)) {
    const c = ch.codePointAt(0);
    if (c === 0xfffd) {
      bad += 1;
    } else if (
      c > 0xff &&
      !(c >= 0x900 && c <= 0x97f) &&
      !(c >= 0xc00 && c <= 0xc7f) &&
      MATH_UNICODE_MAP[ch] === undefined
    ) {
      bad += 1;
    }
  }
  return bad;
}
function deepSanitizeMath(val) {
  if (typeof val === 'string') return sanitizeMathString(val);
  if (Array.isArray(val)) return val.map(deepSanitizeMath);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = deepSanitizeMath(v);
    return out;
  }
  return val;
}

/** Sections that do not depend on textbook passages and can be filled alone. */
const REPAIRABLE_SUPPORT_SECTIONS = new Set(['objectives', 'differentiation', 'teacher', 'reallife']);

/** Pull the tool pack's JSON shape line for one section out of the assembled prompt. */
function sectionShapeFromPrompt(prompt = '', id = '') {
  const line = String(prompt).split('\n').find((l) => l.trim().startsWith(`"${id}":`));
  return line ? line.trim().replace(/,$/, '') : `"${id}": { }`;
}

export function missingSixSectionIds(json) {
  if (!json || typeof json !== 'object') return [...V2_SECTION_IDS];
  return V2_SECTION_IDS.filter((id) => !json[id] || typeof json[id] !== 'object');
}

export function buildMissingSectionsPrompt({ missing, prompt, params = {}, toolSlug, json }) {
  const digest = JSON.stringify(json?.core || {}).slice(0, 1500);
  return [
    `You are completing a partially generated "${toolSlug}" resource for Indian schools.`,
    `Scope: ${[params.board, params.classLabel, params.subject, params.topic, params.subTopic].filter(Boolean).join(' / ')}.`,
    `The core content already exists (excerpt): ${digest}`,
    '',
    `Return ONLY a JSON object with exactly these keys: ${missing.join(', ')}.`,
    'Use exactly this shape for each key:',
    ...missing.map((id) => sectionShapeFromPrompt(prompt, id)),
    'Keep every bullet to one short sentence. Stay on the given topic/subtopic. JSON only.',
  ].join('\n');
}

async function repairMissingSupportSections(json, { assembled, params, toolSlug, attemptModel, opts }) {
  const missing = missingSixSectionIds(json);
  const repairable = json && typeof json === 'object' && missing.length > 0 &&
    missing.every((id) => REPAIRABLE_SUPPORT_SECTIONS.has(id));
  if (!repairable) return json;
  if (typeof opts.canStartCall === 'function' && !opts.canStartCall()) return json;
  try {
    const raw = await geminiService.generateStructuredContent(
      buildMissingSectionsPrompt({ missing, prompt: assembled.prompt, params, toolSlug, json }),
      'json',
      {
        primaryModel: attemptModel,
        flashLiteOnly: opts.flashLiteOnly === true,
        temperature: 0.3,
        maxTokens: 1500,
      },
    );
    const patch = extractJsonObject(raw);
    if (!patch || typeof patch !== 'object') return json;
    const merged = { ...json };
    for (const id of missing) {
      if (patch[id] && typeof patch[id] === 'object') merged[id] = patch[id];
    }
    return merged;
  } catch {
    return json;
  }
}

const V2_ANSWERABLE_KEYS = [
  'sectionA_mcq', 'sectionB_fib', 'sectionC_short', 'sectionD_application',
  'sectionE_long', 'sectionF_case', 'sectionG_hots',
];

function v2Questions(structuredContent) {
  const core = structuredContent?.core || {};
  const out = [];
  for (const key of V2_ANSWERABLE_KEYS) {
    (Array.isArray(core[key]) ? core[key] : []).forEach((row, i) => {
      if (row && typeof row === 'object') out.push({ section: key, index: i + 1, row });
    });
  }
  return out;
}

export function buildAnswerKeyCompletionPrompt({ questions, existing, ragContext = '' }) {
  const example = existing[0] ? JSON.stringify(existing[0]).slice(0, 400) : '{"q":"A1","answer":"...","working":"..."}';
  return [
    'Write answer-key entries for the questions below. They come from an existing worksheet whose answer key was cut short.',
    ragContext ? `Use only this textbook context for facts:\n${String(ragContext).slice(0, 9000)}` : '',
    'QUESTIONS NEEDING ANSWERS:',
    ...questions.map((q) => `${q.label}: ${JSON.stringify(q.row).slice(0, 700)}`),
    '',
    `Return ONLY JSON: {"answerKey":[...]} with exactly ${questions.length} entries, in the same order, each shaped like: ${example}`,
    'Give complete model answers; for questions worth 2+ marks give point-wise marking. Never write "refer to the textbook".',
  ].filter(Boolean).join('\n');
}

/**
 * The model sometimes writes "All questions. See sections above." instead of
 * an answer key while every question already carries its answer. Rebuild the
 * key from those answers (no model call) so teachers see real answers.
 */
export function rebuildPlaceholderAnswerKey(structuredContent) {
  const assessment = structuredContent?.assessment;
  if (!assessment || typeof assessment !== 'object') return false;
  const key = Array.isArray(assessment.answerKey) ? assessment.answerKey : [];
  const text = (entry) => `${entry?.answer || ''} ${entry?.working || ''}`.trim();
  const usable = key.filter((entry) => text(entry) && !PLACEHOLDER_ANSWER_RE.test(text(entry)));
  const questions = v2Questions(structuredContent);
  if (usable.length >= questions.length || usable.length === key.length && key.length > 0) return false;
  const answered = questions.filter((q) => String(q.row.answer || '').trim());
  if (!answered.length || answered.length < questions.length) return false;
  assessment.answerKey = answered.map((q) => ({
    q: `${q.section.replace(/^section([A-G]).*$/, '$1')}${q.index}`,
    answer: String(q.row.answer).trim(),
    working: String(q.row.explanation || q.row.working || '').trim(),
  }));
  return true;
}

/**
 * Flash-Lite often stops the answer key early (e.g. 7 of 15). A full
 * regeneration costs as much as the first call; answer only the missing
 * questions instead, grounded in the same retrieved context.
 */
async function completeTruncatedAnswerKey(structuredContent, { attemptModel, opts }) {
  const questions = v2Questions(structuredContent);
  const assessment = structuredContent?.assessment;
  const existing = Array.isArray(assessment?.answerKey) ? assessment.answerKey : [];
  if (!questions.length || existing.length >= questions.length || !assessment) return false;
  if (typeof opts.canStartCall === 'function' && !opts.canStartCall()) return false;
  const missing = questions.slice(existing.length).map((q, i) => ({
    ...q,
    label: `${q.section.replace(/^section([A-G]).*$/, '$1')}${q.index}`,
    position: existing.length + i + 1,
  }));
  try {
    const raw = await geminiService.generateStructuredContent(
      buildAnswerKeyCompletionPrompt({ questions: missing, existing, ragContext: opts.ragContext || '' }),
      'json',
      {
        primaryModel: attemptModel,
        flashLiteOnly: opts.flashLiteOnly === true,
        temperature: 0.2,
        maxTokens: Math.min(5000, 350 * missing.length + 400),
      },
    );
    const added = extractJsonObject(raw)?.answerKey;
    if (!Array.isArray(added) || added.length < missing.length) return false;
    assessment.answerKey = [...existing, ...added.slice(0, missing.length)];
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} toolSlug
 * @param {object} params { board, classLabel, subject, topic, subTopic }
 * @param {{ ragContext?:string, primaryModel?:string, canStartCall?:()=>boolean, allowUnderfilledQuestionCount?:boolean }} [opts]
 * @returns {Promise<{ ok:boolean, structuredContent?:object, error?:string }>}
 */
export async function generateSixSectionContent(toolSlug, params = {}, opts = {}) {
  const assembled = assembleSixSectionPrompt(toolSlug, params, opts);
  if (!assembled.supported) {
    return { ok: false, error: `Tool "${toolSlug}" is not V2-enabled yet.` };
  }

  const model = opts.primaryModel || getAiGeneratorGeminiModel();
  const fallbackModel = String(opts.fallbackModel || GEMINI_LITE_MODEL).trim();
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
  let lastErr = '';
  const requestedQuestionCount = Number(params.questionCount ?? params.numberOfQuestions);
  const enforceQuestionCount =
    Number.isFinite(requestedQuestionCount) &&
    requestedQuestionCount > 0;
  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const temperature =
      attempt === 1 ? baseTemp : Math.max(0.3, baseTemp - 0.2 * (attempt - 1));
    const attemptModel =
      attempt === maxTries && fallbackModel && fallbackModel !== model
        ? fallbackModel
        : model;
    let raw = '';
    try {
      if (typeof opts.canStartCall === 'function' && !opts.canStartCall()) {
        return { ok: false, error: 'Batch budget cap reached before the next model call.' };
      }
      raw = await geminiService.generateStructuredContent(assembled.prompt, 'json', {
        primaryModel: attemptModel,
        modelOverflow: String(opts.modelOverflow || '').trim(),
        flashLiteOnly: opts.flashLiteOnly === true,
        maxAttemptsPerModel: opts.maxAttemptsPerModel,
        isBatchVariant: opts.isBatchVariant !== false,
        temperature,
        maxTokens,
        multimodalParts: Array.isArray(opts.multimodalParts) ? opts.multimodalParts : [],
      });
    } catch (err) {
      lastErr = err?.message || String(err);
      if (attempt < maxTries && isTransientGeminiError(err)) {
        await sleep(Math.min(12_000, 2000 * attempt));
        continue;
      }
      return { ok: false, error: lastErr || 'Gemini request failed' };
    }
    lastRaw = raw;
    let json = extractJsonObject(raw);
    if (!hasAllSixSections(json)) {
      // Flash-Lite often drops the trailing support sections (teacher, reallife)
      // while core/assessment are complete. Regenerating everything costs a full
      // call (~₹0.45) and under the per-record cap leaves no room for a retry, so
      // ask only for the missing support sections and merge them in.
      json = await repairMissingSupportSections(json, { assembled, params, toolSlug, attemptModel, opts });
    }
    if (!hasAllSixSections(json)) {
      // Say what was wrong — "did not return all six sections" alone hid
      // whether the JSON was unparseable or which sections were missing.
      lastErr = !json || typeof json !== 'object'
        ? `Model output was not parseable JSON (${String(raw || '').length} chars).`
        : `Model output missing section(s): ${V2_SECTION_IDS.filter((id) => !json[id] || typeof json[id] !== 'object').join(', ')}.`;
    }
    if (hasAllSixSections(json)) {
      // Reject a visibly garbled generation and retry for a clean one (Flash-Lite
      // garbles intermittently). On the last attempt, sanitize and keep what we have.
      if (attempt < maxTries && rawGarbageScore(raw) >= 4) {
        lastErr = `Model output looked garbled (score ${rawGarbageScore(raw)}).`;
        continue;
      }
      let structuredContent = deepSanitizeMath({
        schema: 'asli-v2-six-section',
        tool: toolSlug,
        ...Object.fromEntries(V2_SECTION_IDS.map((id) => [id, json[id]])),
      });
      const questionSlots = Array.isArray(params.questionSlots) ? params.questionSlots : [];
      if (questionSlots.length) {
        structuredContent = applyQuestionSlotMetadata(structuredContent, questionSlots, {
          sourceChunkIds: opts.sourceChunkIds || [],
          sourceAssetIds: opts.sourceAssetIds || [],
        }).structuredContent;
      }
      let acceptedUnderfilledCount = false;
      if (enforceQuestionCount) {
        let actualQuestionCount = countUsableQuestionsFromV2OrLegacy(structuredContent, null);
        if (actualQuestionCount > requestedQuestionCount) {
          const trimmed = trimUsableQuestionsToCount(
            structuredContent,
            null,
            requestedQuestionCount,
          );
          structuredContent = trimmed.v2 || structuredContent;
          actualQuestionCount = countUsableQuestionsFromV2OrLegacy(structuredContent, null);
        }
        if (actualQuestionCount < requestedQuestionCount && opts.allowUnderfilledQuestionCount === true) {
          // The book-batch finalizer can deterministically complete an
          // underfilled worksheet from the already retrieved textbook context.
          // Returning the partial structure avoids another full paid LLM call.
          acceptedUnderfilledCount = true;
        } else if (actualQuestionCount !== requestedQuestionCount) {
          lastErr = `Model returned ${actualQuestionCount} questions; exactly ${requestedQuestionCount} were requested.`;
          continue;
        }
      }

      reconcileV2InstructionMarks(structuredContent);
      rebuildPlaceholderAnswerKey(structuredContent);
      await completeTruncatedAnswerKey(structuredContent, { attemptModel, opts });
      const quality = validateV2QuestionContent(structuredContent);
      if (!quality.valid) {
        lastErr = quality.errors.join(' ');
        continue;
      }
      if (questionSlots.length) {
        let stemValidation = validateStemQuestionSet(structuredContent, {
          slots: questionSlots,
          expectedCount: enforceQuestionCount && !acceptedUnderfilledCount ? requestedQuestionCount : 0,
          approvedChunkIds: opts.sourceChunkIds || [],
          approvedAssetIds: opts.sourceAssetIds || [],
        });
        if (!stemValidation.valid) {
          const failed = identifyFailedQuestionSlots(structuredContent, stemValidation.findings);
          if (failed.length && failed.length < stemValidation.questionCount) {
            try {
              if (typeof opts.canStartCall === 'function' && !opts.canStartCall()) {
                lastErr = 'Batch budget cap reached before selective repair.';
                continue;
              }
              const repairRaw = await geminiService.generateStructuredContent(
                buildSelectiveRepairPrompt(failed, questionSlots, opts.ragContext || ''),
                'json',
                {
                  primaryModel: attemptModel,
                  flashLiteOnly: opts.flashLiteOnly === true,
                  temperature: 0.2,
                  maxTokens: Math.min(5000, maxTokens),
                  multimodalParts: Array.isArray(opts.multimodalParts) ? opts.multimodalParts : [],
                },
              );
              const repairJson = extractJsonObject(repairRaw);
              const replacements = Array.isArray(repairJson?.questions) ? repairJson.questions : [];
              const merged = mergeSelectiveQuestionRepairs(structuredContent, failed, replacements);
              if (merged.repairedCount > 0) {
                structuredContent = applyQuestionSlotMetadata(merged.structuredContent, questionSlots, {
                  sourceChunkIds: opts.sourceChunkIds || [],
                  sourceAssetIds: opts.sourceAssetIds || [],
                }).structuredContent;
                stemValidation = validateStemQuestionSet(structuredContent, {
                  slots: questionSlots,
                  expectedCount: enforceQuestionCount && !acceptedUnderfilledCount ? requestedQuestionCount : 0,
                  approvedChunkIds: opts.sourceChunkIds || [],
                  approvedAssetIds: opts.sourceAssetIds || [],
                });
              }
            } catch (repairError) {
              lastErr = `Selective repair failed: ${repairError?.message || repairError}`;
            }
          }
          if (!stemValidation.valid) {
            lastErr = stemValidation.findings.map((finding) => finding.code).join(', ');
            continue;
          }
        }
      }
      return {
        ok: true,
        structuredContent,
      };
    }
  }
  return {
    ok: false,
    error: lastErr || 'Model did not return all six sections.',
    raw: lastRaw,
  };
}

export default generateSixSectionContent;
