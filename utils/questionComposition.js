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

function hasExplicitTypeCounts(params = {}) {
  const nested =
    params.questionComposition && typeof params.questionComposition === 'object'
      ? params.questionComposition
      : null;
  if (nested) {
    return QUESTION_COMPOSITION_KEYS.some((k) => params.questionComposition?.[k] != null);
  }
  return (
    params.countMcq != null ||
    params.mcqCount != null ||
    params.countVsaq != null ||
    params.vsaqCount != null ||
    params.countSaq != null ||
    params.saqCount != null ||
    params.countLaq != null ||
    params.laqCount != null ||
    params.countFib != null ||
    params.fibCount != null
  );
}

/**
 * Spread a flat total across MCQ/VSAQ/SAQ/LAQ/FIB using default proportions.
 * Used when the user only picks "number of questions".
 */
export function composeFromTotalQuestionCount(totalDesired) {
  const target = Math.min(MAX_TOTAL, Math.max(1, Math.floor(Number(totalDesired) || 0)));
  if (!Number.isFinite(target) || target < 1) {
    return normalizeQuestionComposition({});
  }

  const defaults = DEFAULT_QUESTION_COMPOSITION;
  const defaultTotal = QUESTION_COMPOSITION_KEYS.reduce((sum, k) => sum + defaults[k], 0);
  const composition = { mcq: 0, vsaq: 0, saq: 0, laq: 0, fib: 0 };

  let assigned = 0;
  for (const key of QUESTION_COMPOSITION_KEYS) {
    const share = Math.floor((defaults[key] / defaultTotal) * target);
    composition[key] = share;
    assigned += share;
  }

  // Give leftover seats to MCQ first, then SAQ, VSAQ, FIB, LAQ.
  const fillOrder = ['mcq', 'saq', 'vsaq', 'fib', 'laq'];
  let left = target - assigned;
  let i = 0;
  while (left > 0 && i < fillOrder.length * 40) {
    const key = fillOrder[i % fillOrder.length];
    if (composition[key] < MAX_PER_TYPE) {
      composition[key] += 1;
      left -= 1;
    }
    i += 1;
  }

  // Tiny totals: ensure at least one MCQ when possible.
  if (target >= 1 && composition.mcq === 0) {
    const donor = fillOrder.find((k) => k !== 'mcq' && composition[k] > 0);
    if (donor) {
      composition[donor] -= 1;
      composition.mcq = 1;
    } else {
      composition.mcq = target;
    }
  }

  const total = QUESTION_COMPOSITION_KEYS.reduce((sum, k) => sum + composition[k], 0);
  return { composition, total };
}

/**
 * Accepts either nested questionComposition or flat countMcq / countVsaq / …
 * or a single questionCount / numberOfQuestions (auto-distributed).
 * Returns normalized counts + total. At least one type must be > 0.
 */
export function normalizeQuestionComposition(params = {}) {
  const flatTotal = Number(params.questionCount ?? params.numberOfQuestions);
  if (
    !hasExplicitTypeCounts(params) &&
    Number.isFinite(flatTotal) &&
    flatTotal > 0
  ) {
    return composeFromTotalQuestionCount(flatTotal);
  }

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
