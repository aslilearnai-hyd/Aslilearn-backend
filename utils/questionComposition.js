/** Question-type counts for worksheet / exam paper generation. */
export const QUESTION_COMPOSITION_KEYS = ['mcq', 'vsaq', 'saq', 'laq', 'fib'];

export const DEFAULT_QUESTION_COMPOSITION = {
  mcq: 5,
  vsaq: 3,
  saq: 3,
  laq: 1,
  fib: 2,
};

const MAX_PER_TYPE = 20;
const MAX_TOTAL = 40;

function clampCount(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(MAX_PER_TYPE, Math.floor(n));
}

/**
 * Accepts either nested questionComposition or flat countMcq / countVsaq / …
 * Returns normalized counts + total. At least one type must be > 0.
 */
export function normalizeQuestionComposition(params = {}) {
  const nested =
    params.questionComposition && typeof params.questionComposition === 'object'
      ? params.questionComposition
      : null;

  const composition = {
    mcq: clampCount(
      nested?.mcq ?? params.countMcq ?? params.mcqCount,
      DEFAULT_QUESTION_COMPOSITION.mcq
    ),
    vsaq: clampCount(
      nested?.vsaq ?? params.countVsaq ?? params.vsaqCount,
      DEFAULT_QUESTION_COMPOSITION.vsaq
    ),
    saq: clampCount(
      nested?.saq ?? params.countSaq ?? params.saqCount,
      DEFAULT_QUESTION_COMPOSITION.saq
    ),
    laq: clampCount(
      nested?.laq ?? params.countLaq ?? params.laqCount,
      DEFAULT_QUESTION_COMPOSITION.laq
    ),
    fib: clampCount(
      nested?.fib ?? params.countFib ?? params.fibCount,
      DEFAULT_QUESTION_COMPOSITION.fib
    ),
  };

  let total =
    composition.mcq + composition.vsaq + composition.saq + composition.laq + composition.fib;

  if (total <= 0) {
    Object.assign(composition, DEFAULT_QUESTION_COMPOSITION);
    total =
      composition.mcq + composition.vsaq + composition.saq + composition.laq + composition.fib;
  }

  if (total > MAX_TOTAL) {
    const scale = MAX_TOTAL / total;
    for (const key of QUESTION_COMPOSITION_KEYS) {
      composition[key] = Math.max(0, Math.floor(composition[key] * scale));
    }
    total =
      composition.mcq + composition.vsaq + composition.saq + composition.laq + composition.fib;
    if (total <= 0) {
      composition.mcq = Math.min(MAX_TOTAL, DEFAULT_QUESTION_COMPOSITION.mcq);
      total = composition.mcq;
    }
  }

  return { composition, total };
}

export function formatQuestionCompositionPromptLine(composition, total) {
  const parts = [
    `MCQ: ${composition.mcq}`,
    `VSAQ: ${composition.vsaq}`,
    `SAQ: ${composition.saq}`,
    `LAQ: ${composition.laq}`,
    `FIB (fill in the blanks): ${composition.fib}`,
  ];
  return `QUESTION COMPOSITION (exact counts — generate exactly these, total ${total}): ${parts.join('; ')}. Do not add extra question types beyond what is requested. If a count is 0, omit that type entirely.`;
}

/** Tools that accept question-composition counts (MCQ/VSAQ/…) and chapter-wide scope. */
export const CHAPTER_SCOPE_OPTIONAL_SUBTOPIC_TOOLS = new Set([
  'worksheet-mcq-generator',
  'exam-question-paper-generator',
]);

export function isChapterScopeTool(toolType) {
  return CHAPTER_SCOPE_OPTIONAL_SUBTOPIC_TOOLS.has(String(toolType || '').trim());
}

/** True when the user selected whole-chapter scope (no specific subtopic). */
export function isWholeChapterSubtopic(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return true;
  const norm = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return (
    norm === 'whole chapter' ||
    norm === 'wholechapter' ||
    norm === '__whole_chapter__' ||
    norm === 'all subtopics' ||
    norm === 'entire chapter'
  );
}
