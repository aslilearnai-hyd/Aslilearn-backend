/**
 * Drop question types that cannot render correctly in AsliLearn.
 * Diagram stems OK when diagram generation is on / image attached.
 * Match-the-Following OK when matchPairs (or equivalent) are present.
 */

import {
  isMatchQuestionType,
  isMatchStemText,
  questionHasMatchPayload,
} from './match-following.js';

const IMAGE_STEM_RE =
  /\b(?:refer(?:\s+to)?|see|look\s+at|observe|study|based\s+on|as\s+shown\s+in|given\s+in|shown\s+in|in)\s+(?:the\s+)?(?:following\s+)?(?:figure|fig\.?|image|diagram|picture|illustration|photograph|photo|drawing|sketch)\b/i;

const IMAGE_STEM_RE_2 =
  /\b(?:figure|fig\.?|image|diagram|picture|illustration)\s+(?:above|below|given|provided|shows?|depicts?)\b/i;

const IMAGE_STEM_RE_3 =
  /\b(?:label\s+(?:the\s+)?(?:figure|diagram|image|parts?\s+of)|draw\s+(?:a\s+)?(?:labelled\s+)?diagram|complete\s+the\s+(?:figure|diagram)|identify\s+(?:the\s+)?(?:parts?\s+)?(?:in|from)\s+(?:the\s+)?(?:figure|diagram|image))\b/i;

export function isImageStemQuestion(text) {
  const q = String(text || '').trim();
  if (!q) return false;
  return IMAGE_STEM_RE.test(q) || IMAGE_STEM_RE_2.test(q) || IMAGE_STEM_RE_3.test(q);
}

function questionHasDiagramPayload(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (String(entry.imageUrl || entry.image_url || entry.questionImage || '').trim()) return true;
  if (String(entry.imagePrompt || entry.image_prompt || entry.figurePrompt || '').trim()) return true;
  const flag = entry.needsDiagram ?? entry.needs_diagram ?? entry.needsFigure;
  if (flag === true || flag === 1) return true;
  const s = String(flag || '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function diagramsAllowedByDefault() {
  const v = process.env.AI_DIAGRAM_GENERATION;
  if (v == null || String(v).trim() === '') return true;
  const n = String(v).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(n)) return false;
  return true;
}

function matchFollowingAllowedByDefault() {
  const v = process.env.AI_MATCH_FOLLOWING;
  if (v == null || String(v).trim() === '') return true;
  const n = String(v).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(n)) return false;
  return true;
}

/**
 * @param {string} text
 * @param {string} [type]
 * @param {{ allowDiagrams?: boolean, hasImage?: boolean, allowMatch?: boolean, hasMatch?: boolean }} [opts]
 * @returns {boolean}
 */
export function isUnsupportedQuestionStem(text, type = '', opts = {}) {
  const q = String(text || '').trim();
  const allowMatch =
    opts.allowMatch === true ||
    opts.hasMatch === true ||
    (opts.allowMatch !== false && matchFollowingAllowedByDefault());

  if (isMatchQuestionType(type) || isMatchStemText(q)) {
    // Keep structured match questions; drop orphan match stems without pairs when disabled.
    if (allowMatch) return false;
    return true;
  }

  const allowDiagrams =
    opts.allowDiagrams === true ||
    opts.hasImage === true ||
    (opts.allowDiagrams !== false && diagramsAllowedByDefault());

  if (!q) return false;

  if (isImageStemQuestion(q)) {
    return !allowDiagrams;
  }
  return false;
}

/**
 * @param {unknown[]} questions
 * @param {{ allowDiagrams?: boolean, allowMatch?: boolean }} [opts]
 * @returns {any[]}
 */
export function filterUnsupportedQuestions(questions = [], opts = {}) {
  if (!Array.isArray(questions)) return [];
  return questions.filter((entry) => {
    if (typeof entry === 'string') {
      return !isUnsupportedQuestionStem(entry, '', opts);
    }
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
    const hasImage = questionHasDiagramPayload(entry);
    const hasMatch = questionHasMatchPayload(entry);
    // Orphan MATCH type without pairs — drop even when match is allowed
    if ((isMatchQuestionType(type) || isMatchStemText(text)) && !hasMatch) {
      return false;
    }
    return !isUnsupportedQuestionStem(text, type, { ...opts, hasImage, hasMatch });
  });
}

/** Prompt ban / allow lines shared by AI tools. */
export function buildUnsupportedQuestionBanBlock(opts = {}) {
  const allowDiagrams =
    opts.allowDiagrams === true ||
    (opts.allowDiagrams !== false && diagramsAllowedByDefault());
  const allowMatch =
    opts.allowMatch === true ||
    (opts.allowMatch !== false && matchFollowingAllowedByDefault());

  const lines = ['QUESTION TYPE RULES (mandatory):'];

  if (allowMatch) {
    lines.push(
      '',
      'MATCH THE FOLLOWING (allowed — interactive UI available):',
      '- You MAY include 1–2 Match-the-Following items when useful for the subtopic.',
      '- Set type: "MATCH".',
      '- Provide matchPairs: [{ "left": "…", "right": "…" }, …] with 4–6 correct pairs.',
      '- Also set question: a short stem like "Match Column A with Column B".',
      '- left = Column A terms; right = Column B matches (correct pairing in matchPairs).',
      '- Do NOT leave match items as plain prose without matchPairs.',
    );
  } else {
    lines.push('- BAN: Match the Following / Column A–Column B matching items (type MATCH).');
  }

  if (allowDiagrams) {
    lines.push(
      '',
      'DIAGRAM / FIGURE QUESTIONS (allowed — system will auto-generate the image):',
      '- When a Science/Maths concept is clearer with a figure, write a figure-based stem (e.g. "Study the figure below…").',
      '- For EVERY figure-based question set needsDiagram: true AND imagePrompt: a precise NCERT-style labelled diagram description.',
      '- Prefer 1–4 high-value diagram questions per worksheet when relevant.',
    );
  } else {
    lines.push(
      '- BAN: Image-based, figure-based, diagram-based, or picture-based questions.',
      '- BAN: Stems that say "refer to the figure/image/diagram", "label the diagram", etc.',
    );
  }

  lines.push(
    '',
    'Always also use normal text types: MCQ, fill-in-the-blank, true/false, VSA, SA, application, HOTS, numerical.',
  );

  return lines.join('\n');
}
