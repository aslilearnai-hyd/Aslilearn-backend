import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import { VALID_SCHOOL_BOARDS, isValidSchoolBoard } from '../constants/boards.js';
import {
  GEMINI_LITE_MODEL,
  GEMINI_FLASH_PREVIEW_MODEL,
  isRetiredOrUnsupportedGeminiModel,
  resolveAllowedGeminiModel,
} from '../services/gemini-models.js';
import {
  normalizeDifficulty,
  normalizeQuestionCategory,
} from '../utils/advancedExamAnalytics.js';
import {
  nextQuestionDisplayOrder,
  ensureExamQuestionDisplayOrders,
  moveQuestionToDisplayOrder,
  QUESTION_LIST_SORT,
  subjectSectionLabel,
} from '../utils/exam-question-order.js';
import { normalizeClassNumberLabel } from '../utils/studentClassContent.js';

const QUESTION_CATEGORY_CSV_VALUES = [
  'Numerical',
  'Theory',
  'Formula',
  'Diagram',
  'Graph',
  'Assertion/Reason',
  'Comprehension',
  'Match the Following',
];

const GEMINI_BASE_URL = String(
  process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
)
  .trim()
  .replace(/\/+$/, '');
const DEFAULT_GEMINI_MODEL = GEMINI_LITE_MODEL;

function getGeminiApiKey() {
  return String(process.env.VIDYA_AI_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
}

function getGeminiModelCandidates() {
  const preferred = String(process.env.VIDYA_AI_GEMINI_MODEL || '').trim();
  const singleFallback = String(process.env.GEMINI_FALLBACK_MODEL || '').trim();
  const listFallback = String(process.env.VIDYA_AI_GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  const defaults = [GEMINI_LITE_MODEL, GEMINI_FLASH_PREVIEW_MODEL];
  return Array.from(
    new Set(
      [preferred, singleFallback, ...listFallback, ...defaults]
        .map((m) => resolveAllowedGeminiModel(m))
        .filter(Boolean),
    ),
  );
}

/** Max tokens for PDF question extraction (large papers need headroom). */
function getPdfExtractionMaxOutputTokens() {
  const n = Number(process.env.GEMINI_PDF_EXTRACTION_MAX_TOKENS);
  if (Number.isFinite(n) && n >= 1024) return Math.min(n, 65536);
  return 32768;
}

/**
 * JSON schema for structured extraction (Gemini responseMimeType + responseSchema).
 * Enums force MCQ | MSQ | integer only.
 */
/** Canonical subject slugs used across exams (PDF extraction normalizes into these or ""). */
const CANONICAL_EXAM_SUBJECT_SLUGS = ['maths', 'physics', 'chemistry', 'biology'];

/**
 * Map model/PDF subject text to a canonical slug, or "" if unknown / not one of the four.
 * Does not use exam defaults.
 */
function normalizePdfSubjectField(raw) {
  let t = String(raw ?? '').trim().toLowerCase();
  if (!t) return '';
  const synonyms = {
    maths: 'maths',
    mathematics: 'maths',
    math: 'maths',
    physics: 'physics',
    chemistry: 'chemistry',
    biology: 'biology',
    biological: 'biology',
  };
  const v = synonyms[t] || t;
  return CANONICAL_EXAM_SUBJECT_SLUGS.includes(v) ? v : '';
}

const PDF_QUESTION_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questionText: { type: 'STRING', description: 'Full question stem only, no leading number.' },
    questionType: { type: 'STRING', enum: ['MCQ', 'MSQ', 'integer'] },
    subject: {
      type: 'STRING',
      description:
        'From PDF only: maths|physics|chemistry|biology lowercase slug when clear from headers/context; otherwise empty string.',
    },
    marks: { type: 'NUMBER' },
    option1: { type: 'STRING' },
    option2: { type: 'STRING' },
    option3: { type: 'STRING' },
    option4: { type: 'STRING' },
    correctAnswer: { type: 'STRING' },
    explanation: { type: 'STRING' },
  },
  required: [
    'questionText',
    'questionType',
    'subject',
    'marks',
    'option1',
    'option2',
    'option3',
    'option4',
    'correctAnswer',
    'explanation',
  ],
};

/** Gemini structured output requires an OBJECT root (not a bare ARRAY). */
const PDF_QUESTIONS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: PDF_QUESTION_ITEM_SCHEMA,
    },
  },
  required: ['questions'],
};

function normalizeMcqAnswerKey(s) {
  let t = String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2212\u2013\u2014]/g, '-') // unicode minus / en-dash / em-dash → hyphen
    .replace(/\s+/g, ' ')
    .trim();
  if (t.startsWith('(') && t.endsWith(')')) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/\s*,\s*/g, ',');
  return t;
}

/**
 * Map one answer token to an option index. `options` is `{ text }[]` (same shape as bulk upload).
 */
function mcqTokenToOptionIndex(token, options) {
  const normalizedToken = String(token || '').trim().toLowerCase();
  if (!normalizedToken || !Array.isArray(options) || options.length === 0) {
    return -1;
  }

  if (/^\d+$/.test(normalizedToken)) {
    const numeric = parseInt(normalizedToken, 10);
    if (numeric >= 1 && numeric <= options.length) return numeric - 1;
    if (numeric >= 0 && numeric < options.length) return numeric;
  }

  if (/^[a-z]$/.test(normalizedToken)) {
    const alphaIndex = normalizedToken.charCodeAt(0) - 97;
    if (alphaIndex >= 0 && alphaIndex < options.length) return alphaIndex;
  }

  const optionMatch = normalizedToken.match(/^option\s*([a-z0-9])$/);
  if (optionMatch) {
    const optionToken = optionMatch[1];
    if (/^\d$/.test(optionToken)) {
      const n = parseInt(optionToken, 10);
      if (n >= 1 && n <= options.length) return n - 1;
      if (n >= 0 && n < options.length) return n;
    }
    if (/^[a-z]$/.test(optionToken)) {
      const idx = optionToken.charCodeAt(0) - 97;
      if (idx >= 0 && idx < options.length) return idx;
    }
  }

  const textIndex = options.findIndex(
    (opt) => String(opt?.text || '').trim().toLowerCase() === normalizedToken,
  );
  if (textIndex >= 0) return textIndex;

  const key = normalizeMcqAnswerKey(token);
  if (!key) return -1;

  const optionKeys = options.map((opt) => normalizeMcqAnswerKey(opt?.text || ''));
  const exactKeyIdx = optionKeys.findIndex((k) => k === key);
  if (exactKeyIdx >= 0) return exactKeyIdx;

  const containsIdx = optionKeys.findIndex((k) => k && (k.includes(key) || key.includes(k)));
  if (containsIdx >= 0) return containsIdx;

  return -1;
}

function stripPdfQuestionLeadingIndex(text) {
  return String(text || '')
    .replace(/^\s*(?:q(?:uestion)?\s*)?\d+[\.)]\s*/i, '')
    .trim();
}

/** Strip (A) / A. / a) style prefixes from option cells. */
function stripPdfOptionPrefix(text) {
  return String(text || '')
    .replace(/^\s*\(?([a-dA-D])\)?[\.\)]\s*/, '')
    .trim();
}

/**
 * Normalize Gemini PDF rows: clean labels, canonicalize subject (or ""), align correctAnswer to option text.
 * Never fills subject from exam or other defaults.
 */
function postProcessGeminiPdfQuestionRows(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((r) => {
      const questionText = stripPdfQuestionLeadingIndex(String(r?.questionText || '').trim());
      if (!questionText) return null;

      let qt = String(r?.questionType || '').trim().toUpperCase();
      if (qt === 'MULTIPLE' || qt === 'MULTI') qt = 'MSQ';
      if (!['MCQ', 'MSQ', 'INTEGER'].includes(qt)) qt = 'MCQ';

      const subject = normalizePdfSubjectField(r?.subject);

      let marks = Number(r?.marks);
      if (!Number.isFinite(marks) || marks <= 0) marks = 1;

      const o1 = stripPdfOptionPrefix(String(r?.option1 ?? '').trim());
      const o2 = stripPdfOptionPrefix(String(r?.option2 ?? '').trim());
      const o3 = stripPdfOptionPrefix(String(r?.option3 ?? '').trim());
      const o4 = stripPdfOptionPrefix(String(r?.option4 ?? '').trim());
      const explanation = String(r?.explanation ?? '').trim();

      const slots = [o1, o2, o3, o4];
      const nonEmpty = slots.map((s) => s.trim()).filter(Boolean);

      if (qt === 'INTEGER') {
        const ca = String(r?.correctAnswer ?? '').trim();
        return {
          questionText,
          questionType: 'INTEGER',
          subject,
          marks,
          option1: '',
          option2: '',
          option3: '',
          option4: '',
          correctAnswer: ca,
          explanation,
        };
      }

      if (nonEmpty.length < 2) {
        const ca = String(r?.correctAnswer ?? '').trim();
        if (qt === 'MCQ' && ca && /^-?\d+(\.\d+)?$/.test(ca.trim())) {
          return {
            questionText,
            questionType: 'INTEGER',
            subject,
            marks,
            option1: '',
            option2: '',
            option3: '',
            option4: '',
            correctAnswer: ca.trim(),
            explanation,
          };
        }
        return null;
      }

      const optionsAsObjects = nonEmpty.map((text) => ({ text }));
      let correctAnswer = String(r?.correctAnswer ?? '').trim();

      if (qt === 'MSQ') {
        const parts = correctAnswer
          .split(/[;,]/)
          .map((p) => p.trim())
          .filter(Boolean);
        const resolved = [];
        const seen = new Set();
        for (const p of parts) {
          const idx = mcqTokenToOptionIndex(p, optionsAsObjects);
          const text = idx >= 0 ? nonEmpty[idx] : p;
          const k = text.trim().toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            resolved.push(text);
          }
        }
        correctAnswer = resolved.join(', ');
      } else {
        const idx = mcqTokenToOptionIndex(correctAnswer, optionsAsObjects);
        if (idx >= 0) correctAnswer = nonEmpty[idx];
      }

      return {
        questionText,
        questionType: qt,
        subject,
        marks,
        option1: slots[0] || '',
        option2: slots[1] || '',
        option3: slots[2] || '',
        option4: slots[3] || '',
        correctAnswer,
        explanation,
      };
    })
    .filter(Boolean);
}

async function safeGeminiErrorText(response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw;
  } catch {
    return raw;
  }
}

function dedupePdfQuestionRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const key = String(r?.questionText || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function extractQuestionsFromPdfViaGemini({
  buffer,
  mimeType = 'application/pdf',
}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'Gemini API key is missing on the server. Set GEMINI_API_KEY or VIDYA_AI_GEMINI_API_KEY in ASLI-STUD-BACK .env, then restart pm2 (asli-api).',
    );
  }
  const modelCandidates = getGeminiModelCandidates().slice(0, 4);
  if (modelCandidates.length === 0) {
    throw new Error('No Gemini model configured');
  }
  console.log('[PDF_EXAM_EXTRACT] starting', {
    models: modelCandidates,
    bytes: buffer?.length || 0,
    mimeType,
  });

  const buildPrompt = (rangeHint = '') => `Extract exam questions from this PDF and return ONLY valid JSON.
Preferred shape: {"questions":[ ... ]}. A bare JSON array of question objects is also accepted.
Each question object must have these exact keys:
questionText, questionType (MCQ/MSQ/integer), subject, marks (number), option1, option2, option3, option4, correctAnswer, explanation.

${rangeHint}

Important rules:
- Extract EVERY matching question in scope (do not stop early).
- SKIP answer-key / "Test Key" pages and rough-work pages.
- Include Single Correct, Multi Correct (MSQ), Assertion-Reason, Case-based, and Match-the-Following when they have options a)–d).
- For Match-the-Following, put the matching codes into option1–option4 (e.g. "A-2, B-4, C-1, D-3").
- For subject: read from PDF section headers (Mathematics→maths, Physics→physics, Chemistry→chemistry, Biology→biology). Otherwise "".
- For MCQ: correctAnswer is the full text of the correct option (not only a letter), when the key is visible; else best effort from the paper.
- For MSQ: correctAnswer is comma-separated correct option texts.
- For integer: correctAnswer is the numeric answer; options can be empty strings.
- Strip leading "Q1." / "1." from questionText only. Strip "A." / "(a)" prefixes from option bodies.
- Return only valid JSON, no markdown, no explanation.`;

  const maxOut = getPdfExtractionMaxOutputTokens();
  const attemptErrors = [];
  let sawQuotaError = false;
  let sawDeniedError = false;
  const requestTimeoutMs = Number(process.env.GEMINI_PDF_REQUEST_TIMEOUT_MS) || 120000;

  const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const parseGeminiJsonArray = (data, modelLabel) => {
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      attemptErrors.push(`${modelLabel}: output truncated (MAX_TOKENS); will retry in smaller chunks`);
    }
    if (data?.promptFeedback?.blockReason) {
      attemptErrors.push(`${modelLabel}: blocked (${data.promptFeedback.blockReason})`);
      return null;
    }
    const raw = String(
      (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim(),
    );
    if (!raw) {
      attemptErrors.push(
        `${modelLabel}: empty model response (finishReason=${finishReason || 'none'})`,
      );
      return null;
    }
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Truncated JSON is common on large papers — keep going with chunked retries.
      attemptErrors.push(`${modelLabel}: returned invalid JSON (often truncated)`);
      return null;
    }
    if (Array.isArray(parsed)) return { rows: parsed, finishReason };
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.questions)) return { rows: parsed.questions, finishReason };
      if (Array.isArray(parsed.items)) return { rows: parsed.items, finishReason };
      if (Array.isArray(parsed.data)) return { rows: parsed.data, finishReason };
    }
    attemptErrors.push(`${modelLabel}: did not return a JSON array`);
    return null;
  };

  const tryModelWithPrompt = async (model, promptText, useStructured) => {
    const generationConfig = {
      temperature: 0,
      topP: 0.95,
      maxOutputTokens: maxOut,
      ...(useStructured
        ? {
            responseMimeType: 'application/json',
            responseSchema: PDF_QUESTIONS_RESPONSE_SCHEMA,
          }
        : {}),
    };

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType,
                data: buffer.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig,
    };

    let response;
    try {
      response = await fetchWithTimeout(
        `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
    } catch (error) {
      return {
        ok: false,
        status: 408,
        errorText: error?.name === 'AbortError'
          ? `Gemini request timed out after ${requestTimeoutMs}ms`
          : String(error?.message || 'Gemini request failed'),
      };
    }

    if (!response.ok) {
      const errorText = await safeGeminiErrorText(response);
      return { ok: false, status: response.status, errorText };
    }

    const data = await response.json();
    const parsed = parseGeminiJsonArray(data, `${model}${useStructured ? '+schema' : ''}`);
    if (!parsed) return { ok: false, status: 200, errorText: 'parse failed', finishReason: data?.candidates?.[0]?.finishReason };
    return { ok: true, parsed: parsed.rows, finishReason: parsed.finishReason };
  };

  const extractOnce = async (model, rangeHint) => {
    const promptText = buildPrompt(rangeHint);
    let result = await tryModelWithPrompt(model, promptText, true);
    if (result.ok && result.parsed) return result;

    if (result.status === 400 && /schema|mime|response/i.test(String(result.errorText || ''))) {
      attemptErrors.push(`${model}: structured output rejected (${result.errorText || result.status})`);
    } else if (!result.ok) {
      const errorText = result.errorText || '';
      const isQuota = result.status === 429 || /quota|resource_exhausted/i.test(errorText);
      const isDenied = result.status === 403 || /denied access|permission denied/i.test(errorText);
      sawQuotaError = sawQuotaError || isQuota;
      sawDeniedError = sawDeniedError || isDenied;
      attemptErrors.push(`${model}: ${result.status} ${errorText}`);
    }

    const loose = await tryModelWithPrompt(model, promptText, false);
    if (loose.ok && loose.parsed) return loose;
    if (!loose.ok) {
      const err2 = loose.errorText || '';
      const isQ2 = loose.status === 429 || /quota|resource_exhausted/i.test(err2);
      const isDenied2 = loose.status === 403 || /denied access|permission denied/i.test(err2);
      sawQuotaError = sawQuotaError || isQ2;
      sawDeniedError = sawDeniedError || isDenied2;
      attemptErrors.push(`${model} (no schema): ${loose.status} ${err2}`);
    }
    return { ok: false, parsed: null, finishReason: result.finishReason || loose.finishReason };
  };

  // Large multi-subject papers (e.g. 80 Qs) truncate in one Gemini response.
  // Use number-range chunks and merge so we get the full set.
  const RANGE_CHUNKS = [
    [1, 20],
    [21, 40],
    [41, 60],
    [61, 80],
    [81, 120],
  ];

  for (const model of modelCandidates) {
    const collected = [];
    let truncated = false;

    const full = await extractOnce(
      model,
      'Scope: extract ALL questions from the question paper body (not the answer key).',
    );
    if (full.ok && Array.isArray(full.parsed)) {
      collected.push(...full.parsed);
      if (full.finishReason === 'MAX_TOKENS') truncated = true;
    }

    let refined = postProcessGeminiPdfQuestionRows(collected);
    const likelyIncomplete = truncated || refined.length < 50 || refined.length === 0;

    if (likelyIncomplete) {
      console.log('[PDF_EXAM_EXTRACT] chunking by question ranges', {
        model,
        firstPass: refined.length,
        truncated,
      });
      for (const [from, to] of RANGE_CHUNKS) {
        const chunk = await extractOnce(
          model,
          `Scope: extract ONLY questions numbered ${from} through ${to} (inclusive). Skip any question outside this range. Skip answer-key pages.`,
        );
        if (chunk.ok && Array.isArray(chunk.parsed)) {
          collected.push(...chunk.parsed);
          if (chunk.finishReason === 'MAX_TOKENS') truncated = true;
        }
      }
      refined = postProcessGeminiPdfQuestionRows(collected);
    }

    refined = dedupePdfQuestionRows(refined);
    console.log('[PDF_EXAM_EXTRACT] model result', { model, count: refined.length, truncated });
    if (refined.length > 0) return refined;
    attemptErrors.push(`${model}: model returned rows but none passed validation after cleanup`);
  }

  if (sawDeniedError) {
    throw new Error(
      'Gemini PDF upload blocked: your Google AI project was denied access for these models (403). ' +
        'A working API key for short text does not guarantee PDF/multimodal access. ' +
        'Create a new key in Google AI Studio, enable billing if required, or contact Google support. ' +
        `Details: ${attemptErrors.join(' | ')}`,
    );
  }
  if (sawQuotaError) {
    throw new Error(
      'Gemini free-tier quota exhausted for PDF extraction (429). Wait ~1 minute and retry, ' +
        'or enable billing / use a paid plan in Google AI Studio. ' +
        `Details: ${attemptErrors.join(' | ')}`,
    );
  }
  throw new Error(`Gemini PDF extraction failed. Attempts: ${attemptErrors.join(' | ')}`);
}

/**
 * Keeps classNumber and assignedClasses in sync for API clients.
 * Handles legacy documents, string/array quirks, and numeric IDs from JSON.
 */
export function normalizeExamClassFields(exam) {
  if (!exam) return exam;
  const e =
    typeof exam.toObject === 'function'
      ? exam.toObject()
      : typeof exam === 'object'
        ? { ...exam }
        : exam;

  let classes = [];
  const ac = e.assignedClasses;
  if (typeof ac === 'string' && ac.trim()) {
    const s = ac.trim();
    if (s.includes('|')) {
      classes = s.split('|').map((c) => c.trim()).filter(Boolean);
    } else if (s.includes(',')) {
      classes = s.split(',').map((c) => c.trim()).filter(Boolean);
    } else {
      classes = [s];
    }
  } else if (Array.isArray(ac) && ac.length > 0) {
    classes = ac.map((c) => String(c).trim()).filter(Boolean);
  } else if (ac != null && typeof ac === 'object' && !Array.isArray(ac)) {
    classes = Object.values(ac)
      .map((c) => String(c).trim())
      .filter(Boolean);
  }

  let cn =
    e.classNumber != null && String(e.classNumber).trim() !== ''
      ? String(e.classNumber).trim()
      : '';

  if (classes.length === 0 && cn) {
    classes = [cn];
  }
  if (classes.length > 0 && !cn) {
    cn = classes[0];
  }

  e.assignedClasses = classes;
  e.classNumber = cn;

  const normalizedSubjects = normalizeExamSubjects(e.subject, e.subjects)
    .map((s) => normalizeExamSubjectKey(s))
    .filter((s) => ALLOWED_EXAM_SUBJECTS.includes(s));
  if (normalizedSubjects.length > 0) {
    e.subjects = normalizedSubjects;
    e.subject = normalizedSubjects[0];
  } else {
    const fallbackSubject = normalizeExamSubjectKey(e.subject || 'maths');
    e.subject = ALLOWED_EXAM_SUBJECTS.includes(fallbackSubject) ? fallbackSubject : 'maths';
    e.subjects = [e.subject];
  }

  return e;
}

const ALLOWED_EXAM_SUBJECTS = [
  'maths',
  'physics',
  'chemistry',
  'biology',
  'science',
  'english',
  'hindi',
  'social_science',
];

/** Map CSV / UI subject labels to a stable exam subject key. */
function normalizeExamSubjectKey(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!s) return '';
  if (s === 'mathematics' || s === 'math') return 'maths';
  if (s === 'social science' || s === 'social studies' || s === 'sst' || s === 'socialscience') {
    return 'social_science';
  }
  if (s === 'bio') return 'biology';
  return s.replace(/\s+/g, '_');
}

const buildSafeAppendQuestionsPipeline = ({ questionIds = [] }) => {
  const ids = Array.isArray(questionIds) ? questionIds.filter(Boolean) : [];
  return [
    {
      $set: {
        questions: {
          $cond: [{ $isArray: '$questions' }, '$questions', []],
        },
      },
    },
    {
      $set: {
        // Keep Exam.totalQuestions / totalMarks as planned caps — do not bump them here.
        questions: { $concatArrays: ['$questions', ids] },
      },
    },
  ];
};

const buildSafeRemoveQuestionPipeline = ({ questionId }) => [
  {
    $set: {
      questions: {
        $cond: [{ $isArray: '$questions' }, '$questions', []],
      },
    },
  },
  {
    $set: {
      questions: {
        $filter: {
          input: '$questions',
          as: 'questionId',
          cond: { $ne: ['$$questionId', questionId] },
        },
      },
    },
  },
];

/** Actual uploaded question count + marks sum (not the planned exam caps). */
const getExamActualTotals = async (examId) => {
  const oid = mongoose.Types.ObjectId.isValid(examId)
    ? new mongoose.Types.ObjectId(examId)
    : examId;
  const [totals] = await Question.aggregate([
    { $match: { exam: oid } },
    {
      $group: {
        _id: '$exam',
        questionCount: { $sum: 1 },
        marksSum: { $sum: { $ifNull: ['$marks', 0] } },
      },
    },
  ]);
  return {
    questionCount: Number(totals?.questionCount) || 0,
    marksSum: Number(totals?.marksSum) || 0,
  };
};

/**
 * Keep Exam.questions array in sync with Question docs.
 * Never overwrite planned totalQuestions / totalMarks (those are admin caps).
 */
const syncExamQuestionTotals = async (examId) => {
  const ids = await Question.find({ exam: examId }).select('_id').lean();
  await Exam.updateOne(
    { _id: examId },
    { $set: { questions: ids.map((q) => q._id) } },
  );
};

/** Reject when next count/marks would exceed exam planned caps. */
const assertWithinExamCaps = (exam, { nextQuestionCount, nextMarksSum }) => {
  const maxQuestions = Number(exam?.totalQuestions);
  const maxMarks = Number(exam?.totalMarks);
  const hasQuestionCap = Number.isFinite(maxQuestions) && maxQuestions > 0;
  const hasMarksCap = Number.isFinite(maxMarks) && maxMarks > 0;

  if (hasQuestionCap && nextQuestionCount > maxQuestions) {
    const err = new Error(
      `Cannot exceed Total Questions (${maxQuestions}). This exam already has questions at the limit or the upload would go over.`,
    );
    err.status = 400;
    err.code = 'EXAM_QUESTION_CAP';
    throw err;
  }
  if (hasMarksCap && nextMarksSum > maxMarks) {
    const err = new Error(
      `Cannot exceed Total Marks (${maxMarks}). Reduce question marks or raise the exam Total Marks.`,
    );
    err.status = 400;
    err.code = 'EXAM_MARKS_CAP';
    throw err;
  }
};

function buildQuestionDedupKey({
  examId,
  subject,
  questionType,
  questionText,
  questionImage,
}) {
  const textKey = String(questionText || '').trim().toLowerCase();
  const imageKey = String(questionImage || '').trim();
  // Use BOTH text and image. Image questions often share the same/empty caption;
  // `text || image` falsely treated different figures as duplicates and
  // "replace duplicate" deleted the previous question (e.g. Q14 removed when adding Q15).
  const contentKey = `${textKey}||${imageKey}`;
  return [String(examId), String(subject || '').trim().toLowerCase(), String(questionType || '').trim().toLowerCase(), contentKey].join('::');
}

function normalizeExamSubjects(subject, subjects) {
  const listFromSubjects = Array.isArray(subjects)
    ? subjects
    : subjects !== undefined && subjects !== null
      ? [subjects]
      : [];
  const merged = [...listFromSubjects, subject];
  const normalized = Array.from(
    new Set(
      merged
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
  return normalized;
}

// Create Exam (Super Admin only)
export const createExam = async (req, res) => {
  try {
    console.log('📝 createExam controller called');
    console.log('Request body:', req.body);
    console.log('Request user:', req.user);
    
    const { 
      title, 
      description, 
      examType, 
      classNumber,
      assignedClasses,
      subject,
      subjects,
      maxAttempts,
      duration, 
      totalQuestions, 
      totalMarks, 
      instructions, 
      startDate, 
      endDate,
      board,
      targetSchools,
      isSchoolSpecific,
      isBoardSpecific,
      isAllBoards
    } = req.body;

    console.log('📝 Creating exam by Super Admin:', { title, examType, board });

    // Validation
    const normalizedAssignedClasses = Array.isArray(assignedClasses)
      ? assignedClasses
          .map((c) => normalizeClassNumberLabel(c) || String(c).trim())
          .filter(Boolean)
      : classNumber
        ? [normalizeClassNumberLabel(classNumber) || String(classNumber).trim()].filter(Boolean)
        : [];

    const normalizedSubjects = normalizeExamSubjects(subject, subjects);

    if (!title || !examType || normalizedAssignedClasses.length === 0 || normalizedSubjects.length === 0 || !maxAttempts || !duration || !totalQuestions || !totalMarks || !board) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: title, examType, assignedClasses, subject(s), maxAttempts, duration, totalQuestions, totalMarks, and board are required' 
      });
    }

    if (!['weekend', 'mains', 'advanced', 'practice'].includes(examType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid examType. Must be one of: weekend, mains, advanced, practice' 
      });
    }

    const examBoardUpper = board.toUpperCase().trim();
    if (!isValidSchoolBoard(examBoardUpper)) {
      return res.status(400).json({
        success: false,
        message: `Invalid board. Must be one of: ${VALID_SCHOOL_BOARDS.join(', ')}`,
      });
    }

    const invalidSubjects = normalizedSubjects.filter((s) => !ALLOWED_EXAM_SUBJECTS.includes(s));
    if (invalidSubjects.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject(s): ${invalidSubjects.join(', ')}. Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`
      });
    }

    const parsedMaxAttempts = parseInt(maxAttempts, 10);
    if (Number.isNaN(parsedMaxAttempts) || parsedMaxAttempts < 1) {
      return res.status(400).json({
        success: false,
        message: 'maxAttempts must be a number greater than or equal to 1'
      });
    }

    // For Super Admin, we need a valid ObjectId for createdBy
    // Since Super Admin doesn't have a User document, we'll create a dummy ObjectId
    // or handle it differently. Let's use mongoose.Types.ObjectId to create a valid ID
    let createdById = req.userId;
    
    // If userId is not a valid ObjectId (e.g., 'super-admin-001'), create a new one
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      // Create a consistent ObjectId for super admin
      // Using a fixed seed to ensure consistency
      createdById = new mongoose.Types.ObjectId();
      console.log('⚠️ Created new ObjectId for Super Admin:', createdById);
    }

    // Create exam
    const examData = {
      title: title.trim(),
      description: description?.trim() || '',
      examType,
      classNumber: normalizedAssignedClasses[0],
      assignedClasses: normalizedAssignedClasses,
      subject: normalizedSubjects[0],
      subjects: normalizedSubjects,
      maxAttempts: parsedMaxAttempts,
      duration: parseInt(duration),
      totalQuestions: parseInt(totalQuestions),
      totalMarks: parseInt(totalMarks),
      instructions: instructions?.trim() || '',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      board: examBoardUpper,
      createdByRole: 'super-admin',
      createdBy: createdById,
      isActive: true,
      isSchoolSpecific: isSchoolSpecific || false,
      isBoardSpecific: isBoardSpecific || false,
      // Cross-board only when explicitly requested — never treat "all schools" as all boards.
      isAllBoards: Boolean(isAllBoards) && !Boolean(isSchoolSpecific),
    };

    // Add target schools if provided
    if (isSchoolSpecific && targetSchools && Array.isArray(targetSchools) && targetSchools.length > 0) {
      examData.targetSchools = targetSchools.map((id) => {
        // Convert to ObjectId if valid
        if (mongoose.Types.ObjectId.isValid(id)) {
          return new mongoose.Types.ObjectId(id);
        }
        return id;
      });
      examData.schoolId = examData.targetSchools[0];
    }

    const newExam = new Exam(examData);

    await newExam.save();

    console.log('✅ Exam created successfully:', newExam._id);

    const persisted = await Exam.findById(newExam._id)
      .populate('questions')
      .populate('targetSchools', 'schoolName fullName email');

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: normalizeExamClassFields(persisted || newExam)
    });
  } catch (error) {
    console.error('❌ Create exam error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create exam',
      error: error.message 
    });
  }
};

