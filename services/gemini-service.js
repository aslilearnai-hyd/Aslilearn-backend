import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODELS_FALLBACK } from './gemini-models.js';
import { extractActivitiesFromCuriosityWorkbookPdf } from './curiosity-activity-pdf-parser.js';
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
  if (tool === 'rubrics-evaluation-generator') {
    return `${base} Use a rubric or report-card PDF with a criteria table (Excellent / Good / Satisfactory / Needs improvement) and evaluation narrative sections.${detail}`;
  }
  if (tool === 'activity-project-generator') {
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

async function callChatCompletions({
  messages,
  temperature = 0.3,
  maxTokens = 2000,
  preferJson = false, // kept for compatibility with callers
}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const contextTokens = Number(process.env.LLM_CONTEXT_TOKENS) || 0;
  const callGeminiFallback = async (normalizedMessages, jsonMode = preferJson) => {
    const { apiKey, modelChain } = getGeminiFallbackConfig();
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

    const maxAttemptsPerModel = Math.max(1, Math.min(5, Number(process.env.GEMINI_RETRY_ATTEMPTS_PER_MODEL) || 3));
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
    throw lastErr || new Error('Gemini failed on all configured models');
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

Create an engaging classroom activity/project with:
1) Objective
2) Materials
3) Procedure
4) Assessment rubric
5) Extension idea`,
    'worksheet-mcq-generator': `${common}

Create a worksheet with ${params.questionCount || 10} questions (${params.questionType || 'mixed'}), include answers and short explanations.`,
    'concept-mastery-helper': `${common}

Explain the concept in simple steps, common mistakes, examples, and a quick recap.`,
    'lesson-planner': `${common}

Create a complete lesson plan for ${params.duration || 90} minutes with objectives, prerequisite, teaching flow, examples, and homework.`,
    'homework-creator': `${common}

Create a meaningful homework set with instructions, questions, answer key, and grading criteria.`,
    'rubrics-evaluation-generator': `${common}

Create clear evaluation rubrics with criteria and performance levels (Excellent, Good, Satisfactory, Needs Improvement).`,
    'story-passage-creator': `${common}

Write a topic-relevant story/passage in the subject language, then add vocabulary, comprehension and discussion questions.`,
    'short-notes-summaries-maker': `${common}

Create concise revision notes with key ideas, definitions, formulas (if any), and quick reference points.`,
    'flashcard-generator': `${common}

Generate ${params.cardCount || 20} flashcards. Each card MUST use these seven fields (copy labels exactly):
Front, Back, Memory Cue, Skill Focus, Example Use, Peer Prompt, Reflection.`,
    'daily-class-plan-maker': `${common}

Create a practical day plan with time slots, activities, checkpoints, and notes.`,
    'exam-question-paper-generator': `${common}

Generate a full exam paper with exactly ${Math.min(
      Math.max(Number(params.questionCount ?? params.numberOfQuestions ?? 17) || 17, 1),
      100,
    )} questions and a complete answer key.`,
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
    toolType === 'activity-project-generator'
      ? `

ACTIVITY & PROJECT — TEMPLATE MAPPING (mandatory):
Each JSON object is ONE activity from the PDF. Map sections by label/numbering in the PDF text:
(1) title — activity title only
(2) learning_objectives — from "Learning Objectives" / section 2
(3) materials_required — from "Materials Required" / section 3
(4) step_by_step_procedure — from "Step-by-step Procedure" / student steps ONLY (section 4)
(5) teacher_instructions — from "Teacher Instructions" (section 5) — keep separate from (4)
(6) student_instructions — from "Student Instructions" (section 6) when present
(7) expected_learning_outcomes — from "Expected Learning Outcomes" (section 7)
(8) assessment_criteria_rubric — from "Assessment Criteria (Rubric)" (section 8)
(9) real_life_application — from "Real-life Application" (section 9)

