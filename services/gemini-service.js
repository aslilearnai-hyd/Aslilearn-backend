import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODELS_FALLBACK } from './gemini-models.js';
import { extractActivitiesFromCuriosityWorkbookPdf } from './curiosity-activity-pdf-parser.js';

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

async function callChatCompletions({
  messages,
  temperature = 0.3,
  maxTokens = 2000,
  preferJson = false, // kept for compatibility with callers
}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const contextTokens = Number(process.env.LLM_CONTEXT_TOKENS) || 0;
  const callGeminiFallback = async (normalizedMessages) => {
    const { apiKey, modelChain } = getGeminiFallbackConfig();
    if (!apiKey) {
      throw new Error('Gemini API key is missing');
    }
    const genAI = new GoogleGenerativeAI(apiKey);

    const prompt = normalizedMessages
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.content || '')}`)
      .join('\n\n');

    const isAuthOrConfigError = (msg) =>
      /\b(401|403)\b|API key not valid|PERMISSION_DENIED|API_KEY_INVALID|permission denied/i.test(msg);
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
            console.warn(
              `[Gemini] ${modelName} rate limited or quota hit; switching to next model (avoiding repeated calls on same model).`,
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

Generate ${params.cardCount || 20} flashcards in plain text with "Front:" and "Back:" lines.`,
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

const PDF_TOOL_CONFIG = {
  'activity-project-generator': {
    requiredFields: [
      'title',
      'learning_objectives',
      'materials_required',
      'step_by_step_procedure',
      'teacher_instructions',
      'student_instructions',
      'expected_learning_outcomes',
      'assessment_criteria_rubric',
      'real_life_application',
    ],
    /** Official Activity & Project layout (includes section 6 in Curiosity PDFs). */
    schema: {
      sl_no: 'number',
      title: 'string — (1) Title',
      learning_objectives: ['string — (2) Learning objectives, one per line'],
      materials_required: ['string — (3) Materials required, one per item'],
      step_by_step_procedure: ['string — (4) Step-by-step procedure for students, one step per string'],
      teacher_instructions: ['string — (5) Teacher instructions, one bullet per string'],
      student_instructions: ['string — (6) Student instructions, one bullet per string'],
      expected_learning_outcomes: 'string — (7) Expected learning outcomes (paragraph or bullets as one string)',
      assessment_criteria_rubric: ['string — (8) Assessment criteria / rubric, one criterion per string'],
      real_life_application: 'string — (9) Real-life application',
    },
  },
  'worksheet-mcq-generator': {
    requiredFields: ['question', 'answer'],
    schema: {
      question_number: 'number',
      type: 'string',
      section: 'string',
      question: 'string',
      options: ['string'],
      answer: 'string',
      explanation: 'string',
      marks: 'number',
      blank_answer: 'string',
    },
  },
  'concept-mastery-helper': {
    requiredFields: ['concept_name', 'lesson'],
    schema: {
      concept_name: 'string',
      difficulty: 'string',
      lesson: 'string',
      real_example: 'string',
      key_points: ['string'],
      common_mistakes: ['string'],
      quick_recap: 'string',
    },
  },
  'lesson-planner': { requiredFields: ['lesson_name', 'learning_objectives'], schema: { lesson_name: 'string' } },
  'homework-creator': { requiredFields: ['title', 'questions'], schema: { title: 'string' } },
  'rubrics-evaluation-generator': { requiredFields: ['title', 'criteria'], schema: { title: 'string' } },
  'story-passage-creator': { requiredFields: ['title', 'passage'], schema: { title: 'string' } },
  'short-notes-summaries-maker': { requiredFields: ['concept_name', 'summary'], schema: { concept_name: 'string' } },
  'flashcard-generator': { requiredFields: ['front', 'back'], schema: { front: 'string', back: 'string', type: 'string', hint: 'string', topic_tag: 'string' } },
  'daily-class-plan-maker': { requiredFields: ['title', 'time_slots'], schema: { title: 'string' } },
  'exam-question-paper-generator': { requiredFields: ['question', 'answer'], schema: { question_number: 'number', question: 'string', answer: 'string' } },
};

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
  return `You are a precise educational content extractor. Extract structured data from this PDF.

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
Extract ONLY the items that have COMPLETE content in this PDF (items with all required fields: ${requiredFields}).
Do NOT extract items that are only titles or brief mentions without full content.
Do NOT generate or invent content that is not present in the PDF text above.
Do NOT treat standalone workbook appendix headings as a separate activity unless they are a full numbered activity block.${activityTemplateBlock}

Return a JSON array. Each element uses this schema:
${schemaStr}

RULES:
1. Return ONLY a raw JSON array [ ... ] — no markdown, no code fences, no explanation
2. Extract ONLY items with complete content — skip title-only entries
3. Preserve the EXACT wording from the PDF — do not paraphrase
4. For fields not present in PDF, use "" or []
5. sl_no / question_number must match the activity number from the PDF when numbered
6. Add "_fromPdf": true to each extracted object
7. The "title" field must be ONLY the activity name (e.g. "Observing shadows"). Never use section labels (Materials Required, Learning Objectives, Title, Rubric) as title`;
}

