/**
 * Hard accuracy gate for V2 six-section worksheets (esp. Maths MCQs).
 * Code-level checks — no LLM cost. Rejects self-contradictory workings,
 * answer letters that don't match options, and simple arithmetic mismatches.
 */

import { parseGroupedInteger } from './indian-number-notation.js';

const SELF_CONTRADICTION_RE =
  /\b(wait[,!]?\s*(recalculate|correct|fix)|oops|i\s+made\s+a\s+mistake|correction\s*:|actually\s+the\s+answer|recalculat(e|ing)|wrong[,.]?\s*it\s+should)/i;

const OPTION_LETTER_RE = /^([A-Da-d])\s*[).:\-–]?\s*/;

function walkCoreQuestions(core = {}) {
  const rows = [];
  const sections = [
    ['sectionA_mcq', 'mcq'],
    ['sectionB_fib', 'fib'],
    ['sectionC_short', 'short'],
    ['sectionD_application', 'application'],
    ['sectionE_long', 'long'],
  ];
  for (const [key, kind] of sections) {
    const arr = core?.[key];
    if (!Array.isArray(arr)) continue;
    arr.forEach((q, i) => {
      if (q && typeof q === 'object') rows.push({ ...q, _kind: kind, _section: key, _index: i });
    });
  }
  return rows;
}

function extractOptionLetter(answer) {
  const s = String(answer || '').trim();
  const m = s.match(OPTION_LETTER_RE);
  return m ? m[1].toUpperCase() : null;
}

function parseOptionValue(opt) {
  const s = String(opt || '').replace(OPTION_LETTER_RE, '').trim();
  // Prefer last large number / Indian-grouped integer in the option text.
  const nums = s.match(/-?\d{1,3}(?:,\d{2,3})+|-?\d+/g) || [];
  if (!nums.length) return { text: s, num: null };
  const last = nums[nums.length - 1];
  return { text: s, num: parseGroupedInteger(last) };
}

function optionByLetter(options, letter) {
  if (!letter || !Array.isArray(options)) return null;
  const idx = letter.charCodeAt(0) - 65;
  if (idx < 0 || idx >= options.length) return null;
  return options[idx];
}

/** Detect binary ops on two integers in a stem (difference / sum / product). */
function detectBinaryArithmetic(question) {
  const q = String(question || '');
  // "difference between A and B" / "A − B" / "A - B"
  const diff = q.match(
    /(?:difference\s+between|subtract)\s+([\d,]+)\s+(?:and|from)\s+([\d,]+)/i,
  );
  if (diff) {
    const a = parseGroupedInteger(diff[1]);
    const b = parseGroupedInteger(diff[2]);
    if (a != null && b != null) return { op: 'diff', a, b, expected: Math.abs(a - b) };
  }
  const minus = q.match(/([\d,]+)\s*[-−–]\s*([\d,]+)/);
  if (minus) {
    const a = parseGroupedInteger(minus[1]);
    const b = parseGroupedInteger(minus[2]);
    if (a != null && b != null) return { op: 'minus', a, b, expected: a - b };
  }
  const sum = q.match(
    /(?:sum\s+of|add)\s+([\d,]+)\s+(?:and|\+|plus)\s+([\d,]+)/i,
  );
  if (sum) {
    const a = parseGroupedInteger(sum[1]);
    const b = parseGroupedInteger(sum[2]);
    if (a != null && b != null) return { op: 'sum', a, b, expected: a + b };
  }
  const plus = q.match(/([\d,]+)\s*[+＋]\s*([\d,]+)/);
  if (plus) {
    const a = parseGroupedInteger(plus[1]);
    const b = parseGroupedInteger(plus[2]);
    if (a != null && b != null) return { op: 'plus', a, b, expected: a + b };
  }
  const prod = q.match(
    /(?:product\s+of|multiply)\s+([\d,]+)\s+(?:and|by|×|\*)\s+([\d,]+)/i,
  );
  if (prod) {
    const a = parseGroupedInteger(prod[1]);
    const b = parseGroupedInteger(prod[2]);
    if (a != null && b != null && Math.abs(a * b) < Number.MAX_SAFE_INTEGER) {
      return { op: 'prod', a, b, expected: a * b };
    }
  }
  return null;
}

function answerKeyRows(assessment = {}) {
  const ak = assessment?.answerKey;
  return Array.isArray(ak) ? ak : [];
}

/**
 * Validate V2 structured content for hard math / answer-key failures.
 * @returns {{ valid:boolean, errors:string[], warnings:string[] }}
 */