If the PDF has several activities, return one object per activity (same sl_no / order as in the document). Do not merge multiple activities into one object.
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
  const storyTemplateBlock =
    toolType === 'story-passage-creator'
      ? `

STORY & PASSAGE CREATOR — TEMPLATE MAPPING (mandatory, one object per story/passage item):
Map PDF headings to fields (copy exact wording from the document):
1 title — passage / story title (e.g. "A Question from the Night Sky")
2 alignment_block — OR separate nep_ncf_focus, skill_focus, udl_support (Alignment Block: NEP/NCF, Skill Focus, UDL)
3 learning_objectives[] — learning objectives (strings)
4 passage — full passage / story text (required)
5 vocabulary_support[] — vocabulary with brief definitions (strings, e.g. "curiosity - wish to know more")
6 questions[] — comprehension and thinking questions (strings or { question })
7 answer_hints[] — answer hints aligned to questions (strings)
8 differentiation_support and differentiation_extension — Support and Extension strategies
9 real_life_application — real-life application paragraph
10 reflection_prompt — reflection / exit ticket prompt
Optional header metadata when shown in PDF: bloom_level, difficulty_level, class_label, subject, subtopic

Return ONE JSON object per distinct story/passage block in the PDF (Item 1, Item 2, …). Do NOT merge separate stories into one object.
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
  const flashcardTemplateBlock =
    toolType === 'flashcard-generator'
      ? `

FLASHCARD GENERATOR — TEMPLATE MAPPING (mandatory, one object per card / Item N):
Map PDF headings to fields (copy exact wording):
1 front — Front (prompt / cue) — required
2 back — Back (response / definition) — required
3 memory_cue — Memory Cue (legacy PDFs may label "Hint")
4 skill_focus — Skill Focus (legacy: bloom_level, skill)
5 example_use — Example Use (legacy: real_life_link, example)
6 peer_prompt — Peer Prompt
7 reflection — Reflection (legacy: reflection_prompt, self_check)
Optional deck_title or title when the PDF names the whole set.

Return ONE JSON object per distinct flashcard in the PDF (Card 1, Item 1, …). Do NOT merge separate cards into one object.
`
      : '';
  const rubricTemplateBlock =
    toolType === 'rubrics-evaluation-generator'
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
    toolType === 'lesson-planner'
      ? `

LESSON PLAN — TEMPLATE MAPPING (mandatory, 14 sections):
Each JSON object is ONE full lesson plan variation from the PDF ("Lesson 1", "Variation 1", "Plan 1", etc.).
Map PDF headings to these fields (copy exact wording; one bullet/line per array item):
1 lesson_name — title only (not "Objectives" alone)
2 learning_objectives[] — "Learning Objectives", "Outcomes"
3 ncf_competency_alignment — NCF / competency / learning outcome alignment
4 prior_knowledge_diagnostic — prior knowledge or diagnostic question
5 introduction_warmup — introduction / warm-up
6 teaching_strategy — teaching strategy / pedagogy
7 teaching_activities[] — procedure, teaching-learning process, classroom activities, methodology steps
8 teacher_talk_points[] — teacher talk / teacher instructions
9 student_tasks[] — student tasks / student instructions
10 formative_assessment_questions[] — formative assessment questions (bullets)
11 differentiation_plan — differentiation / UDL
12 homework_practice — homework / practice
13 materials_required[] and/or teaching_aids_required[] — materials, resources, teaching aids
14 closure_exit_ticket — closure / exit ticket; timeline[] or time_slots[] for period/time cues

Return one object per distinct lesson variation with lesson_name plus at least one substantive body field from sections 2–14. Do not return worksheet question rows.
`
      : '';
  const examTemplateBlock =
    toolType === 'exam-question-paper-generator'
      ? `

EXAM QUESTION PAPER — TEMPLATE MAPPING (mandatory, 11 sections):
Prefer ONE JSON object per full examination paper in the PDF (not one array item per question unless the PDF is only a flat numbered list).
Map PDF headings to fields (copy exact wording):
1 paper_title / title — paper title and general instructions block (instructions string)
2 blueprint — blueprint / design grid / marks distribution table
3–7 sections[] — Section A (MCQs), B (VSA), C (short answer), D (long answer), E (case/competency): each { sectionName, questions[{ question_number, question, options[], answer, marks, internal_choice_group }] }
8 internal_choices — internal choice / OR instructions (string)
9 answer_key — complete answer key (string or built from per-question answers)
10 marking_scheme — detailed marking scheme (string)
11 open_ended_rubric — rubric for open-ended questions (string)

