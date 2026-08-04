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
import { enrichExtractedExamQuestions } from '../services/exam-pdf-enrichment.js';
import { extractDocxQuestionPaper, isDocxUpload } from '../services/docx-question-paper.js';
import { buildGeminiEndpoint } from '../services/gemini-auth.js';

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
  // Flash-Lite only unless explicitly turned off. This used to append
  // GEMINI_FLASH_PREVIEW_MODEL unconditionally, so a pricier model stayed in the
  // candidate list no matter what the environment said.
  const liteOnly =
    String(process.env.AI_GENERATOR_FLASH_LITE_ONLY ?? 'true').trim().toLowerCase() !== 'false';
  if (liteOnly) {
    return [resolveAllowedGeminiModel(preferred) || GEMINI_LITE_MODEL];
  }

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
    questionNumber: {
      type: 'NUMBER',
      description: 'Printed question number from the paper (1, 2, 3…). Mandatory — read it from the paper.',
    },
    hasFigure: {
      type: 'BOOLEAN',
      description:
        'true only when this question (or its case/passage) depends on a picture, diagram, graph or figure printed in the paper. false for pure text/math questions.',
    },
    questionText: {
      type: 'STRING',
      description:
        'Full stem as students must see it. For case/passage questions include the full case text before the question. Keep exact math grouping. No leading Q number.',
    },
    questionType: {
      type: 'STRING',
      enum: ['MCQ', 'MSQ', 'integer', 'assertion_reason', 'match_following'],
    },
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
    'questionNumber',
    'hasFigure',
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

/** Second-opinion answer check (text-only, no PDF attached — cheap). */
const ANSWER_VERIFY_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          questionNumber: { type: 'NUMBER' },
          correctOption: { type: 'STRING', enum: ['a', 'b', 'c', 'd'] },
        },
        required: ['questionNumber', 'correctOption'],
      },
    },
  },
  required: ['answers'],
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
 * Prefer classroom Unicode over Gemini verbal math ("cube root of", "sqrt(...)").
 * Does not invent new grouping — only replaces wording/function names.
 */
