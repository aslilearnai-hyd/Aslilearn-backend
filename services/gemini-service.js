import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODELS_FALLBACK } from './gemini-models.js';
import { extractActivitiesFromCuriosityWorkbookPdf } from './curiosity-activity-pdf-parser.js';
import {
  ACTIVITY_TITLE_FRAGMENT_RE,
  extractActivityTitleFromBlock,
  isActivityTemplateTitleLabel,
  isGenericActivityNumberTitle,
  looksLikeTruncatedActivityField,
  looksLikeValidActivityTitle,
  repairActivityItemTitlesFromPdf,
} from './activity-title-utils.js';
import {
  activityPatternExtractIsComplete,
  mapActivityRowForToolSlug,
  scoreActivityExtractRow,
} from './pdf-activity-extract.js';
import { buildPdfToolConfigMap } from '../config/aiToolTemplates.js';
import {
  consolidateWorksheetExtractItems,
  normalizeWorksheetQuestionKey,
} from './pdf-worksheet-extract.js';
import { extractToolItemsFromPdfText } from './pdf-tool-extract.js';
import {
  PDF_EXTRACT_MAX_RETRIES,
  PDF_STRICT_JSON_RULES,
  appendPdfExtractItems,
  buildPdfExtractionPasses,
  buildPdfExtractRetryPrompt,
  cleanPdfTextForExtraction,
  countExpectedPdfItems,
  normalizeExtractedItem,
  parsePdfExtractResponse,
  validatePdfExtractItems,
} from './pdf-extract-validation.js';
import { buildStoryPassageLanguagePromptBlock, buildStoryPassageContentPromptBlock, buildStoryPassageMonolingualOverrideBlock } from '../utils/story-passage-subject.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