If the PDF is only numbered questions, return flat rows with section label + question_number + question + options + answer + marks — they will be merged into sections A–E by section name.
Preserve "OR", "attempt any", and internal-choice markers in internal_choice_group or question text.
`
      : '';
  const rule7 =
    toolType === 'activity-project-generator'
      ? '7. The "title" field must be ONLY the activity name (e.g. "Observing shadows"). Never use section labels (Materials Required, Learning Objectives, Title, Rubric) as title'
      : toolType === 'lesson-planner'
        ? '7. Use "lesson_name" for the lesson title (not generic words like "Objectives" alone). Fill learning_objectives and teaching_activities from the PDF whenever those sections exist.'
        : toolType === 'daily-class-plan-maker'
          ? '7. Use "title" and day_period_topic_breakup for the plan heading. Fill objectives, teaching_methods, classroom_activity, and time_slots from the PDF — not lesson_name / NCF fields unless the PDF uses those labels.'
          : toolType === 'exam-question-paper-generator'
            ? '7. Use paper_title/title for the exam name. Put questions in sections[] with sectionName from the PDF (Section A, Section B, MCQs, etc.). Copy answers and marks exactly.'
            : toolType === 'worksheet-mcq-generator'
              ? '7. Use title/worksheet_title for the worksheet name. Group questions in sections[] by Section A–E (no separate long-answer section) or copy section labels into each row\'s section field.'
              : toolType === 'story-passage-creator'
                ? '7. Use title for the story/passage name. Put prose in passage; map all story template fields from PDF section headings.'
                : toolType === 'short-notes-summaries-maker'
                  ? '7. Use title/concept_name for the note name. Map all 10 short-note template fields from PDF section headings.'
                  : toolType === 'flashcard-generator'
                    ? '7. Map all seven flashcard fields (front, back, memory_cue, skill_focus, example_use, peer_prompt, reflection) from PDF section headings.'
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
${toolType === 'lesson-planner'
  ? `Extract one JSON object per lesson plan variation in the PDF (numbered lessons, "Variation N", multiple period plans, etc.).
Each object MUST have non-empty lesson_name and at least one substantive content field from the schema (bullets/lines copied from the PDF).
Skip stubs that are only a title with no objectives, activities, timeline, materials, or assessment text.
Do NOT invent steps or objectives that are not present in the PDF text.
Do NOT treat standalone appendix or index pages as lesson plans.${activityTemplateBlock}${lessonPlannerTemplateBlock}`
  : toolType === 'daily-class-plan-maker'
    ? `Extract one JSON object per full daily class plan in the PDF.
Each object MUST have a non-empty title or day_period_topic_breakup and at least one substantive daily-plan field (objectives, teaching_methods, classroom_activity, time_slots, exit_ticket, etc.) copied from the PDF.
Skip title-only stubs. Do NOT map daily plans into lesson-planner field names unless the PDF uses those exact labels.${activityTemplateBlock}${dailyClassPlanTemplateBlock}`
  : toolType === 'exam-question-paper-generator'
    ? `Extract one JSON object per full examination paper when the PDF has a complete paper structure; otherwise extract one flat row per question with section + question_number + question + options + answer + marks.
Each full-paper object MUST include sections[] (or flat questions that will be grouped) and paper_title or title when present in the PDF.
Copy answer keys and marking schemes when in a separate section of the PDF.${activityTemplateBlock}${examTemplateBlock}`
  : toolType === 'worksheet-mcq-generator'
    ? `Extract one JSON object per full worksheet when the PDF has title, instructions, and section blocks; otherwise one flat row per question with section (A–E), question_number, question, options[], answer, type, marks.
Do NOT skip questions because the answer key is on a later page.${activityTemplateBlock}${worksheetTemplateBlock}`
    : toolType === 'story-passage-creator'
      ? `Extract one JSON object per complete story/passage item in the PDF (numbered items, separate titles, or distinct passage blocks).
Each object MUST include non-empty passage (or content) and title when present. Copy alignment, objectives, vocabulary, questions, answer hints, differentiation, real-life application, and reflection from the PDF.
Skip title-only stubs.${activityTemplateBlock}${storyTemplateBlock}`
      : toolType === 'short-notes-summaries-maker'
        ? `Extract one JSON object per complete short-note item in the PDF (Item 1, Item 2, numbered notes).
Each object MUST include non-empty short_note_summary (or summary) and title/concept_name when present. Copy all 10 template sections from the PDF.
Skip title-only stubs.${activityTemplateBlock}${shortNotesTemplateBlock}`
        : toolType === 'flashcard-generator'
          ? `Extract one JSON object per flashcard in the PDF (Card 1, Item 1, numbered cards).
Each object MUST include non-empty front and back. Copy memory_cue, skill_focus, example_use, peer_prompt, and reflection when present in the PDF.
Skip title-only stubs.${activityTemplateBlock}${flashcardTemplateBlock}`
          : `Extract ONLY the items that have COMPLETE content in this PDF (items with all required fields: ${requiredFields}).