export function buildSingleItemGenerationPrompt(toolType, itemNumber, itemTitle, templateExamples = [], params = {}) {
  const { classLabel = '', subject = '', topic = '', subtopic = '' } = params;
  const config = PDF_TOOL_CONFIG[toolType];
  const schemaStr = config ? JSON.stringify(config.schema, null, 2) : '{ "title": "string", "content": "string" }';
  const examplesStr = templateExamples
    .slice(0, 2)
    .map((ex, i) => `Example ${i + 1}:\n${JSON.stringify(ex, null, 2)}`)
    .join('\n\n');
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
      results.push(...partial);
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

export async function extractAndGenerateAllItems(toolType, rawPdfText, params = {}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = String(rawPdfText || '').trim();
  if (!text) return [];

  if (toolType === 'activity-project-generator') {
    const workbookActivities = extractActivitiesFromCuriosityWorkbookPdf(text);
    if (workbookActivities && workbookActivities.length > 0) {
      return workbookActivities
        .map((row) => ({ ...row, _fromPdf: true }))
        .sort((a, b) => Number(a.sl_no || 0) - Number(b.sl_no || 0));
    }
  }

  const extractPrompt = buildPdfExtractPrompt(toolType, text, params);
  let extractedItems = [];
  try {
    const extractRaw = await callChatCompletions({
      messages: [
        { role: 'system', content: 'You are a JSON extraction engine. Return ONLY a valid JSON array.' },
        { role: 'user', content: extractPrompt },
      ],
      temperature: 0.05,
      maxTokens: 8000,
      preferJson: false,
    });
    const parsed = JSON.parse(stripCodeFences(extractRaw));
    extractedItems = Array.isArray(parsed) ? parsed.map((item) => ({ ...item, _fromPdf: true })) : [];
  } catch (err) {
    console.error('[PDF] Phase 1 extraction failed:', err?.message || err);
    extractedItems = [];
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
  if (!missingItems.length) {
    return extractedItems.sort((a, b) => Number(a.sl_no || a.question_number || 0) - Number(b.sl_no || b.question_number || 0));
  }

  const templateExamples = extractedItems.slice(0, 2);
  let generatedItems = [];

  if (missingItems.length > 0) {
    if (toolType === 'activity-project-generator') {
      const batch = await generateMissingActivitiesInOneCall(toolType, missingItems, templateExamples, params);
      if (batch && batch.length === missingItems.length) {
        generatedItems = batch;
      }
    }
    if (!generatedItems.length) {
      const itemGapMs = Math.max(0, Math.min(30_000, Number(process.env.GEMINI_PDF_ITEM_DELAY_MS) || 2000));
      for (let i = 0; i < missingItems.length; i += 1) {
        const { number, title } = missingItems[i];
        try {
          const genPrompt = buildSingleItemGenerationPrompt(toolType, number, title, templateExamples, params);
          const genRaw = await callChatCompletions({
            messages: [
              { role: 'system', content: 'Return ONLY one valid JSON object.' },
              { role: 'user', content: genPrompt },
            ],
            temperature: 0.35,
            maxTokens: 1800,
            preferJson: false,
          });
          const genItem = JSON.parse(stripCodeFences(genRaw));
          if (genItem && typeof genItem === 'object' && !Array.isArray(genItem)) {
            generatedItems.push({
              ...genItem,
              sl_no: genItem.sl_no || number,
              question_number: genItem.question_number || number,
              title: genItem.title || title,
              name: genItem.name || title,
              _fromPdf: false,
            });
          }
        } catch (err) {
          console.error(`[PDF] Generation failed for ${number}:`, err?.message || err);
          generatedItems.push({
            sl_no: number,
            question_number: number,
            title,
            name: title,
            _fromPdf: false,
          });
        }
        if (itemGapMs > 0 && i + 1 < missingItems.length) {
          await sleep(itemGapMs);
        }
      }
    }
  }

  return [...extractedItems, ...generatedItems].sort(
    (a, b) => Number(a.sl_no || a.question_number || 0) - Number(b.sl_no || b.question_number || 0),
  );
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