// Get All Exams (Super Admin - all boards)
export const getAllExams = async (req, res) => {
  try {
    console.log('📋 getAllExams controller called');
    const { board, schoolIds, classNumbers } = req.query;
    
    // Soft-deleted exams set isActive=false; hide them from management lists.
    let query = { createdByRole: 'super-admin', isActive: { $ne: false } };
    const conditions = [];
    
    // Filter by board if provided, but include all-boards exams too
    if (board && isValidSchoolBoard(board)) {
      const bUpper = String(board).toUpperCase().trim();
      conditions.push({
        $or: [
          { isAllBoards: true }, // Include exams available to all boards
          { board: bUpper } // Include exams specific to the selected board
        ]
      });
    }
    
    // Filter by school IDs if provided
    if (schoolIds) {
      const schoolIdArray = Array.isArray(schoolIds) ? schoolIds : schoolIds.split(',');
      const schoolObjectIds = schoolIdArray.map((id) => {
        // Handle both string IDs and ObjectIds
        if (mongoose.Types.ObjectId.isValid(id)) {
          return new mongoose.Types.ObjectId(id);
        }
        return id;
      });
      
      conditions.push({
        $or: [
          { isSchoolSpecific: { $ne: true } }, // Include exams available to all schools
          { 
            isSchoolSpecific: true,
            targetSchools: { $in: schoolObjectIds }
          }
        ]
      });
    }

    // Filter by class numbers if provided (supports both new assignedClasses and legacy classNumber)
    if (classNumbers) {
      const classList = (Array.isArray(classNumbers) ? classNumbers : classNumbers.split(','))
        .map((c) => String(c).trim())
        .filter(Boolean);

      if (classList.length > 0) {
        conditions.push({
          $or: [
            { assignedClasses: { $in: classList } },
            { classNumber: { $in: classList } }
          ]
        });
      }
    }
    
    // Combine all conditions with $and
    if (conditions.length > 0) {
      query.$and = conditions;
    }
    
    console.log('🔍 Query:', JSON.stringify(query, null, 2));
    
    const exams = await Exam.find(query)
      .populate('questions')
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ createdAt: -1 });

    const examIds = exams.map((ex) => ex._id);
    const actualByExam = new Map();
    if (examIds.length) {
      const actualRows = await Question.aggregate([
        { $match: { exam: { $in: examIds } } },
        {
          $group: {
            _id: '$exam',
            questionCount: { $sum: 1 },
            marksSum: { $sum: { $ifNull: ['$marks', 0] } },
          },
        },
      ]);
      for (const row of actualRows) {
        actualByExam.set(String(row._id), {
          actualQuestionCount: Number(row.questionCount) || 0,
          actualMarksSum: Number(row.marksSum) || 0,
        });
      }
    }

    const normalizedExams = exams.map((ex) => {
      const base = normalizeExamClassFields(ex);
      const actual = actualByExam.get(String(ex._id)) || {
        actualQuestionCount: Array.isArray(ex.questions) ? ex.questions.length : 0,
        actualMarksSum: 0,
      };
      return { ...base, ...actual };
    });

    console.log(`✅ Found ${normalizedExams.length} exams`);
    if (schoolIds) {
      console.log(`📚 Filtering by schools: ${schoolIds}`);
      normalizedExams.forEach(exam => {
        console.log(`  - Exam: ${exam.title}, isSchoolSpecific: ${exam.isSchoolSpecific}, targetSchools: ${exam.targetSchools?.map(s => s._id || s).join(', ')}`);
      });
    }
    res.json({
      success: true,
      data: normalizedExams
    });
  } catch (error) {
    console.error('❌ Get all exams error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
};

// Get Exams by Board (Super Admin)
export const getExamsByBoard = async (req, res) => {
  try {
    console.log('📋 getExamsByBoard controller called');
    console.log('Board code from params:', req.params.boardCode);
    const { boardCode } = req.params;

    const bc = String(boardCode || '').toUpperCase().trim();
    if (!isValidSchoolBoard(bc)) {
      console.log('❌ Invalid board code:', boardCode);
      return res.status(400).json({ success: false, message: 'Invalid board code' });
    }

    const exams = await Exam.find({ 
      board: bc,
      createdByRole: 'super-admin',
      isActive: { $ne: false },
    })
      .populate('questions')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: exams.map((ex) => normalizeExamClassFields(ex))
    });
  } catch (error) {
    console.error('Get exams by board error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
};

// Update Exam (Super Admin)
export const updateExam = async (req, res) => {
  try {
    const { examId } = req.params;
    console.log('📝 updateExam controller called');
    console.log('Update examId:', examId);
    console.log('Update request body:', JSON.stringify(req.body, null, 2));
    const { 
      title, 
      description, 
      examType, 
      classNumber,
      assignedClasses,
      subject,
      subjects,
      maxAttempts,
      duration, 
      totalQuestions, 
      totalMarks, 
      instructions, 
      startDate, 
      endDate,
      board,
      isActive 
    } = req.body;

    const exam = await Exam.findById(examId);

    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const oldValues = {
      classNumber: exam.classNumber,
      assignedClasses: exam.assignedClasses,
      subject: exam.subject
    };

    // Update fields
    if (title) exam.title = title.trim();
    if (description !== undefined) exam.description = description?.trim() || '';
    if (examType) exam.examType = examType;
    if (assignedClasses !== undefined) {
      const normalizedAssignedClasses = (Array.isArray(assignedClasses) ? assignedClasses : [assignedClasses])
        .map((c) => normalizeClassNumberLabel(c) || String(c).trim())
        .filter(Boolean);

      if (normalizedAssignedClasses.length === 0) {
        return res.status(400).json({ success: false, message: 'assignedClasses must contain at least one class' });
      }

      exam.assignedClasses = normalizedAssignedClasses;
      exam.classNumber = normalizedAssignedClasses[0];
    } else if (classNumber !== undefined) {
      const normalizedClass = normalizeClassNumberLabel(classNumber) || String(classNumber).trim();
      if (!normalizedClass) {
        return res.status(400).json({ success: false, message: 'classNumber cannot be empty' });
      }
      exam.classNumber = normalizedClass;
      exam.assignedClasses = [normalizedClass];
    }
    if (subject !== undefined || subjects !== undefined) {
      const normalizedSubjects = normalizeExamSubjects(subject, subjects);
      if (normalizedSubjects.length === 0) {
        return res.status(400).json({ success: false, message: 'subject(s) cannot be empty' });
      }
      const invalidSubjects = normalizedSubjects.filter((s) => !ALLOWED_EXAM_SUBJECTS.includes(s));
      if (invalidSubjects.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid subject(s): ${invalidSubjects.join(', ')}. Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`
        });
      }
      exam.subject = normalizedSubjects[0];
      exam.subjects = normalizedSubjects;
    }
    if (maxAttempts !== undefined) {
      const parsedMaxAttempts = parseInt(maxAttempts, 10);
      if (Number.isNaN(parsedMaxAttempts) || parsedMaxAttempts < 1) {
        return res.status(400).json({ success: false, message: 'maxAttempts must be a number greater than or equal to 1' });
      }
      exam.maxAttempts = parsedMaxAttempts;
    }
    if (duration !== undefined && duration !== null && String(duration).trim() !== '') {
      const parsedDuration = parseInt(duration, 10);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 1) {
        return res.status(400).json({ success: false, message: 'duration must be a number >= 1' });
      }
      exam.duration = parsedDuration;
    }
    if (totalQuestions !== undefined && totalQuestions !== null && String(totalQuestions).trim() !== '') {
      const parsedTQ = parseInt(totalQuestions, 10);
      if (!Number.isFinite(parsedTQ) || parsedTQ < 1) {
        return res.status(400).json({ success: false, message: 'totalQuestions must be a number >= 1' });
      }
      const actual = await getExamActualTotals(examId);
      if (parsedTQ < actual.questionCount) {
        return res.status(400).json({
          success: false,
          message: `Total Questions cannot be less than uploaded questions (${actual.questionCount}). Delete questions first or set Total Questions to at least ${actual.questionCount}.`,
        });
      }
      exam.totalQuestions = parsedTQ;
    }
    if (totalMarks !== undefined && totalMarks !== null && String(totalMarks).trim() !== '') {
      const parsedTM = parseInt(totalMarks, 10);
      if (!Number.isFinite(parsedTM) || parsedTM < 1) {
        return res.status(400).json({ success: false, message: 'totalMarks must be a number >= 1' });
      }
      const actual = await getExamActualTotals(examId);
      if (parsedTM < actual.marksSum) {
        return res.status(400).json({
          success: false,
          message: `Total Marks cannot be less than uploaded question marks (${actual.marksSum}). Lower question marks or set Total Marks to at least ${actual.marksSum}.`,
        });
      }
      exam.totalMarks = parsedTM;
    }
    if (instructions !== undefined) exam.instructions = instructions?.trim() || '';
    if (startDate) exam.startDate = new Date(startDate);
    if (endDate) exam.endDate = new Date(endDate);
    if (board !== undefined && board !== null && String(board).trim() !== '') {
      const bu = String(board).toUpperCase().trim();
      if (!isValidSchoolBoard(bu)) {
        return res.status(400).json({
          success: false,
          message: `Invalid board. Must be one of: ${VALID_SCHOOL_BOARDS.join(', ')}`,
        });
      }
      exam.board = bu;
    }
    if (isActive !== undefined) exam.isActive = Boolean(isActive);

    const { targetSchools: tsBody, isSchoolSpecific: issBody, isAllBoards: iabBody } = req.body;
    if (tsBody !== undefined && Array.isArray(tsBody)) {
      exam.targetSchools = tsBody
        .filter((id) => id != null && id !== '')
        .map((id) =>
          mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
        );
    }
    if (issBody !== undefined) exam.isSchoolSpecific = Boolean(issBody);
    if (iabBody !== undefined) exam.isAllBoards = Boolean(iabBody);
    if (exam.isSchoolSpecific) exam.isAllBoards = false;
    if (exam.targetSchools?.length) {
      exam.schoolId = exam.targetSchools[0];
    } else if (!exam.isSchoolSpecific) {
      exam.schoolId = undefined;
    }

    // Backfill legacy exams so schema-required fields are always present.
    if (!exam.classNumber) exam.classNumber = '10';
    if (!Array.isArray(exam.assignedClasses) || exam.assignedClasses.length === 0) exam.assignedClasses = [exam.classNumber];
    if (!exam.subject) exam.subject = 'maths';
    if (!Array.isArray(exam.subjects) || exam.subjects.length === 0) exam.subjects = [exam.subject];
    if (!exam.maxAttempts || exam.maxAttempts < 1) exam.maxAttempts = 1;

    await exam.save();
    const refreshedExam = await Exam.findById(examId).lean();

    console.log('✅ Update exam class persistence check:', {
      before: oldValues,
      after: {
        classNumber: refreshedExam?.classNumber,
        assignedClasses: refreshedExam?.assignedClasses,
        subject: refreshedExam?.subject
      }
    });

    res.json({
      success: true,
      message: 'Exam updated successfully',
      data: normalizeExamClassFields(refreshedExam || exam)
    });
  } catch (error) {
    console.error('Update exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to update exam' });
  }
};

// Delete Exam (Super Admin) — soft-delete so result history remains
export const deleteExam = async (req, res) => {
  try {
    const { examId } = req.params;

    const exam = await Exam.findById(examId);

    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    exam.isActive = false;
    await exam.save();
    await Question.updateMany({ exam: examId }, { $set: { isActive: false } });

    res.json({
      success: true,
      message: 'Exam deleted successfully'
    });
  } catch (error) {
    console.error('Delete exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete exam' });
  }
};

// Add Question to Exam (Super Admin)
export const addQuestion = async (req, res) => {
  try {
    console.log('📝 addQuestion controller called');
    console.log('Exam ID:', req.params.examId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request user:', req.user);
    
    const { examId } = req.params;
    const {
      questionText,
      questionImage,
      questionType,
      options,
      correctAnswer,
      marks,
      negativeMarks,
      explanation,
      subject,
      chapter,
      difficulty,
      questionCategory,
      conceptType,
      board,
      displayOrder: rawDisplayOrder,
      sectionHeading: rawSectionHeading,
      replaceDuplicate = false
    } = req.body;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      console.log('❌ Invalid exam ID format:', examId);
      return res.status(400).json({ success: false, message: 'Invalid exam ID format' });
    }

    const exam = await Exam.findById(examId);

    if (!exam) {
      console.log('❌ Exam not found:', examId);
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    if (exam.createdByRole !== 'super-admin') {
      console.log('❌ Exam not created by super-admin');
      return res.status(403).json({ success: false, message: 'Only super-admin created exams can be modified' });
    }

    console.log('✅ Exam found:', exam.title, 'Board:', exam.board);

    if (!questionText?.trim() && !questionImage) {
      return res.status(400).json({ success: false, message: 'Either question text or image is required' });
    }

    if ((questionType === 'mcq' || questionType === 'multiple') && (!options || options.length === 0)) {
      return res.status(400).json({ success: false, message: 'Options are required for MCQ and Multiple Choice questions' });
    }

    // Handle createdBy for Super Admin (same as exam creation)
    let createdById = req.userId;
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      createdById = new mongoose.Types.ObjectId();
      console.log('⚠️ Created new ObjectId for Super Admin question:', createdById);
    }

    // Format correctAnswer based on question type
    let formattedCorrectAnswer = correctAnswer;
    
    if (questionType === 'integer') {
      // Integer type: correctAnswer should be a number
      formattedCorrectAnswer = typeof correctAnswer === 'number' ? correctAnswer : parseInt(correctAnswer);
      if (isNaN(formattedCorrectAnswer)) {
        return res.status(400).json({ success: false, message: 'Invalid integer answer' });
      }
    } else if (questionType === 'multiple' && Array.isArray(correctAnswer)) {
      // For multiple choice, map the indices to option texts
      formattedCorrectAnswer = correctAnswer.map((idx) => {
        const optionIndex = parseInt(idx);
        if (!isNaN(optionIndex) && options && options[optionIndex]) {
          return options[optionIndex].text || options[optionIndex];
        }
        return idx;
      });
      // If no valid options found, use the indices as-is
      if (formattedCorrectAnswer.length === 0) {
        formattedCorrectAnswer = correctAnswer;
      }
    } else if (questionType === 'mcq' && options && options.length > 0) {
      // For single MCQ, convert index to option text
      const optionIndex = parseInt(correctAnswer);
      if (!isNaN(optionIndex) && options[optionIndex]) {
        formattedCorrectAnswer = options[optionIndex].text || options[optionIndex];
      } else {
        // If conversion fails, use as-is (might already be text)
        formattedCorrectAnswer = correctAnswer;
      }
    }

    // Validate correctAnswer is not empty/null/undefined
    if (formattedCorrectAnswer === null || formattedCorrectAnswer === undefined || 
        (typeof formattedCorrectAnswer === 'string' && formattedCorrectAnswer.trim() === '') ||
        (Array.isArray(formattedCorrectAnswer) && formattedCorrectAnswer.length === 0)) {
      console.log('❌ Invalid correctAnswer:', formattedCorrectAnswer);
      return res.status(400).json({ success: false, message: 'Correct answer is required and cannot be empty' });
    }

    console.log('📝 Creating question:', {
      questionType,
      subject,
      marks,
      board: board || exam.board,
      correctAnswer: formattedCorrectAnswer,
      optionsCount: options?.length || 0
    });

    // Ensure questionText is not empty string if questionImage is not provided
    const finalQuestionText = questionText?.trim() || '';
    const finalQuestionImage = questionImage?.trim() || null;

    if (!finalQuestionText && !finalQuestionImage) {
      return res.status(400).json({ success: false, message: 'Either question text or image is required' });
    }

    // Format options - ensure empty array for integer type. Each option is
    // stored as `{ text, isCorrect }`; tag the isCorrect flag based on the
    // formatted correctAnswer so consumers that read options[].isCorrect (e.g.
    // preview / legacy content generators) stay in sync with correctAnswer.
    const finalOptions = questionType === 'integer'
      ? []
      : (options || []).map((opt) => {
          const text = typeof opt === 'string' ? opt : (opt?.text ?? '');
          return { text: String(text), isCorrect: false };
        });

    if (questionType === 'mcq') {
      const correctText = String(formattedCorrectAnswer || '').trim().toLowerCase();
      const idx = finalOptions.findIndex(
        (o) => String(o.text || '').trim().toLowerCase() === correctText
      );
      if (idx >= 0) finalOptions[idx].isCorrect = true;
    } else if (questionType === 'multiple' && Array.isArray(formattedCorrectAnswer)) {
      const correctSet = new Set(
        formattedCorrectAnswer.map((t) => String(t).trim().toLowerCase())
      );
      finalOptions.forEach((o) => {
        if (correctSet.has(String(o.text || '').trim().toLowerCase())) {
          o.isCorrect = true;
        }
      });
    }

    // Validate marks / negativeMarks strictly instead of silently defaulting.
    let marksValue = 1;
    if (marks !== undefined && marks !== null && String(marks).trim() !== '') {
      const parsed = Number(marks);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid marks (must be a positive number)' });
      }
      marksValue = parsed;
    }

    let negativeMarksValue = 0;
    if (negativeMarks !== undefined && negativeMarks !== null && String(negativeMarks).trim() !== '') {
      const parsed = Number(negativeMarks);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ success: false, message: 'Invalid negativeMarks (must be a non-negative number)' });
      }
      negativeMarksValue = parsed;
    }

    const examSubjects = normalizeExamSubjects(exam.subject, exam.subjects)
      .filter((s) => ALLOWED_EXAM_SUBJECTS.includes(s));
    const normalizedQuestionSubject = String(subject || '').trim().toLowerCase() || examSubjects[0] || 'maths';

    if (!ALLOWED_EXAM_SUBJECTS.includes(normalizedQuestionSubject)) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject "${normalizedQuestionSubject}". Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`
      });
    }

    if (examSubjects.length > 0 && !examSubjects.includes(normalizedQuestionSubject)) {
      return res.status(400).json({
        success: false,
        message: `Question subject "${normalizedQuestionSubject}" is not allowed for this exam. Allowed subjects: ${examSubjects.join(', ')}`
      });
    }

    const duplicateKey = buildQuestionDedupKey({
      examId,
      subject: normalizedQuestionSubject,
      questionType,
      questionText: finalQuestionText,
      questionImage: finalQuestionImage,
    });
    const existingQuestions = await Question.find(
      { exam: examId, subject: normalizedQuestionSubject, questionType },
      { _id: 1, questionText: 1, questionImage: 1, marks: 1 }
    ).lean();
    const duplicateQuestion = existingQuestions.find((q) => {
      const key = buildQuestionDedupKey({
        examId,
        subject: normalizedQuestionSubject,
        questionType,
        questionText: q.questionText,
        questionImage: q.questionImage,
      });
      return key === duplicateKey;
    });
    if (duplicateQuestion && !replaceDuplicate) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate question already exists for this exam and subject',
        duplicateQuestionId: duplicateQuestion._id,
      });
    }

    if (duplicateQuestion && replaceDuplicate) {
      await Question.findByIdAndDelete(duplicateQuestion._id);
      await Exam.updateOne(
        { _id: examId },
        buildSafeRemoveQuestionPipeline({
          questionId: duplicateQuestion._id,
        })
      );
      console.log('♻️ Replacing duplicate question:', duplicateQuestion._id);
    }

    const actual = await getExamActualTotals(examId);
    try {
      assertWithinExamCaps(exam, {
        nextQuestionCount: actual.questionCount + 1,
        nextMarksSum: actual.marksSum + marksValue,
      });
    } catch (capErr) {
      return res.status(capErr.status || 400).json({
        success: false,
        message: capErr.message,
        code: capErr.code,
      });
    }

    const parsedDisplayOrder = Number(rawDisplayOrder);
    const displayOrder =
      Number.isFinite(parsedDisplayOrder) && parsedDisplayOrder >= 1
        ? Math.floor(parsedDisplayOrder)
        : await nextQuestionDisplayOrder(Question, examId);

    const sectionHeading =
      rawSectionHeading !== undefined && rawSectionHeading !== null
        ? String(rawSectionHeading).trim()
        : subjectSectionLabel(normalizedQuestionSubject);

    const question = new Question({
      questionText: finalQuestionText || undefined,
      questionImage: finalQuestionImage || undefined,
      questionType,
      options: finalOptions,
      correctAnswer: formattedCorrectAnswer,
      marks: marksValue,
      negativeMarks: negativeMarksValue,
      explanation: explanation?.trim() || undefined,
      subject: normalizedQuestionSubject,
      displayOrder,
      sectionHeading,
      chapter: String(chapter || '').trim() || 'General',
      difficulty: ['easy', 'moderate', 'difficult', 'highly_difficult'].includes(String(difficulty || '').toLowerCase())
        ? String(difficulty).toLowerCase()
        : undefined,
      questionCategory: String(questionCategory || '').trim() || undefined,
      conceptType: (() => {
        const raw = String(conceptType || '').trim().toLowerCase();
        if (raw.includes('application') || raw.includes('problem')) return 'Application';
        if (raw.includes('concept') || raw.includes('theory')) return 'Concept';
        return undefined;
      })(),
      exam: examId,
      board: (board || exam.board).toUpperCase(),
      createdBy: createdById
    });

    console.log('📝 Question object created, attempting to save...');

    await question.save();
    console.log('✅ Question saved:', question._id);

    // Add question to exam + keep totals consistent.
    await Exam.updateOne(
      { _id: examId },
      buildSafeAppendQuestionsPipeline({
        questionIds: [question._id],
      })
    );
    await syncExamQuestionTotals(examId);
    console.log('✅ Question added to exam');

    res.status(201).json({
      success: true,
      message: 'Question added successfully',
      data: question
    });
  } catch (error) {
    console.error('❌ Add question error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to add question',
      error: error.message 
    });
  }
};

