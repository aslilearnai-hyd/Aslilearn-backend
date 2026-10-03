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