function isTruthy(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolveChatCompletionsEndpoint(baseUrlRaw) {
  const sanitized = String(baseUrlRaw || '').trim().replace(/\/+$/, '');
  if (!sanitized) {
    return 'http://127.0.0.1:1234/v1/chat/completions';
  }

  if (/\/chat\/completions$/i.test(sanitized)) {
    return sanitized;
  }

  if (/\/v1$/i.test(sanitized)) {
    return `${sanitized}/chat/completions`;
  }

  return `${sanitized}/v1/chat/completions`;
}

function getLlmConfig() {
  const baseUrlRaw =
    process.env.UPSTREAM_LLM_URL ||
    process.env.LLM_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.LM_STUDIO_BASE_URL ||
    'http://127.0.0.1:1234/v1';
  const apiKey =
    process.env.UPSTREAM_LLM_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    'lm-studio';
  const model =
    process.env.LLM_MODEL_ID ||
    process.env.UPSTREAM_LLM_MODEL_ID ||
    process.env.OPENAI_MODEL ||
    process.env.LM_STUDIO_MODEL ||
    'mistralai/mistral-7b-instruct-v0.3';
  const disableAuth = isTruthy(process.env.DISABLE_LLM_AUTH);
  const allowInsecureCert = isTruthy(process.env.ALLOW_INSECURE_LLM_CERT);
  const endpoint = resolveChatCompletionsEndpoint(baseUrlRaw);

  if (allowInsecureCert) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return {
    endpoint,
    apiKey: String(apiKey),
    model: String(model),
    disableAuth,
    allowInsecureCert,
    contextTokens: Number(process.env.LLM_CONTEXT_TOKENS) || 0,
    provider: String(process.env.LLM_PROVIDER || '').trim().toLowerCase(),
  };
}

/** gemini-1.5-* / 1.0-* often return 404 on v1beta generateContent; omit from chain. */
function isUnsupportedGeminiV1BetaModel(m) {
  const s = String(m || '').trim().toLowerCase();
  return (
    s.startsWith('gemini-1.5') ||
    s.startsWith('gemini-1.0') ||
    s.startsWith('gemini-1.1') ||
    s === 'gemini-pro' ||
    s === 'gemini-pro-vision'
  );
}

/**
 * Extra models after primary + env list. Kept in sync with `./gemini-models.js` (Flash-only, v1beta-safe).
 */
function defaultResilienceTail() {
  return [...GEMINI_MODELS_FALLBACK];
}

function mergeGeminiModelChain(primaryModel, envFallbackCsv) {
  let primary = String(primaryModel || '').trim();
  if (isUnsupportedGeminiV1BetaModel(primary)) {
    const replacement = GEMINI_MODELS_FALLBACK[0] || 'gemini-2.5-flash';
    console.warn(
      `[Gemini] Model "${primaryModel}" is not supported for v1beta generateContent; using "${replacement}" in chain.`,
    );
    primary = replacement;
  }
  const fromEnv = String(envFallbackCsv || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .filter((m) => !isUnsupportedGeminiV1BetaModel(m));
  const merged = [primary, ...fromEnv, ...defaultResilienceTail()];
  const seen = new Set();
  const out = [];
  for (const raw of merged) {
    const m = String(raw || '').trim();
    if (!m || isUnsupportedGeminiV1BetaModel(m)) continue;
    const key = m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function mergeLiteModelChain(primaryModel, envFallbackCsv) {
  const primary = String(primaryModel || 'gemini-2.5-flash-lite').trim();
  const fromEnv = String(envFallbackCsv || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .filter((m) => !isUnsupportedGeminiV1BetaModel(m));
  const seen = new Set();
  const out = [];
  for (const raw of [primary, ...fromEnv]) {
    const m = String(raw || '').trim();
    if (!m || isUnsupportedGeminiV1BetaModel(m)) continue;
    const key = m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.length ? out : ['gemini-2.5-flash-lite'];
}

function getFlashLiteModelChain(primaryLite, isBatchVariant = false) {
  const overflowCsv =
    process.env.AI_GENERATOR_GEMINI_LITE_OVERFLOW ||
    process.env.VIDYA_AI_GEMINI_LITE_OVERFLOW ||
    'gemini-2.0-flash-lite,gemini-1.5-flash-lite';
  const chain = mergeLiteModelChain(primaryLite || 'gemini-2.5-flash-lite', overflowCsv);
  if (!isBatchVariant) return chain;
  const maxModels = Number(process.env.GEMINI_BATCH_LITE_MODELS);
  const cap = Number.isFinite(maxModels) && maxModels > 0 ? Math.min(maxModels, 3) : 2;
  return chain.slice(0, cap);
}

/** True for 503/429/network errors — do not burn validation retries on these. */
export function isTransientGeminiError(error) {
  const msg = String(error?.message || error || '');
  return /\b503\b|\b429\b|UNAVAILABLE|high demand|overloaded|temporar|RESOURCE_EXHAUSTED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|failed to fetch|network/i.test(
    msg,
  );
}

function getGeminiFallbackConfig() {
  const apiKey = String(
    process.env.VIDYA_AI_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      ''
  ).trim();
  const primaryModel = String(
    process.env.GEMINI_FALLBACK_MODEL ||
      process.env.VIDYA_AI_GEMINI_MODEL ||
      'gemini-2.5-flash'
  ).trim();
  const envFallbackCsv =
    process.env.VIDYA_AI_GEMINI_FALLBACK_MODELS ||
    'gemini-2.5-flash-lite,gemini-2.0-flash,gemini-2.5-flash';
  const modelChain = mergeGeminiModelChain(primaryModel, envFallbackCsv);
  const baseUrl = String(
    process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
  )
    .trim()
    .replace(/\/+$/, '');
  return { apiKey, model: primaryModel, modelChain, baseUrl };
}

function cleanText(value) {
  return value == null ? '' : String(value).trim();
}

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Recover truncated / slightly invalid JSON arrays from Gemini PDF extract. */
function parsePdfJsonArraySafely(raw) {
  return parsePdfExtractResponse(raw);
}

/** @type {Record<string, unknown>} */
let lastPdfExtractionMeta = {};

export function getLastPdfExtractionMeta() {
  return { ...lastPdfExtractionMeta };
}

let lastPdfExtractFailure = '';

export function getLastPdfExtractFailure() {
  return lastPdfExtractFailure;
}

export function buildPdfExtractEmptyMessage(toolType) {
  const tool = String(toolType || '').trim();
  const base =
    'Could not extract any complete items from this PDF. AI PDF only saves text that appears in the document — it does not generate missing content.';
  const detail = lastPdfExtractFailure ? ` Detail: ${lastPdfExtractFailure}` : '';
  if (tool === 'worksheet-mcq-generator') {
    return `${base} Use a PDF with numbered questions (1., Q1., etc.). If this file is an Activity or Lesson Plan workbook, choose the matching tool instead.${detail}`;
  }
  if (tool === 'homework-creator') {
    return `${base} Use a homework PDF with instructions and practice questions, or a numbered question list (grouped into one homework set). If this is a class worksheet only, choose Worksheet & MCQ instead.${detail}`;
  }
  if (tool === '__removed-rubrics-tool__') {
    return `${base} Use a rubric or report-card PDF with a criteria table (Excellent / Good / Satisfactory / Needs improvement) and evaluation narrative sections.${detail}`;
  }
  if (tool === 'activity-project-generator' || tool === 'project-idea-lab') {
    return `${base} For activity workbooks, ensure the PDF has selectable text and numbered activities. Large PDFs may need to be split if Gemini output was cut off.${detail}`;
  }
  return `${base}${detail}`;
}

/** Parse "Please retry in 11.43s" / RetryInfo from Gemini quota errors (milliseconds). */
function parseGeminiSuggestedRetryMs(msg) {
  const m = String(msg || '');
  const secMatch = m.match(/Please retry in ([0-9.]+)\s*s/i);
  if (secMatch) {
    const ms = Math.ceil(parseFloat(secMatch[1]) * 1000);
    if (Number.isFinite(ms) && ms >= 500 && ms <= 120_000) return ms;
  }
  return null;
}

function estimateTokensFromText(text) {
  const words = String(text || '')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.3));
}

let activeTokenUsageSession = null;

/** Start accumulating LLM token usage for one AI PDF / generation run. */
export function beginTokenUsageSession(label = 'generation') {
  activeTokenUsageSession = {
    label: String(label || 'generation'),
    startedAt: new Date().toISOString(),
    calls: [],
    totals: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    },
  };
  return activeTokenUsageSession;
}

export function getTokenUsageSession() {
  return activeTokenUsageSession;
}

/** End session and return usage snapshot (totals + per-call breakdown). */
export function endTokenUsageSession() {
  const session = activeTokenUsageSession;
  activeTokenUsageSession = null;
  if (!session) {
    return {
      label: 'generation',
      calls: [],
      totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 },
    };
  }
  return {
    label: session.label,
    startedAt: session.startedAt,
    endedAt: new Date().toISOString(),
    calls: session.calls,
    totals: { ...session.totals },
  };
}

function recordTokenUsage(entry = {}) {
  if (!activeTokenUsageSession) return;
  const promptTokens = Number(entry.promptTokens || 0);
  const completionTokens = Number(entry.completionTokens || 0);
  const totalTokens = Number(entry.totalTokens || promptTokens + completionTokens);
  const row = {
    label: String(entry.label || 'llm').trim() || 'llm',
    provider: String(entry.provider || 'unknown').trim() || 'unknown',
    model: String(entry.model || '').trim(),
    promptTokens,
    completionTokens,
    totalTokens,
    at: new Date().toISOString(),
  };
  activeTokenUsageSession.calls.push(row);
  activeTokenUsageSession.totals.promptTokens += promptTokens;
  activeTokenUsageSession.totals.completionTokens += completionTokens;
  activeTokenUsageSession.totals.totalTokens += totalTokens;
  activeTokenUsageSession.totals.callCount += 1;
}

async function callChatCompletions({
  messages,
  temperature = 0.3,
  maxTokens = 2000,
  preferJson = false, // kept for compatibility with callers
  usageLabel = 'llm',
  primaryModel = '',
  flashLiteOnly = false,
  maxAttemptsPerModel: maxAttemptsPerModelOption,
  isBatchVariant = false,
}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const contextTokens = Number(process.env.LLM_CONTEXT_TOKENS) || 0;
  const callGeminiFallback = async (normalizedMessages, jsonMode = preferJson) => {
    const { apiKey, modelChain: defaultChain } = getGeminiFallbackConfig();
    const liteModel = String(process.env.AI_GENERATOR_GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
    const modelChain = flashLiteOnly
      ? getFlashLiteModelChain(liteModel, isBatchVariant)
      : String(primaryModel || '').trim()
        ? mergeGeminiModelChain(primaryModel, defaultChain.join(','))
        : defaultChain;
    if (!apiKey) {
      throw new Error('Gemini API key is missing');
    }
    const genAI = new GoogleGenerativeAI(apiKey);

    const prompt = normalizedMessages
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.content || '')}`)
      .join('\n\n');

    const isAuthOrConfigError = (msg) => {
      const m = String(msg || '');
      // 401 / explicit invalid key — no point trying other models with the same key.
      if (/\b401\b|API key not valid|API_KEY_INVALID|invalid api key|UNAUTHENTICATED/i.test(m)) return true;
      // 403 often means "this model/API not allowed for this key" — still try other model IDs in the chain.
      // Only short-circuit 403 when the message clearly indicates the key itself is wrong.
      if (/\b403\b/i.test(m) && /api key|API_KEY|credentials|invalid key|key.*invalid/i.test(m)) return true;
      return false;
    };
    const isRetryableModelError = (msg) =>
      /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|try again later|temporar|fetch failed|ECONNRESET|EAI_AGAIN|ETIMEDOUT|timeout|failed to fetch|network/i.test(
        msg,
      );
    /** 404 often means model id not on this API version; try next model instead of hard-failing. */
    const isTryNextModelError = (msg) => /\b404\b|not found|NOT_FOUND|no such model/i.test(msg);

    const envMaxAttempts = Number(process.env.GEMINI_RETRY_ATTEMPTS_PER_MODEL);
    const batchTransientRetries = Number(process.env.GEMINI_BATCH_TRANSIENT_RETRIES);
    const defaultMaxAttempts =
      isBatchVariant && flashLiteOnly
        ? Number.isFinite(batchTransientRetries) && batchTransientRetries > 0
          ? Math.min(batchTransientRetries, 2)
          : 1
        : Number.isFinite(envMaxAttempts) && envMaxAttempts > 0
          ? envMaxAttempts
          : 3;
    const maxAttemptsPerModel = Math.max(
      1,
      Math.min(
        5,
        Number.isFinite(maxAttemptsPerModelOption) && maxAttemptsPerModelOption > 0
          ? maxAttemptsPerModelOption
          : defaultMaxAttempts,
      ),
    );
    let lastErr = null;

    for (const modelName of modelChain) {
      for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
        try {
          const modelClient = genAI.getGenerativeModel({ model: modelName });
          const result = await modelClient.generateContent({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt || 'Help with educational content.' }],
              },
            ],
            generationConfig: {
              temperature,
              maxOutputTokens: contextTokens > 0 ? Math.min(maxTokens, contextTokens) : maxTokens,
              ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
            },
          });
          const text = String(result?.response?.text?.() || '').trim();
          if (!text) {
            lastErr = new Error(`Gemini returned empty content on ${modelName}`);
            if (attempt < maxAttemptsPerModel) {
              await sleep(600 * attempt);
              continue;
            }
            break;
          }
          const usageMeta = result?.response?.usageMetadata;
          const promptTokens =
            Number(usageMeta?.promptTokenCount) ||
            estimateTokensFromText(
              normalizedMessages.map((m) => String(m.content || '')).join('\n'),
            );
          const completionTokens = Number(usageMeta?.candidatesTokenCount) || estimateTokensFromText(text);
          recordTokenUsage({
            label: usageLabel,
            provider: 'gemini',
            model: modelName,
            promptTokens,
            completionTokens,
            totalTokens: Number(usageMeta?.totalTokenCount) || promptTokens + completionTokens,
          });
          if (modelName !== modelChain[0]) {
            console.warn(`[Gemini] Succeeded on fallback model ${modelName} (primary busy or failed).`);
          }
          return text;
        } catch (error) {
          const msg = String(error?.message || error);
          lastErr = new Error(`Gemini failed on ${modelName}: ${msg}`);
          if (isAuthOrConfigError(msg)) {
            throw lastErr;
          }
          if (isTryNextModelError(msg)) {
            break;
          }
          const is429Like =
            /\b429\b|RESOURCE_EXHAUSTED|quota exceeded|Too Many Requests/i.test(msg);
          if (is429Like) {
            const suggested = parseGeminiSuggestedRetryMs(msg);
            const delayMs =
              suggested ?? Math.min(20_000, Math.round(1500 * attempt + Math.random() * 800));
            if (attempt < maxAttemptsPerModel) {
              console.warn(
                `[Gemini] ${modelName} rate limit / quota; waiting ${delayMs}ms then retry (${attempt}/${maxAttemptsPerModel})`,
              );
              await sleep(delayMs);
              continue;
            }
            console.warn(
              `[Gemini] ${modelName} still over quota after ${maxAttemptsPerModel} attempts; trying next model.`,
            );
            break;
          }
          const is503Like =
            /\b503\b|UNAVAILABLE|high demand|experiencing/i.test(msg);
          if (is503Like) {
            if (attempt < maxAttemptsPerModel) {
              const delayMs = Math.min(12_000, Math.round(2500 * attempt + Math.random() * 1000));
              console.warn(
                `[Gemini] ${modelName} unavailable (503); waiting ${delayMs}ms then retry (${attempt}/${maxAttemptsPerModel})`,
              );
              await sleep(delayMs);
              continue;
            }
            console.warn(`[Gemini] ${modelName} still unavailable after retries; trying next lite model.`);
            break;
          }
          const retryThisModel = isRetryableModelError(msg) && attempt < maxAttemptsPerModel;
          if (retryThisModel) {
            const backoff = Math.min(14_000, Math.round(1000 * 2 ** (attempt - 1) + Math.random() * 400));
            await sleep(backoff);
            continue;
          }
          break;
        }
      }
    }
    throw (
      lastErr ||
      new Error(
        'Gemini failed on all configured models. If you saw 503/unavailable, wait a minute and retry — demand spikes are usually temporary.',
      )
    );
  };

  const callUpstreamFallback = async (normalizedMessages) => {
    const cfg = getLlmConfig();
    const payload = {
      model: cfg.model,
      messages: normalizedMessages,
      temperature,
      max_tokens: contextTokens > 0 ? Math.min(maxTokens, contextTokens) : maxTokens,
    };
    if (preferJson) {
      payload.response_format = { type: 'json_object' };
    }

    const headers = { 'Content-Type': 'application/json' };
    if (!cfg.disableAuth) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }

    const response = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Upstream fallback failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      throw new Error('Upstream fallback returned empty content');
    }
    const usage = data?.usage || {};
    const promptTokens =
      Number(usage.prompt_tokens) ||
      estimateTokensFromText(normalizedMessages.map((m) => String(m.content || '')).join('\n'));
    const completionTokens = Number(usage.completion_tokens) || estimateTokensFromText(text);
    recordTokenUsage({
      label: usageLabel,
      provider: 'upstream',
      model: cfg.model,
      promptTokens,
      completionTokens,
      totalTokens: Number(usage.total_tokens) || promptTokens + completionTokens,
    });
    return text;
  };

  // Some local model templates (LM Studio) only accept user/assistant roles.
  const normalizeMessages = (inputMessages) => {
    const list = Array.isArray(inputMessages) ? inputMessages : [];
    if (!list.length) return [{ role: 'user', content: 'Hello' }];

    const systemMessages = list
      .filter((m) => m?.role === 'system' && m?.content != null)
      .map((m) => String(m.content).trim())
      .filter(Boolean);

    const nonSystem = list
      .filter((m) => m?.role !== 'system')
      .map((m) => {
        const role = m?.role === 'assistant' ? 'assistant' : 'user';
        return { role, content: m?.content ?? '' };
      });

    if (!systemMessages.length) return nonSystem;

    if (!nonSystem.length) {
      return [{ role: 'user', content: systemMessages.join('\n\n') }];
    }

    const first = nonSystem[0];
    if (first.role === 'user' && typeof first.content === 'string') {
      return [
        {
          ...first,
          content: `${systemMessages.join('\n\n')}\n\n${first.content}`,
        },
        ...nonSystem.slice(1),
      ];
    }

    return [
      { role: 'user', content: systemMessages.join('\n\n') },
      ...nonSystem,
    ];
  };

  const normalizedMessages = normalizeMessages(messages);
  try {
    return await callGeminiFallback(normalizedMessages);
  } catch (geminiError) {
    if (isBatchVariant && flashLiteOnly) {
      throw geminiError;
    }
    try {
      return await callUpstreamFallback(normalizedMessages);
    } catch (upstreamError) {
      throw new Error(
        `Gemini and upstream fallback failed: ${String(geminiError?.message || geminiError)} | ${String(
          upstreamError?.message || upstreamError
        )}`
      );
    }
  }
}

function buildTeacherToolPrompt(toolType, params = {}) {
  const storyLanguageBlock =
    toolType === 'reading-practice-room' || toolType === 'story-passage-creator'
      ? [
          buildStoryPassageLanguagePromptBlock(params.subject),
          buildStoryPassageContentPromptBlock(),
          buildStoryPassageMonolingualOverrideBlock(params.subject),
        ]
          .filter(Boolean)
          .join('\n\n')
      : '';
  const common = `You are a strict educational content generator.

Return response ONLY in plain text.

Do NOT use markdown.
Do NOT use:
#, ##, ###, *, **, ---, markdown bullets, decorative symbols.

Do NOT repeat metadata inside CONTENT.
Do NOT add explanation, notes, or summaries outside structure.
Do NOT mix tools.

Return ONLY this exact structure:

NAME OF THE TOOL
${params.toolDisplayName || toolType}

CLASS
${params.gradeLevel || 'General'}

SUBJECT
${params.subject || 'General'}

TOPIC
${params.topic || 'General Topic'}

SUB TOPIC
${params.subTopic || 'General'}

CONTENT
tool specific content only

IMPORTANT:
CONTENT must be plain text only.
Use textbook content as primary source.
If textbook content is missing, generate curriculum-relevant content for the same tool only.`;

  const templates = {
    'activity-project-generator': `${common}

Create an engaging teacher-facing activity/project using ONLY the 13-point Activity / Project Generator JSON format:
1 Title of Activity / Project, 2 Subtopic Link and Prior Knowledge Required, 3 Learning Objectives, 4 NCF Competency / Learning Outcome Alignment, 5 Materials Required, 6 Step-by-step Procedure (facilitation/teaching steps), 7 Teacher Instructions, 8 Student Instructions, 9 Differentiation, 10 Assessment Rubric, 11 Expected Learning Outcomes, 12 Real-life Application, 13 Reflection / Exit Ticket.
Keep teacher_instructions and student_instructions as separate arrays.`,
    'project-idea-lab': `${common}

Create an engaging student project/activity using ONLY the 14-point Project Idea Lab JSON format:
1 Project / Activity Title, 2 Subtopic Link and Prior Knowledge Required, 3 Learning Objectives - Bloom's Taxonomy Aligned, 4 NCF Competency / Learning Outcome Alignment, 5 Materials Required, 6 Step-by-step Student Procedure (student-facing steps only), 7 Safety and Care Instructions, 8 Observation / Data Recording Table, 9 Creative Output / Final Product, 10 Differentiation: Support and Extension, 11 Self-Assessment Rubric, 12 Expected Learning Outcomes, 13 Real-life Application, 14 Reflection / Exit Ticket.
Do NOT output separate teacher_instructions or student_instructions sections.`,
    'worksheet-mcq-generator': `${common}

Create a worksheet with ${params.questionCount || 10} questions (${params.questionType || 'mixed'}), include answers and short explanations.`,
    'concept-mastery-helper': `${common}

Explain the concept in simple steps, common mistakes, examples, and a quick recap.`,
    'lesson-planner': `${common}

Create a teacher lesson plan for ${params.duration || 90} minutes using this 14-point format:
1 Lesson Title, 2 Learning Objectives, 3 NCF Competency / Learning Outcome Alignment, 4 Prior Knowledge / Diagnostic Question, 5 Introduction / Warm-up, 6 Teaching Strategy, 7 Classroom Activities, 8 Teacher Talk Points, 9 Student Tasks, 10 Formative Assessment Questions, 11 Differentiation Plan, 12 Homework / Practice, 13 Teaching Aids Required, 14 Closure / Exit Ticket.`,
    'study-schedule-maker': `${common}

Create a Study Schedule Maker plan for ${params.duration || 90} minutes using this 13-point format:
1 Study Schedule Title, 2 Study Goal and Subtopic Link, 3 Prior Knowledge and Readiness Check, 4 Learning Objectives - Bloom's Taxonomy Aligned, 5 NCF Competency / Learning Outcome Alignment, 6 Study Plan Table, 7 Concept Learning Slot, 8 Practice Slot, 9 Breaks and Focus Tips, 10 Self-Assessment Checkpoint, 11 Support and Extension Plan, 12 Expected Learning Outcomes, 13 Reflection / Exit Ticket.`,
    'homework-creator': `${common}

Create a meaningful homework set with instructions, questions, answer key, and grading criteria.`,
    '__removed-rubrics-tool__': `${common}

Create a complete Rubrics, Evaluation & Report Card using ALL 10 sections: (1) Assessment Purpose, (2) Competency Assessed, (3) Evaluation Rubric with min 3 criteria and four performance levels each (Excellent, Good, Satisfactory, Needs Improvement), (4) Grading Criteria, (5) Strengths Observed, (6) Areas for Improvement, (7) Teacher Remarks, (8) Actionable Improvement Suggestions, (9) Parent-friendly Feedback, (10) Next-step Remedial / Enrichment Activity.`,
    'reading-practice-room': `${common}

Create a Reading Practice Room set using this 13-point format:
1 Reading Practice Title, 2 Subtopic Link and Prior Knowledge Required, 3 Learning Objectives - Bloom's Taxonomy Aligned, 4 NCF Competency / Learning Outcome Alignment, 5 Vocabulary Warm-up, 6 Passage / Story, 7 Read and Recall Questions, 8 Think and Infer Questions, 9 Apply and Connect Questions, 10 Vocabulary Practice, 11 Answer Key / Suggested Responses, 12 Expected Learning Outcomes, 13 Reflection / Exit Ticket.${storyLanguageBlock ? `\n\n${storyLanguageBlock}` : ''}`,
    'story-passage-creator': `${common}

Create a Story and Passage Creator set using this 19-point format:
1 Story / Passage Title, 2 Topic and Subtopic Connection, 3 Prior Knowledge Required, 4 Learning Objectives – Bloom's Taxonomy Aligned, 5 NCF Competency / Learning Outcome Alignment, 6 Vocabulary Warm-up, 7 Pre-reading Thinking Prompt, 8 Story / Passage Content, 9 Read and Recall Questions, 10 Think and Infer Questions, 11 Apply and Connect Questions, 12 Vocabulary and Grammar Practice, 13 Creative Response Activity, 14 Answer Key / Suggested Responses, 15 Common Mistakes to Avoid, 16 Differentiation Support, 17 Expected Learning Outcomes, 18 Real-life Application, 19 Reflection / Exit Ticket.${storyLanguageBlock ? `\n\n${storyLanguageBlock}` : ''}`,
    'short-notes-summaries-maker': `${common}

Create concise revision notes with key ideas, definitions, formulas (if any), and quick reference points.`,
    'my-study-decks': `${common}

Generate ${params.cardCount || 20} flashcards using the My Study Decks 12-point format:
Deck Title, Subtopic Link and Prior Knowledge Required, Learning Objectives - Bloom's Taxonomy Aligned, NCF Competency / Learning Outcome Alignment, Flashcard Set, Difficulty Tag for Each Card, Memory Hook / Quick Tip, Self-Check Round, Common Mistakes to Avoid, Expected Learning Outcomes, Real-life Application, Reflection / Exit Ticket.`,
    'flashcard-generator': `${common}

Generate a teacher flashcard deck using the 5-block Flash Card Generator format:
1 Context & Alignment (deck title, topic, subtopic, class, difficulty, Bloom's level), 2 Foundations (prior knowledge, learning objectives, NCF competency), 3 The Card Set: Application & HOTS (cards with Task front and Solution back), 4 Study Aids (deck memory hook, common mistakes, rapid recall), 5 Wrap-Up (real-life connection, differentiation, exit ticket).
Target at least ${Math.max(5, Number(params.cardCount) || 5)} HOTS/application cards; every card needs non-empty front (Task) and back (Solution).`,
    'daily-class-plan-maker': `${common}

Create a practical day plan with time slots, activities, checkpoints, and notes.`,
    'mock-test-builder': `${common}

Generate a mock test with exactly ${Math.min(
      Math.max(Number(params.questionCount ?? params.numberOfQuestions ?? 17) || 17, 1),
      100,
    )} questions in the 12-section Mock Test Builder format, including question paper, answer key, solutions/explanations, remedial suggestions, outcomes, real-life application, and reflection/exit ticket.`,
    'exam-question-paper-generator': `${common}

Generate a full exam question paper with exactly ${Math.min(
      Math.max(Number(params.questionCount ?? params.numberOfQuestions ?? 17) || 17, 1),
      100,
    )} questions in the 11-point Exam Question Paper Generator format: paper title/instructions, blueprint, sections A–E, internal choices, answer key, marking scheme, and open-ended rubric.`,
  };

  return (
    templates[toolType] ||
    `${common}

Generate high-quality educational content for toolType="${toolType}" using params: ${JSON.stringify(params)}`
  );
}

const PDF_TOOL_CONFIG = buildPdfToolConfigMap();

export function buildPdfParsePrompt(toolType, rawPdfText, params = {}) {
  return buildPdfExtractPrompt(toolType, rawPdfText, params);
}

export function buildPdfExtractPrompt(toolType, rawPdfText, params = {}) {
  const { classLabel = '', subject = '', topic = '', subtopic = '' } = params;
  const config = PDF_TOOL_CONFIG[toolType];
  const schemaStr = config ? JSON.stringify(config.schema, null, 2) : '{ "title": "string", "content": "string" }';
  const requiredFields = config?.requiredFields?.join(', ') || 'title, content';
  const activityTemplateBlock =
    toolType === 'project-idea-lab'
      ? `

PROJECT IDEA LAB — TEMPLATE MAPPING (mandatory, 14 sections):
Each JSON object is ONE activity from the PDF. Map sections by label/numbering in the PDF text:
(1) title — Project / Activity Title only
(2) subtopic_link_prior_knowledge — Subtopic Link and Prior Knowledge Required
(3) learning_objectives[] — Learning Objectives - Bloom's Taxonomy Aligned
(4) ncf_competency_alignment — NCF Competency / Learning Outcome Alignment
(5) materials_required[] — Materials Required
(6) step_by_step_procedure[] — Step-by-step Student Procedure (student-facing; NOT teacher talk)
(7) safety_care_instructions[] — Safety and Care Instructions
(8) observation_data_recording_table — Observation / Data Recording Table
(9) creative_output_final_product — Creative Output / Final Product
(10) differentiation_support_extension — Differentiation: Support and Extension
(11) self_assessment_rubric[] — Self-Assessment Rubric
(12) expected_learning_outcomes — Expected Learning Outcomes
(13) real_life_application — Real-life Application
(14) reflection_exit_ticket — Reflection / Exit Ticket

Legacy PDF labels: map "Student Instructions" → step_by_step_procedure[]; map "Assessment Rubric" → self_assessment_rubric[]; omit standalone teacher_instructions from output.
If the PDF has several activities, return one object per activity. Do not merge multiple activities into one object.
`
      : toolType === 'activity-project-generator'
        ? `

ACTIVITY / PROJECT GENERATOR — TEMPLATE MAPPING (mandatory, 13 sections):
Each JSON object is ONE activity from the PDF. Map sections by label/numbering in the PDF text:
(1) title — Title of Activity / Project only
(2) subtopic_link_prior_knowledge — Subtopic Link and Prior Knowledge Required
(3) learning_objectives[] — Learning Objectives
(4) ncf_competency_alignment — NCF Competency / Learning Outcome Alignment
(5) materials_required[] — Materials Required
(6) step_by_step_procedure[] — Step-by-step Procedure (teaching/facilitation steps)
(7) teacher_instructions[] — Teacher Instructions (keep separate from procedure)
(8) student_instructions[] — Student Instructions
(9) differentiation — Differentiation
(10) assessment_criteria_rubric[] — Assessment Rubric
(11) expected_learning_outcomes — Expected Learning Outcomes
(12) real_life_application — Real-life Application
(13) reflection_exit_ticket — Reflection / Exit Ticket

If the PDF has several activities, return one object per activity. Do not merge multiple activities into one object.
`
        : '';
  const conceptTemplateBlock =
    toolType === 'concept-mastery-helper'
      ? `

CONCEPT MASTERY — EXTRACTION (mandatory):
- Return ONE JSON object per concept/chapter/topic block in the PDF (flat array).
- Each object uses the Concept Mastery schema: concept_name, simple_definition, why_important, prior_knowledge_needed, lesson (main explanation body), diagram_suggestion, real_example, common_mistakes[], concept_check_questions[], key_points[], exam_tips, hots_question, self_reflection_prompt.
- Map PDF headings to these fields (e.g. "Simple Definition", "Step-by-step Explanation" → lesson).
- Do NOT return worksheet-style "question" / "options" rows unless they are concept_check_questions[] strings inside the concept object.
- Required per item: concept_name and non-empty lesson (or simple_definition + lesson combined from PDF text).
`
      : '';
  const worksheetTemplateBlock =
    toolType === 'worksheet-mcq-generator'
      ? `

WORKSHEET & MCQ — TEMPLATE MAPPING (mandatory, 10 sections):
Use ONE JSON object per full worksheet when the PDF is a single worksheet (title, instructions, Section A–E). When the PDF has many separate worksheets or a question bank (one MCQ per row / Worksheet 1, Worksheet 2…), return one object per worksheet OR one flat row per question — do NOT merge unrelated worksheets into one object.
Map PDF headings to fields (copy exact wording):
1 title / worksheet_title — worksheet title
2 learning_objectives[] — learning objectives
3 instructions — instructions to students
4–8 sections[] — Section A (MCQs), B (fill blanks), C (VSA), D (SA), E (competency / real-life): each { sectionName, questions[{ question_number, type, section, question, options[], answer, explanation, marks }] }
9 answer_key — complete answer key (string)
10 bloom_level and difficulty_tag — Bloom's level and difficulty

Do NOT use a separate long-answer / case-based section (old Section E). Map those items to Section D if present.
Extract EVERY question in Section A, B, C, D, and E — do not stop after MCQs and one fill-blank. VSA and short-answer items must appear even without options.
If the PDF is only numbered questions, return flat rows with section (A–E), question_number, question, options[], answer, type (MCQ|FIB|VSA|SA|COMPETENCY). Do NOT skip questions because answers are in a later key.
`
      : '';
  const homeworkTemplateBlock =
    toolType === 'homework-creator'
      ? `

HOMEWORK CREATOR — TEMPLATE MAPPING (mandatory, 10 sections):
Prefer ONE JSON object per homework assignment in the PDF (not one row per question unless the PDF has only numbered questions).
Map PDF headings to fields (copy exact wording):
1 title — homework title
2 instructions — student instructions / directions
3 practice_questions[] or questions[] — numbered practice items (strings or { question, options[], answer })
4 application_tasks[] — application-based tasks
5 creative_thinking_question — one creative / thinking question
6 real_life_observation_task — real-life observation task
7 challenge_question — challenge question
8 support_hint — support hint for students
9 answer_hints — answer key / hints (string)
10 parent_note — note to parents

If the PDF is only a numbered question list with no section headings, return ONE object with title from the document heading and all items in practice_questions[].
`
      : '';
  const readingPracticeTemplateBlock =
    toolType === 'reading-practice-room'
      ? `

READING PRACTICE ROOM — TEMPLATE MAPPING (mandatory, one object per reading practice item):
Map PDF headings to fields (copy exact wording from the document):
1 reading_practice_title (or title) — reading practice title
2 subtopic_link_prior_knowledge — subtopic link and prior knowledge required
3 learning_objectives[] — Bloom-aligned learning objectives (strings)
4 ncf_competency_alignment — NCF competency / learning outcome alignment (string or bullets)
5 vocabulary_warmup[] — vocabulary warm-up (strings with brief definitions)
6 passage — full passage / story text (required)
7 read_and_recall_questions[] — read and recall questions (strings or { question })
8 think_and_infer_questions[] — think and infer questions
9 apply_and_connect_questions[] — apply and connect questions
10 vocabulary_practice[] — vocabulary practice tasks
11 answer_key_suggested_responses[] — answer key / suggested responses
12 expected_learning_outcomes[] — expected learning outcomes (strings)
13 reflection_exit_ticket — reflection / exit ticket prompt
Optional header metadata when shown in PDF: bloom_level, difficulty_level, class_label, subject, subtopic

Return ONE JSON object per distinct reading practice block in the PDF (Item 1, Item 2, …). Do NOT merge separate items into one object.
`
      : '';
  const storyPassageTemplateBlock =
    toolType === 'story-passage-creator'
      ? `

STORY AND PASSAGE CREATOR — TEMPLATE MAPPING (mandatory, one object per story/passage item):
Map PDF headings to fields (copy exact wording from the document):
1 title — story / passage title
2 topic_subtopic_connection — topic and subtopic connection
3 prior_knowledge_required — prior knowledge required
4 learning_objectives[] — Bloom-aligned learning objectives (strings)
5 ncf_competency_alignment — NCF competency / learning outcome alignment
6 vocabulary_warmup[] — vocabulary warm-up (strings)
7 pre_reading_thinking_prompt — pre-reading thinking prompt
8 passage (or story_passage_content) — full story / passage text (required)
9 read_and_recall_questions[] — read and recall questions
10 think_and_infer_questions[] — think and infer questions
11 apply_and_connect_questions[] — apply and connect questions
12 vocabulary_grammar_practice — vocabulary and grammar practice
13 creative_response_activity — creative response activity
14 answer_key_suggested_responses[] — answer key / suggested responses
15 common_mistakes_to_avoid — common mistakes to avoid
16 differentiation_support — differentiation support
17 expected_learning_outcomes[] — expected learning outcomes
18 real_life_application — real-life application
19 reflection_exit_ticket — reflection / exit ticket

Return ONE JSON object per distinct story/passage block in the PDF. Do NOT merge separate items into one object.
`
      : '';
  const shortNotesTemplateBlock =
    toolType === 'short-notes-summaries-maker'
      ? `

SHORT NOTES & SUMMARIES — TEMPLATE MAPPING (mandatory, one object per Item N):
Map PDF headings to fields (copy exact wording):
1 title / concept_name — note title (e.g. "Science as Curiosity")
2 alignment_block — OR nep_ncf_focus + udl_support (Alignment Block: NEP/NCF, UDL)
3 learning_objectives[] — learning objectives (strings)
4 short_note_summary — Short Note / Summary paragraph (required)
5 key_points_to_remember[] — Key Points to Remember (bullets)
6 example — Example paragraph (e.g. stars at night)
7 common_misconception_correction — Misconception and Correction text
8 quick_check_questions[] — Quick Check Questions (strings)
9 differentiation_support and differentiation_extension — Support and Extension
10 real_life_application — Real-life Application
11 reflection_exit_ticket — Reflection / Exit Ticket prompt
Optional header metadata: bloom_level, skill_focus, subtopic, class_label, subject

Return ONE JSON object per distinct short-note item (Item 1, Item 2, …). Do NOT merge separate items into one object.
`
      : '';
  const myStudyDecksTemplateBlock =
    toolType === 'my-study-decks'
      ? `

MY STUDY DECKS — TEMPLATE MAPPING (mandatory, one deck object):
Map PDF headings to fields (copy exact wording):
1 deck_title — Deck Title
2 subtopic_link_prior_knowledge_required — Subtopic Link and Prior Knowledge Required
3 learning_objectives[] — Learning Objectives - Bloom's Taxonomy Aligned
4 ncf_competency_alignment — NCF Competency / Learning Outcome Alignment
5 cards[] / flashcard_set[] — Flashcard Set (each card needs front, back)
6 difficulty_tag_for_each_card — Difficulty Tag for Each Card (per card)
7 memory_hook_quick_tip — Memory Hook / Quick Tip (per card)
8 self_check_round — Self-Check Round (per card or deck-level round prompt)
9 common_mistakes_to_avoid[] — Common Mistakes to Avoid
10 expected_learning_outcomes[] — Expected Learning Outcomes
11 real_life_application — Real-life Application
12 reflection_exit_ticket — Reflection / Exit Ticket

Return ONE JSON object per distinct deck in the PDF. Keep all cards inside cards[] (or flashcard_set[]).
`
      : '';
  const flashcardTemplateBlock =
    toolType === 'flashcard-generator'
      ? `

FLASH CARD GENERATOR — TEMPLATE MAPPING (mandatory, one deck object, 5 blocks):
Block 1 Context & Alignment: flashcard_deck_title, topic, subtopic, class_level, difficulty_level, bloom_level (topic_and_subtopic_link optional).
Block 2 Foundations: prior_knowledge_required, learning_objectives[], ncf_competency_alignment.
Block 3 The Card Set: application_hots_cards[] AND cards[] (min 5) — front=Task, back=Solution; per-card difficulty_tag_for_each_card and memory_hook_quick_tip.
Block 4 Study Aids: deck_memory_hook, common_mistakes_to_avoid[], self_check_rapid_recall_round.
Block 5 Wrap-Up: real_life_connection, differentiation_support, reflection_exit_ticket.

Legacy: deck_title/title -> flashcard_deck_title; memory_cue/hint -> deck_memory_hook or memory_hook_quick_tip; skill_focus/bloom_level -> difficulty_tag_for_each_card or bloom_level.

Return ONE JSON object per distinct deck in the PDF.
`
      : '';
  const rubricTemplateBlock =
    toolType === '__removed-rubrics-tool__'
      ? `

RUBRICS, EVALUATION & REPORT CARD — TEMPLATE MAPPING (mandatory, 10 sections):
Prefer ONE JSON object per rubric / evaluation / report-card block in the PDF (not one array item per criterion row unless merging is impossible).
Map PDF headings to fields (copy exact wording):
1 title — rubric or evaluation title
2 assessment_purpose — assessment purpose
3 competency_assessed — competency / learning outcome assessed
4 criteria[] — rubric grid: each { name, excellent, good, satisfactory, needs_improvement } (four performance levels)
5 grading_criteria — overall grading criteria or scale description (string)
6 strengths_observed — strengths observed
7 areas_for_improvement — areas for improvement
8 teacher_remarks — teacher remarks
9 actionable_suggestions — actionable improvement suggestions
10 parent_friendly_feedback — parent-friendly feedback
11 next_step_remedial_enrichment — next-step remedial / enrichment (include in the same rubric object)

If the PDF is only a rubric table, return ONE object with title + all table rows in criteria[].
`
      : '';
  const dailyClassPlanTemplateBlock =
    toolType === 'daily-class-plan-maker'
      ? `

DAILY CLASS PLAN — TEMPLATE MAPPING (mandatory, 9 sections + period grid):
Prefer ONE JSON object per full daily class plan in the PDF (not one row per period unless merging is impossible).
Map PDF headings to fields (copy exact wording):
1 day_period_topic_breakup — day / period-wise topic break-up (string)
2 objectives[] — learning objective for each period
3 teaching_methods[] — teaching method per period
4 classroom_activity[] — classroom activity / demonstration
5 exit_ticket — quick assessment / exit ticket (string)
6 differentiated_support — differentiated support (string)
7 homework_followup — homework / follow-up task (string)
8 teaching_aids[] — required teaching aids
9 teacher_reflection_notes — teacher reflection notes (string)
time_slots[] — period grid: each { time, activity, type }; if the PDF only has a timeline list, use timeline[] strings AND parse into time_slots when possible

Use title for the plan name. Do NOT use lesson-planner-only fields (lesson_name, ncf_competency_alignment, prior_knowledge_diagnostic) unless the PDF labels them — map content to the 9 daily-plan fields above.
`
      : '';
  const lessonPlannerTemplateBlock =
    toolType === 'study-schedule-maker'
      ? `

STUDY SCHEDULE MAKER — TEMPLATE MAPPING (mandatory, 13 sections):
Each JSON object is ONE full study schedule from the PDF ("Schedule 1", "Variation 1", "Plan 1", etc.).
Map PDF headings to these fields (copy exact wording; one bullet/line per array item):
1 study_schedule_title (or lesson_name) — schedule title only (not "Objectives" alone)
2 study_goal_subtopic_link — study goal and subtopic link
3 prior_knowledge_readiness_check — prior knowledge and readiness check
4 learning_objectives[] — Bloom-aligned learning objectives
5 ncf_competency_alignment — NCF / competency / learning outcome alignment
6 study_plan_table[] — REQUIRED: at least 2 timed rows (e.g. "9:00–9:30: Read …"); never leave empty if sections 7–10 exist — use timeline[] / time_slots[] or derive rows from concept/practice/breaks slots
7 concept_learning_slot — concept learning slot (reading, notes, concept focus)
8 practice_slot — practice slot (exercises, questions, application)
9 breaks_focus_tips — breaks and focus tips
10 self_assessment_checkpoint — self-assessment checkpoint
11 support_extension_plan — support and extension plan
12 expected_learning_outcomes[] — expected learning outcomes
13 reflection_exit_ticket — reflection / exit ticket

Return one object per distinct schedule with study_schedule_title plus at least one substantive body field from sections 2–13.
`
      : toolType === 'lesson-planner'
        ? `

LESSON PLANNER — TEMPLATE MAPPING (mandatory, 14 sections):
Each JSON object is ONE full lesson plan from the PDF ("Lesson 1", "Variation 1", "Period plan", etc.).
Map PDF headings to these fields (copy exact wording; one bullet/line per array item):
1 lesson_name — lesson title only
2 learning_objectives[]
3 ncf_competency_alignment
4 prior_knowledge_diagnostic
5 introduction_warmup
6 teaching_strategy
7 teaching_activities[] — classroom activities / teaching-learning process
8 teacher_talk_points[]
9 student_tasks[]
10 formative_assessment_questions[]
11 differentiation_plan
12 homework_practice
13 teaching_aids_required[]
14 closure_exit_ticket

Keep teacher_talk_points separate from student_tasks. Return one object per distinct lesson with lesson_name plus substantive body fields.
`
        : '';
  const mockTestTemplateBlock =
    toolType === 'mock-test-builder'
      ? `

MOCK TEST BUILDER — TEMPLATE MAPPING (mandatory, 12 sections):
Prefer ONE JSON object per full examination paper in the PDF (not one array item per question unless the PDF is only a flat numbered list).
Map PDF headings to fields (copy exact wording):
1 mock_test_title — Mock Test Title
2 test_purpose_subtopic_link — Test Purpose and Subtopic Link
3 learning_objectives[] — Learning Objectives - Bloom's Taxonomy Aligned
4 ncf_competency_alignment — NCF Competency / Learning Outcome Alignment
5 instructions — Instructions for Students
6 question_paper (or sections[] / section_a..section_e) — Question Paper with sections and questions
7 answer_key — Answer Key
8 step_by_step_solutions_explanations — Step-by-step Solutions / Explanations
9 remedial_revision_suggestions[] — Remedial Revision Suggestions
10 expected_learning_outcomes[] — Expected Learning Outcomes
11 real_life_application — Real-life Application
12 reflection_exit_ticket — Reflection / Exit Ticket

If the PDF is only numbered questions, return flat rows with section label + question_number + question + options + answer + marks — they will be merged into sections A–E by section name.
Preserve "OR", "attempt any", and internal-choice markers in internal_choice_group or question text.
`
      : '';
  const examTemplateBlock =
    toolType === 'exam-question-paper-generator'
      ? `

EXAM QUESTION PAPER GENERATOR — TEMPLATE MAPPING (mandatory, 11 sections):
Prefer ONE JSON object per full examination paper in the PDF.
Map PDF headings to fields (copy exact wording):
1 paper_title — Paper Title and General Instructions (include instructions text)
2 blueprint — Blueprint / Design Grid
3 section_a — Section A: MCQs
4 section_b — Section B: Very Short Answer Questions
5 section_c — Section C: Short Answer Questions
6 section_d — Section D: Long Answer Questions
7 section_e — Section E: Case-based / Competency Questions
8 internal_choices — Internal Choices
9 answer_key — Complete Answer Key
10 marking_scheme — Detailed Marking Scheme
11 open_ended_rubric — Rubric for Open-ended Questions

Use sections[] with sectionName when the PDF groups questions by section label.
Preserve OR/internal-choice markers in internal_choice_group or question text.
`
      : '';
  const rule7 =
    toolType === 'activity-project-generator' ||
    toolType === 'project-idea-lab'
      ? '7. The "title" field must be ONLY the activity name (e.g. "Observing shadows"). Never use section labels (Materials Required, Learning Objectives, Title, Rubric) as title'
      : toolType === 'study-schedule-maker'
        ? '7. Use study_schedule_title (or lesson_name) for the schedule title. Map all 13 Study Schedule Maker fields from PDF section headings.'
        : toolType === 'lesson-planner'
          ? '7. Use lesson_name for the lesson title. Map all 14 Lesson Planner teacher fields from PDF section headings.'
        : toolType === 'daily-class-plan-maker'
          ? '7. Use "title" and day_period_topic_breakup for the plan heading. Fill objectives, teaching_methods, classroom_activity, and time_slots from the PDF — not lesson_name / NCF fields unless the PDF uses those labels.'
          : toolType === 'mock-test-builder'
            ? '7. Use mock_test_title for the test name. Put questions in question_paper (or sections[]) with sectionName from the PDF, and include answer_key, solutions/explanations, remedial suggestions, outcomes, real-life application, and reflection when present.'
            : toolType === 'exam-question-paper-generator'
              ? '7. Use paper_title for the exam name. Put questions in sections[] or section_a..section_e with section labels from the PDF, and include internal_choices, answer_key, marking_scheme, and open_ended_rubric when present.'
              : toolType === 'worksheet-mcq-generator'
              ? '7. Use title/worksheet_title for the worksheet name. Group questions in sections[] by Section A–E (no separate long-answer section) or copy section labels into each row\'s section field.'
              : toolType === 'reading-practice-room'
                ? '7. Use reading_practice_title (or title) for the item name. Put prose in passage; map all 13 Reading Practice Room fields from PDF section headings.'
                : toolType === 'story-passage-creator'
                  ? '7. Use title for the item name. Put prose in passage; map all 19 Story and Passage Creator fields from PDF section headings.'
                : toolType === 'short-notes-summaries-maker'
                  ? '7. Use title/concept_name for the note name. Map all 10 short-note template fields from PDF section headings.'
                  : toolType === 'my-study-decks'
                    ? '7. Map the 12 My Study Decks fields, including cards with front/back plus difficulty_tag_for_each_card and memory_hook_quick_tip, from PDF section headings.'
                    : toolType === 'flashcard-generator'
                      ? '7. Map deck_title and cards[] with front, back, memory_cue, skill_focus, example_use, peer_prompt, and reflection per card.'
                    : '7. Use schema field names exactly; each item\'s title/name fields must be real content titles from the PDF, not section headings alone';
  return `You are a precise educational content extractor. EXTRACT-ONLY: copy text from the PDF — never invent, paraphrase, summarize, or fill missing sections.

CONTEXT:
- Tool: ${toolType}
- Class: ${classLabel}
- Subject: ${subject}
- Topic: ${topic}
- Subtopic: ${subtopic}

PDF TEXT:
"""
${rawPdfText}
"""

YOUR TASK:
${toolType === 'study-schedule-maker'
  ? `Extract one JSON object per study schedule variation in the PDF (numbered schedules, "Variation N", multiple day plans, etc.).
Each object MUST have non-empty study_schedule_title (or lesson_name) and at least one substantive field from the 13-section schema.
Skip title-only stubs. Copy study_plan_table, concept slot, practice slot, and reflection from the PDF when present.
Do NOT treat standalone appendix or index pages as schedules.${activityTemplateBlock}${lessonPlannerTemplateBlock}`
  : toolType === 'lesson-planner'
    ? `Extract one JSON object per lesson plan variation in the PDF (numbered lessons, "Variation N", period plans, etc.).
Each object MUST have non-empty lesson_name and at least one substantive field from the 14-section teacher schema.
Skip title-only stubs. Copy objectives, teaching_activities, teacher_talk_points, student_tasks, and closure from the PDF when present.${activityTemplateBlock}${lessonPlannerTemplateBlock}`
  : toolType === 'daily-class-plan-maker'
    ? `Extract one JSON object per full daily class plan in the PDF.
Each object MUST have a non-empty title or day_period_topic_breakup and at least one substantive daily-plan field (objectives, teaching_methods, classroom_activity, time_slots, exit_ticket, etc.) copied from the PDF.
Skip title-only stubs. Do NOT map daily plans into lesson-planner field names unless the PDF uses those exact labels.${activityTemplateBlock}${dailyClassPlanTemplateBlock}`
  : toolType === 'mock-test-builder'
    ? `Extract one JSON object per full mock test when the PDF has a complete structure; otherwise extract one flat row per question with section + question_number + question + options + answer + marks.
Each full-test object MUST include question_paper (or sections[]) and mock_test_title/title when present in the PDF.
Copy answer keys and solutions/explanations when in separate sections of the PDF.${activityTemplateBlock}${mockTestTemplateBlock}`
    : toolType === 'exam-question-paper-generator'
      ? `Extract one JSON object per full exam paper when the PDF has a complete structure; otherwise extract one flat row per question with section + question_number + question + options + answer + marks.
Each full-test object MUST include sections[] or section_a..section_e and paper_title/title when present in the PDF.
Copy answer_key, marking_scheme, and open_ended_rubric when in separate sections.${activityTemplateBlock}${examTemplateBlock}`
  : toolType === 'worksheet-mcq-generator'
    ? `Extract one JSON object per full worksheet when the PDF has title, instructions, and section blocks; otherwise one flat row per question with section (A–E), question_number, question, options[], answer, type, marks.
Do NOT skip questions because the answer key is on a later page.${activityTemplateBlock}${worksheetTemplateBlock}`
    : toolType === 'reading-practice-room'
      ? `Extract one JSON object per complete reading practice item in the PDF (numbered items, separate titles, or distinct passage blocks).
Each object MUST include non-empty passage (or content) and reading_practice_title/title when present. Copy all 13 Reading Practice Room sections from the PDF.
Skip title-only stubs.${activityTemplateBlock}${readingPracticeTemplateBlock}`
      : toolType === 'story-passage-creator'
        ? `Extract one JSON object per complete story/passage item in the PDF (numbered items, separate titles, or distinct passage blocks).
Each object MUST include non-empty passage (or content) and title when present. Copy all 19 Story and Passage Creator sections from the PDF.
Skip title-only stubs.${activityTemplateBlock}${storyPassageTemplateBlock}`
      : toolType === 'short-notes-summaries-maker'
        ? `Extract one JSON object per complete short-note item in the PDF (Item 1, Item 2, numbered notes).
Each object MUST include non-empty short_note_summary (or summary) and title/concept_name when present. Copy all 10 template sections from the PDF.
Skip title-only stubs.${activityTemplateBlock}${shortNotesTemplateBlock}`
        : toolType === 'my-study-decks'
          ? `Extract one JSON object per deck in the PDF.
Each deck object MUST include cards[] (or flashcard_set[]) with non-empty front and back for each card.
Populate the full 12-point My Study Decks format fields when present in the PDF.
Skip title-only stubs.${activityTemplateBlock}${myStudyDecksTemplateBlock}`
          : toolType === 'flashcard-generator'
            ? `Extract one JSON object per deck in the PDF.
Each deck object MUST follow the 18-point Flash Card Generator format with cards[] (or typed card groups 7–10) where every card has non-empty front and back.
Populate difficulty_tag_for_each_card and memory_hook_quick_tip per card when present.
Skip title-only stubs.${activityTemplateBlock}${flashcardTemplateBlock}`
            : `Extract ONLY the items that have COMPLETE content in this PDF (items with all required fields: ${requiredFields}).
Do NOT extract items that are only titles or brief mentions without full content.
Do NOT generate or invent content that is not present in the PDF text above.
Do NOT treat standalone workbook appendix headings as a separate activity unless they are a full numbered activity block.${activityTemplateBlock}${conceptTemplateBlock}${worksheetTemplateBlock}${homeworkTemplateBlock}${storyTemplateBlock}${shortNotesTemplateBlock}${myStudyDecksTemplateBlock}${flashcardTemplateBlock}${rubricTemplateBlock}${lessonPlannerTemplateBlock}${dailyClassPlanTemplateBlock}${examTemplateBlock}`}

Return a JSON array. Each element uses this schema:
${schemaStr}

RULES:
1. Return ONLY a raw JSON array [ ... ] — no markdown, no code fences, no explanation
2. ${toolType === 'lesson-planner' || toolType === 'study-schedule-maker' || toolType === 'daily-class-plan-maker' || toolType === 'mock-test-builder' || toolType === 'exam-question-paper-generator' || toolType === 'worksheet-mcq-generator' ? 'Skip title-only rows with no substantive body in any mapped field.' : 'Extract ONLY items with complete content — skip title-only entries'}
3. Preserve the EXACT wording from the PDF — do not paraphrase, rewrite, or add curriculum content that is not in the PDF
4. For fields not present in PDF, use "" or [] — NEVER guess or generate placeholder teaching content
5. sl_no / question_number must match the lesson or variation number from the PDF when numbered
6. Add "_fromPdf": true to each extracted object
7. If an activity, question, or lesson is mentioned but body text is missing, OMIT that item entirely (do not fabricate it)
8. ${rule7.replace(/^\d+\.\s*/, '')}

${PDF_STRICT_JSON_RULES}`;
}

export function buildSingleItemGenerationPrompt(toolType, itemNumber, itemTitle, templateExamples = [], params = {}) {
  const { classLabel = '', subject = '', topic = '', subtopic = '' } = params;
  const storyLanguageBlock =
    toolType === 'reading-practice-room' || toolType === 'story-passage-creator'
      ? [
          buildStoryPassageLanguagePromptBlock(subject),
          buildStoryPassageContentPromptBlock(),
          buildStoryPassageMonolingualOverrideBlock(subject),
        ]
          .filter(Boolean)
          .join('\n\n')
      : '';
  const config = PDF_TOOL_CONFIG[toolType];
  const schemaStr = config ? JSON.stringify(config.schema, null, 2) : '{ "title": "string", "content": "string" }';
  const examplesStr = templateExamples
    .slice(0, 2)
    .map((ex, i) => `Example ${i + 1}:\n${JSON.stringify(ex, null, 2)}`)
    .join('\n\n');

  if (toolType === 'lesson-planner') {
    return `You are an expert educational content creator for Indian school curriculum.

CONTEXT:
- Class: ${classLabel}
- Subject: ${subject}
- Topic: ${topic}
- Subtopic: ${subtopic}
- Tool Type: lesson-planner

TASK:
Generate ONE complete lesson plan JSON object for variation #${itemNumber} titled: "${itemTitle}".
Base every field on the STYLE and DEPTH of the examples and on curriculum context — this fills a gap when the PDF extraction missed this variation.

STYLE REFERENCE:
${examplesStr}

OUTPUT SCHEMA:
${schemaStr}

RULES:
1. Return ONLY a single JSON object — no markdown, no code fences
2. Set sl_no and question_number to ${itemNumber}
3. lesson_name must be "${itemTitle}" or a concise lesson title derived from it (not a section heading like "Objectives" alone)
4. learning_objectives: at least 3 strings; teaching_activities: at least 4 strings; timeline: at least 3 time-block strings; assessment: non-empty string
5. Use the exact schema key names; arrays of strings where the schema shows arrays
6. Do not copy unrelated PDF boilerplate; write coherent lesson content for this subtopic`;
  }

  return `You are an expert educational content creator for Indian school curriculum.

CONTEXT:
- Class: ${classLabel}
- Subject: ${subject}
- Topic: ${topic}
- Subtopic: ${subtopic}
- Tool Type: ${toolType}
${storyLanguageBlock ? `\n${storyLanguageBlock}` : ''}

TASK:
Generate ONE complete item.
Item Number: ${itemNumber}
Item Title: "${itemTitle}"

STYLE REFERENCE:
${examplesStr}

OUTPUT SCHEMA:
${schemaStr}

RULES:
1. Return ONLY a single JSON object
2. Keep sl_no or question_number as ${itemNumber}
3. title and name must be ONLY the activity name (same as: "${itemTitle}") — never a template section heading
4. Match style/depth of examples
5. Return curriculum-appropriate content
6. Fill the Project Idea Lab template fields: learning_objectives, materials_required, step_by_step_procedure (student steps only), safety_care_instructions, observation_data_recording_table, creative_output_final_product, differentiation_support_extension, self_assessment_rubric, expected_learning_outcomes, real_life_application, reflection_exit_ticket — use schema key names exactly
7. Never put section labels in "title"; title = short activity name only`;
}

function normalizeTitleKey(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 120);
}