// Bulk Upload Exams via CSV (Super Admin only)
export const bulkUploadExams = async (req, res) => {
  try {
    console.log('📝 bulkUploadExams controller called');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No CSV file uploaded' 
      });
    }

    // Accept .xlsx / .xls natively (full Unicode) OR .csv (encoding auto-detected).
    // Uploading the real Excel file is strongly preferred: Excel's plain CSV
    // export is Windows-1252 and silently drops characters like θ, π, √, ≤, ≥, Δ.
    let csvData;
    try {
      ({ csv: csvData } = spreadsheetBufferToCsv(req.file.buffer, req.file.originalname));
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: `Failed to read uploaded file: ${err.message}`
      });
    }
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'File must have at least a header row and one data row' 
      });
    }

    // Helper function to parse CSV line (handles quoted values); cleanCsvCell
    // trims whitespace and normalizes smart punctuation (−, –, —, ’, “, …) to
    // plain ASCII so downstream validation isn't thrown off by Excel quirks.
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cleanCsvCell(current));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(cleanCsvCell(current)); // Add last field
      return result;
    };

    const toOptionIndex = (token, options) => {
      const normalizedToken = String(token || '').trim().toLowerCase();
      if (!normalizedToken || !Array.isArray(options) || options.length === 0) {
        return -1;
      }

      if (/^\d+$/.test(normalizedToken)) {
        const numeric = parseInt(normalizedToken, 10);
        // Support both 0-based and 1-based index values in CSV.
        if (numeric >= 0 && numeric < options.length) return numeric;
        if (numeric >= 1 && numeric <= options.length) return numeric - 1;
      }

      if (/^[a-z]$/.test(normalizedToken)) {
        const alphaIndex = normalizedToken.charCodeAt(0) - 97;
        if (alphaIndex >= 0 && alphaIndex < options.length) return alphaIndex;
      }

      const optionMatch = normalizedToken.match(/^option\s*([a-z0-9])$/);
      if (optionMatch) {
        const optionToken = optionMatch[1];
        if (/^\d$/.test(optionToken)) {
          const n = parseInt(optionToken, 10);
          if (n >= 1 && n <= options.length) return n - 1;
          if (n >= 0 && n < options.length) return n;
        }
        if (/^[a-z]$/.test(optionToken)) {
          const alphaIndex = optionToken.charCodeAt(0) - 97;
          if (alphaIndex >= 0 && alphaIndex < options.length) return alphaIndex;
        }
      }

      // Also support passing the exact option text as the answer.
      const textIndex = options.findIndex(
        (opt) => String(opt?.text || '').trim().toLowerCase() === normalizedToken
      );
      return textIndex;
    };

    const normalizeHeader = (header) =>
      String(header || '')
        .trim()
        .toLowerCase()
        .replace(/^"|"$/g, '')
        .replace(/[^a-z0-9]/g, '');

    // Get header row
    const headers = parseCSVLine(lines[0]).map((h) => normalizeHeader(h));
    
    // Validate required headers
    const requiredHeaders = ['title', 'examtype', 'classnumber', 'subject', 'maxattempts', 'board', 'duration', 'totalquestions', 'totalmarks', 'startdate', 'enddate'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Missing required headers: ${missingHeaders.join(', ')}` 
      });
    }

    const createdExams = [];
    const errors = [];
    let createdById = req.userId;
    
    // If userId is not a valid ObjectId, create a new one
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      createdById = new mongoose.Types.ObjectId();
    }

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        
        if (values.length !== headers.length) {
          errors.push(`Row ${i + 1}: Column count mismatch (expected ${headers.length}, got ${values.length})`);
          continue;
        }

        // Create exam object from CSV row
        const examData = {};
        headers.forEach((header, index) => {
          examData[header] = values[index]?.trim() || '';
        });

        // Validate required fields
        if (!examData.title || !examData.examtype || !examData.classnumber || !examData.subject || !examData.maxattempts || !examData.board || !examData.duration || 
            !examData.totalquestions || !examData.totalmarks || !examData.startdate || !examData.enddate) {
          errors.push(`Row ${i + 1}: Missing required fields`);
          continue;
        }

        // Validate examType
        const examType = examData.examtype.toLowerCase();
        if (!['weekend', 'mains', 'advanced', 'practice'].includes(examType)) {
          errors.push(`Row ${i + 1}: Invalid examType "${examType}". Must be one of: weekend, mains, advanced, practice`);
          continue;
        }

        // Validate board
        const board = examData.board.toUpperCase().trim();
        if (!isValidSchoolBoard(board)) {
          errors.push(
            `Row ${i + 1}: Invalid board "${board}". Must be one of: ${VALID_SCHOOL_BOARDS.join(', ')}`
          );
          continue;
        }

        const normalizedSubject = normalizeExamSubjectKey(examData.subject);
        if (!ALLOWED_EXAM_SUBJECTS.includes(normalizedSubject)) {
          errors.push(
            `Row ${i + 1}: Invalid subject "${examData.subject}". Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')} (aliases: mathematics→maths, social science→social_science)`,
          );
          continue;
        }

        const parsedMaxAttempts = parseInt(examData.maxattempts);
        if (isNaN(parsedMaxAttempts) || parsedMaxAttempts < 1) {
          errors.push(`Row ${i + 1}: Invalid maxAttempts. Must be >= 1`);
          continue;
        }

        // Parse filterType and targetSchools
        // all-schools = all schools on THIS board (not cross-board)
        // all-boards = every board
        // specific-schools = only listed school admin ids
        const filterType = (examData.filtertype || 'all-schools').toLowerCase();
        const isSchoolSpecific = filterType === 'specific-schools';
        const isAllBoards = filterType === 'all-boards' || filterType === 'allboards';
        
        let targetSchools = [];
        if (isSchoolSpecific && examData.targetschools) {
          // Parse comma-separated school IDs
          targetSchools = examData.targetschools.split(',').map((id) => id.trim()).filter((id) => id);
        }

        if (isSchoolSpecific && targetSchools.length === 0) {
          errors.push(
            `Row ${i + 1}: filterType is specific-schools but targetSchools is empty`
          );
          continue;
        }

        const assignedClasses = String(examData.classnumber || '')
          .split(/[|,]/)
          .map((c) => normalizeClassNumberLabel(c) || String(c).trim())
          .filter(Boolean);
        if (assignedClasses.length === 0) {
          errors.push(`Row ${i + 1}: Invalid classNumber`);
          continue;
        }

        // Create exam data object
        const newExamData = {
          title: examData.title,
          description: examData.description || '',
          examType,
          classNumber: assignedClasses[0],
          assignedClasses,
          subject: normalizedSubject,
          maxAttempts: parsedMaxAttempts,
          duration: parseInt(examData.duration),
          totalQuestions: parseInt(examData.totalquestions),
          totalMarks: parseInt(examData.totalmarks),
          instructions: examData.instructions || '',
          startDate: new Date(examData.startdate),
          endDate: new Date(examData.enddate),
          board,
          createdByRole: 'super-admin',
          createdBy: createdById,
          isActive: true,
          isSchoolSpecific,
          isBoardSpecific: false,
          isAllBoards
        };

        // Add target schools if provided
        if (isSchoolSpecific && targetSchools.length > 0) {
          newExamData.targetSchools = targetSchools.map((id) => {
            if (mongoose.Types.ObjectId.isValid(id)) {
              return new mongoose.Types.ObjectId(id);
            }
            return id;
          });
          newExamData.schoolId = newExamData.targetSchools[0];
        }

        // Validate dates
        if (isNaN(newExamData.startDate.getTime()) || isNaN(newExamData.endDate.getTime())) {
          errors.push(`Row ${i + 1}: Invalid date format`);
          continue;
        }

        if (newExamData.endDate < newExamData.startDate) {
          errors.push(`Row ${i + 1}: End date must be after start date`);
          continue;
        }

        // Validate numeric fields
        if (isNaN(newExamData.duration) || newExamData.duration <= 0) {
          errors.push(`Row ${i + 1}: Invalid duration`);
          continue;
        }

        if (isNaN(newExamData.totalQuestions) || newExamData.totalQuestions <= 0) {
          errors.push(`Row ${i + 1}: Invalid totalQuestions`);
          continue;
        }

        if (isNaN(newExamData.totalMarks) || newExamData.totalMarks <= 0) {
          errors.push(`Row ${i + 1}: Invalid totalMarks`);
          continue;
        }

        // Create exam
        const newExam = new Exam(newExamData);
        await newExam.save();

        createdExams.push({
          id: newExam._id,
          title: newExam.title,
          examType: newExam.examType
        });

        console.log(`✅ Exam created from row ${i + 1}:`, newExam.title);
      } catch (error) {
        console.error(`❌ Error processing row ${i + 1}:`, error);
        errors.push(`Row ${i + 1}: ${error.message || 'Unknown error'}`);
      }
    }

    console.log(`✅ Bulk upload completed: ${createdExams.length} created, ${errors.length} errors`);

    res.json({
      success: true,
      message: `Successfully created ${createdExams.length} exam(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`,
      created: createdExams.length,
      data: createdExams,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Bulk upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process CSV file',
      error: error.message 
    });
  }
};