Do NOT extract items that are only titles or brief mentions without full content.
Do NOT generate or invent content that is not present in the PDF text above.
Do NOT treat standalone workbook appendix headings as a separate activity unless they are a full numbered activity block.${activityTemplateBlock}${conceptTemplateBlock}${worksheetTemplateBlock}${homeworkTemplateBlock}${storyTemplateBlock}${shortNotesTemplateBlock}${flashcardTemplateBlock}${rubricTemplateBlock}${lessonPlannerTemplateBlock}${dailyClassPlanTemplateBlock}${examTemplateBlock}`}

Return a JSON array. Each element uses this schema:
${schemaStr}

RULES:
1. Return ONLY a raw JSON array [ ... ] — no markdown, no code fences, no explanation
2. ${toolType === 'lesson-planner' || toolType === 'daily-class-plan-maker' || toolType === 'exam-question-paper-generator' || toolType === 'worksheet-mcq-generator' ? 'Skip title-only rows with no substantive body in any mapped field.' : 'Extract ONLY items with complete content — skip title-only entries'}
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
6. Fill the Activity & Project template fields: learning_objectives, materials_required, step_by_step_procedure (student steps only), teacher_instructions (separate from procedure), expected_learning_outcomes, assessment_criteria_rubric, real_life_application — use the schema key names exactly; arrays must have at least one string each where the PDF implies content
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

function looksLikeRealActivityTitle(title) {
  const t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  if (SECTION_HEADING_ONLY_AS_ACTIVITY_TITLE.test(t)) return false;
  if (/title\s*[—:-]\s*materials required/i.test(t)) return false;
  if (t.length < 8) return false;
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
    toolType === 'activity-project-generator' ? [sliceTextForActivityTitleScan(full), full] : [full];
  const results = [];
  for (const scan of scanTexts) {
    const partial = [];
    if (toolType === 'activity-project-generator') {
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
  if (toolType !== 'activity-project-generator' || !missingItems.length) return null;
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
4. Every object MUST follow the Activity & Project template keys: learning_objectives, materials_required, step_by_step_procedure, teacher_instructions, expected_learning_outcomes, assessment_criteria_rubric, real_life_application — populate each from curriculum context; keep step_by_step_procedure (students) and teacher_instructions separate
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
      if (toolType === 'exam-question-paper-generator') {
        const hasSections = Array.isArray(item.sections) && item.sections.length > 0;
        const hasExamMeta = Boolean(
          String(item.paper_title || item.title || '').trim() ||
            String(item.instructions || '').trim() ||
            String(item.blueprint || '').trim() ||
            String(item.answer_key || '').trim() ||
            String(item.marking_scheme || '').trim() ||
            String(item.internal_choices || '').trim(),
        );
        if (hasSections || (hasExamMeta && !String(item.question || '').trim())) {
          out.push(
            mark({
              ...item,
              paper_title: String(item.paper_title || item.title || 'Exam Paper').trim(),
              title: String(item.title || item.paper_title || 'Exam Paper').trim(),
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
      if (toolType === 'story-passage-creator') {
        const passage = String(item.passage || item.content || item.story_text || '').trim();
        const hasStoryBody = Boolean(
          passage ||
            (Array.isArray(item.learning_objectives) && item.learning_objectives.length) ||
            (Array.isArray(item.vocabulary_support) && item.vocabulary_support.length) ||
            (Array.isArray(item.questions) && item.questions.length) ||
            String(item.alignment_block || item.alignment || '').trim() ||
            String(item.reflection_prompt || '').trim(),
        );
        if (hasStoryBody) {
          out.push(
            mark({
              ...item,
              title: String(item.title || item.passage_title || 'Story').trim(),
              passage: passage || item.passage,
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
      if (toolType === 'rubrics-evaluation-generator') {
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
        if (questionText && !item.lesson_name && !item.teaching_activities?.length) continue;
        const lessonName = String(item.lesson_name || item.title || item.name || '').trim();
        const hasLessonBody = Boolean(
          item.learning_objectives?.length ||
            item.objectives?.length ||
            item.teaching_activities?.length ||
            item.activities?.length ||
            item.timeline?.length ||
            item.materials_required?.length ||
            item.introduction_warmup ||
            item.teaching_strategy ||
            item.assessment ||
            item.closure_exit_ticket,
        );
        if (lessonName || hasLessonBody) {
          out.push(
            mark({
              ...item,
              lesson_name: lessonName || item.lesson_name || 'Lesson',
              title: lessonName || item.title,
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
    (toolType === 'exam-question-paper-generator' || toolType === 'worksheet-mcq-generator') &&
    Array.isArray(parsed.sections) &&
    parsed.sections.length
  ) {
    return [mark(parsed)];
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    toolType === 'flashcard-generator' &&
    (Array.isArray(parsed.cards) || Array.isArray(parsed.flashcards))
  ) {
    return flattenPdfExtractItems(toolType, [parsed]);
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
    toolType === 'daily-class-plan-maker' ||
    toolType === 'activity-project-generator' ||
    toolType === 'worksheet-mcq-generator' ||
    toolType === 'homework-creator' ||
    toolType === 'exam-question-paper-generator' ||
    toolType === 'concept-mastery-helper' ||
    toolType === 'rubrics-evaluation-generator' ||
    toolType === 'flashcard-generator' ||
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

function mergePatternExtractWithGemini(toolType, extractedItems, fromText) {
  if (!Array.isArray(fromText) || !fromText.length) return extractedItems;
  const seen = new Set();
  const merged = [];
  for (const item of [...extractedItems, ...fromText]) {
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

  if (toolType === 'activity-project-generator') {
    const workbookActivities = extractActivitiesFromCuriosityWorkbookPdf(text);
    if (workbookActivities && workbookActivities.length > 0) {
      lastPdfExtractionMeta = {
        ...lastPdfExtractionMeta,
        extractionStatus: 'complete',
        validationPassed: true,
        extractedItemCount: workbookActivities.length,
        parser: 'curiosity-workbook',
      };
      return workbookActivities
        .map((row) => ({ ...row, _fromPdf: true }))
        .sort((a, b) => Number(a.sl_no || 0) - Number(b.sl_no || 0));
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

  const patternItems = extractToolItemsFromPdfText(toolType, text);
  if (patternItems.length) {
    console.log(`[PDF] Pattern extract: ${patternItems.length} ${toolType} item(s)`);
    extractedItems = mergePatternExtractWithGemini(toolType, extractedItems, patternItems);
    lastPdfExtractFailure = '';
  }

  if (toolType === 'worksheet-mcq-generator' && extractedItems.length) {
    extractedItems = consolidateWorksheetExtractItems(extractedItems, { ...params, rawPdfText: text });
  }

  if (toolType === 'homework-creator' && extractedItems.length) {
    extractedItems = consolidateHomeworkExtractItems(extractedItems, params);
  }

  if (toolType === 'rubrics-evaluation-generator' && extractedItems.length) {
    extractedItems = consolidateRubricExtractItems(extractedItems, params);
  }

  if (toolType === 'exam-question-paper-generator' && extractedItems.length) {
    extractedItems = consolidateExamExtractItems(extractedItems, params);
  }

  if (toolType === 'flashcard-generator' && extractedItems.length) {
    extractedItems = expandFlashcardExtractItems(extractedItems);
  }

  if (toolType === 'activity-project-generator' && extractedItems.length) {
    extractedItems = extractedItems.filter((it) => {
      const title = String(it?.title || it?.name || '').trim();
      if (!title) return false;
      return looksLikeRealActivityTitle(title);
    });
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
  const common = `Class: ${params.gradeLevel || 'General'}
Subject: ${params.subject || 'General'}
Topic: ${params.topic || params.chapter || params.concept || 'General Topic'}

Format response in Markdown and keep it student-friendly.`;

  const templates = {
    'smart-study-guide-generator': `${common}

Create a personalized study guide with key concepts, formulas, and a revision checklist.`,
    'concept-breakdown-explainer': `${common}

Break the concept into simple steps with examples and common misconceptions.`,
    'personalized-revision-planner': `${common}

Create a realistic day-wise revision planner based on exam date and available hours.`,
    'smart-qa-practice-generator': `${common}

Generate practice questions with step-by-step answers and quick tips.`,
    'chapter-summary-creator': `${common}

Provide a concise chapter summary with key takeaways and quick review points.`,
    'key-points-formula-extractor': `${common}

List the most important key points, definitions, and formulas.`,
    'quick-assignment-builder': `${common}

Build a structured assignment with instructions and marking criteria.`,
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

  async generateStructuredContent(prompt, format = 'text') {
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

    const text = await callChatCompletions({
      messages,
      temperature: wantsJson ? 0.1 : 0.3,
      maxTokens: 2200,
      preferJson: wantsJson,
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

export default geminiService;
