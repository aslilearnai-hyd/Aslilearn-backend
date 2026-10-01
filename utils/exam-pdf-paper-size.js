/**
 * Infer how many questions an uploaded exam paper should yield.
 * Classic IIT/NEET foundation papers are 80 (20×4 subjects) or 120 (30×4).
 * The extractor used to hardcode 80, which dropped Q81–120.
 */

export const EXAM_PAPER_QUESTION_CEILING_MAX = 200;

function maxPositive(nums) {
  let max = 0;
  for (const raw of nums || []) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= EXAM_PAPER_QUESTION_CEILING_MAX) {
      max = Math.max(max, Math.floor(n));
    }
  }
  return max;
}

/**
 * @param {{
 *   printedNumbers?: number[],
 *   answerKeyNumbers?: number[],
 *   plannedTotal?: unknown,
 *   subjectSectionCount?: number,
 * }} [input]
 * @returns {number}
 */
export function inferExamPaperQuestionCeiling(input = {}) {
  const printedMax = maxPositive(input.printedNumbers);
  const keyMax = maxPositive(input.answerKeyNumbers);
  const planned = Number(input.plannedTotal);
  const plannedOk =
    Number.isFinite(planned) && planned >= 1 && planned <= EXAM_PAPER_QUESTION_CEILING_MAX
      ? Math.floor(planned)
      : 0;
  const subjectSectionCount = Number(input.subjectSectionCount) || 0;

  let ceiling = Math.max(printedMax, keyMax, plannedOk);

  if (ceiling >= 81 && ceiling <= 119) ceiling = 120;
  if (ceiling > 0 && ceiling < 80 && subjectSectionCount >= 4) ceiling = 80;

  if (ceiling === 0) {
    // Unknown 4-subject papers: cover the 120 layout so Q81–120 are not skipped.
    ceiling = subjectSectionCount >= 4 ? 120 : 80;
  }

  return Math.min(EXAM_PAPER_QUESTION_CEILING_MAX, ceiling);
}

/**
 * Split 1..ceiling across subject sections (Math, Physics, …).
 * @param {number} subjectCount
 * @param {number} ceiling
 * @returns {{ from: number, to: number }[]}
 */
export function subjectQuestionRanges(subjectCount, ceiling) {
  const n = Math.max(1, Math.floor(Number(subjectCount) || 0) || 1);
  const cap = Math.max(n, Math.floor(Number(ceiling) || 0) || n);
  const per = Math.ceil(cap / n);
  const ranges = [];
  for (let i = 0; i < n; i += 1) {
    const from = i * per + 1;
    const to = Math.min(cap, (i + 1) * per);
    if (from <= to) ranges.push({ from, to });
  }
  return ranges;
}

export function sequentialExpectedNumbers(ceiling) {
  const n = Math.max(0, Math.min(EXAM_PAPER_QUESTION_CEILING_MAX, Math.floor(Number(ceiling) || 0)));
  return Array.from({ length: n }, (_, i) => i + 1);
}

export function pdfExtractRangeChunks(ceiling, { fastMode = false } = {}) {
  const cap = Math.max(1, Math.floor(Number(ceiling) || 0) || (fastMode ? 80 : 120));
  const size = fastMode ? 40 : 20;
  const ranges = [];
  for (let from = 1; from <= cap; from += size) {
    ranges.push([from, Math.min(from + size - 1, cap)]);
  }
  return ranges;
}
