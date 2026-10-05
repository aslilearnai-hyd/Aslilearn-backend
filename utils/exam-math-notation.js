/**
 * Lossless notation contract shared by exam PDF extraction prompts.
 *
 * Delimited LaTeX is used because plain text cannot preserve a stacked
 * fraction unambiguously. It is also understood by the web/mobile exam
 * renderers.
 */
export const EXAM_PDF_MATH_FIDELITY_RULES = `- MATH FIDELITY (critical): Transcribe every mathematical expression symbol-for-symbol. Preserve every coefficient, variable, operator, bracket, exponent, radical, numerator, denominator, fraction bar, and equality/inequality sign.
- Put each mathematical expression inside inline LaTeX delimiters $...$. In JSON, escape each LaTeX backslash correctly.
- A printed stacked fraction MUST become \\frac{numerator}{denominator}; never omit the denominator and never flatten or concatenate the two rows.
  Exact examples: printed (n^2 + 2) over 2 -> $\\frac{n^2+2}{2}$; printed (n+2)(n+3) over 2 -> $\\frac{(n+2)(n+3)}{2}$; printed n(n+1) over 4 -> $\\frac{n(n+1)}{4}$.
- Use x^{12} for multi-character exponents, \\sqrt{...} for square roots, and \\sqrt[3]{...} for cube roots. Preserve nested grouping exactly.
- Never simplify, expand, factor, solve, autocorrect, or replace the printed expression with an equivalent expression. Transcription and answer solving are separate tasks.
- Before returning JSON, visually compare every math-bearing stem and option with the source. Confirm that the number of fraction bars/denominators, radicals, exponents, brackets, terms, and choices is unchanged.`;

export const EXAM_MATH_FIELD_DESCRIPTION =
  'Lossless source transcription. Put math in $...$ LaTeX; use \\frac{numerator}{denominator} for every printed fraction and preserve all grouping/operators.';

// Include Unicode superscripts because a failed OCR pass commonly emits `n²`
// without LaTeX delimiters. Adjacent bracket groups are another strong signal
// for the fractions/products that have historically been misread.
const MATH_SIGNAL = /(\\frac|\\sqrt|\$[^$]+\$|[=<>^√∛⁰¹²³⁴⁵⁶⁷⁸⁹]|\d\s*[+*/−-]\s*[A-Za-z(]|[A-Za-z)]\s*[+*/−-]\s*\d|\)\s*\()/;

export function isMathAuditCandidate(row) {
  if (String(row?.subject || '').trim().toLowerCase() === 'maths') return true;
  const text = [
    row?.questionText,
    row?.option1,
    row?.option2,
    row?.option3,
    row?.option4,
  ]
    .map((value) => String(value || ''))
    .join(' ');
  return MATH_SIGNAL.test(text);
}

/**
 * Merge a visual math audit without allowing it to change metadata or silently
 * detach a text answer from its corrected option.
 */
export function mergeMathAuditRows(originalRows, auditedRows) {
  const auditedByNumber = new Map(
    (Array.isArray(auditedRows) ? auditedRows : [])
      .map((row) => [Number(row?.questionNumber), row])
      .filter(([number]) => Number.isFinite(number) && number >= 1),
  );
  const mathFields = ['questionText', 'option1', 'option2', 'option3', 'option4'];

  return (Array.isArray(originalRows) ? originalRows : []).map((row) => {
    if (!isMathAuditCandidate(row)) return row;
    const audit = auditedByNumber.get(Number(row?.questionNumber));
    if (!audit) return row;

    const oldOptions = [row?.option1, row?.option2, row?.option3, row?.option4].map((value) =>
      String(value || '').trim(),
    );
    const next = { ...row };
    for (const field of mathFields) {
      const corrected = String(audit?.[field] || '').trim();
      if (corrected) next[field] = corrected;
    }
    const correctedOptions = [next.option1, next.option2, next.option3, next.option4].map((value) =>
      String(value || '').trim(),
    );
    const auditedAnswer = String(audit?.correctAnswer || '').trim();
    const auditedAnswerIndex = correctedOptions.findIndex(
      (option) => option.toLowerCase() === auditedAnswer.toLowerCase(),
    );
    if (auditedAnswerIndex >= 0) {
      next.correctAnswer = correctedOptions[auditedAnswerIndex];
      const auditedExplanation = String(audit?.explanation || '').trim();
      if (auditedExplanation) next.explanation = auditedExplanation;
      return next;
    }

    const oldAnswer = String(row?.correctAnswer || '').trim().toLowerCase();
    const oldAnswerIndex = oldOptions.findIndex((option) => option.toLowerCase() === oldAnswer);
    if (oldAnswerIndex >= 0 && correctedOptions[oldAnswerIndex]) {
      next.correctAnswer = correctedOptions[oldAnswerIndex];
    }
    return next;
  });
}