/** Lines like "3. Assessment Criteria" match N. Title but are not student activities. */
const ACTIVITY_TITLE_LINE_BLOCKLIST =
  /^(assessment|rubric|marking\s*scheme|learning\s*outcomes?\b|learning\s*objectives?\b|objectives?\s*:\s*$|materials\s*:\s*$|materials\s+list\b|list\s+of\s+materials\b|resources\s*:\s*$|references\b|appendix|answer\s*key|teacher\s*notes|included\s*activities\b|list\s*of\s*activities\b|table\s*of\s*contents?|chapter\s*\d+|figure\s*\d+|practice\s*papers?|worksheet\s*\d+|question\s*bank|wb\s*\d+|evaluation\s+rubric|grading\s+rubric|summative\b|formative\b|criteria\s*\()/i;

/** Same idea as sanitizeActivityTitle — these are not activity names for PDF line detection. */
const SECTION_HEADING_ONLY_AS_ACTIVITY_TITLE =
  /^(?:\d+\.\s*)?(?:title\s*[—:-]\s*)?(materials required|learning objectives|step-by-step procedure|teacher instructions|expected learning outcomes|assessment criteria(?:\s*\(rubric\))?|rubric|real[-\s]?life application|title)\s*$/i;

/** Re-parse each Activity N block so title is the real name, not "Activity 39". */
function enrichWorkbookActivityTitles(activities, rawText) {
  if (!Array.isArray(activities) || !activities.length) return activities;
  const text = String(rawText || '');
  const titleBySl = new Map();
  const parts = text.split(/\n(?=Activity\s+\d+\b)/gi);
  for (const part of parts) {
    const m = part.match(/\bActivity\s+(\d+)\b/i);
    if (!m) continue;
    const sl = Number.parseInt(m[1], 10);
    if (!Number.isFinite(sl)) continue;
    const name = extractActivityTitleFromBlock(part);
    if (name && looksLikeRealActivityTitle(name) && looksLikeValidActivityTitle(name)) titleBySl.set(sl, name);
  }
  return activities.map((row) => {
    const sl = Number(row?.sl_no ?? row?.question_number);
    const better = titleBySl.get(sl);
    const current = String(row?.title || row?.name || '').trim();
    if (better && (!current || isGenericActivityNumberTitle(current) || !looksLikeRealActivityTitle(current))) {
      return { ...row, title: better, name: better };
    }
    return row;
  });
}

function looksLikeRealActivityTitle(title) {
  if (!looksLikeValidActivityTitle(title)) return false;
  const t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 4) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  const lower = t.toLowerCase();
  if (ACTIVITY_TITLE_LINE_BLOCKLIST.test(lower)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length < 12) return false;
  return true;
}