// Bulk Upload Questions via CSV (Super Admin only)
export const bulkUploadQuestions = async (req, res) => {
  try {
    console.log('📝 bulkUploadQuestions controller called');
    const { examId } = req.params;
    // Default behavior: allow duplicates unless explicitly disabled.
    const allowDuplicatesRaw = String(req.body?.allowDuplicates || '').trim().toLowerCase();
    const allowDuplicates =
      allowDuplicatesRaw === ''
        ? true
        : ['true', '1', 'yes', 'on'].includes(allowDuplicatesRaw);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No CSV file uploaded' 
      });
    }

    // Validate examId
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid exam ID format' 
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ 
        success: false, 
        message: 'Exam not found or not accessible' 
      });
    }
    const examAllowedSubjects = normalizeExamSubjects(exam.subject, exam.subjects)
      .filter((s) => ALLOWED_EXAM_SUBJECTS.includes(s));

    // Accept .xlsx / .xls natively (full Unicode) OR .csv (encoding auto-detected).
    // Uploading the real Excel file preserves x², x³, θ, π, √, Δ, ≤, ≥ — which
    // a plain Excel CSV export (Windows-1252) silently replaces with `?`.
    let csvData;
    try {
      ({ csv: csvData } = spreadsheetBufferToCsv(req.file.buffer, req.file.originalname));
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: `Failed to read uploaded file: ${err.message}`
      });
    }
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'File must have at least a header row and one data row' 
      });
    }

    // Helper function to parse CSV line (handles quoted values); cleanCsvCell
    // trims whitespace and normalizes smart punctuation (−, –, —, ’, “, …).
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cleanCsvCell(current));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(cleanCsvCell(current)); // Add last field
      return result;
    };

    const normalizeHeader = (header) =>
      String(header || '')
        .trim()
        .toLowerCase()
        .replace(/^"|"$/g, '')
        .replace(/[^a-z0-9]/g, '');

    // Resolve a single answer token to an option index (shared with PDF extraction).
    const toOptionIndex = (token, options) => mcqTokenToOptionIndex(token, options);

    // Get header row
    const headers = parseCSVLine(lines[0]).map((h) => normalizeHeader(h));
    
    // Validate required headers
    const requiredHeaders = ['questiontext', 'questiontype', 'subject', 'marks'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Missing required headers: ${missingHeaders.join(', ')}` 
      });
    }

    const createdQuestions = [];
    const errors = [];
    const seenQuestionKeys = new Set();
    let createdById = req.userId;
    
    // If userId is not a valid ObjectId, create a new one
    if (!createdById || !mongoose.Types.ObjectId.isValid(createdById)) {
      createdById = new mongoose.Types.ObjectId();
    }

    if (!allowDuplicates) {
      const existingQuestions = await Question.find(
        { exam: examId },
        { subject: 1, questionType: 1, questionText: 1, questionImage: 1 }
      ).lean();
      existingQuestions.forEach((q) => {
        seenQuestionKeys.add(buildQuestionDedupKey({
          examId,
          subject: q.subject,
          questionType: q.questionType,
          questionText: q.questionText,
          questionImage: q.questionImage,
        }));
      });
    }

    // Collect new question IDs so we can push them into the exam in one update
    // at the end (instead of one $push per question).
    const newQuestionIdsToPush = [];
    let nextOrder = await nextQuestionDisplayOrder(Question, examId);
    let runningActual = await getExamActualTotals(examId);

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      try {
        const rawValues = parseCSVLine(lines[i]);

        // Be lenient about column count: pad short rows with empty cells and
        // drop trailing extras. Most "column count mismatch" errors are caused
        // by Excel trimming trailing empty columns or by a stray comma.
        const values =
          rawValues.length === headers.length
            ? rawValues
            : rawValues.length < headers.length
              ? rawValues.concat(Array(headers.length - rawValues.length).fill(''))
              : rawValues.slice(0, headers.length);

        // Create question object from CSV row
        const questionData = {};
        headers.forEach((header, index) => {
          questionData[header] = values[index]?.trim() || '';
        });
        const getRowValue = (...keys) => {
          for (const key of keys) {
            const normalizedKey = normalizeHeader(key);
            const val = questionData[normalizedKey];
            if (val !== undefined && String(val).trim() !== '') {
              return String(val).trim();
            }
          }
          return '';
        };

        // Validate required fields
        if (!getRowValue('questiontext', 'question_text') && !getRowValue('questionimage', 'question_image')) {
          errors.push(`Row ${i + 1}: Either questionText or questionImage is required`);
          continue;
        }

        // Validate questionType
        const questionType = (getRowValue('questiontype', 'question_type', 'type') || 'mcq').toLowerCase();
        if (!['mcq', 'multiple', 'integer'].includes(questionType)) {
          errors.push(`Row ${i + 1}: Invalid questionType "${questionType}". Must be one of: mcq, multiple, integer`);
          continue;
        }

        // Validate subject
        const subject =
          normalizeExamSubjectKey(getRowValue('subject') || '') ||
          examAllowedSubjects[0] ||
          'maths';
        if (!ALLOWED_EXAM_SUBJECTS.includes(subject)) {
          errors.push(`Row ${i + 1}: Invalid subject "${subject}". Must be one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`);
          continue;
        }
        if (examAllowedSubjects.length > 0 && !examAllowedSubjects.includes(subject)) {
          errors.push(`Row ${i + 1}: Subject "${subject}" is not allowed for this exam. Allowed subjects: ${examAllowedSubjects.join(', ')}`);
          continue;
        }

        // Parse options for MCQ/Multiple
        let options = [];
        if (questionType === 'mcq' || questionType === 'multiple') {
          for (let j = 1; j <= 4; j++) {
            const optionValue = getRowValue(
              `option${j}`,
              `option_${j}`,
              `option ${j}`,
            );
            if (optionValue) {
              options.push({ text: optionValue, isCorrect: false });
            }
          }
          if (options.length === 0) {
            errors.push(`Row ${i + 1}: At least one option is required for ${questionType} questions`);
            continue;
          }
        }

        // Parse correct answer based on question type
        let correctAnswer;
        if (questionType === 'integer') {
          const integerAns = getRowValue('integeranswer', 'integer_answer', 'correctanswer', 'correct_answer', 'answer');
          if (!integerAns) {
            errors.push(`Row ${i + 1}: integerAnswer is required for integer type questions`);
            continue;
          }
          const parsedInt = parseInt(integerAns);
          if (isNaN(parsedInt)) {
            errors.push(`Row ${i + 1}: Invalid integer answer`);
            continue;
          }
          correctAnswer = parsedInt;
        } else if (questionType === 'multiple') {
          const correctAnswersStr = getRowValue(
            'correctanswers',
            'correct_answers',
            'correctanswer',
            'correct_answer',
            'answer'
          );
          if (!correctAnswersStr) {
            errors.push(`Row ${i + 1}: correctAnswers is required for multiple choice questions`);
            continue;
          }
          // Parse comma/semicolon separated values: accepts 0/1-based indices, letters (a-d), optionN, or option text.
          const indices = correctAnswersStr
            .split(/[;,]/)
            .map((token) => toOptionIndex(token, options))
            .filter((idx) => idx >= 0 && idx < options.length);
          const uniqueIndices = [...new Set(indices)];
          if (uniqueIndices.length === 0) {
            errors.push(`Row ${i + 1}: Invalid correctAnswers format`);
            continue;
          }
          // Convert indices to option texts
          correctAnswer = uniqueIndices.map(idx => {
            if (options[idx]) {
              return options[idx].text;
            }
            return null;
          }).filter(text => text !== null);
          if (correctAnswer.length === 0) {
            errors.push(`Row ${i + 1}: No valid correct answers found`);
            continue;
          }
        } else {
          // MCQ - single answer
          const correctAnswerStr =
            getRowValue(
              'correctanswer',
              'correct_answer',
              'correctanswers',
              'correct_answers',
              'answer'
            );
          if (!correctAnswerStr) {
            errors.push(`Row ${i + 1}: correctAnswer is required for MCQ questions`);
            continue;
          }
          const answerIndex = toOptionIndex(correctAnswerStr, options);
          if (answerIndex < 0 || !options[answerIndex]) {
            errors.push(`Row ${i + 1}: Invalid correctAnswer "${correctAnswerStr}" (expected 1-4, a-d, or exact option text)`);
            continue;
          }
          correctAnswer = options[answerIndex].text;
          options[answerIndex].isCorrect = true;
        }

        // Mark the correct options for `multiple` so option.isCorrect stays in
        // sync with correctAnswer. (MCQ is handled in its branch above.)
        if (questionType === 'multiple' && Array.isArray(correctAnswer)) {
          const correctSet = new Set(correctAnswer.map((t) => String(t).trim().toLowerCase()));
          options.forEach((opt) => {
            if (opt && correctSet.has(String(opt.text || '').trim().toLowerCase())) {
              opt.isCorrect = true;
            }
          });
        }

        // Validate marks. Empty/missing defaults to 1; any other invalid value
        // (negative, zero, non-numeric) is a hard error so silent corruption is
        // caught at upload time rather than showing up as a weird score later.
        const marksRaw = getRowValue('marks');
        let marks = 1;
        if (marksRaw !== '') {
          const parsedMarks = Number(marksRaw);
          if (!Number.isFinite(parsedMarks) || parsedMarks <= 0) {
            errors.push(`Row ${i + 1}: Invalid marks "${marksRaw}" (must be a positive number)`);
            continue;
          }
          marks = parsedMarks;
        }

        try {
          assertWithinExamCaps(exam, {
            nextQuestionCount: runningActual.questionCount + 1,
            nextMarksSum: runningActual.marksSum + marks,
          });
        } catch (capErr) {
          errors.push(`Row ${i + 1}: ${capErr.message}`);
          continue;
        }

        const negativeMarksRaw = getRowValue('negativemarks', 'negative_marks', 'negativeMarks');
        let negativeMarks = 0;
        if (negativeMarksRaw !== '') {
          const parsedNeg = Number(negativeMarksRaw);
          if (!Number.isFinite(parsedNeg) || parsedNeg < 0) {
            errors.push(`Row ${i + 1}: Invalid negativeMarks "${negativeMarksRaw}" (must be a non-negative number)`);
            continue;
          }
          negativeMarks = parsedNeg;
        }

        const rawCategory = getRowValue(
          'questioncategory',
          'question_category',
          'analytics_type',
          'analytictype',
          'analyticsType',
          'type_tag',
          'examquestiontype',
          'exam_question_type',
          'questionstyle',
          'question_style'
        );
        let questionCategory;
        if (rawCategory) {
          const normalizedCategory = normalizeQuestionCategory(rawCategory);
          if (!normalizedCategory) {
            errors.push(
              `Row ${i + 1}: Invalid questionCategory "${rawCategory}". Use one of: ${QUESTION_CATEGORY_CSV_VALUES.join(', ')}`
            );
            continue;
          }
          questionCategory = normalizedCategory;
        }

        const rawDifficulty = getRowValue('difficulty', 'difficultylevel', 'difficulty_level');
        const difficulty = normalizeDifficulty(rawDifficulty, marks);

        // Create question data object
        const rawOrder = getRowValue(
          'displayorder',
          'display_order',
          'orderno',
          'order',
          'qno',
          'questionnumber',
          'question_number'
        );
        const parsedOrder = parseInt(rawOrder, 10);
        const displayOrder =
          Number.isFinite(parsedOrder) && parsedOrder >= 1 ? parsedOrder : nextOrder++;
        if (Number.isFinite(parsedOrder) && parsedOrder >= 1) {
          nextOrder = Math.max(nextOrder, parsedOrder + 1);
        }

        const sectionHeading =
          getRowValue('sectionheading', 'section_heading', 'section', 'heading') ||
          subjectSectionLabel(subject);

        const newQuestionData = {
          questionText: getRowValue('questiontext', 'question_text') || undefined,
          questionImage: getRowValue('questionimage', 'question_image') || undefined,
          questionType,
          options: questionType === 'integer' ? [] : options,
          correctAnswer,
          marks,
          negativeMarks,
          explanation: getRowValue('explanation') || undefined,
          subject,
          displayOrder,
          sectionHeading,
          chapter: getRowValue('chapter', 'chaptername', 'chapter_name', 'topic', 'unit') || 'General',
          difficulty,
          questionCategory,
          conceptType: (() => {
            const rawConcept = String(getRowValue('concepttype', 'concept_type', 'skilltype', 'skill_type') || '').toLowerCase();
            if (rawConcept.includes('application') || rawConcept.includes('problem')) return 'Application';
            return 'Concept';
          })(),
          exam: examId,
          board: exam.board,
          createdBy: createdById
        };

        const questionKey = buildQuestionDedupKey({
          examId,
          subject: newQuestionData.subject,
          questionType: newQuestionData.questionType,
          questionText: newQuestionData.questionText,
          questionImage: newQuestionData.questionImage,
        });
        if (!allowDuplicates && seenQuestionKeys.has(questionKey)) {
          // Duplicate skips are intentional in strict mode; do not treat them as errors.
          continue;
        }

        // Create question
        const newQuestion = new Question(newQuestionData);
        await newQuestion.save();
        if (!allowDuplicates) {
          seenQuestionKeys.add(questionKey);
        }
        newQuestionIdsToPush.push(newQuestion._id);
        runningActual = {
          questionCount: runningActual.questionCount + 1,
          marksSum: runningActual.marksSum + marks,
        };

        createdQuestions.push({
          id: newQuestion._id,
          questionText: newQuestion.questionText || 'Image question',
          questionType: newQuestion.questionType
        });

        console.log(`✅ Question created from row ${i + 1}:`, newQuestion.questionText || 'Image question');
      } catch (error) {
        console.error(`❌ Error processing row ${i + 1}:`, error);
        errors.push(`Row ${i + 1}: ${error.message || 'Unknown error'}`);
      }
    }

    // Attach all newly-created questions to the exam in a single update.
    // Planned totalQuestions / totalMarks caps are left unchanged.
    if (newQuestionIdsToPush.length > 0) {
      await Exam.updateOne(
        { _id: examId },
        buildSafeAppendQuestionsPipeline({
          questionIds: newQuestionIdsToPush,
        })
      );
      await syncExamQuestionTotals(examId);
    }

    console.log(`✅ Bulk question upload completed: ${createdQuestions.length} created, ${errors.length} errors`);
    if (errors.length > 0) {
      console.log('⚠️ Bulk question upload row errors:', errors);
    }

    res.json({
      success: true,
      message: `Successfully created ${createdQuestions.length} question(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`,
      created: createdQuestions.length,
      data: createdQuestions,
      allowDuplicates,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Bulk question upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process CSV file',
      error: error.message 
    });
  }
};

// Convert PDF questions to normalized row format for preview / CSV download.
export const convertPdfToQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID format' });
    }
    const exam = await Exam.findById(examId);
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found or not accessible' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'PDF file is required' });
    }

    const mime = String(req.file.mimetype || '').toLowerCase();
    if (!mime.includes('pdf')) {
      return res.status(400).json({ success: false, message: 'Only PDF files are allowed' });
    }

    const rows = await extractQuestionsFromPdfViaGemini({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || 'application/pdf',
    });

    const normalized = rows.map((r, idx) => {
      const questionTypeRaw = String(r?.questionType || '').trim().toUpperCase();
      const mappedType = questionTypeRaw === 'MSQ' ? 'multiple' : questionTypeRaw === 'INTEGER' ? 'integer' : 'mcq';
      const subject = String(r?.subject ?? '').trim().toLowerCase();
      const marks = Number(r?.marks);
      return {
        row: idx + 1,
        questionText: String(r?.questionText || '').trim(),
        questionType: mappedType,
        subject,
        marks: Number.isFinite(marks) && marks > 0 ? marks : 1,
        option1: String(r?.option1 || '').trim(),
        option2: String(r?.option2 || '').trim(),
        option3: String(r?.option3 || '').trim(),
        option4: String(r?.option4 || '').trim(),
        correctAnswer: String(r?.correctAnswer || '').trim(),
        explanation: String(r?.explanation || '').trim(),
      };
    }).filter((r) => r.questionText);

    return res.json({
      success: true,
      data: normalized,
      message: `Extracted ${normalized.length} question(s) from PDF.`,
    });
  } catch (error) {
    console.error('❌ convertPdfToQuestions error:', error);
    const msg = String(error?.message || 'Failed to extract questions from PDF');
    const status =
      /Gemini API key is missing/i.test(msg) ? 503 :
      /quota exceeded|resource_exhausted|429/i.test(msg) ? 429 :
      msg.includes('Gemini PDF extraction failed') || msg.includes('Gemini PDF upload blocked') ? 502 :
      msg.includes('invalid JSON') || msg.includes('did not return a JSON array') ? 422 :
      500;
    return res.status(status).json({
      success: false,
      message: msg,
    });
  }
};

// Update question fields (meta + full content: text, options, answer, type, image, etc.)
export const updateQuestion = async (req, res) => {
  try {
    const { examId, questionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam/question id format' });
    }

    const exam = await Exam.findById(examId);
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found or not accessible' });
    }

    const question = await Question.findOne({ _id: questionId, exam: examId });
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    const {
      displayOrder,
      sectionHeading,
      subject,
      chapter,
      marks,
      negativeMarks,
      explanation,
      questionText,
      questionImage,
      questionType,
      options,
      correctAnswer,
      difficulty,
      questionCategory,
      conceptType,
    } = req.body || {};

    const contentUpdateRequested =
      questionText !== undefined ||
      questionImage !== undefined ||
      questionType !== undefined ||
      options !== undefined ||
      correctAnswer !== undefined;

    let orderMove = null;
    if (displayOrder !== undefined) {
      const n = Number(displayOrder);
      if (!Number.isFinite(n) || n < 1) {
        return res.status(400).json({
          success: false,
          message: 'displayOrder must be a number >= 1',
        });
      }
      // Insert-style move: shift neighbors so orders stay unique 1..N (no collisions / "missing" Qs).
      orderMove = await moveQuestionToDisplayOrder(Question, examId, questionId, Math.floor(n));
    }

    // Re-load after possible reorder so later field updates apply to the same doc.
    const questionToUpdate = orderMove?.moved
      ? await Question.findOne({ _id: questionId, exam: examId })
      : question;
    if (!questionToUpdate) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    if (sectionHeading !== undefined) {
      questionToUpdate.sectionHeading = String(sectionHeading || '').trim();
    }

    if (subject !== undefined) {
      const normalized = normalizeExamSubjectKey(subject);
      if (!ALLOWED_EXAM_SUBJECTS.includes(normalized)) {
        return res.status(400).json({
          success: false,
          message: `Invalid subject. Use one of: ${ALLOWED_EXAM_SUBJECTS.join(', ')}`,
        });
      }
      const examSubjects = Array.isArray(exam.subjects)
        ? exam.subjects.map((s) => normalizeExamSubjectKey(s))
        : [];
      if (examSubjects.length && !examSubjects.includes(normalized)) {
        return res.status(400).json({
          success: false,
          message: `Subject "${normalized}" is not allowed for this exam`,
        });
      }
      questionToUpdate.subject = normalized;
      if (sectionHeading === undefined && !String(questionToUpdate.sectionHeading || '').trim()) {
        questionToUpdate.sectionHeading = subjectSectionLabel(normalized);
      }
    }

    if (chapter !== undefined) {
      questionToUpdate.chapter = String(chapter || '').trim() || 'General';
    }
    if (marks !== undefined) {
      const m = Number(marks);
      if (!Number.isFinite(m) || m < 0) {
        return res.status(400).json({ success: false, message: 'Invalid marks' });
      }
      const actual = await getExamActualTotals(examId);
      const oldMarks = Number(questionToUpdate.marks) || 0;
      try {
        assertWithinExamCaps(exam, {
          nextQuestionCount: actual.questionCount,
          nextMarksSum: actual.marksSum - oldMarks + m,
        });
      } catch (capErr) {
        return res.status(capErr.status || 400).json({
          success: false,
          message: capErr.message,
          code: capErr.code,
        });
      }
      questionToUpdate.marks = m;
    }
    if (negativeMarks !== undefined) {
      const nm = Number(negativeMarks);
      if (!Number.isFinite(nm) || nm < 0) {
        return res.status(400).json({ success: false, message: 'Invalid negativeMarks' });
      }
      questionToUpdate.negativeMarks = nm;
    }
    if (explanation !== undefined) {
      questionToUpdate.explanation = String(explanation || '').trim() || undefined;
    }
    if (difficulty !== undefined) {
      questionToUpdate.difficulty = String(difficulty || '').trim() || undefined;
    }
    if (questionCategory !== undefined) {
      questionToUpdate.questionCategory = String(questionCategory || '').trim() || undefined;
    }
    if (conceptType !== undefined) {
      questionToUpdate.conceptType = String(conceptType || '').trim() || undefined;
    }

    if (questionImage !== undefined) {
      questionToUpdate.questionImage = String(questionImage || '').trim() || null;
    }

    if (questionText !== undefined) {
      questionToUpdate.questionText = String(questionText || '').trim() || undefined;
    }

    const nextTypeRaw =
      questionType !== undefined
        ? String(questionType || '').trim().toLowerCase()
        : String(questionToUpdate.questionType || 'mcq').trim().toLowerCase();
    const nextType = ['mcq', 'multiple', 'integer'].includes(nextTypeRaw) ? nextTypeRaw : null;
    if (questionType !== undefined && !nextType) {
      return res.status(400).json({
        success: false,
        message: 'Invalid questionType. Use mcq, multiple, or integer',
      });
    }
    if (nextType) {
      questionToUpdate.questionType = nextType;
    }

    // Full content update: reformat options + correctAnswer like addQuestion
    if (contentUpdateRequested && (options !== undefined || correctAnswer !== undefined || questionType !== undefined)) {
      const effectiveType = questionToUpdate.questionType;
      const incomingOptions = options !== undefined ? options : questionToUpdate.options;
      let formattedCorrectAnswer =
        correctAnswer !== undefined ? correctAnswer : questionToUpdate.correctAnswer;

      if ((effectiveType === 'mcq' || effectiveType === 'multiple') && (!incomingOptions || incomingOptions.length === 0)) {
        return res.status(400).json({
          success: false,
          message: 'Options are required for MCQ and Multiple Choice questions',
        });
      }

      if (effectiveType === 'integer') {
        formattedCorrectAnswer =
          typeof formattedCorrectAnswer === 'number'
            ? formattedCorrectAnswer
            : parseInt(formattedCorrectAnswer, 10);
        if (Number.isNaN(formattedCorrectAnswer)) {
          return res.status(400).json({ success: false, message: 'Invalid integer answer' });
        }
      } else if (effectiveType === 'multiple' && Array.isArray(formattedCorrectAnswer)) {
        formattedCorrectAnswer = formattedCorrectAnswer.map((idx) => {
          const optionIndex = parseInt(idx, 10);
          if (!Number.isNaN(optionIndex) && incomingOptions && incomingOptions[optionIndex]) {
            const opt = incomingOptions[optionIndex];
            return typeof opt === 'string' ? opt : opt?.text ?? idx;
          }
          return idx;
        });
        if (formattedCorrectAnswer.length === 0) {
          formattedCorrectAnswer = correctAnswer;
        }
      } else if (effectiveType === 'mcq' && incomingOptions && incomingOptions.length > 0) {
        const optionIndex = parseInt(formattedCorrectAnswer, 10);
        if (!Number.isNaN(optionIndex) && incomingOptions[optionIndex]) {
          const opt = incomingOptions[optionIndex];
          formattedCorrectAnswer = typeof opt === 'string' ? opt : opt?.text ?? formattedCorrectAnswer;
        }
      }

      if (
        formattedCorrectAnswer === null ||
        formattedCorrectAnswer === undefined ||
        (typeof formattedCorrectAnswer === 'string' && formattedCorrectAnswer.trim() === '') ||
        (Array.isArray(formattedCorrectAnswer) && formattedCorrectAnswer.length === 0)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Correct answer is required and cannot be empty',
        });
      }

      const finalOptions =
        effectiveType === 'integer'
          ? []
          : (incomingOptions || []).map((opt) => {
              const text = typeof opt === 'string' ? opt : opt?.text ?? '';
              return { text: String(text), isCorrect: false };
            }).filter((o) => String(o.text || '').trim() !== '');

      if (effectiveType === 'mcq') {
        const correctText = String(formattedCorrectAnswer || '').trim().toLowerCase();
        const idx = finalOptions.findIndex(
          (o) => String(o.text || '').trim().toLowerCase() === correctText
        );
        if (idx >= 0) finalOptions[idx].isCorrect = true;
      } else if (effectiveType === 'multiple' && Array.isArray(formattedCorrectAnswer)) {
        const correctSet = new Set(
          formattedCorrectAnswer.map((t) => String(t).trim().toLowerCase())
        );
        finalOptions.forEach((o) => {
          if (correctSet.has(String(o.text || '').trim().toLowerCase())) {
            o.isCorrect = true;
          }
        });
      }

      questionToUpdate.options = finalOptions;
      questionToUpdate.correctAnswer = formattedCorrectAnswer;
    }

    const finalText = String(questionToUpdate.questionText || '').trim();
    const finalImage = String(questionToUpdate.questionImage || '').trim();
    if (!finalText && !finalImage) {
      return res.status(400).json({
        success: false,
        message: 'Either question text or image is required',
      });
    }
    questionToUpdate.questionText = finalText || undefined;
    questionToUpdate.questionImage = finalImage || null;

    await questionToUpdate.save();
    if (marks !== undefined) {
      await syncExamQuestionTotals(examId);
    } else if (contentUpdateRequested) {
      await syncExamQuestionTotals(examId);
    }

    const refreshed =
      orderMove?.questions?.length || contentUpdateRequested
        ? await Question.find({ exam: examId }).sort(QUESTION_LIST_SORT)
        : null;
    const latest = refreshed?.find((q) => String(q._id) === String(questionId)) || questionToUpdate;

    return res.json({
      success: true,
      message: orderMove && orderMove.from !== orderMove.to
        ? `Question moved from Q${orderMove.from} to Q${orderMove.to}; other questions shifted`
        : 'Question updated successfully',
      data: latest,
      questions: refreshed || undefined,
    });
  } catch (error) {
    console.error('❌ updateQuestion error:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to update question',
    });
  }
};

/**
 * Reorder all questions for an exam.
 * Body: { orderedIds: string[] } — full list of question ids in desired display order.
 */
export const reorderQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map(String) : [];

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }
    if (orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: 'orderedIds is required' });
    }

    const exam = await Exam.findById(examId);
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found or not accessible' });
    }

    await ensureExamQuestionDisplayOrders(Question, examId);

    const existing = await Question.find({ exam: examId }).select('_id').lean();
    const existingSet = new Set(existing.map((q) => String(q._id)));
    const uniqueOrdered = [];
    const seen = new Set();
    for (const id of orderedIds) {
      if (!existingSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      uniqueOrdered.push(id);
    }
    for (const id of existingSet) {
      if (!seen.has(id)) uniqueOrdered.push(id);
    }

    const ops = uniqueOrdered.map((id, idx) => ({
      updateOne: {
        filter: { _id: id, exam: examId },
        update: { $set: { displayOrder: idx + 1, updatedAt: new Date() } },
      },
    }));
    if (ops.length) await Question.bulkWrite(ops);

    const questions = await Question.find({ exam: examId }).sort(QUESTION_LIST_SORT);
    return res.json({
      success: true,
      message: 'Questions reordered successfully',
      data: questions,
    });
  } catch (error) {
    console.error('❌ reorderQuestions error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to reorder questions',
    });
  }
};

// Delete a single question and keep exam counters consistent.
export const deleteQuestion = async (req, res) => {
  try {
    const { examId, questionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam/question id format' });
    }
    const exam = await Exam.findById(examId);
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found or not accessible' });
    }

    const question = await Question.findOne({ _id: questionId, exam: examId }).lean();
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    await Question.deleteOne({ _id: questionId });
    await Exam.updateOne(
      { _id: examId },
      buildSafeRemoveQuestionPipeline({
        questionId: new mongoose.Types.ObjectId(questionId),
      }),
    );
    await syncExamQuestionTotals(examId);

    return res.json({
      success: true,
      message: 'Question deleted successfully',
    });
  } catch (error) {
    console.error('❌ deleteQuestion error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete question',
    });
  }
};

// Delete all questions for an exam and keep exam counters consistent.
export const deleteAllQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id format' });
    }

    const exam = await Exam.findById(examId);
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found or not accessible' });
    }

    const deleteResult = await Question.deleteMany({ exam: examId });
    await Exam.updateOne(
      { _id: examId },
      {
        $set: {
          questions: [],
          // Keep planned Total Questions / Total Marks caps; only clear question refs.
        },
      },
    );
    await syncExamQuestionTotals(examId);

    return res.json({
      success: true,
      message: `Deleted ${Number(deleteResult?.deletedCount) || 0} question(s) successfully`,
      deletedCount: Number(deleteResult?.deletedCount) || 0,
    });
  } catch (error) {
    console.error('❌ deleteAllQuestions error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete all questions',
    });
  }
};