export function validateMathAccuracy(structured) {
  const errors = [];
  const warnings = [];
  if (!structured?.core) return { valid: true, errors, warnings };

  const questions = walkCoreQuestions(structured.core);
  const keys = answerKeyRows(structured.assessment);

  questions.forEach((q, qi) => {
    const stem = String(q.question || q.prompt || '').trim();
    const coreAnswer = String(q.answer || '').trim();
    const key = keys[qi];
    const keyAnswer = String(key?.answer || '').trim();
    const working = String(key?.working || q.working || q.explanation || '').trim();

    if (SELF_CONTRADICTION_RE.test(working) || SELF_CONTRADICTION_RE.test(keyAnswer)) {
      errors.push(
        `Q${qi + 1} (${q._section}): answer working contradicts itself ("Wait/recalculate" style).`,
      );
    }

    if (q._kind === 'mcq') {
      const options = Array.isArray(q.options) ? q.options.map(String) : [];
      if (options.length < 2) {
        errors.push(`Q${qi + 1}: MCQ missing options`);
        return;
      }
      const letter = extractOptionLetter(coreAnswer) || extractOptionLetter(keyAnswer);
      if (!letter) {
        warnings.push(`Q${qi + 1}: MCQ answer has no clear A/B/C/D letter`);
      } else {
        const chosen = optionByLetter(options, letter);
        if (!chosen) {
          errors.push(`Q${qi + 1}: answer letter ${letter} not in options`);
        }
        // Core answer vs assessment answerKey letter must agree when both present.
        const coreL = extractOptionLetter(coreAnswer);
        const keyL = extractOptionLetter(keyAnswer);
        if (coreL && keyL && coreL !== keyL) {
          errors.push(
            `Q${qi + 1}: core answer (${coreL}) disagrees with assessment.answerKey (${keyL})`,
          );
        }
      }

      const arith = detectBinaryArithmetic(stem);
      if (arith && letter) {
        const chosen = optionByLetter(options, letter);
        const chosenVal = parseOptionValue(chosen).num;
        if (chosenVal != null && chosenVal !== arith.expected) {
          // See if the correct value exists as another option (wrong key selected).
          const matchIdx = options.findIndex((o) => parseOptionValue(o).num === arith.expected);
          if (matchIdx >= 0) {
            errors.push(
              `Q${qi + 1}: arithmetic expects ${arith.expected} (${arith.op} of ${arith.a},${arith.b}) but selected option ${letter}; correct is ${String.fromCharCode(65 + matchIdx)}.`,
            );
          } else {
            errors.push(
              `Q${qi + 1}: selected option value ${chosenVal} ≠ computed ${arith.expected} (${arith.op}).`,
            );
          }
        }
      }

      // If working states a final number that matches an option but not the selected letter.
      const workNums = (working.match(/-?\d{1,3}(?:,\d{2,3})+|-?\d{2,}/g) || [])
        .map(parseGroupedInteger)
        .filter((n) => n != null);
      if (workNums.length && letter && options.length) {
        const finalNum = workNums[workNums.length - 1];
        const chosenVal = parseOptionValue(optionByLetter(options, letter)).num;
        const matchIdx = options.findIndex((o) => parseOptionValue(o).num === finalNum);
        if (
          matchIdx >= 0 &&
          chosenVal != null &&
          finalNum !== chosenVal &&
          String.fromCharCode(65 + matchIdx) !== letter
        ) {
          errors.push(
            `Q${qi + 1}: working ends at ${finalNum} (option ${String.fromCharCode(65 + matchIdx)}) but answer key says ${letter}.`,
          );
        }
      }
    }
  });

  // Completeness: answerKey length should cover all core questions.
  if (questions.length && keys.length && keys.length < questions.length) {
    errors.push(
      `assessment.answerKey has ${keys.length} entries but core has ${questions.length} questions.`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Soft fix: when arithmetic is unambiguous and the correct option exists,
 * rewrite core.answer + matching answerKey entry to the correct letter.
 * Returns { fixed, structured, fixes[] }.
 */
export function tryAutoFixMcqAnswers(structured) {
  if (!structured?.core) return { fixed: false, structured, fixes: [] };
  const clone = JSON.parse(JSON.stringify(structured));
  const questions = walkCoreQuestions(clone.core);
  const keys = answerKeyRows(clone.assessment);
  const fixes = [];

  questions.forEach((q, qi) => {
    if (q._kind !== 'mcq') return;
    const stem = String(q.question || '').trim();
    const arith = detectBinaryArithmetic(stem);
    if (!arith) return;
    const options = Array.isArray(q.options) ? q.options.map(String) : [];
    const matchIdx = options.findIndex((o) => parseOptionValue(o).num === arith.expected);
    if (matchIdx < 0) return;
    const letter = String.fromCharCode(65 + matchIdx);
    const optText = options[matchIdx];
    const newAnswer = `${letter}) ${String(optText).replace(OPTION_LETTER_RE, '').trim()}`;
    const section = q._section;
    if (clone.core[section]?.[q._index]) {
      clone.core[section][q._index].answer = newAnswer;
    }
    if (keys[qi]) {
      keys[qi].answer = newAnswer;
      if (SELF_CONTRADICTION_RE.test(String(keys[qi].working || ''))) {
        keys[qi].working = `${arith.a} ${arith.op} ${arith.b} = ${arith.expected}. Correct option: ${letter}.`;
      }
    }
    fixes.push(`Q${qi + 1} → ${letter} (${arith.expected})`);
  });

  if (fixes.length && clone.assessment) clone.assessment.answerKey = keys;
  return { fixed: fixes.length > 0, structured: clone, fixes };
}

export default { validateMathAccuracy, tryAutoFixMcqAnswers };
