/**
 * Drop question types that cannot render correctly in AsliLearn (no images, no match UI).
 * Used by AI generation + client parsers.
 */

const IMAGE_STEM_RE =
  /\b(?:refer(?:\s+to)?|see|look\s+at|observe|study|based\s+on|as\s+shown\s+in|given\s+in|shown\s+in|in)\s+(?:the\s+)?(?:following\s+)?(?:figure|fig\.?|image|diagram|picture|illustration|photograph|photo|drawing|sketch)\b/i;

const IMAGE_STEM_RE_2 =
  /\b(?:figure|fig\.?|image|diagram|picture|illustration)\s+(?:above|below|given|provided|shows?|depicts?)\b/i;

const IMAGE_STEM_RE_3 =
  /\b(?:label\s+(?:the\s+)?(?:figure|diagram|image|parts?\s+of)|draw\s+(?:a\s+)?(?:labelled\s+)?diagram|complete\s+the\s+(?:figure|diagram)|identify\s+(?:the\s+)?(?:parts?\s+)?(?:in|from)\s+(?:the\s+)?(?:figure|diagram|image))\b/i;

const MATCH_STEM_RE =
  /\bmatch\s+(?:the\s+)?following\b|\bcolumn\s*a\b[\s\S]{0,80}\bcolumn\s*b\b|\bmatch\s+(?:each|these|the)\s+(?:items?|terms?|words?)\b/i;

/**
 * @param {string} text
 * @param {string} [type]
 * @returns {boolean}
 */
export function isUnsupportedQuestionStem(text, type = '') {
  const t = String(type || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
  if (t === 'MATCH' || t === 'MATCHING' || t === 'MATCHTHEFOLLOWING') return true;

  const q = String(text || '').trim();
  if (!q) return false;
  if (MATCH_STEM_RE.test(q)) return true;
  if (IMAGE_STEM_RE.test(q) || IMAGE_STEM_RE_2.test(q) || IMAGE_STEM_RE_3.test(q)) return true;
  return false;
}

/**
 * @param {unknown[]} questions
 * @returns {any[]}
 */
export function filterUnsupportedQuestions(questions = []) {
  if (!Array.isArray(questions)) return [];
  return questions.filter((entry) => {
    if (typeof entry === 'string') return !isUnsupportedQuestionStem(entry);
    if (!entry || typeof entry !== 'object') return false;
    const text = String(
      entry.question ||
        entry.question_text ||
        entry.questionText ||
        entry.prompt ||
        entry.text ||
        entry.statement ||
        entry.stem ||
        '',
    ).trim();
    const type = String(entry.type || entry.question_type || entry.questionType || '').trim();
    return !isUnsupportedQuestionStem(text, type);
  });
}

/** Prompt ban lines shared by AI tools. */
export function buildUnsupportedQuestionBanBlock() {
  return [
    'UNSUPPORTED QUESTION TYPES (mandatory ban — do NOT generate):',
    '- Match the Following / Column A–Column B matching items (type MATCH).',
    '- Image-based, figure-based, diagram-based, or picture-based questions.',
    '- Stems that say "refer to the figure/image/diagram", "as shown in the figure", "label the diagram", "based on the given image", or similar.',
    '- Any question that requires a missing picture, chart, or drawing to answer.',
    'Use text-only question types only: MCQ, fill-in-the-blank, true/false, VSA, SA, application, HOTS, numerical.',
  ].join('\n');
}