function normalizeVerbalMathInExamText(text) {
  let s = String(text || '');
  if (!s) return s;
  // cube root of ( ... )  /  cuberoot(...)
  s = s.replace(/\bcube\s*roots?\s+of\s*\(/gi, '∛(');
  s = s.replace(/\bcuberoot\s*\(/gi, '∛(');
  s = s.replace(/\bcube\s*roots?\s+of\s+(\d+)/gi, '∛$1');
  // square root of / sqrt(
  s = s.replace(/\bsquare\s*roots?\s+of\s*\(/gi, '√(');
  s = s.replace(/\bsqrt\s*\(/gi, '√(');
  s = s.replace(/\bsquare\s*roots?\s+of\s+(\d+)/gi, '√$1');
  s = s.replace(/\bsqrt\s+(\d+)/gi, '√$1');
  // caret powers already handled on client; light pass here
  s = s.replace(/\^2\b/g, '²');
  s = s.replace(/\^3\b/g, '³');
  return s;
}

/**
 * Normalize Gemini PDF rows: clean labels, canonicalize subject (or ""), align correctAnswer to option text.
 * Never fills subject from exam or other defaults.
 */
function postProcessGeminiPdfQuestionRows(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((r) => {
      const questionText = normalizeVerbalMathInExamText(
        stripPdfQuestionLeadingIndex(String(r?.questionText || '').trim()),
      );
      if (!questionText) return null;

      const qnRaw = Number(r?.questionNumber);
      const fromStem = String(r?.questionText || '').match(
        /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})[\.)]\s+/i,
      );
      const questionNumber =
        Number.isFinite(qnRaw) && qnRaw >= 1
          ? Math.floor(qnRaw)
          : fromStem
            ? parseInt(fromStem[1], 10)
            : undefined;

      let qt = String(r?.questionType || '').trim().toUpperCase();
      if (qt === 'MULTIPLE' || qt === 'MULTI') qt = 'MSQ';
      if (!['MCQ', 'MSQ', 'INTEGER'].includes(qt)) qt = 'MCQ';

      const subject = normalizePdfSubjectField(r?.subject);

      let marks = Number(r?.marks);
      if (!Number.isFinite(marks) || marks <= 0) marks = 1;

      const o1 = normalizeVerbalMathInExamText(stripPdfOptionPrefix(String(r?.option1 ?? '').trim()));
      const o2 = normalizeVerbalMathInExamText(stripPdfOptionPrefix(String(r?.option2 ?? '').trim()));
      const o3 = normalizeVerbalMathInExamText(stripPdfOptionPrefix(String(r?.option3 ?? '').trim()));
      const o4 = normalizeVerbalMathInExamText(stripPdfOptionPrefix(String(r?.option4 ?? '').trim()));
      const explanation = normalizeVerbalMathInExamText(String(r?.explanation ?? '').trim());

      const slots = [o1, o2, o3, o4];
      const nonEmpty = slots.map((s) => s.trim()).filter(Boolean);
      const withMeta = (row) => ({
        ...row,
        ...(questionNumber != null ? { questionNumber } : {}),
        hasFigure: r?.hasFigure === true,
      });

      if (qt === 'INTEGER') {
        const ca = String(r?.correctAnswer ?? '').trim();
        return withMeta({
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
        });
      }

      if (nonEmpty.length < 2) {
        const ca = String(r?.correctAnswer ?? '').trim();
        if (qt === 'MCQ' && ca && /^-?\d+(\.\d+)?$/.test(ca.trim())) {
          return withMeta({
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
          });
        }
        // Keep numbered stems even with incomplete options — answer key can still attach,
        // and gap-fill may enrich options on a later pass.
        if (questionNumber != null) {
          return withMeta({
            questionText,
            questionType: qt === 'MSQ' ? 'MSQ' : 'MCQ',
            subject,
            marks,
            option1: slots[0] || '',
            option2: slots[1] || '',
            option3: slots[2] || '',
            option4: slots[3] || '',
            correctAnswer: ca,
            explanation,
          });
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

      return withMeta({
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
      });
    })
    .filter(Boolean);
}

/**
 * Split CSV text into records, respecting quoted cells that contain newlines.
 * A naive split(/\r?\n/) breaks any row whose questionText holds a case
 * passage or Assertion–Reason stem (multi-line), shifting every field after it.
 */
function splitCsvRecords(csvText) {
  const records = [];
  const text = String(csvText || '');
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes; // escaped "" toggles twice — net no change, safe here
      current += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      if (current.trim()) records.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) records.push(current);
  return records;
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

/** Pages that are rough work / answer key — confuse Gemini and eat output tokens. */
function isPureExamPdfTailPageText(pageText) {
  const t = String(pageText || '');
  if (!t.trim()) return true;
  if (/Test\s*Key/i.test(t) || /ANSWER\s*KEY/i.test(t)) return true;
  const compact = t.replace(/\s+/g, ' ').trim();
  // Pure rough-work sheet (no real numbered questions)
  if (/Rough\s*Work/i.test(t) && !/\d{1,3}[\.)]\s+\S/.test(t) && compact.length < 600) {
    return true;
  }
  return false;
}

/**
 * Drop trailing Rough Work / Test Key pages before sending PDF to Gemini,
 * and parse letter keys from the dropped pages so we can fill correctAnswer.
 */
async function prepareExamPdfBufferForExtraction(buffer) {
  const result = {
    buffer,
    removedTailPages: 0,
    totalPages: 0,
    answerKeyByNumber: new Map(),
    printedQuestionNumbers: [],
    bodyPaperCode: '',
    keyPaperCode: '',
  };
  try {
    const { PDFParse } = await import('pdf-parse');
    const { PDFDocument } = await import('pdf-lib');
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy().catch(() => {});

    const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
    result.totalPages = pages.length || Number(parsed?.total) || 0;
    if (pages.length < 2) return result;

    const pageTexts = pages.map((p) => String(p?.text || p || ''));

    // Parse answer key from full text (before strip).
    const fullText = pageTexts.join('\n');
    result.answerKeyByNumber = parseAsliPrepTestKeyLetters(fullText);

    // Find Test Key / Answer Key page, then walk back over pure Rough Work pages.
    let keyPage = -1;
    for (let i = 0; i < pageTexts.length; i += 1) {
      if (/Test\s*Key|ANSWER\s*KEY/i.test(pageTexts[i])) {
        keyPage = i;
        break;
      }
    }

    // Paper identity, so a key page from a different sitting can be spotted.
    // AsliPrep papers print e.g. "CODE: VII – DPS/MA1_B/(2026-27)" on the body
    // and "Class: VII (MA1-N) … (2025-26)" on the key.
    if (keyPage >= 0) {
      const bodyText = pageTexts.slice(0, keyPage).join('\n');
      result.bodyPaperCode = examPaperIdentitySignature(bodyText);
      result.keyPaperCode = examPaperIdentitySignature(pageTexts[keyPage]);
    }

    let firstTail = -1;
    if (keyPage >= 0) {
      firstTail = keyPage;
      while (firstTail > 0 && isPureExamPdfTailPageText(pageTexts[firstTail - 1])) {
        firstTail -= 1;
      }
    } else {
      // No explicit key page — strip only trailing pure rough-work pages
      firstTail = pageTexts.length;
      while (firstTail > 0 && isPureExamPdfTailPageText(pageTexts[firstTail - 1])) {
        firstTail -= 1;
      }
      if (firstTail === pageTexts.length) firstTail = -1;
    }

    // Printed question numbers from the question-paper body (kept pages only).
    // Only accept numbers that continue a consecutive run from 1 — this rejects
    // false positives like "1. 0.5" entries inside Match-the-Following columns.
    {
      const bodyPages = firstTail > 0 ? pageTexts.slice(0, firstTail) : pageTexts;
      const seen = new Set();
      let expectedNext = 1;
      const re = /(?:^|\n)\s*(\d{1,3})[.)]\s+\S/g;
      for (const pageText of bodyPages) {
        let m;
        while ((m = re.exec(pageText))) {
          const n = parseInt(m[1], 10);
          if (n === expectedNext && n >= 1 && n <= 200) {
            seen.add(n);
            expectedNext = n + 1;
          }
        }
        re.lastIndex = 0;
      }
      result.printedQuestionNumbers = [...seen].sort((a, b) => a - b);
    }

    if (firstTail < 0 || firstTail === 0 || firstTail >= pageTexts.length) return result;

    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    if (src.getPageCount() !== pageTexts.length) {
      // Page-count mismatch — don't risk cutting real questions.
      return result;
    }
    const out = await PDFDocument.create();
    const keepIdx = Array.from({ length: firstTail }, (_, i) => i);
    const copied = await out.copyPages(src, keepIdx);
    copied.forEach((p) => out.addPage(p));
    const stripped = Buffer.from(await out.save());
    result.buffer = stripped;
    result.removedTailPages = pageTexts.length - firstTail;
    console.log('[PDF_EXAM_EXTRACT] stripped answer-key/rough-work tail', {
      totalPages: pageTexts.length,
      keptPages: firstTail,
      removedTailPages: result.removedTailPages,
      answerKeyEntries: result.answerKeyByNumber.size,
    });
    return result;
  } catch (e) {
    console.warn('[PDF_EXAM_EXTRACT] prepareExamPdfBufferForExtraction failed:', e?.message || e);
    return result;
  }
}

/**
 * Flag numeric-option questions whose chosen answer contradicts the model's own
 * explanation. On a paper with no usable key these are the answers most likely
 * to be wrong: the working in the explanation reaches one value while a
 * different option got selected. Flags only — never silently rewrites the
 * answer, since the explanation can be the faulty half.
 */
export function flagAnswersContradictedByExplanation(rows) {
  const numericCore = (s) =>
    String(s || '')
      .replace(/[,\s]/g, '')
      .match(/-?\d+(?:\.\d+)?/)?.[0] || '';
  const standaloneNumberInText = (num, text) => {
    if (!num) return false;
    const escaped = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Boundaries must reject 16 inside 160 or 16.5, but accept a sentence-final
    // "= 16." — a dot only continues the number when a digit follows it.
    return new RegExp(`(?<!\\d)(?<!\\d\\.)${escaped}(?!\\d)(?!\\.\\d)`).test(
      String(text || '').replace(/,/g, ''),
    );
  };

  return (rows || []).map((row) => {
    if (row?.answerConflict) return row;
    const opts = [row?.option1, row?.option2, row?.option3, row?.option4]
      .map((o) => String(o || '').trim())
      .filter(Boolean);
    if (opts.length < 3) return row;
    // Only judge short numeric choices ("20 N", "2,000 Pa", "641") — for prose
    // options the explanation rarely repeats the wording, so absence proves nothing.
    if (!opts.every((o) => o.length <= 14 && numericCore(o))) return row;

    const explanation = String(row?.explanation || '');
    if (explanation.length < 10) return row;

    const chosen = String(row?.correctAnswer || '').trim();
    const chosenNum = numericCore(chosen);
    if (!chosenNum) return row;
    if (standaloneNumberInText(chosenNum, explanation)) return row;

    const otherSupported = opts.some(
      (o) => numericCore(o) !== chosenNum && standaloneNumberInText(numericCore(o), explanation),
    );
    if (!otherSupported) return row;
    return { ...row, answerConflict: true, conflictReason: 'explanation' };
  });
}

/**
 * Printed question numbers, accepting only numbers that continue a run from 1.
 * That rejects false positives like "1. 0.5" inside a Match-the-Following
 * column, which would otherwise look like question 1.
 */
function printedQuestionNumbersFromText(text) {
  const seen = new Set();
  let expectedNext = 1;
  const re = /(?:^|\n)\s*(\d{1,3})[.)]\s+\S/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const n = parseInt(m[1], 10);
    if (n === expectedNext && n >= 1 && n <= 200) {
      seen.add(n);
      expectedNext = n + 1;
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Paper-identity fingerprint: the paper/set code (MA1_B, MA1-N…) and academic
 * year, normalized. Used to tell whether an answer-key page belongs to the
 * question paper it is stapled to. Returns '' when nothing identifiable.
 */
function examPaperIdentitySignature(text) {
  const t = String(text || '');
  const codeMatch = t.match(/\b([A-Z]{1,4}\s*\d{1,2}\s*[_\-–]\s*[A-Z]{1,2})\b/);
  const yearMatch = t.match(/\b(20\d{2})\s*[-–—]\s*(\d{2})\b/);
  const code = codeMatch ? codeMatch[1].replace(/[\s_\-–]/g, '').toUpperCase() : '';
  const year = yearMatch ? `${yearMatch[1]}-${yearMatch[2]}` : '';
  return [code, year].filter(Boolean).join('/');
}

/**
 * Does this answer key actually belong to this paper?
 *
 * A key stapled from a different sitting silently corrupts every answer, so it
 * is checked two ways: the printed paper code/year, and how often the key
 * agrees with the answers derived from reading the questions. A genuine key
 * agrees on the large majority; an unrelated one lands near chance (1 in 4).
 */
function assessAnswerKeyTrust({ rows, answerKeyByNumber, bodyPaperCode, keyPaperCode }) {
  const result = { apply: true, agreedPct: null, conflicts: [], reason: '' };
  if (!answerKeyByNumber?.size) {
    result.apply = false;
    result.reason = 'no answer key found in PDF';
    return result;
  }

  if (bodyPaperCode && keyPaperCode && bodyPaperCode !== keyPaperCode) {
    result.apply = false;
    result.reason = `answer key is for a different paper (paper ${bodyPaperCode}, key ${keyPaperCode})`;
    return result;
  }

  let compared = 0;
  for (const row of rows || []) {
    const qn = Number(row?.questionNumber);
    const letter = answerKeyByNumber.get(qn);
    if (!letter || String(row?.questionType || '').toUpperCase() === 'INTEGER') continue;
    const opts = [row.option1, row.option2, row.option3, row.option4].map((o) =>
      String(o || '').trim(),
    );
    const keyText = opts[letter.charCodeAt(0) - 97];
    if (!keyText) continue;
    const modelAnswer = String(row?.correctAnswer || '').trim();
    if (!modelAnswer) continue;
    compared += 1;
    if (modelAnswer.toLowerCase() !== keyText.toLowerCase()) {
      result.conflicts.push(qn);
    }
  }

  if (compared < 5) return result; // too little overlap to judge — trust the key
  const agreed = compared - result.conflicts.length;
  result.agreedPct = Math.round((agreed / compared) * 100);
  if (result.agreedPct < 60) {
    result.apply = false;
    result.reason =
      `answer key matches only ${result.agreedPct}% of the questions in this paper, ` +
      'so it appears to belong to a different paper';
  }
  return result;
}

/**
 * Parse Asli Prep style keys:
 *   Test Key
 *   1 2 3 4 5
 *   b b a c c
 */
function parseAsliPrepTestKeyLetters(fullText) {
  const map = new Map();
  const text = String(fullText || '');
  if (!/Test\s*Key|ANSWER\s*KEY/i.test(text)) return map;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // A key cell is a letter a-d, or a non-answer token like "Bonus" / "*" / "-"
  // (dropped questions). Non-letter tokens keep their position so the rest of
  // the row still lines up with the number row above it.
  const keyToken = /^(?:[a-dA-D]|bonus|\*|[-–—]+)$/i;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const numLine = lines[i];
    const ansLine = lines[i + 1];
    if (!/^\d+(?:\s+\d+){2,}$/.test(numLine)) continue;
    const tokens = ansLine.split(/\s+/);
    if (tokens.length < 3 || !tokens.every((t) => keyToken.test(t))) continue;
    if (tokens.filter((t) => /^[a-dA-D]$/.test(t)).length < 2) continue;
    const nums = numLine.split(/\s+/).map((n) => parseInt(n, 10));
    const n = Math.min(nums.length, tokens.length);
    for (let k = 0; k < n; k += 1) {
      const letter = tokens[k].toLowerCase();
      if (Number.isFinite(nums[k]) && /^[a-d]$/.test(letter)) {
        map.set(nums[k], letter);
      }
    }
  }
  return map;
}

function applyAnswerKeyLettersToRows(rows, answerKeyByNumber) {
  if (!Array.isArray(rows) || !answerKeyByNumber?.size) return rows;
  return rows.map((r) => {
    const qn = Number(r?.questionNumber);
    if (!Number.isFinite(qn) || qn < 1) return r;
    // Integer rows have no options, so a letter key can't map to anything —
    // overwriting the numeric answer with "a" only breaks save validation.
    if (String(r?.questionType || '').toUpperCase() === 'INTEGER') return r;
    const letter = answerKeyByNumber.get(qn);
    if (!letter) return r;
    const opts = [r.option1, r.option2, r.option3, r.option4].map((o) => String(o || '').trim());
    const idx = letter.charCodeAt(0) - 97;
    if (idx < 0 || idx > 3) return r;
    const chosen = opts[idx];
    // Multi-correct keys in this format are still single letters per Q in Asli keys.
    if (String(r.questionType || '').toUpperCase() === 'MSQ' && chosen) {
      return { ...r, correctAnswer: chosen };
    }
    if (chosen) return { ...r, correctAnswer: chosen };
    return { ...r, correctAnswer: letter };
  });
}

function optionFillScore(row) {
  const opts = [row?.option1, row?.option2, row?.option3, row?.option4].map((o) =>
    String(o || '').trim(),
  );
  const filled = opts.filter(Boolean).length;
  const totalLen = opts.reduce((acc, o) => acc + o.length, 0);
  // Filled slots dominate; option text length breaks ties (richer extraction wins).
  return filled * 10000 + Math.min(totalLen, 9999);
}

function dedupePdfQuestionRows(rows) {
  const byNumber = new Map();
  const unnumbered = [];
  for (const r of rows || []) {
    const n = Number(r?.questionNumber);
    if (Number.isFinite(n) && n >= 1) {
      const key = Math.floor(n);
      const prev = byNumber.get(key);
      if (!prev || optionFillScore(r) > optionFillScore(prev)) {
        byNumber.set(key, r);
      }
      continue;
    }
    unnumbered.push(r);
  }

  const numberedTexts = new Set(
    [...byNumber.values()].map((r) =>
      String(r?.questionText || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
    ),
  );

  const out = [...byNumber.values()];
  for (const r of unnumbered) {
    const key = String(r?.questionText || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!key || numberedTexts.has(key)) continue;
    numberedTexts.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Rupee-visible cost estimate for one extraction (gemini flash-lite pricing:
 * $0.10/M input, $0.40/M output tokens; ~₹88/USD). Estimate only — shown in
 * API meta so admins can see what each upload costs.
 */
function buildExtractionUsage(totals) {
  const usd = ((totals.promptTokens || 0) * 0.1 + (totals.outputTokens || 0) * 0.4) / 1e6;
  // Use the same rate the rest of the app displays, not a second hardcoded one.
  const rate = Number(process.env.USD_TO_INR_RATE);
  const usdToInr = Number.isFinite(rate) && rate > 0 ? rate : 88;
  return {
    geminiCalls: totals.calls || 0,
    promptTokens: totals.promptTokens || 0,
    outputTokens: totals.outputTokens || 0,
    approxCostUsd: Number(usd.toFixed(4)),
    approxCostInr: Number((usd * usdToInr).toFixed(2)),
  };
}

export async function extractQuestionsFromPdfViaGemini({
  buffer,
  mimeType = 'application/pdf',
  /** Set for Word uploads: the paper as text, since .docx cannot be inlined. */
  documentText = '',
  fastMode = false,
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

  // Strip trailing Rough Work / Test Key pages (Grade 6 style) — they confuse Gemini
  // and burn output tokens. Keep parsed keys to fill correctAnswer after extract.
  // A Word upload has no pages to strip, so the same facts are read off its text.
  const prepared = documentText
    ? {
        buffer,
        removedTailPages: 0,
        answerKeyByNumber: parseAsliPrepTestKeyLetters(documentText),
        printedQuestionNumbers: printedQuestionNumbersFromText(documentText),
        bodyPaperCode: '',
        keyPaperCode: '',
      }
    : await prepareExamPdfBufferForExtraction(buffer);
  const pdfBuffer = prepared.buffer || buffer;
  const answerKeyByNumber = prepared.answerKeyByNumber || new Map();

  console.log('[PDF_EXAM_EXTRACT] starting', {
    models: modelCandidates,
    bytes: pdfBuffer?.length || 0,
    mimeType,
    removedTailPages: prepared.removedTailPages || 0,
    answerKeyEntries: answerKeyByNumber.size,
  });

  const buildPrompt = (rangeHint = '') => `Extract exam questions from this PDF and return ONLY valid JSON.
Preferred shape: {"questions":[ ... ]}. A bare JSON array of question objects is also accepted.
Each question object must have these exact keys:
questionNumber (printed number — mandatory), hasFigure (boolean), questionText, questionType (MCQ/MSQ/integer/assertion_reason/match_following), subject, marks (number), option1, option2, option3, option4, correctAnswer, explanation.

${rangeHint}

Important rules:
- Extract EVERY matching question in scope (do not stop early).
- This PDF should already exclude answer-key / rough-work pages — do not invent key tables.
- Include Single Correct, Multi Correct (MSQ), Assertion-Reason, Case-based, and Match-the-Following when they have options a)–d).
- For Match-the-Following, put the matching codes into option1–option4 (e.g. "A-2, B-4, C-1, D-3").
- Always set questionNumber to the printed question number (1, 2, 3…). NEVER omit it — every question in the paper has a printed number.
- Set hasFigure=true when the question (or its case) refers to a picture, diagram, graph, figure, OR a Match-the-Following Column I/II table printed in the paper. Pure text/math questions (no diagram/table) get hasFigure=false.
- For subject: read from PDF section headers (Mathematics→maths, Physics→physics, Chemistry→chemistry, Biology→biology). Otherwise "".
- For MCQ/MSQ: correctAnswer may be a letter (a/b/c/d) or full option text.
- For integer: correctAnswer is the numeric answer; options can be empty strings.
- If four choices a)-d) are printed, the question is MCQ — even under an "Integer Value Type Questions" heading. Only use questionType "integer" when NO options are printed.
- Your correctAnswer must be one of the printed options and must agree with your own explanation. Work out the answer, then pick the option that matches it.
- Strip leading "Q1." / "1." from questionText only. Strip "A." / "(a)" prefixes from option bodies.
- MATH FIDELITY (critical): Copy expressions EXACTLY as printed — same parentheses, nesting, and operator order.
  Prefer Unicode: √ ∛ ² ³ − × ÷. Do NOT rewrite as "cube root of" / "sqrt" / "square root of" unless the PDF itself uses words.
  Example: printed ∛(109 + √256) + √(117² − 108²) must stay that nesting — NEVER flatten to ∛(109 + √256 + √(...)).
- CASE / PASSAGE CONTEXT (critical): For Case-Based / Comprehension questions ONLY, each dependent questionText MUST begin with that case's full passage, then the question stem.
  Do NOT attach a case/passage to unrelated questions in later sections (e.g. never paste a Chemistry case onto Biology or Match questions).
  Do NOT invent or reuse one case for the whole paper — only questions that belong to that Case I / Case II / Paragraph.
  Example:
  "Case I: A square solar learning park covers 11,025 m². … edge of 7 m.\\n\\nWhat is the side length of the square solar farm?"
  Q9 and Q10 that share Case I both get the same Case I text; Q11 under Case II gets Case II only.
- ASSERTION–REASON: Set questionType to "assertion_reason". Put Assertion into assertionText and Reason into reasonText when possible; also put both into questionText as "A: …\\nR: …". Put the four standard A/R choice lines into option1–option4. Questions that share the same Directions block share the same directions text (do not invent different directions per question).
- MATCH-THE-FOLLOWING: Set questionType to "match_following" AND hasFigure=true (the Column I/II table will be captured as a photo). Include a short stem in questionText; still put Column I / Column II text when readable. Put matching codes into option1–option4 (e.g. "A-2, B-4, C-1, D-3"). Questions under the same Match directions share that directions text.
- Return only valid JSON, no markdown, no explanation.`;

  const maxOutRaw = getPdfExtractionMaxOutputTokens();
  // Fast mode: smaller output budget → Gemini finishes each chunk sooner.
  const maxOut = fastMode ? Math.min(maxOutRaw, 16384) : maxOutRaw;
  const attemptErrors = [];
  let sawQuotaError = false;
  let sawDeniedError = false;
  // 0 / unset = no abort (papers can take many minutes; size in MB is not the limiter).
  const requestTimeoutMs = (() => {
    if (process.env.GEMINI_PDF_REQUEST_TIMEOUT_MS === undefined || process.env.GEMINI_PDF_REQUEST_TIMEOUT_MS === '') {
      return 0;
    }
    const n = Number(process.env.GEMINI_PDF_REQUEST_TIMEOUT_MS);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();

  // Hard budget on Gemini calls per upload. Every call re-sends the whole PDF,
  // so an unbounded retry cascade multiplies cost. ~6 calls handles an 80-question
  // paper (4 range chunks + gap-fill); the cap is headroom, not the normal path.
  const maxCallsPerUpload = (() => {
    const n = Number(process.env.GEMINI_PDF_MAX_CALLS);
    const fallback = fastMode ? 8 : 14;
    return Number.isFinite(n) && n >= 3 ? Math.min(n, 40) : fallback;
  })();
  const usageTotals = { calls: 0, promptTokens: 0, outputTokens: 0 };
  const callBudgetExhausted = () => usageTotals.calls >= maxCallsPerUpload;

  const fetchWithTimeout = async (url, options) => {
    if (!requestTimeoutMs) {
      return fetch(url, options);
    }
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
    if (callBudgetExhausted()) {
      return {
        ok: false,
        status: 0,
        errorText: `per-upload Gemini call budget (${maxCallsPerUpload}) exhausted`,
      };
    }
    usageTotals.calls += 1;
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

    // A Word upload has no renderable page to attach — the paper is supplied as
    // text instead, and the same prompt runs against it.
    const parts = documentText
      ? [{ text: `${promptText}\n\n--- QUESTION PAPER TEXT ---\n${documentText}` }]
      : [
          { text: promptText },
          {
            inlineData: {
              mimeType,
              data: pdfBuffer.toString('base64'),
            },
          },
        ];

    const payload = {
      contents: [{ role: 'user', parts }],
      generationConfig,
    };

    let response;
    try {
      // AIza keys authenticate by query param, AQ keys by bearer header.
      const endpoint = buildGeminiEndpoint({ baseUrl: GEMINI_BASE_URL, model, apiKey });
      response = await fetchWithTimeout(endpoint.url, {
        method: 'POST',
        headers: endpoint.headers,
        body: JSON.stringify(payload),
      });
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
    usageTotals.promptTokens += Number(data?.usageMetadata?.promptTokenCount) || 0;
    usageTotals.outputTokens += Number(data?.usageMetadata?.candidatesTokenCount) || 0;
    const parsed = parseGeminiJsonArray(data, `${model}${useStructured ? '+schema' : ''}`);
    if (!parsed) return { ok: false, status: 200, errorText: 'parse failed', finishReason: data?.candidates?.[0]?.finishReason };
    return { ok: true, parsed: parsed.rows, finishReason: parsed.finishReason };
  };

  /**
   * Text-only Gemini call. Costs a fraction of an extraction call because the
   * PDF (≈6.4k image tokens every time) is not attached.
   */
  const callGeminiText = async (model, promptText, responseSchema) => {
    if (callBudgetExhausted()) return null;
    usageTotals.calls += 1;
    let response;
    try {
      const endpoint = buildGeminiEndpoint({ baseUrl: GEMINI_BASE_URL, model, apiKey });
      response = await fetchWithTimeout(endpoint.url, {
          method: 'POST',
          headers: endpoint.headers,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: {
              temperature: 0,
              topP: 0.95,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const data = await response.json();
    usageTotals.promptTokens += Number(data?.usageMetadata?.promptTokenCount) || 0;
    usageTotals.outputTokens += Number(data?.usageMetadata?.candidatesTokenCount) || 0;
    const raw = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, ''));
    } catch {
      return null;
    }
  };

  /**
   * Re-solve each MCQ from its extracted text alone and compare with the answer
   * chosen during extraction. The extraction pass does OCR, layout parsing and
   * solving at once and slips on arithmetic, so a disagreement is a strong
   * signal that one of the two is wrong.
   *
   * It only flags — it never rewrites the answer. This pass sees the text
   * without the PDF's visual maths layout, so it is wrong often enough that
   * letting it overrule extraction turns correct answers into incorrect ones.
   * Detection is the value here; the admin resolves the flagged rows.
   */
  const verifyAnswersWithTextPass = async (model, rows) => {
    const candidates = (rows || []).filter((r) => {
      if (String(r?.questionType || '').toUpperCase() !== 'MCQ') return false;
      if (!Number.isFinite(Number(r?.questionNumber))) return false;
      return [r.option1, r.option2, r.option3, r.option4].every((o) => String(o || '').trim());
    });
    if (candidates.length === 0) return rows;

    const chosenByNumber = new Map();
    const BATCH = 20;
    // Batches are independent, so they run together rather than one after
    // another — this pass must not add tens of seconds to the request.
    const batches = [];
    for (let i = 0; i < candidates.length; i += BATCH) {
      batches.push(candidates.slice(i, i + BATCH));
    }

    const verifyResults = await Promise.all(
      batches.map((batch) => {
        if (callBudgetExhausted()) return Promise.resolve(null);
        const block = batch
          .map((r) => {
            const stem = String(r.questionText || '').replace(/\s+/g, ' ').slice(0, 700);
            return (
              `Q${r.questionNumber}: ${stem}\n` +
              `a) ${r.option1}\nb) ${r.option2}\nc) ${r.option3}\nd) ${r.option4}`
            );
          })
          .join('\n\n');
        return callGeminiText(
          model,
          'You are checking the answer key for a Grade 7 IIT/NEET foundation exam.\n' +
            'Solve each question below and return the letter of the correct option.\n' +
            'Do the arithmetic carefully and step by step in your head before choosing; ' +
            'a plausible-looking option is often a deliberate distractor.\n' +
            'Some questions carry a figure that is not shown here — for those, answer from the physics/reasoning as best you can.\n' +
            'Return one entry per question, using the exact question numbers given.\n\n' +
            block,
          ANSWER_VERIFY_RESPONSE_SCHEMA,
        );
      }),
    );

    for (const parsed of verifyResults) {
      for (const a of parsed?.answers || []) {
        const qn = Number(a?.questionNumber);
        const letter = String(a?.correctOption || '').trim().toLowerCase();
        if (Number.isFinite(qn) && /^[a-d]$/.test(letter)) chosenByNumber.set(qn, letter);
      }
    }
    if (chosenByNumber.size === 0) return rows;

    let changed = 0;
    const next = rows.map((r) => {
      const qn = Number(r?.questionNumber);
      const letter = chosenByNumber.get(qn);
      if (!letter) return r;
      const opts = [r.option1, r.option2, r.option3, r.option4].map((o) => String(o || '').trim());
      const verified = opts[letter.charCodeAt(0) - 97];
      if (!verified) return r;
      const current = String(r.correctAnswer || '').trim();
      if (current.toLowerCase() === verified.toLowerCase()) return r;
      changed += 1;
      return {
        ...r,
        answerConflict: true,
        conflictReason: 'second_opinion',
        secondOpinionAnswer: verified,
      };
    });
    console.log('[PDF_EXAM_EXTRACT] answer verification pass', {
      checked: chosenByNumber.size,
      disagreed: changed,
    });
    return next;
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

    // Fast mode: never double-send the PDF. A second unstructured call doubles
    // wall time (and often hits rate limits → 10–15 min jobs).
    const shouldLooseRetry =
      !fastMode &&
      (result.status === 400 || /schema|mime|response|parse failed/i.test(String(result.errorText || '')));
    if (!shouldLooseRetry) {
      return { ok: false, parsed: null, finishReason: result.finishReason };
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

  /** Run async work with a hard concurrency cap (avoids Gemini rate-limit pileups). */
  const mapPool = async (items, concurrency, fn) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const results = new Array(list.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), list.length) }, async () => {
      while (next < list.length) {
        const idx = next;
        next += 1;
        results[idx] = await fn(list[idx], idx);
      }
    });
    await Promise.all(workers);
    return results;
  };

  // Papers of unknown size fall back to these ranges when the first pass fails.
  const FALLBACK_RANGE_CHUNKS = fastMode
    ? [
        [1, 40],
        [41, 80],
      ]
    : [
        [1, 20],
        [21, 40],
        [41, 60],
        [61, 80],
        [81, 120],
      ];

  const presentQuestionNumbers = (rows) => {
    const set = new Set();
    for (const r of rows || []) {
      const n = Number(r?.questionNumber);
      if (Number.isFinite(n) && n >= 1) set.add(Math.floor(n));
    }
    return set;
  };

  // Ground truth for "which questions exist": answer key ∪ printed numbers from
  // the PDF text layer (covers Bonus questions the key skips).
  const expectedNumbers = (() => {
    const set = new Set(prepared.printedQuestionNumbers || []);
    for (const n of answerKeyByNumber.keys()) set.add(n);
    // Cap runaway detections (Match column "1."/"2." noise, etc.)
    const sorted = [...set].filter((n) => n >= 1 && n <= 120).sort((a, b) => a - b);
    return sorted;
  })();

  const missingQuestionNumbers = (rows) => {
    const present = presentQuestionNumbers(rows);
    return expectedNumbers.filter((n) => !present.has(n));
  };

  /** Batch missing ids into small prompts, e.g. [14,15,57,58] → "14, 15, 57, 58" */
  const chunkMissingIds = (ids, size = 6) => {
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
    return out;
  };

  const geminiConcurrency = fastMode ? 2 : 3;
  const rangeChunkSize = fastMode ? 40 : 20;
  const extractStartedAt = Date.now();

  for (const model of modelCandidates) {
    if (callBudgetExhausted()) break;
    const collected = [];
    let truncated = false;
    const maxExpected = expectedNumbers.length ? expectedNumbers[expectedNumbers.length - 1] : 0;

    // Fast + known size ≤40: one full-paper call beats multiple overlapping PDFs.
    // Large papers: skip full pass (Flash often stops early) and use range chunks.
    const skipFullPass = fastMode ? maxExpected > 40 : maxExpected >= 30;

    if (!skipFullPass) {
      console.log('[PDF_EXAM_EXTRACT] full-paper pass', { model, fastMode, maxExpected });
      const full = await extractOnce(
        model,
        'Scope: extract ALL questions from the question paper body (not the answer key). Include every printed question number.',
      );
      if (full.ok && Array.isArray(full.parsed)) {
        collected.push(...full.parsed);
        if (full.finishReason === 'MAX_TOKENS') truncated = true;
      }
    }

    let refined = postProcessGeminiPdfQuestionRows(collected);
    const shouldChunk =
      skipFullPass || truncated || refined.length === 0 || missingQuestionNumbers(refined).length > 0;

    if (shouldChunk) {
      const ranges =
        maxExpected > 0
          ? Array.from({ length: Math.ceil(maxExpected / rangeChunkSize) }, (_, i) => [
              i * rangeChunkSize + 1,
              Math.min(i * rangeChunkSize + rangeChunkSize, maxExpected),
            ])
          : FALLBACK_RANGE_CHUNKS;
      const missingBefore = new Set(missingQuestionNumbers(refined));
      let rangesToRun = ranges.filter(([from, to]) => {
        if (expectedNumbers.length === 0 || refined.length === 0) return true;
        return [...missingBefore].some((n) => n >= from && n <= to);
      });
      // Hard cap: never fire more than 3 full-PDF range calls in fast mode.
      if (fastMode && rangesToRun.length > 3) {
        rangesToRun = rangesToRun.slice(0, 3);
      }
      console.log('[PDF_EXAM_EXTRACT] chunking by question ranges', {
        model,
        firstPass: refined.length,
        skipFullPass,
        maxExpected,
        truncated,
        ranges: rangesToRun.length,
        chunkSize: rangeChunkSize,
        concurrency: geminiConcurrency,
        elapsedMs: Date.now() - extractStartedAt,
      });

      const chunkResults = await mapPool(rangesToRun, geminiConcurrency, ([from, to]) =>
        callBudgetExhausted()
          ? Promise.resolve(null)
          : extractOnce(
              model,
              `Scope: extract ONLY questions numbered ${from} through ${to} (inclusive). ` +
                `You must return every question in this range that appears in the paper. ` +
                `Skip any question outside this range.`,
            ),
      );

      for (const chunk of chunkResults) {
        if (chunk?.ok && Array.isArray(chunk.parsed)) {
          collected.push(...chunk.parsed);
          if (chunk.finishReason === 'MAX_TOKENS') truncated = true;
        }
      }
      refined = postProcessGeminiPdfQuestionRows(collected);
    }

    refined = dedupePdfQuestionRows(refined);

    // Gap-fill: in fast mode still fill gaps when coverage is incomplete.
    let missing = missingQuestionNumbers(refined);
    const coverage =
      expectedNumbers.length > 0 ? refined.length / Math.max(expectedNumbers.length, 1) : 1;
    const doGapFill =
      missing.length > 0 &&
      !callBudgetExhausted() &&
      (!fastMode || coverage < 0.95);
    let gapPass = 0;
    const maxGapPasses = fastMode ? 2 : 2;
    while (doGapFill && missing.length > 0 && gapPass < maxGapPasses && !callBudgetExhausted()) {
      gapPass += 1;
      const batchSize = fastMode ? 12 : gapPass === 1 ? 6 : 1;
      // Fast: up to 4 gap batches (covers ≤48 missing).
      const batches = chunkMissingIds(missing, batchSize).slice(0, fastMode ? 4 : 8);
      console.log('[PDF_EXAM_EXTRACT] gap-fill missing numbers', {
        model,
        pass: gapPass,
        batchSize,
        missingCount: missing.length,
        batches: batches.length,
        coverage: Number(coverage.toFixed(2)),
        missing: missing.slice(0, 20),
        elapsedMs: Date.now() - extractStartedAt,
      });
      const gapResults = await mapPool(batches, geminiConcurrency, (batch) => {
        if (callBudgetExhausted()) return Promise.resolve(null);
        const list = batch.join(', ');
        const alone = batch.length === 1;
        return extractOnce(
          model,
          alone
            ? `Scope: extract ONLY question number ${batch[0]}. ` +
              `This is mandatory — locate the printed "${batch[0]}." question in the paper and return exactly one object. ` +
              `Set questionNumber to ${batch[0]}. Include Match-the-Following / Assertion-Reason / Case-based if that is Q${batch[0]}. ` +
              `If it is case-based, questionText MUST include the full Case/passage paragraph first, then the question stem. ` +
              `Copy all four options a)–d) into option1–option4.`
            : `Scope: extract ONLY these exact question numbers: ${list}. ` +
              `Return one object per number if that question exists in the paper. ` +
              `Set questionNumber exactly. For case-based items, include the full case/passage in questionText. ` +
              `Do not skip Match-the-Following or Assertion-Reason items.`,
        ).then((chunk) => {
          if (
            alone &&
            chunk?.ok &&
            Array.isArray(chunk.parsed) &&
            chunk.parsed.length === 1 &&
            !Number(chunk.parsed[0]?.questionNumber)
          ) {
            chunk.parsed[0].questionNumber = batch[0];
          }
          return chunk;
        });
      });
      for (const chunk of gapResults) {
        if (chunk?.ok && Array.isArray(chunk.parsed)) {
          collected.push(...chunk.parsed);
        }
      }
      refined = dedupePdfQuestionRows(postProcessGeminiPdfQuestionRows(collected));
      missing = missingQuestionNumbers(refined);
      if (missing.length === 0) break;
    }

    // Once every expected printed number is present, unnumbered leftovers are
    // duplicate re-extractions with formatting drift — drop them.
    if (expectedNumbers.length > 0 && missingQuestionNumbers(refined).length === 0) {
      refined = refined.filter((r) => Number.isFinite(Number(r?.questionNumber)));
    }

    const keyTrust = assessAnswerKeyTrust({
      rows: refined,
      answerKeyByNumber,
      bodyPaperCode: prepared.bodyPaperCode,
      keyPaperCode: prepared.keyPaperCode,
    });
    if (keyTrust.apply) {
      refined = applyAnswerKeyLettersToRows(refined, answerKeyByNumber);
      // Key won, but where it disagreed the admin should look before publishing.
      const conflictSet = new Set(keyTrust.conflicts);
      refined = refined.map((r) =>
        conflictSet.has(Number(r?.questionNumber))
          ? { ...r, answerConflict: true, conflictReason: 'printed_key' }
          : r,
      );
    } else {
      console.warn('[PDF_EXAM_EXTRACT] answer key NOT applied:', keyTrust.reason);
      // Fast mode skips extra answer-verification passes to reduce latency.
      if (!fastMode) {
        // No trustworthy key, so the answers must stand on their own: re-solve
        // them independently, then surface any the explanation contradicts.
        refined = await verifyAnswersWithTextPass(model, refined);
        refined = flagAnswersContradictedByExplanation(refined);
      }
    }

    // Prefer stable order by printed question number when available
    refined.sort((a, b) => {
      const an = Number(a?.questionNumber);
      const bn = Number(b?.questionNumber);
      const aOk = Number.isFinite(an) ? an : Number.MAX_SAFE_INTEGER;
      const bOk = Number.isFinite(bn) ? bn : Number.MAX_SAFE_INTEGER;
      if (aOk !== bOk) return aOk - bOk;
      return String(a?.questionText || '').localeCompare(String(b?.questionText || ''));
    });

    console.log('[PDF_EXAM_EXTRACT] model result', {
      model,
      count: refined.length,
      truncated,
      answerKeyApplied: answerKeyByNumber.size,
      stillMissing: missingQuestionNumbers(refined).slice(0, 20),
      geminiCalls: usageTotals.calls,
      promptTokens: usageTotals.promptTokens,
      outputTokens: usageTotals.outputTokens,
      elapsedMs: Date.now() - extractStartedAt,
      fastMode,
    });
    if (refined.length > 0) {
      return {
        rows: refined,
        usage: buildExtractionUsage(usageTotals),
        answerKey: {
          found: answerKeyByNumber.size > 0,
          applied: keyTrust.apply,
          agreedPct: keyTrust.agreedPct,
          conflictCount: refined.filter((r) => r?.answerConflict).length,
          reason: keyTrust.reason,
        },
      };
    }
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

const DEFAULT_ASSERTION_REASON_DIRECTIONS = 'Directions: Each question is followed by four options: a), b), c), and d).\\nChoose the correct answer based on the given Assertion (A) and Reason (R).\\na) Both A and R are true, and R is the correct explanation of A.\\nb) Both A and R are true, but R is not the correct explanation of A.\\nc) A is true, but R is false.\\nd) A is false, but R is true.';

const ALLOWED_QUESTION_TYPES = ['mcq', 'multiple', 'integer', 'assertion_reason', 'match_following'];

/**
 * Extract a numeric integer answer from PDF/Gemini output.
 * Accepts: 42, "42", "-3", "10.0", "Ans: 25", "25 marks", " = 7 ", etc.
 */
function parseIntegerAnswer(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.trunc(raw);
  }
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Strip common wrappers / labels
  s = s
    .replace(/^(?:ans(?:wer)?|correct(?:\s*answer)?|key|sol(?:ution)?)\s*[:.\-=]?\s*/i, '')
    .replace(/,/g, '')
    .trim();
  // Pure integer or whole float
  if (/^[+-]?\d+(?:\.0+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  // First signed integer token in the string (ignore units / trailing text)
  const m = s.match(/[+-]?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

const isChoiceQuestionType = (t) =>
  t === 'mcq' || t === 'multiple' || t === 'assertion_reason' || t === 'match_following';

const isSingleChoiceQuestionType = (t) =>
  t === 'mcq' || t === 'assertion_reason' || t === 'match_following';

function normalizeMatchColumnList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const m = String(item).match(/^\s*([A-D]|\d{1,2})\s*[.):\-]?\s*(.*)$/i);
        if (m) return { key: m[1], text: String(m[2] || '').trim() };
        return { key: '', text: String(item).trim() };
      }
      return {
        key: String(item?.key || '').trim(),
        text: String(item?.text || '').trim(),
      };
    })
    .filter((x) => x.text);
}

function pickSharedMatterFields(body = {}) {
  const sharedMatterId = String(body.sharedMatterId || body.passageId || '').trim();
  const sharedMatterText = String(body.sharedMatterText || body.passageText || '').trim();
  const kindRaw = String(body.sharedMatterKind || '').trim().toLowerCase();
  const sharedMatterKind = ['case', 'assertion_reason', 'match_following'].includes(kindRaw)
    ? kindRaw
    : sharedMatterText
      ? 'case'
      : '';
  return {
    sharedMatterId,
    sharedMatterText,
    sharedMatterKind,
    assertionText: String(body.assertionText || '').trim(),
    reasonText: String(body.reasonText || '').trim(),
    matchColumnI: normalizeMatchColumnList(body.matchColumnI),
    matchColumnII: normalizeMatchColumnList(body.matchColumnII),
  };
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

    const parsedDuration = parseInt(duration, 10);
    if (!Number.isFinite(parsedDuration) || parsedDuration < 1) {
      return res.status(400).json({
        success: false,
        message: 'duration must be a number >= 1 (minutes)',
      });
    }

    const parsedTotalQuestions = parseInt(totalQuestions, 10);
    if (!Number.isFinite(parsedTotalQuestions) || parsedTotalQuestions < 1) {
      return res.status(400).json({
        success: false,
        message: 'totalQuestions must be a number >= 1',
      });
    }

    const parsedTotalMarks = parseInt(totalMarks, 10);
    if (!Number.isFinite(parsedTotalMarks) || parsedTotalMarks < 1) {
      return res.status(400).json({
        success: false,
        message: 'totalMarks must be a number >= 1',
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
      });
    }
    const parsedStart = new Date(startDate);
    const parsedEnd = new Date(endDate);
    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate must be valid dates',
      });
    }
    if (parsedEnd < parsedStart) {
      return res.status(400).json({
        success: false,
        message: 'endDate must be on or after startDate',
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
      duration: parsedDuration,
      totalQuestions: parsedTotalQuestions,
      totalMarks: parsedTotalMarks,
      instructions: instructions?.trim() || '',
      startDate: parsedStart,
      endDate: parsedEnd,
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
    if (startDate || endDate) {
      const nextStart = startDate ? new Date(startDate) : exam.startDate;
      const nextEnd = endDate ? new Date(endDate) : exam.endDate;
      if (startDate && Number.isNaN(nextStart.getTime())) {
        return res.status(400).json({ success: false, message: 'startDate must be a valid date' });
      }
      if (endDate && Number.isNaN(nextEnd.getTime())) {
        return res.status(400).json({ success: false, message: 'endDate must be a valid date' });
      }
      if (nextStart && nextEnd && nextEnd < nextStart) {
        return res.status(400).json({
          success: false,
          message: 'endDate must be on or after startDate',
        });
      }
      if (startDate) exam.startDate = nextStart;
      if (endDate) exam.endDate = nextEnd;
    }
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
      replaceDuplicate = false,
      sharedMatterId,
      sharedMatterText,
      sharedMatterKind,
      assertionText,
      reasonText,
      matchColumnI,
      matchColumnII,
      passageId,
      passageText,
    } = req.body;

    const matterFields = pickSharedMatterFields({
      sharedMatterId,
      sharedMatterText,
      sharedMatterKind,
      assertionText,
      reasonText,
      matchColumnI,
      matchColumnII,
      passageId,
      passageText,
    });

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

    const normalizedType = String(questionType || 'mcq').trim().toLowerCase();
    if (normalizedType === 'assertion_reason' && !matterFields.sharedMatterText) {
      matterFields.sharedMatterText = DEFAULT_ASSERTION_REASON_DIRECTIONS;
      matterFields.sharedMatterKind = matterFields.sharedMatterKind || 'assertion_reason';
    }
    if (!ALLOWED_QUESTION_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid questionType. Use one of: ${ALLOWED_QUESTION_TYPES.join(', ')}`,
      });
    }

    if (isChoiceQuestionType(normalizedType) && (!options || options.length === 0)) {
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
    
    if (normalizedType === 'integer') {
      formattedCorrectAnswer = parseIntegerAnswer(correctAnswer);
      if (formattedCorrectAnswer === null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid integer answer — expected a number (e.g. 42 or Ans: 42)',
        });
      }
    } else if (normalizedType === 'multiple' && Array.isArray(correctAnswer)) {
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
    } else if (isSingleChoiceQuestionType(normalizedType) && options && options.length > 0) {
      // For single MCQ / AR / Match, convert index to option text
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
      questionType: normalizedType,
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
    const finalOptions = normalizedType === 'integer'
      ? []
      : (options || []).map((opt) => {
          const text = typeof opt === 'string' ? opt : (opt?.text ?? '');
          return { text: String(text), isCorrect: false };
        });

    if (isSingleChoiceQuestionType(normalizedType)) {
      const correctText = String(formattedCorrectAnswer || '').trim().toLowerCase();
      const idx = finalOptions.findIndex(
        (o) => String(o.text || '').trim().toLowerCase() === correctText
      );
      if (idx >= 0) finalOptions[idx].isCorrect = true;
    } else if (normalizedType === 'multiple' && Array.isArray(formattedCorrectAnswer)) {
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
      questionType: normalizedType,
      questionText: finalQuestionText,
      questionImage: finalQuestionImage,
    });
    const existingQuestions = await Question.find(
      { exam: examId, subject: normalizedQuestionSubject, questionType: normalizedType },
      { _id: 1, questionText: 1, questionImage: 1, marks: 1 }
    ).lean();
    const duplicateQuestion = existingQuestions.find((q) => {
      const key = buildQuestionDedupKey({
        examId,
        subject: normalizedQuestionSubject,
        questionType: normalizedType,
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
      questionType: normalizedType,
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
      ...matterFields,
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
    const lines = splitCsvRecords(csvData);
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
    const lines = splitCsvRecords(csvData);
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
        if (!ALLOWED_QUESTION_TYPES.includes(questionType)) {
          errors.push(`Row ${i + 1}: Invalid questionType "${questionType}". Must be one of: ${ALLOWED_QUESTION_TYPES.join(', ')}`);
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

        // Parse options for MCQ/Multiple/AR/Match
        let options = [];
        if (isChoiceQuestionType(questionType)) {
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
          if (!integerAns && integerAns !== 0) {
            errors.push(`Row ${i + 1}: integerAnswer is required for integer type questions`);
            continue;
          }
          const parsedInt = parseIntegerAnswer(integerAns);
          if (parsedInt === null) {
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
          needsReview: ['true', '1', 'yes'].includes(
            String(getRowValue('needsreview', 'needs_review') || '').trim().toLowerCase(),
          ),
          reviewNote: getRowValue('reviewnote', 'review_note') || '',
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

async function buildPdfConvertPayload({
  examId,
  buffer,
  mimeType,
  originalname,
  documentText: initialDocumentText = '',
  onProgress,
  fastMode = false,
}) {
  const mime = String(mimeType || '').toLowerCase();
  const isDocx = isDocxUpload(originalname, mimeType);
  if (!mime.includes('pdf') && !isDocx) {
    const err = new Error('Only PDF or Word (.docx) files are allowed');
    err.status = 400;
    throw err;
  }

  let documentText = String(initialDocumentText || '');
  if (isDocx) {
    try {
      const parsedDocx = extractDocxQuestionPaper(buffer);
      documentText = parsedDocx.text;
    } catch (docxError) {
      const err = new Error(`Could not read that Word file: ${docxError.message}`);
      err.status = 400;
      throw err;
    }
    if (documentText.trim().length < 40) {
      const err = new Error(
        'That Word file contains no readable text. If the questions are pictures inside the document, upload the paper as a PDF instead.',
      );
      err.status = 422;
      throw err;
    }
  }

  onProgress?.('Reading paper with Gemini…');
  const { rows, usage, answerKey } = await extractQuestionsFromPdfViaGemini({
    buffer,
    mimeType: mimeType || 'application/pdf',
    documentText,
    fastMode,
  });

  const mapExtractedType = (raw) => {
    const t = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (t === 'MSQ' || t === 'MULTIPLE') return 'multiple';
    if (t === 'INTEGER') return 'integer';
    if (t === 'ASSERTION_REASON' || t === 'ASSERTIONREASON' || t === 'AR') return 'assertion_reason';
    if (t === 'MATCH_FOLLOWING' || t === 'MATCHTHEFOLLOWING' || t === 'MATCH') return 'match_following';
    return 'mcq';
  };

  const normalizedBase = rows
    .map((r, idx) => {
      const mappedType = mapExtractedType(r?.questionType);
      const subject = String(r?.subject ?? '').trim().toLowerCase();
      const marks = Number(r?.marks);
      const qn = Number(r?.questionNumber);
      return {
        row: idx + 1,
        questionNumber: Number.isFinite(qn) && qn >= 1 ? Math.floor(qn) : undefined,
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
        questionImage: String(r?.questionImage || '').trim(),
        hasFigure: r?.hasFigure === true,
        answerConflict: r?.answerConflict === true,
        conflictReason: String(r?.conflictReason || ''),
        secondOpinionAnswer: String(r?.secondOpinionAnswer || '').trim(),
        passageId: String(r?.passageId || '').trim(),
        passageText: String(r?.passageText || '').trim(),
        sharedMatterId: String(r?.sharedMatterId || r?.passageId || '').trim(),
        sharedMatterText: String(r?.sharedMatterText || r?.passageText || '').trim(),
        sharedMatterKind: String(r?.sharedMatterKind || '').trim(),
        assertionText: String(r?.assertionText || '').trim(),
        reasonText: String(r?.reasonText || '').trim(),
        matchColumnI: Array.isArray(r?.matchColumnI) ? r.matchColumnI : [],
        matchColumnII: Array.isArray(r?.matchColumnII) ? r.matchColumnII : [],
      };
    })
    .filter((r) => r.questionText);

  let enriched = { rows: normalizedBase, meta: {} };
  if (fastMode) {
    // Fast Gemini path: shared matter + diagram embeds (not full-page shots).
    // Match tables still get a page screenshot; diagram Qs get cropped embeds only.
    onProgress?.('Attaching shared matter…');
    const {
      attachSharedMatterLightweight,
      attachPdfFiguresToRows,
      ensureAssertionReasonDirections,
      applyExtractionValidation,
    } = await import('../services/exam-pdf-enrichment.js');
    enriched = await attachSharedMatterLightweight({
      rows: normalizedBase,
      fullText: documentText,
      pdfBuffer: isDocx ? null : buffer,
    });
    if (!isDocx && buffer) {
      onProgress?.('Attaching diagram images…');
      const figureStarted = Date.now();
      try {
        // Always await figure attach — racing a short timeout was dropping photos
        // while text extract finished. Soft ceiling via env only.
        const timeoutMs = Number(process.env.PDF_FIGURE_ATTACH_TIMEOUT_MS) || 180000;
        const figurePromise = attachPdfFiguresToRows(buffer, enriched.rows || [], {
          examId,
          fast: true,
        });
        const rowsWithFigures = await Promise.race([
          figurePromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`figure attach exceeded ${timeoutMs}ms`)), timeoutMs),
          ),
        ]).catch(async (err) => {
          console.warn('[PDF_EXAM_EXTRACT] figure attach issue:', err?.message || err);
          // Last chance: if the real promise still settles soon, use it
          try {
            return await Promise.race([
              figurePromise,
              new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
            ]);
          } catch {
            return null;
          }
        });
        if (Array.isArray(rowsWithFigures)) {
          enriched = { ...enriched, rows: rowsWithFigures };
          console.log('[PDF_EXAM_EXTRACT] figure attach finished', {
            withImages: rowsWithFigures.filter((r) => r.questionImage).length,
            elapsedMs: Date.now() - figureStarted,
          });
        } else {
          console.warn('[PDF_EXAM_EXTRACT] figure attach produced no rows; keeping text-only', {
            elapsedMs: Date.now() - figureStarted,
          });
        }
      } catch (figErr) {
        console.warn('[PDF_EXAM_EXTRACT] figure attach skipped:', figErr?.message || figErr);
      }
    }
    // Directions / flags AFTER photos so diagram images are not wiped, and AR
    // still gets directions (AR images are cleared on purpose).
    enriched = {
      ...enriched,
      rows: applyExtractionValidation(ensureAssertionReasonDirections(enriched.rows || [])),
    };
  } else {
    onProgress?.('Enriching questions (passages / figures)…');
    enriched = await enrichExtractedExamQuestions({
      pdfBuffer: isDocx ? null : buffer,
      fullText: documentText,
      rows: normalizedBase,
      examId,
    });
  }

  const normalized = (enriched.rows || []).map((r, idx) => {
    const flags = Array.isArray(r.validationFlags) ? [...r.validationFlags] : [];
    let note = String(r.validationNote || '');
    if (r.answerConflict === true && !flags.includes('answer_conflict')) {
      flags.push('answer_conflict');
    }
    if (r.answerConflict === true && !note) {
      const second = String(r.secondOpinionAnswer || '').trim();
      note =
        r.conflictReason === 'second_opinion' && second
          ? `Answer needs checking — solving this question again gives "${second.slice(0, 60)}"`
          : r.conflictReason === 'explanation'
            ? "Answer needs checking — this question's own explanation points to a different option"
            : r.conflictReason === 'printed_key'
              ? "Answer needs checking — the paper's printed key disagrees with the question"
              : 'Answer needs checking';
    }
    const solvable = flags.length === 0 && r.answerConflict !== true;
    return {
      ...r,
      row: idx + 1,
      questionImage: String(r.questionImage || '').trim(),
      passageText: String(r.passageText || '').trim(),
      passageId: String(r.passageId || r.sharedMatterId || '').trim(),
      sharedMatterId: String(r.sharedMatterId || r.passageId || '').trim(),
      sharedMatterText: String(r.sharedMatterText || '').trim(),
      sharedMatterKind: String(r.sharedMatterKind || '').trim(),
      assertionText: String(r.assertionText || '').trim(),
      reasonText: String(r.reasonText || '').trim(),
      matchColumnI: Array.isArray(r.matchColumnI) ? r.matchColumnI : [],
      matchColumnII: Array.isArray(r.matchColumnII) ? r.matchColumnII : [],
      solvable,
      validationFlags: flags,
      validationNote: note || (solvable ? '' : String(r.validationNote || 'Needs review')),
    };
  });

  const flagged = normalized.filter((r) => !r.solvable).length;
  const withImages = normalized.filter((r) => r.questionImage).length;
  const message =
    `Extracted ${normalized.length} question(s) from PDF` +
    (withImages ? `, ${withImages} with figure(s)` : '') +
    (flagged ? `, ${flagged} flagged for review` : '') +
    '. ' +
    (answerKey?.found && !answerKey?.applied
      ? `WARNING: the printed answer key was NOT used because ${answerKey.reason}. ` +
        'Answers below were read from the questions themselves — please check them before saving.'
      : answerKey?.applied && answerKey?.conflictCount
        ? `Printed answer key applied; ${answerKey.conflictCount} question(s) where it disagrees are flagged.`
        : answerKey?.applied
          ? 'Printed answer key applied.'
          : 'No printed answer key found — answers were read from the questions.');

  return {
    success: true,
    data: normalized,
    meta: {
      ...(enriched.meta || {}),
      flaggedCount: flagged,
      withImages,
      extraction: usage,
      answerKey,
    },
    message,
  };
}

// Convert PDF questions to normalized row format for preview / CSV download.
// Runs as a background job so nginx's ~5 min proxy_read_timeout cannot 504 the browser.
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
    const isDocx = isDocxUpload(req.file.originalname, req.file.mimetype);
    if (!mime.includes('pdf') && !isDocx) {
      return res.status(400).json({
        success: false,
        message: 'Only PDF or Word (.docx) files are allowed',
      });
    }

    let documentText = '';
    if (isDocx) {
      try {
        const parsedDocx = extractDocxQuestionPaper(req.file.buffer);
        documentText = parsedDocx.text;
      } catch (docxError) {
        return res.status(400).json({
          success: false,
          message: `Could not read that Word file: ${docxError.message}`,
        });
      }
      if (documentText.trim().length < 40) {
        return res.status(422).json({
          success: false,
          message:
            'That Word file contains no readable text. If the questions are pictures inside the document, upload the paper as a PDF instead.',
        });
      }
    }

    // Default FAST extract (fewer Gemini round-trips). Photos still attach via
    // screenshot/embed. Pass thoroughMode=true (or fastMode=false) for extra
    // gap-fill + answer verification (often 5–10+ minutes on large papers).
    const thorough =
      String(req.body?.thoroughMode ?? req.query?.thoroughMode ?? '0').toLowerCase() === 'true';
    const fastRaw = String(req.body?.fastMode ?? req.query?.fastMode ?? (thorough ? 'false' : 'true')).toLowerCase();
    const fastMode = !thorough && (fastRaw === 'true' || fastRaw === '1' || fastRaw === 'yes');

    const {
      createExamPdfConvertJob,
      runExamPdfConvertJob,
    } = await import('../services/exam-pdf-convert-job-service.js');

    const fileBuffer = Buffer.from(req.file.buffer);
    const mimeType = req.file.mimetype || 'application/pdf';
    const originalname = req.file.originalname || 'paper.pdf';
    const job = createExamPdfConvertJob({
      examId: String(examId),
      originalname,
      userId: String(req.user?._id || req.user?.id || ''),
      fastMode,
    });

    // Fire-and-forget — client polls GET …/pdf-convert/jobs/:jobId
    setImmediate(() => {
      void runExamPdfConvertJob(job.id, (onProgress) =>
        buildPdfConvertPayload({
          examId,
          buffer: fileBuffer,
          mimeType,
          originalname,
          documentText,
          onProgress,
          fastMode,
        }),
      );
    });

    return res.status(202).json({
      success: true,
      async: true,
      jobId: job.id,
      message: `Extraction started (${fastMode ? 'fast mode' : 'full mode'}). Poll job status until complete.`,
    });
  } catch (error) {
    console.error('❌ convertPdfToQuestions error:', error);
    const msg = String(error?.message || 'Failed to extract questions from PDF');
    const status =
      error?.status ||
      (/Gemini API key is missing/i.test(msg) ? 503 :
      /quota exceeded|resource_exhausted|429/i.test(msg) ? 429 :
      msg.includes('Gemini PDF extraction failed') || msg.includes('Gemini PDF upload blocked') ? 502 :
      msg.includes('invalid JSON') || msg.includes('did not return a JSON array') ? 422 :
      500);
    return res.status(status).json({
      success: false,
      message: msg,
    });
  }
};

export const getPdfConvertJobStatus = async (req, res) => {
  try {
    const { examId, jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID format' });
    }
    const exam = await Exam.findById(examId).select('_id createdByRole');
    if (!exam || exam.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found or not accessible' });
    }

    const { getExamPdfConvertJob } = await import('../services/exam-pdf-convert-job-service.js');
    const job = getExamPdfConvertJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Extraction job not found or expired' });
    }
    if (String(job.meta?.examId || '') !== String(examId)) {
      return res.status(404).json({ success: false, message: 'Extraction job not found for this exam' });
    }

    if (job.status === 'failed') {
      return res.status(200).json({
        success: false,
        async: true,
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        message: job.error || 'Extraction failed',
      });
    }

    if (job.status === 'completed' && job.result) {
      return res.json({
        success: true,
        async: true,
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        data: job.result.data,
        meta: job.result.meta,
        message: job.result.message,
      });
    }

    return res.json({
      success: true,
      async: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress || 'Working…',
      message: job.progress || 'Extraction in progress',
    });
  } catch (error) {
    console.error('❌ getPdfConvertJobStatus error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to read extraction job status',
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
      sharedMatterId,
      sharedMatterText,
      sharedMatterKind,
      assertionText,
      reasonText,
      matchColumnI,
      matchColumnII,
      passageId,
      passageText,
      applySharedMatterToGroup,
    } = req.body || {};

    const contentUpdateRequested =
      questionText !== undefined ||
      questionImage !== undefined ||
      questionType !== undefined ||
      options !== undefined ||
      correctAnswer !== undefined ||
      sharedMatterText !== undefined ||
      assertionText !== undefined ||
      reasonText !== undefined ||
      matchColumnI !== undefined ||
      matchColumnII !== undefined;

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

    // A content edit means a human has looked at this question, so the
    // "needs review" warning has served its purpose. Reordering or retagging
    // is not a review and deliberately leaves the flag alone.
    if (contentUpdateRequested) {
      questionToUpdate.needsReview = false;
      questionToUpdate.reviewNote = '';
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
    const nextType = ALLOWED_QUESTION_TYPES.includes(nextTypeRaw) ? nextTypeRaw : null;
    if (questionType !== undefined && !nextType) {
      return res.status(400).json({
        success: false,
        message: `Invalid questionType. Use one of: ${ALLOWED_QUESTION_TYPES.join(', ')}`,
      });
    }
    if (nextType) {
      questionToUpdate.questionType = nextType;
    }

    // Shared matter / AR / Match structured fields
    if (
      sharedMatterId !== undefined ||
      sharedMatterText !== undefined ||
      sharedMatterKind !== undefined ||
      assertionText !== undefined ||
      reasonText !== undefined ||
      matchColumnI !== undefined ||
      matchColumnII !== undefined ||
      passageId !== undefined ||
      passageText !== undefined
    ) {
      const matterFields = pickSharedMatterFields({
        sharedMatterId:
          sharedMatterId !== undefined ? sharedMatterId : questionToUpdate.sharedMatterId,
        sharedMatterText:
          sharedMatterText !== undefined ? sharedMatterText : questionToUpdate.sharedMatterText,
        sharedMatterKind:
          sharedMatterKind !== undefined ? sharedMatterKind : questionToUpdate.sharedMatterKind,
        assertionText:
          assertionText !== undefined ? assertionText : questionToUpdate.assertionText,
        reasonText: reasonText !== undefined ? reasonText : questionToUpdate.reasonText,
        matchColumnI:
          matchColumnI !== undefined ? matchColumnI : questionToUpdate.matchColumnI,
        matchColumnII:
          matchColumnII !== undefined ? matchColumnII : questionToUpdate.matchColumnII,
        passageId,
        passageText,
      });
      if (questionToUpdate.questionType === 'assertion_reason' && !matterFields.sharedMatterText) {
        matterFields.sharedMatterText = DEFAULT_ASSERTION_REASON_DIRECTIONS;
        matterFields.sharedMatterKind = matterFields.sharedMatterKind || 'assertion_reason';
      }
      Object.assign(questionToUpdate, matterFields);

      // Propagate shared matter text to all questions in the same group
      if (
        applySharedMatterToGroup &&
        matterFields.sharedMatterId &&
        matterFields.sharedMatterText
      ) {
        await Question.updateMany(
          {
            exam: examId,
            sharedMatterId: matterFields.sharedMatterId,
            _id: { $ne: questionId },
          },
          {
            $set: {
              sharedMatterText: matterFields.sharedMatterText,
              sharedMatterKind: matterFields.sharedMatterKind || '',
            },
          },
        );
      }
    }

    // Full content update: reformat options + correctAnswer like addQuestion
    if (contentUpdateRequested && (options !== undefined || correctAnswer !== undefined || questionType !== undefined)) {
      const effectiveType = questionToUpdate.questionType;
      const incomingOptions = options !== undefined ? options : questionToUpdate.options;
      let formattedCorrectAnswer =
        correctAnswer !== undefined ? correctAnswer : questionToUpdate.correctAnswer;

      if (isChoiceQuestionType(effectiveType) && (!incomingOptions || incomingOptions.length === 0)) {
        return res.status(400).json({
          success: false,
          message: 'Options are required for MCQ and Multiple Choice questions',
        });
      }

      if (effectiveType === 'integer') {
        formattedCorrectAnswer = parseIntegerAnswer(formattedCorrectAnswer);
        if (formattedCorrectAnswer === null) {
          return res.status(400).json({
            success: false,
            message: 'Invalid integer answer — expected a number (e.g. 42 or Ans: 42)',
          });
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
      } else if (isSingleChoiceQuestionType(effectiveType) && incomingOptions && incomingOptions.length > 0) {
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

      if (isSingleChoiceQuestionType(effectiveType)) {
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