/** Prefer numbered lines inside the activities block, not appendix/rubric pages. */
function sliceTextForActivityTitleScan(rawText) {
  const text = String(rawText || '');
  const anchors = [
    /included\s+activities/i,
    /list\s+of\s+activities/i,
    /practical\s+activities/i,
    /hands[-\s]?on\s+activities/i,
    /activities\s*\(\s*1\s*[-–]/i,
  ];
  let start = -1;
  for (const re of anchors) {
    const m = re.exec(text);
    if (m && m.index >= 0 && (start < 0 || m.index < start)) start = m.index;
  }
  let sliced = start >= 0 ? text.slice(start) : text;
  const endPatterns = [
    /\n\s*assessment\s*criteria\b/i,
    /\n\s*answer\s*key\b/i,
    /\n\s*teacher[''\u2019]s?\s*notes\b/i,
    /\n\s*references\b/i,
  ];
  for (const re of endPatterns) {
    const m = re.exec(sliced);
    if (m && m.index > 120) sliced = sliced.slice(0, m.index);
  }
  return sliced;
}

function detectAllTitlesInPdf(toolType, rawText) {
  const full = String(rawText || '').trim();
  const scanTexts =
    toolType === 'activity-project-generator' || toolType === 'project-idea-lab'
      ? [sliceTextForActivityTitleScan(full), full]
      : [full];
  const results = [];
  for (const scan of scanTexts) {
    const partial = [];
    if (toolType === 'activity-project-generator' || toolType === 'project-idea-lab') {
      const titlePattern = /^\s*(\d+)\.\s+(.+)$/gm;
      let m;
      while ((m = titlePattern.exec(scan)) !== null) {
        const number = Number.parseInt(m[1], 10);
        const title = String(m[2] || '').trim();
        if (!Number.isFinite(number) || !title) continue;
        if (!looksLikeRealActivityTitle(title)) continue;
        partial.push({ number, title });
      }
    } else if (toolType === 'concept-mastery-helper') {
      const itemPattern = /^(?:Item|Concept|Topic)\s+(\d+)\b[:\s-]*(.*)$/gim;
      let m;
      while ((m = itemPattern.exec(scan)) !== null) {
        const number = Number.parseInt(m[1], 10);
        const title = String(m[2] || '').trim() || `Concept ${number}`;
        if (Number.isFinite(number)) partial.push({ number, title });
      }
    } else {
      const genericPattern = /^(?:Q\.?\s*)?(\d+)[\.\)]\s+(.+)$/gm;
      let m;
      while ((m = genericPattern.exec(scan)) !== null) {
        const number = Number.parseInt(m[1], 10);
        const title = String(m[2] || '').trim();
        if (Number.isFinite(number) && title) partial.push({ number, title });
      }
    }
    if (partial.length) {
      appendPdfExtractItems(results, partial, 300);
      break;
    }
  }
  const seen = new Set();
  return results
    .filter((r) => {
      const key = `${r.number}:${normalizeTitleKey(r.title)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.number - b.number);
}

/** One Gemini call for all title-only gaps — avoids N×429 failures and empty placeholder rows. */
async function generateMissingActivitiesInOneCall(toolType, missingItems, templateExamples, params) {
  if (
    (toolType !== 'activity-project-generator' && toolType !== 'project-idea-lab') ||
    !missingItems.length
  ) {
    return null;
  }
  const config = PDF_TOOL_CONFIG[toolType];
  if (!config) return null;
  const schemaStr = JSON.stringify(config.schema, null, 2);
  const lines = missingItems.map((m) => `${m.number}. ${m.title}`).join('\n');
  const examplesStr = templateExamples
    .slice(0, 2)
    .map((ex, i) => `Example ${i + 1}:\n${JSON.stringify(ex, null, 2)}`)
    .join('\n\n');
  const { classLabel = '', subject = '', topic = '', subtopic = '' } = params;
  const prompt = `You are an expert educational content creator for Indian school curriculum.

CONTEXT:
- Class: ${classLabel}
- Subject: ${subject}
- Topic: ${topic}
- Subtopic: ${subtopic}

TASK:
Return a JSON array with EXACTLY ${missingItems.length} objects, in the SAME ORDER as these numbered lines.

NUMBERED LINES (order must match array index 0..${missingItems.length - 1}):
${lines}

STYLE REFERENCE:
${examplesStr}

Each array element must match this schema:
${schemaStr}

RULES:
1. Return ONLY a raw JSON array [ ... ] — no markdown, no code fences, no commentary
2. For each item k, sl_no or question_number must equal the number on line k
3. title / name must be ONLY the real activity name for that line — never a section heading (Materials Required, Learning Objectives, etc.)
4. Every object MUST follow the template keys from the schema exactly — populate each from curriculum context
5. Use realistic classroom activities appropriate to the class and subject`;

  try {
    const raw = await callChatCompletions({
      messages: [
        { role: 'system', content: 'You return ONLY valid JSON arrays for educational tools.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.28,
      maxTokens: 8192,
      preferJson: false,
    });
    const parsed = JSON.parse(stripCodeFences(raw));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const out = [];
    for (let i = 0; i < missingItems.length; i += 1) {
      const { number, title } = missingItems[i];
      let obj = parsed[i];
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        obj = parsed.find((p) => Number(p?.sl_no || p?.question_number) === number);
      }
      if (!obj || typeof obj !== 'object') return null;
      out.push({
        ...obj,
        sl_no: Number(obj.sl_no || obj.question_number || number),
        question_number: Number(obj.question_number || obj.sl_no || number),
        title: String(obj.title || title).trim(),
        name: String(obj.name || obj.title || title).trim(),
        _fromPdf: false,
      });
    }
    return out.length === missingItems.length ? out : null;
  } catch (e) {
    console.warn('[PDF] Batch activity generation failed:', e?.message || e);
    return null;
  }
}

/** Normalize Gemini PDF JSON into a flat list of per-item objects. */
function flattenPdfExtractItems(toolType, parsed) {
  const mark = (row) => ({ ...row, _fromPdf: true });
  const isQuestionTool =
    toolType === 'worksheet-mcq-generator' ||
    toolType === 'homework-creator' ||
    toolType === 'mock-test-builder' ||
    toolType === 'exam-question-paper-generator';
  if (Array.isArray(parsed)) {
    const out = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      if (toolType === 'concept-mastery-helper') {
        const questionText = String(item.question || '').trim();
        const hasConceptBody = Boolean(
          item.concept_name ||
            item.lesson ||
            item.simple_definition ||
            item.explanation ||
            item.step_by_step_explanation ||
            (item.content && !questionText) ||
            (item.summary && !questionText) ||
            (item.title && !questionText) ||
            (item.name && !questionText),
        );
        if (hasConceptBody) {
          const conceptName = String(
            item.concept_name || item.title || item.name || item.topic || '',
          ).trim();
          const lesson = String(
            item.lesson ||
              item.explanation ||
              item.step_by_step_explanation ||
              item.content ||
              item.body ||
              item.summary ||
              item.text ||
              '',
          ).trim();
          out.push(
            mark({
              ...item,
              concept_name: conceptName || 'Concept',
              title: conceptName || item.title,
              lesson,
              simple_definition: String(item.simple_definition || item.definition || '').trim(),
            }),
          );
          continue;
        }
        if (questionText) continue;
      }
      if (toolType === 'worksheet-mcq-generator') {
        const hasSections = Array.isArray(item.sections) && item.sections.length > 0;
        const hasWorksheetMeta = Boolean(
          String(item.title || item.worksheet_title || '').trim() ||
            String(item.instructions || '').trim() ||
            item.learning_objectives?.length ||
            String(item.answer_key || '').trim() ||
            String(item.bloom_level || '').trim(),
        );
        if (hasSections || (hasWorksheetMeta && !String(item.question || '').trim())) {
          out.push(
            mark({
              ...item,
              title: String(item.title || item.worksheet_title || 'Worksheet').trim(),
              worksheet_title: String(item.worksheet_title || item.title || 'Worksheet').trim(),
            }),
          );
          continue;
        }
        if (String(item.question || '').trim()) {
          out.push(mark(item));
          continue;
        }
        continue;
      }
      if (toolType === 'mock-test-builder' || toolType === 'exam-question-paper-generator') {
        const hasSections = Array.isArray(item.sections) && item.sections.length > 0;
        const hasExamMeta = Boolean(
          String(item.mock_test_title || item.paper_title || item.title || '').trim() ||
            String(item.instructions || '').trim() ||
            String(item.blueprint || '').trim() ||
            String(item.test_purpose_subtopic_link || '').trim() ||
            String(item.answer_key || '').trim() ||
            String(item.marking_scheme || '').trim() ||
            String(item.internal_choices || '').trim() ||
            String(item.step_by_step_solutions_explanations || '').trim(),
        );
        if (hasSections || (hasExamMeta && !String(item.question || '').trim())) {
          const title = String(
            item.mock_test_title || item.paper_title || item.title || 'Exam Paper',
          ).trim();
          out.push(
            mark({
              ...item,
              mock_test_title: toolType === 'mock-test-builder' ? title : item.mock_test_title,
              paper_title: String(item.paper_title || item.title || title).trim(),
              title,
            }),
          );
          continue;
        }
        if (String(item.question || '').trim()) {
          out.push(mark(item));
          continue;
        }
        continue;
      }
      if (toolType === 'reading-practice-room' || toolType === 'story-passage-creator') {
        const passage = String(item.passage || item.content || item.story_text || '').trim();
        const isTeacherStory = toolType === 'story-passage-creator';
        const hasStoryBody = Boolean(
          passage ||
            (Array.isArray(item.learning_objectives) && item.learning_objectives.length) ||
            (Array.isArray(item.vocabulary_warmup) && item.vocabulary_warmup.length) ||
            (Array.isArray(item.vocabulary_support) && item.vocabulary_support.length) ||
            (Array.isArray(item.read_and_recall_questions) && item.read_and_recall_questions.length) ||
            (Array.isArray(item.think_and_infer_questions) && item.think_and_infer_questions.length) ||
            (Array.isArray(item.apply_and_connect_questions) && item.apply_and_connect_questions.length) ||
            (Array.isArray(item.comprehension_questions) && item.comprehension_questions.length) ||
            (Array.isArray(item.questions) && item.questions.length) ||
            String(item.topic_subtopic_connection || item.prior_knowledge_required || '').trim() ||
            String(item.pre_reading_thinking_prompt || '').trim() ||
            String(item.vocabulary_grammar_practice || item.creative_response_activity || '').trim() ||
            String(item.ncf_competency_alignment || item.alignment_block || item.alignment || '').trim() ||
            String(item.common_mistakes_to_avoid || '').trim() ||
            String(item.reflection_exit_ticket || item.reflection_prompt || '').trim(),
        );
        if (hasStoryBody) {
          const defaultTitle = isTeacherStory ? 'Story' : 'Reading Practice';
          const title = String(
            item.reading_practice_title || item.title || item.passage_title || defaultTitle,
          ).trim();
          out.push(
            mark({
              ...item,
              title,
              ...(isTeacherStory
                ? { passage: passage || item.passage || item.story_passage_content }
                : {
                    reading_practice_title: title,
                    passage: passage || item.passage,
                  }),
            }),
          );
          continue;
        }
        continue;
      }
      if (toolType === 'short-notes-summaries-maker') {
        const summary = String(
          item.short_note_summary || item.summary || item.exam_summary || '',
        ).trim();
        const hasNotesBody = Boolean(
          summary ||
            (Array.isArray(item.key_points_to_remember) && item.key_points_to_remember.length) ||
            (Array.isArray(item.key_points) && item.key_points.length) ||
            (Array.isArray(item.keyPoints) && item.keyPoints.length) ||
            String(item.alignment_block || '').trim() ||
            String(item.example || '').trim() ||
            String(item.common_misconception_correction || '').trim(),
        );
        if (hasNotesBody) {
          out.push(
            mark({
              ...item,
              title: String(item.title || item.concept_name || 'Notes').trim(),
              concept_name: String(item.concept_name || item.title || 'Notes').trim(),
              short_note_summary: summary || item.short_note_summary,
            }),
          );
          continue;
        }
        continue;
      }
      if (toolType === 'homework-creator') {
        const questionText = String(item.question || '').trim();
        const hasHomeworkBody = Boolean(
          String(item.instructions || '').trim() ||
            (Array.isArray(item.application_tasks) && item.application_tasks.length) ||
            (Array.isArray(item.practice_questions) && item.practice_questions.length) ||
            String(item.creative_thinking_question || '').trim() ||
            String(item.parent_note || '').trim() ||
            String(item.answer_hints || '').trim(),
        );
        if (hasHomeworkBody || (item.title && !questionText)) {
          out.push(
            mark({
              ...item,
              title: String(item.title || item.name || item.topic || 'Homework').trim(),
            }),
          );
          continue;
        }
        if (questionText) {
          out.push(mark(item));
          continue;
        }
        continue;
      }
      if (toolType === '__removed-rubrics-tool__') {
        const criteria = Array.isArray(item.criteria) ? item.criteria : [];
        const isCriterionRow =
          (item.name || item.criterion || item.excellent || item.good) &&
          !String(item.title || item.assessment_purpose || '').trim() &&
          criteria.length === 0;
        const hasRubricBody =
          String(item.title || '').trim() ||
          String(item.assessment_purpose || '').trim() ||
          criteria.length > 0 ||
          String(item.strengths_observed || '').trim() ||
          String(item.teacher_remarks || '').trim();
        if (hasRubricBody) {
          out.push(
            mark({
              ...item,
              title: String(item.title || item.rubric_title || 'Rubric').trim(),
            }),
          );
          continue;
        }
        if (isCriterionRow) {
          out.push(mark(item));
          continue;
        }
        continue;
      }
      if (toolType === 'daily-class-plan-maker') {
        const questionText = String(item.question || '').trim();
        if (questionText && !item.day_period_topic_breakup && !item.objectives?.length) continue;
        const planTitle = String(
          item.title || item.day_period_topic_breakup || item.lesson_name || item.name || '',
        ).trim();
        const hasDailyBody = Boolean(
          item.day_period_topic_breakup ||
            item.objectives?.length ||
            item.period_objectives?.length ||
            item.teaching_methods?.length ||
            item.classroom_activity?.length ||
            item.time_slots?.length ||
            item.timeline?.length ||
            item.exit_ticket ||
            item.differentiated_support ||
            item.homework_followup ||
            item.teaching_aids?.length ||
            item.teacher_reflection_notes,
        );
        if (planTitle || hasDailyBody) {
          out.push(
            mark({
              ...item,
              title: planTitle || item.title || 'Daily Plan',
              day_period_topic_breakup:
                String(item.day_period_topic_breakup || planTitle || '').trim() || item.day_period_topic_breakup,
            }),
          );
        }
        continue;
      }
      if (toolType === 'lesson-planner') {
        const questionText = String(item.question || '').trim();
        if (questionText && !item.study_schedule_title && !item.lesson_name && !item.study_plan_table?.length)
          continue;
        const scheduleTitle = String(
          item.study_schedule_title || item.lesson_name || item.title || item.name || '',
        ).trim();
        const hasScheduleBody = Boolean(
          item.learning_objectives?.length ||
            item.objectives?.length ||
            item.study_plan_table?.length ||
            item.timeline?.length ||
            item.concept_learning_slot ||
            item.practice_slot ||
            item.self_assessment_checkpoint ||
            item.reflection_exit_ticket ||
            item.teaching_activities?.length ||
            item.activities?.length ||
            item.introduction_warmup ||
            item.teaching_strategy ||
            item.closure_exit_ticket,
        );
        if (scheduleTitle || hasScheduleBody) {
          out.push(
            mark({
              ...item,
              study_schedule_title: scheduleTitle || item.study_schedule_title || 'Study Schedule',
              lesson_name: scheduleTitle || item.lesson_name || 'Study Schedule',
              title: scheduleTitle || item.title,
            }),
          );
        }
        continue;
      }
      if (isQuestionTool && Array.isArray(item.questions) && item.questions.length) {
        item.questions.forEach((q, i) => {
          const row = typeof q === 'object' && q ? q : { question: String(q) };
          out.push(
            mark({
              ...row,
              question_number: row.question_number ?? row.sl_no ?? i + 1,
            }),
          );
        });
        continue;
      }
      if (isQuestionTool && String(item.question || '').trim()) {
        out.push(mark(item));
        continue;
      }
      if (toolType === 'flashcard-generator') {
        const hasDeckBody =
          (Array.isArray(item.cards) && item.cards.length) ||
          (Array.isArray(item.concept_and_definition_cards) && item.concept_and_definition_cards.length) ||
          (Array.isArray(item.formula_rule_cards) && item.formula_rule_cards.length) ||
          (Array.isArray(item.application_hots_cards) && item.application_hots_cards.length) ||
          (Array.isArray(item.visual_diagram_suggestion_cards) && item.visual_diagram_suggestion_cards.length);
        if (hasDeckBody || String(item.flashcard_deck_title || item.deck_title || item.title || '').trim()) {
          out.push(mark(item));
          continue;
        }
      }
      if (toolType === 'my-study-decks') {
        const nested = [
          ...(Array.isArray(item.cards) ? item.cards : []),
          ...(Array.isArray(item.flashcards) ? item.flashcards : []),
        ];
        if (nested.length) {
          const deckTitle = String(item.deck_title || item.title || '').trim();
          nested.forEach((raw, i) => {
            if (!raw || typeof raw !== 'object') return;
            const front = String(raw.front || raw.question || raw.term || '').trim();
            const back = String(
              raw.back || raw.correct_answer || raw.answer || raw.definition || '',
            ).trim();
            if (!front && !back) return;
            out.push(
              mark({
                ...raw,
                front,
                back,
                sl_no: raw.sl_no ?? item.sl_no ?? i + 1,
                deck_title: deckTitle || raw.deck_title,
                title: front.slice(0, 120) || `Card ${i + 1}`,
              }),
            );
          });
          continue;
        }
        const front = String(item.front || '').trim();
        const back = String(item.back || '').trim();
        if (front || back) {
          out.push(
            mark({
              ...item,
              front,
              back,
              title: String(item.title || front.slice(0, 120) || `Card ${item.sl_no || out.length + 1}`).trim(),
            }),
          );
          continue;
        }
        continue;
      }
      if (item.title || item.name || item.lesson_name || item.concept_name) {
        out.push(mark(item));
      }
    }
    return out;
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.concepts) && toolType === 'concept-mastery-helper') {
    return parsed.concepts
      .filter((c) => c && typeof c === 'object')
      .map((c, i) =>
        mark({
          ...c,
          concept_name: String(c.concept_name || c.title || c.name || `Concept ${i + 1}`).trim(),
        }),
      );
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions) && isQuestionTool) {
    return parsed.questions.map((q, i) => {
      const row = typeof q === 'object' && q ? q : { question: String(q) };
      return mark({ ...row, question_number: row.question_number ?? i + 1 });
    });
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    (toolType === 'mock-test-builder' ||
      toolType === 'exam-question-paper-generator' ||
      toolType === 'worksheet-mcq-generator') &&
    Array.isArray(parsed.sections) &&
    parsed.sections.length
  ) {
    return [mark(parsed)];
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    toolType === 'mock-test-builder' &&
    (Array.isArray(parsed.section_a) ||
      Array.isArray(parsed.section_b) ||
      String(parsed.mock_test_title || parsed.paper_title || '').trim())
  ) {
    return [mark(parsed)];
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    toolType === 'flashcard-generator' &&
    (Array.isArray(parsed.cards) ||
      Array.isArray(parsed.flashcards) ||
      Array.isArray(parsed.concept_and_definition_cards) ||
      String(parsed.flashcard_deck_title || parsed.deck_title || '').trim())
  ) {
    return [mark(parsed)];
  }
  return [];
}

/** Split deck objects ({ cards[] }) into one extract row per flashcard. */
function expandFlashcardExtractItems(items) {
  if (!Array.isArray(items) || !items.length) return items;
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const nested = [
      ...(Array.isArray(item.cards) ? item.cards : []),
      ...(Array.isArray(item.flashcards) ? item.flashcards : []),
    ];
    if (nested.length) {
      const deckTitle = String(item.deck_title || item.title || '').trim();
      nested.forEach((raw, i) => {
        if (!raw || typeof raw !== 'object') return;
        const front = String(raw.front || raw.question || raw.term || '').trim();
        const back = String(
          raw.back || raw.correct_answer || raw.answer || raw.definition || '',
        ).trim();
        if (!front && !back) return;
        out.push({
          ...raw,
          front,
          back,
          sl_no: raw.sl_no ?? item.sl_no ?? i + 1,
          deck_title: deckTitle || raw.deck_title,
          title: front.slice(0, 120) || `Card ${i + 1}`,
          _fromPdf: item._fromPdf !== false,
        });
      });
      continue;
    }
    const front = String(item.front || '').trim();
    const back = String(item.back || '').trim();
    if (front || back) {
      out.push({
        ...item,
        front,
        back,
        title: String(item.title || front.slice(0, 120) || `Card ${item.sl_no || out.length + 1}`).trim(),
      });
    }
  }
  return out.length ? out : items;
}

/** Merge question-only PDF rows into one exam paper with sections A–E. */
function consolidateExamExtractItems(items, params = {}) {
  if (!Array.isArray(items) || !items.length) return items;
  const fullSets = [];
  const questionOnly = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const hasSections = Array.isArray(item.sections) && item.sections.length > 0;
    const hasExamMeta = Boolean(
      String(item.paper_title || item.title || '').trim() ||
        String(item.instructions || '').trim() ||
        String(item.blueprint || '').trim() ||
        String(item.answer_key || '').trim() ||
        String(item.marking_scheme || '').trim() ||
        String(item.internal_choices || '').trim(),
    );
    const qOnly = String(item.question || '').trim() && !hasSections && !hasExamMeta;
    if (qOnly) questionOnly.push(item);
    else fullSets.push(item);
  }
  if (!questionOnly.length) return fullSets.length ? fullSets : items;

  const sectionMap = new Map();
  for (const q of questionOnly) {
    const name = String(q.section || q.sectionName || 'Questions').trim() || 'Questions';
    if (!sectionMap.has(name)) sectionMap.set(name, []);
    sectionMap.get(name).push(q);
  }
  const groupedSections = Array.from(sectionMap.entries()).map(([sectionName, questions]) => ({
    sectionName,
    questions,
  }));

  const defaultTitle = String(params.topic || params.subtopic || 'Exam Paper').trim() || 'Exam Paper';
  if (!fullSets.length) {
    return [{ title: defaultTitle, paper_title: defaultTitle, sections: groupedSections, _fromPdf: true }];
  }
  const merged = { ...fullSets[0] };
  const mergedMap = new Map();
  for (const sec of [...(Array.isArray(merged.sections) ? merged.sections : []), ...groupedSections]) {
    const name = String(sec.sectionName || sec.name || 'Questions').trim() || 'Questions';
    const qs = Array.isArray(sec.questions) ? sec.questions : [];
    if (!mergedMap.has(name)) mergedMap.set(name, []);
    mergedMap.get(name).push(...qs);
  }
  merged.sections = Array.from(mergedMap.entries()).map(([sectionName, questions]) => ({
    sectionName,
    questions,
  }));
  return [merged, ...fullSets.slice(1)];
}

async function runGeminiPdfExtractPass(toolType, textSlice, params, passContext = {}) {
  const maxExtractTokens =
    toolType === 'concept-mastery-helper'
      ? 32768
      : toolType === 'lesson-planner' ||
    toolType === 'study-schedule-maker' ||
    toolType === 'daily-class-plan-maker' ||
    toolType === 'activity-project-generator' ||
    toolType === 'project-idea-lab' ||
    toolType === 'worksheet-mcq-generator' ||
    toolType === 'homework-creator' ||
    toolType === 'exam-question-paper-generator' ||
    toolType === 'concept-mastery-helper' ||
    toolType === '__removed-rubrics-tool__' ||
    toolType === 'my-study-decks' ||
    toolType === 'flashcard-generator' ||
    toolType === 'reading-practice-room' ||
    toolType === 'story-passage-creator' ||
    toolType === 'short-notes-summaries-maker'
      ? 16384
      : 8000;

  const basePrompt = buildPdfExtractPrompt(toolType, textSlice, params);
  let lastValidation = { valid: false, errors: ['No attempt made'], stats: { itemCount: 0 } };
  let lastRaw = '';
  let totalRetries = 0;

  for (let attempt = 1; attempt <= PDF_EXTRACT_MAX_RETRIES; attempt += 1) {
    const userPrompt =
      attempt === 1
        ? basePrompt
        : buildPdfExtractRetryPrompt(basePrompt, lastValidation, attempt);

    try {
      const extractRaw = await callChatCompletions({
        messages: [
          {
            role: 'system',
            content:
              'You are a strict JSON extraction engine. Return ONLY a valid JSON array. No markdown. No explanations. No text outside JSON. Include ALL items and ALL array elements from the PDF. Do not truncate strings.',
          },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.02,
        maxTokens: maxExtractTokens,
        preferJson: true,
        usageLabel: `pdf-extract:${toolType}:${passContext.label || 'full'}`,
      });

      lastRaw = extractRaw;
      if (process.env.PDF_EXTRACT_LOG_RAW === '1') {
        console.log(
          `[PDF] Raw Gemini response (${toolType}, pass ${passContext.label || 'full'}, attempt ${attempt}, ${extractRaw.length} chars):`,
          extractRaw.slice(0, 1200),
        );
      }

      const parsed = parsePdfExtractResponse(extractRaw);
      const flattened = flattenPdfExtractItems(toolType, parsed).map((it) =>
        normalizeExtractedItem(toolType, it),
      );

      lastValidation = validatePdfExtractItems(toolType, flattened, {
        pdfText: textSlice,
        expectedItemCount: passContext.expectedItemCount,
        chunkIndex: passContext.chunkIndex,
        chunkTotal: passContext.chunkTotal,
        isPartialPass: Boolean(passContext.isPartialPass),
      });

      if (lastValidation.valid) {
        return {
          items: flattened,
          validation: lastValidation,
          attempt,
          retryCount: totalRetries,
          rawLength: extractRaw.length,
        };
      }

      totalRetries += 1;
      console.warn(
        `[PDF] Validation failed (${toolType}, ${passContext.label || 'full'}, attempt ${attempt}/${PDF_EXTRACT_MAX_RETRIES}):`,
        lastValidation.errors.slice(0, 6).join(' | '),
      );

      if (attempt === PDF_EXTRACT_MAX_RETRIES) {
        console.warn(
          `[PDF] Returning best-effort extract after ${PDF_EXTRACT_MAX_RETRIES} attempts; ${flattened.length} item(s)`,
        );
        return {
          items: flattened,
          validation: lastValidation,
          attempt,
          retryCount: totalRetries,
          rawLength: extractRaw.length,
        };
      }
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`[PDF] Gemini extract failed (attempt ${attempt}):`, msg);
      lastPdfExtractFailure = msg.includes('JSON')
        ? 'Gemini returned invalid or truncated JSON (PDF may be too large — try splitting the file).'
        : msg;
      if (attempt === PDF_EXTRACT_MAX_RETRIES) throw err;
      totalRetries += 1;
    }
  }

  return {
    items: [],
    validation: lastValidation,
    attempt: PDF_EXTRACT_MAX_RETRIES,
    retryCount: totalRetries,
    rawLength: lastRaw.length,
  };
}

/** Merge criterion-only PDF rows into one rubric when no full 10-section object exists. */
function consolidateRubricExtractItems(items, params = {}) {
  if (!Array.isArray(items) || !items.length) return items;
  const fullSets = [];
  const criterionRows = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const criteria = Array.isArray(item.criteria) ? item.criteria : [];
    const isCriterionRow =
      (item.name || item.criterion || item.excellent || item.good) &&
      !String(item.title || item.assessment_purpose || '').trim() &&
      criteria.length === 0;
    const hasRubricBody =
      String(item.title || '').trim() ||
      String(item.assessment_purpose || '').trim() ||
      criteria.length > 0 ||
      String(item.strengths_observed || '').trim() ||
      String(item.teacher_remarks || '').trim();
    if (isCriterionRow) criterionRows.push(item);
    else if (hasRubricBody) fullSets.push(item);
  }
  if (!criterionRows.length) return fullSets;
  const defaultTitle = String(params.topic || params.subtopic || 'Rubric').trim() || 'Rubric';
  if (!fullSets.length) {
    return [{ title: defaultTitle, criteria: criterionRows, _fromPdf: true }];
  }
  const merged = { ...fullSets[0] };
  merged.criteria = [
    ...(Array.isArray(merged.criteria) ? merged.criteria : []),
    ...criterionRows,
  ];
  return [merged, ...fullSets.slice(1)];
}

/** Merge question-only PDF rows into one homework set when no full 10-section object exists. */
function consolidateHomeworkExtractItems(items, params = {}) {
  if (!Array.isArray(items) || !items.length) return items;
  const fullSets = [];
  const questionOnly = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const hasHomeworkBody =
      String(item.instructions || '').trim() ||
      (Array.isArray(item.application_tasks) && item.application_tasks.length) ||
      String(item.creative_thinking_question || '').trim() ||
      String(item.real_life_observation_task || '').trim() ||
      String(item.challenge_question || '').trim() ||
      String(item.parent_note || '').trim() ||
      String(item.support_hint || '').trim() ||
      String(item.answer_hints || '').trim() ||
      (Array.isArray(item.practice_questions) &&
        item.practice_questions.length &&
        !String(item.question || '').trim());
    const qOnly = String(item.question || '').trim() && !hasHomeworkBody;
    if (qOnly) questionOnly.push(item);
    else fullSets.push(item);
  }
  if (!questionOnly.length) return fullSets;
  const defaultTitle = String(params.topic || params.subtopic || 'Homework').trim() || 'Homework';
  if (!fullSets.length) {
    return [
      {
        title: defaultTitle,
        instructions: '',
        practice_questions: questionOnly,
        _fromPdf: true,
      },
    ];
  }
  const merged = { ...fullSets[0] };
  merged.practice_questions = [
    ...(Array.isArray(merged.practice_questions) ? merged.practice_questions : []),
    ...(Array.isArray(merged.questions) ? merged.questions : []),
    ...questionOnly,
  ];
  delete merged.question;
  return [merged, ...fullSets.slice(1)];
}

function dedupeExtractedItems(items, toolType = '') {
  const tool = String(toolType || '').trim();
  const seen = new Set();
  const out = [];
  for (const item of items) {
    let key;
    if (tool === 'worksheet-mcq-generator' && String(item?.question || '').trim()) {
      const qKey = normalizeWorksheetQuestionKey(item.question);
      const num = item?.question_number ?? item?.sl_no;
      key =
        qKey ||
        normalizeTitleKey(`wsq:${num || ''}:${item.question}`);
    } else if (tool === 'flashcard-generator') {
      const front = String(item?.front || '').trim();
      const back = String(item?.back || '').trim();
      const num = item?.sl_no ?? item?.question_number;
      key = normalizeTitleKey(
        front && back
          ? `fc:${num || ''}:${front}:${back}`
          : item?.title || item?.deck_title || `card-${num || out.length}`,
      );
    } else {
      key = normalizeTitleKey(
        item?.title ||
          item?.name ||
          item?.concept_name ||
          item?.lesson_name ||
          item?.question ||
          item?.front ||
          `${item?.question_number || item?.sl_no || ''}`,
      );
    }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function coerceActivityStringList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x ?? '').trim()).filter(Boolean);
  const s = String(value ?? '').trim();
  return s ? [s] : [];
}

function mergeSingleActivityExtractRow(rowA, rowB) {
  const primary = scoreActivityExtractRow(rowA) >= scoreActivityExtractRow(rowB) ? rowA : rowB;
  const secondary = primary === rowA ? rowB : rowA;
  const out = { ...secondary, ...primary };
  const stringFields = [
    'subtopic_link_prior_knowledge',
    'ncf_competency_alignment',
    'differentiation',
    'differentiation_support_extension',
    'expected_learning_outcomes',
    'real_life_application',
    'reflection_exit_ticket',
  ];
  const arrayFields = [
    'learning_objectives',
    'materials_required',
    'step_by_step_procedure',
    'teacher_instructions',
    'student_instructions',
    'assessment_criteria_rubric',
    'self_assessment_rubric',
  ];
  for (const field of stringFields) {
    const p = String(primary[field] ?? '').trim();
    const s = String(secondary[field] ?? '').trim();
    if ((!p || looksLikeTruncatedActivityField(p)) && s && !looksLikeTruncatedActivityField(s)) {
      out[field] = secondary[field];
    } else if (p && s && p.length < s.length && looksLikeTruncatedActivityField(p)) {
      out[field] = secondary[field];
    }
  }
  for (const field of arrayFields) {
    const p = coerceActivityStringList(primary[field]);
    const s = coerceActivityStringList(secondary[field]);
    const pOk = p.length && !p.some((line) => looksLikeTruncatedActivityField(line));
    const sOk = s.length && !s.some((line) => looksLikeTruncatedActivityField(line));
    if (!pOk && sOk) out[field] = secondary[field];
    else if (pOk) out[field] = primary[field];
    else if (s.length) out[field] = secondary[field];
  }
  out._fromPdf = Boolean(primary._fromPdf || secondary._fromPdf);
  return out;
}

function mergeActivityPatternWithGemini(extractedItems, fromText) {
  if (!Array.isArray(fromText) || !fromText.length) return extractedItems;
  const patternByKey = new Map();
  for (const row of fromText) {
    if (!row || typeof row !== 'object') continue;
    const key = normalizeTitleKey(row.title || row.name);
    if (!key) continue;
    const prev = patternByKey.get(key);
    if (!prev || scoreActivityExtractRow(row) > scoreActivityExtractRow(prev)) {
      patternByKey.set(key, row);
    }
  }
  const merged = [];
  const seen = new Set();
  for (const row of extractedItems) {
    if (!row || typeof row !== 'object') continue;
    const key = normalizeTitleKey(row.title || row.name);
    const pattern = key ? patternByKey.get(key) : null;
    if (pattern) {
      merged.push(mergeSingleActivityExtractRow(pattern, row));
      seen.add(key);
    } else {
      merged.push(row);
      if (key) seen.add(key);
    }
  }
  for (const [key, row] of patternByKey) {
    if (!seen.has(key)) merged.push(row);
  }
  return merged.length ? merged : fromText;
}

function mergePatternExtractWithGemini(toolType, extractedItems, fromText) {
  if (!Array.isArray(fromText) || !fromText.length) return extractedItems;
  if (toolType === 'activity-project-generator' || toolType === 'project-idea-lab') {
    return mergeActivityPatternWithGemini(extractedItems, fromText);
  }
  const seen = new Set();
  const merged = [];
  for (const item of [...fromText, ...extractedItems]) {
    if (!item || typeof item !== 'object') continue;
    let key;
    if (toolType === 'worksheet-mcq-generator' && String(item.question || '').trim()) {
      key = normalizeWorksheetQuestionKey(item.question);
    } else if (toolType === 'flashcard-generator') {
      key = normalizeTitleKey(`${item.front || ''}:${item.back || ''}`);
    } else {
      key = normalizeTitleKey(
        item.concept_name || item.title || item.name || item.lesson_name || item.front || item.question,
      );
    }
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(item);
  }
  return merged.length ? merged : fromText;
}

/** Extract structured items from PDF text only — never generates missing items. */
export async function extractAndGenerateAllItems(toolType, rawPdfText, params = {}) {
  const text = cleanPdfTextForExtraction(String(rawPdfText || '').trim());
  lastPdfExtractFailure = '';
  lastPdfExtractionMeta = {
    extractionStatus: 'started',
    validationPassed: false,
    retryCount: 0,
    extractedItemCount: 0,
    expectedItemCount: countExpectedPdfItems(toolType, text),
    chunkPasses: [],
    validationErrors: [],
  };

  if (!text) {
    lastPdfExtractFailure = 'No text could be read from the PDF.';
    lastPdfExtractionMeta.extractionStatus = 'failed';
    return [];
  }

  if (toolType === 'activity-project-generator' || toolType === 'project-idea-lab') {
    const workbookActivities = enrichWorkbookActivityTitles(
      extractActivitiesFromCuriosityWorkbookPdf(text),
      text,
    );
    if (workbookActivities && workbookActivities.length > 0) {
      const { canonicalizeActivityExtractedItem } = await import('./ai-content-engine-service.js');
      const normalized = workbookActivities
        .map((row) =>
          canonicalizeActivityExtractedItem(
            mapActivityRowForToolSlug({ ...row, _fromPdf: true }, toolType),
            toolType,
          ),
        )
        .sort((a, b) => Number(a.sl_no || 0) - Number(b.sl_no || 0));
      console.log(`[PDF] Curiosity workbook extract: ${normalized.length} activity item(s)`);
      lastPdfExtractionMeta = {
        ...lastPdfExtractionMeta,
        extractionStatus: 'complete',
        validationPassed: true,
        extractedItemCount: normalized.length,
        parser: 'curiosity-workbook',
      };
      return normalized;
    }

    const patternEarly = extractToolItemsFromPdfText(toolType, text);
    const expectedTotalEarly = countExpectedPdfItems(toolType, text);
    if (activityPatternExtractIsComplete(patternEarly, expectedTotalEarly)) {
      const { canonicalizeActivityExtractedItem } = await import('./ai-content-engine-service.js');
      const normalized = repairActivityItemTitlesFromPdf(
        patternEarly
          .map((row, i) =>
            canonicalizeActivityExtractedItem(
              mapActivityRowForToolSlug({ ...row, sl_no: row.sl_no ?? i + 1, _fromPdf: true }, toolType),
              toolType,
            ),
          )
          .sort((a, b) => Number(a.sl_no || 0) - Number(b.sl_no || 0)),
        text,
      );
      lastPdfExtractionMeta = {
        ...lastPdfExtractionMeta,
        extractionStatus: 'complete',
        validationPassed: true,
        extractedItemCount: normalized.length,
        parser: 'pattern-regex',
      };
      return normalized;
    }
  }

  let extractedItems = [];
  const textPasses = buildPdfExtractionPasses(toolType, text);
  const expectedTotal = countExpectedPdfItems(toolType, text);

  for (let passIndex = 0; passIndex < textPasses.length; passIndex += 1) {
    const pass = textPasses[passIndex];
    try {
      const result = await runGeminiPdfExtractPass(toolType, pass.text, params, {
        label: pass.label,
        strategy: pass.strategy,
        chunkIndex: passIndex,
        chunkTotal: textPasses.length,
        expectedItemCount: pass.strategy === 'item' ? 1 : expectedTotal,
        isPartialPass: pass.strategy === 'section' || pass.strategy === 'size',
      });
      const batch = result.items || [];
      lastPdfExtractionMeta.retryCount += Number(result.retryCount || 0);
      lastPdfExtractionMeta.chunkPasses.push({
        label: pass.label,
        strategy: pass.strategy,
        itemCount: batch.length,
        attempt: result.attempt,
        validationPassed: Boolean(result.validation?.valid),
        errors: (result.validation?.errors || []).slice(0, 8),
      });
      if (batch.length) appendPdfExtractItems(extractedItems, batch);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error('[PDF] Gemini extract failed:', msg);
      lastPdfExtractFailure = msg.includes('JSON')
        ? 'Gemini returned invalid or truncated JSON (PDF may be too large — try splitting the file).'
        : msg;
      lastPdfExtractionMeta.chunkPasses.push({
        label: pass.label,
        strategy: pass.strategy,
        itemCount: 0,
        error: msg,
      });
    }
  }

  extractedItems = extractedItems.map((it) => normalizeExtractedItem(toolType, it));
  extractedItems = dedupeExtractedItems(extractedItems, toolType);

  if (toolType === 'activity-project-generator' || toolType === 'project-idea-lab') {
    extractedItems = repairActivityItemTitlesFromPdf(extractedItems, text);
  }

  const patternItems = extractToolItemsFromPdfText(toolType, text);
  if (patternItems.length) {
    console.log(`[PDF] Pattern extract: ${patternItems.length} ${toolType} item(s)`);
    extractedItems = mergePatternExtractWithGemini(toolType, extractedItems, patternItems);
    lastPdfExtractFailure = '';
  }

  if (toolType === 'worksheet-mcq-generator' && extractedItems.length) {
    extractedItems = consolidateWorksheetExtractItems(extractedItems, { ...params, rawPdfText: text });
    const { canonicalizeWorksheetExtractedItem } = await import('./ai-content-engine-service.js');
    extractedItems = extractedItems.map((it) => canonicalizeWorksheetExtractedItem(it, text));
  }

  if (toolType === 'homework-creator' && extractedItems.length) {
    extractedItems = consolidateHomeworkExtractItems(extractedItems, params);
  }

  if (toolType === '__removed-rubrics-tool__' && extractedItems.length) {
    extractedItems = consolidateRubricExtractItems(extractedItems, params);
  }

  if (
    (toolType === 'mock-test-builder' || toolType === 'exam-question-paper-generator') &&
    extractedItems.length
  ) {
    extractedItems = consolidateExamExtractItems(extractedItems, params);
  }

  if (toolType === 'my-study-decks' && extractedItems.length) {
    extractedItems = expandFlashcardExtractItems(extractedItems);
  }

  if (
    (toolType === 'activity-project-generator' || toolType === 'project-idea-lab') &&
    extractedItems.length
  ) {
    extractedItems = extractedItems.filter((it) => {
      const title = String(it?.title || it?.name || '').trim();
      if (!title) return false;
      return looksLikeRealActivityTitle(title);
    });
    const { canonicalizeActivityExtractedItem } = await import('./ai-content-engine-service.js');
    extractedItems = extractedItems.map((it) =>
      canonicalizeActivityExtractedItem(mapActivityRowForToolSlug(it, toolType), toolType),
    );
  }

  const allTitlesInPdf = detectAllTitlesInPdf(toolType, text);
  const extractedTitleKeys = new Set(
    extractedItems.map((item) =>
      normalizeTitleKey(item?.title || item?.name || item?.concept_name || item?.lesson_name || item?.question || item?.front),
    ),
  );
  const missingItems = allTitlesInPdf.filter(({ title }) => !extractedTitleKeys.has(normalizeTitleKey(title)));
  if (missingItems.length > 0) {
    console.log(
      `[PDF] Extract-only mode: skipping ${missingItems.length} title(s) with no complete PDF body (not generating):`,
      missingItems.map((m) => m.title).slice(0, 8).join(' | '),
    );
  }

  const sorted = dedupeExtractedItems(extractedItems).sort(
    (a, b) => Number(a.sl_no || a.question_number || 0) - Number(b.sl_no || b.question_number || 0),
  );

  const finalValidation = validatePdfExtractItems(toolType, sorted, {
    pdfText: text,
    expectedItemCount: expectedTotal,
  });
  lastPdfExtractionMeta = {
    ...lastPdfExtractionMeta,
    extractionStatus: sorted.length ? 'complete' : 'empty',
    validationPassed: finalValidation.valid,
    extractedItemCount: sorted.length,
    expectedItemCount: expectedTotal,
    validationErrors: finalValidation.errors,
    validationWarnings: finalValidation.warnings,
    questionCount: finalValidation.stats?.questionCount || 0,
  };

  if (!sorted.length && !lastPdfExtractFailure) {
    lastPdfExtractFailure =
      toolType === 'worksheet-mcq-generator'
        ? 'No numbered questions found. This PDF may be an Activity/Lesson layout — pick the matching tool.'
        : 'No complete items matched the selected tool format in the PDF text.';
    lastPdfExtractionMeta.extractionStatus = 'empty';
  } else if (sorted.length && !finalValidation.valid) {
    console.warn(
      `[PDF] Final validation warnings for ${toolType}:`,
      finalValidation.errors.slice(0, 8).join(' | '),
    );
  }

  return sorted;
}

export async function parsePdfToStructuredItems(toolType, rawPdfText, params = {}) {
  return extractAndGenerateAllItems(toolType, rawPdfText, params);
}

function buildStudentToolPrompt(toolType, params = {}) {
  const topicLine = params.subTopic
    ? `Topic: ${params.topic || params.chapter || params.concept || 'General Topic'}\nSubtopic: ${params.subTopic}`
    : `Topic: ${params.topic || params.chapter || params.concept || 'General Topic'}`;
  const common = `Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
${topicLine}

Format response in Markdown and keep it student-friendly.`;

  const templates = {
    'smart-study-guide-generator': `${common}

Create a personalized 11-section study guide: (1) short title (topic name only — never MCQ options or answers), (2) chapter/subtopic overview, (3) learning objectives, (4) prior knowledge, (5) key concepts in simple language, (6) definitions and formulae, (7) concept flow/mind map, (8) real-life examples, (9) quick revision notes, (10) objective and subjective practice questions in section 10 only, (11) tips for further improvement.`,
    'concept-breakdown-explainer': `${common}

Break the concept into a 9-section breakdown: (1) concept title, (2) simple definition, (3) step-by-step breakdown, (4) real-life and Indian context examples, (5) important terms and keywords, (6) concept check questions, (7) application-based thinking question, (8) higher-order thinking prompt, (9) quick revision summary.`,
    'personalized-revision-planner': `${common}

Create a realistic day-wise revision planner based on exam date and available hours.`,
    'smart-qa-practice-generator': `${common}

Generate an 11-section practice set: title, learning objectives, instructions, Section A (MCQs) through Section G (HOTS/analytical), and answer key with explanations; tag each question with bloom_level and difficulty_tag.`,
    'chapter-summary-creator': `${common}

Create a 10-section chapter summary: title, overview, learning objectives, important concepts, definitions, formulae/rules, concept connections, real-life applications, quick revision notes, and practice recall questions.`,
    'key-points-formula-extractor': `${common}

Extract a 10-section key points sheet: topic title, important concepts, essential definitions, formulae/rules, keywords, must-remember facts, real-life connections, exam points, mnemonics, and a one-minute revision summary.`,
    'quick-assignment-builder': `${common}

Build an 11-section quick assignment: title, learning objectives, student instructions, concept-based questions, application tasks, real-life/competency activity, creative and collaborative questions, advanced challenge, assessment rubric, and expected learning outcomes.`,
    'exam-readiness-checker': `${common}

Assess readiness, identify weak areas, and provide an actionable improvement plan.`,
    'project-layout-designer': `${common}

Design a complete project layout with sections, timeline, and resources.`,
    'goal-motivation-planner': `${common}

Create a SMART goals and motivation plan with milestones and tracking.`,
  };

  return (
    templates[toolType] ||
    `${common}

Generate educational content for toolType="${toolType}" using params: ${JSON.stringify(params)}`
  );
}

class GeminiService {
  constructor() {
    const cfg = getGeminiFallbackConfig();
    this.model = cfg.model;
    this.modelChain = cfg.modelChain;
    this.endpoint = `${cfg.baseUrl}/models/${cfg.model}:generateContent`;
    this.provider = 'gemini';
    this.disableAuth = false;
    console.log(
      `✅ Gemini service ready: primary=${this.model}, chain=[${(this.modelChain || []).join(', ')}]`,
    );
  }

  async generateResponse(message, context = {}, chatHistory = []) {
    const studentName = context?.studentName || 'Student';
    let systemInstruction = `You are Vidya AI for AsliLearn.
Give direct, accurate, educational answers.
Use clear language and step-by-step explanations for problem solving.
Keep responses focused and practical.`;

    if (context.currentSubject) {
      systemInstruction += `\nSession subject focus: ${context.currentSubject}. Keep explanations, examples, quizzes, and practice strictly inside this subject at school-level depth.`;
      if (context.currentTopic) {
        systemInstruction += `\nCurrent topic: ${context.currentTopic}`;
      }
    }

    const normalizedHistory = (chatHistory || []).slice(-8).map((msg) => ({
      role: msg?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(msg?.content),
    }));

    const messages = [
      { role: 'system', content: systemInstruction },
      ...normalizedHistory.filter((m) => m.content.length > 0),
      { role: 'user', content: cleanText(message) || `Help ${studentName} with studies.` },
    ];

    return callChatCompletions({
      messages,
      temperature: 0.4,
      maxTokens: 1400,
    });
  }

  async analyzeImage(imageBase64, context = '') {
    const prompt = `Analyze this educational image and help the student.
${context ? `Context: ${context}` : ''}
Provide: (1) what you see, (2) explanation/solution, (3) key takeaways.`;

    const dataUri = `data:image/jpeg;base64,${imageBase64}`;
    const visionMessages = [
      { role: 'system', content: 'You are a helpful educational vision assistant.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ];

    try {
      return await callChatCompletions({
        messages: visionMessages,
        temperature: 0.2,
        maxTokens: 1400,
      });
    } catch (error) {
      console.warn('Vision request failed, falling back to text-only analysis:', error.message);
      return callChatCompletions({
        messages: [
          { role: 'system', content: 'You are a helpful educational assistant.' },
          {
            role: 'user',
            content:
              `${prompt}\n\nImage bytes were provided but vision is unavailable on current model. ` +
              'Explain this limitation and provide what guidance can still be offered.',
          },
        ],
        temperature: 0.2,
        maxTokens: 600,
      });
    }
  }

  async generateStructuredContent(prompt, format = 'text', options = {}) {
    const wantsJson = String(format).toLowerCase() === 'json';
    const messages = [
      {
        role: 'system',
        content: wantsJson
          ? 'Return only valid JSON. No markdown, no code fences, no extra text.'
          : 'Return clear, structured educational content.',
      },
      { role: 'user', content: cleanText(prompt) },
    ];

    const defaultJsonTemp = options.isBatchVariant ? 0.72 : 0.1;
    const text = await callChatCompletions({
      messages,
      temperature:
        typeof options.temperature === 'number' && Number.isFinite(options.temperature)
          ? options.temperature
          : wantsJson
            ? defaultJsonTemp
            : 0.3,
      maxTokens:
        typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens)
          ? options.maxTokens
          : 2200,
      preferJson: wantsJson,
      usageLabel: wantsJson ? 'structured-json' : 'structured-text',
      primaryModel: String(options.primaryModel || '').trim(),
      flashLiteOnly: options.flashLiteOnly === true,
      maxAttemptsPerModel: options.maxAttemptsPerModel,
      isBatchVariant: options.isBatchVariant === true,
    });

    return wantsJson ? stripCodeFences(text) : text;
  }
}

const geminiService = new GeminiService();

export const generateLessonPlan = async (subject, topic, gradeLevel, duration) => {
  const prompt = `Create a comprehensive lesson plan.
Subject: ${subject}
Topic: ${topic}
Grade: ${gradeLevel}
Duration: ${duration} minutes

Include objectives, prerequisites, teaching flow, examples, assessment, homework, and common mistakes.`;
  return geminiService.generateStructuredContent(prompt, 'text');
};

export const generateTestQuestions = async (subject, topic, gradeLevel, questionCount, difficulty) => {
  const prompt = `Generate exactly ${questionCount} MCQs in JSON.
Subject: ${subject}
Topic: ${topic}
Grade: ${gradeLevel}
Difficulty: ${difficulty}

JSON schema:
{
  "questions": [
    {
      "question": "string",
      "type": "multiple-choice",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "string",
      "explanation": "string"
    }
  ]
}`;
  return geminiService.generateStructuredContent(prompt, 'json');
};

export const generateClasswork = async (subject, topic, gradeLevel, assignmentType) => {
  const prompt = `Create ${assignmentType} classwork.
Subject: ${subject}
Topic: ${topic}
Grade: ${gradeLevel}
Include title, instructions, tasks, rubric, and expected duration.`;
  return geminiService.generateStructuredContent(prompt, 'text');
};

export const generateSchedule = async (subjects, gradeLevels, timeSlots, preferences) => {
  const prompt = `Create a weekly teaching schedule.
Subjects: ${Array.isArray(subjects) ? subjects.join(', ') : subjects}
Grades: ${Array.isArray(gradeLevels) ? gradeLevels.join(', ') : gradeLevels}
Time slots: ${Array.isArray(timeSlots) ? timeSlots.join(', ') : timeSlots}
Preferences: ${preferences}`;
  return geminiService.generateStructuredContent(prompt, 'text');
};

export const generateTeacherTool = async (toolType, params) => {
  return geminiService.generateStructuredContent(buildTeacherToolPrompt(toolType, params), 'text');
};

export const generateStudentTool = async (toolType, params) => {
  return geminiService.generateStructuredContent(buildStudentToolPrompt(toolType, params), 'text');
};

/**
 * Single JSON-mode LLM call (used by universal PDF knowledge extraction).
 * @param {string} prompt
 * @param {{ maxTokens?: number, temperature?: number, usageLabel?: string }} [options]
 */
export async function callLlmJson(prompt, options = {}) {
  const text = await callChatCompletions({
    messages: [{ role: 'user', content: String(prompt || '') }],
    temperature: options.temperature ?? 0.2,
    maxTokens: options.maxTokens ?? 12000,
    preferJson: true,
    usageLabel: options.usageLabel || 'llm-json',
  });
  return String(text || '').trim();
}

export default geminiService;
