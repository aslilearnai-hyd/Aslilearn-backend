import { buildUnsupportedQuestionBanBlock } from '../../utils/unsupported-question-filter.js';

/**
 * Precision + textbook-grounding rules for all AI tools (including book-based generator).
 * @module prompts/shared/precision-generation
 */

export const PRECISION_VARIANT_FOCUSES = Object.freeze([
  'Definitions, key terms, and SI units from the subtopic',
  'Formula application with step-by-step numerical working',
  'Cause–effect and mechanism explanation with one example',
  'Compare/contrast two ideas within the subtopic',
  'Common misconceptions and correct reasoning',
  'Short-answer and long-answer exam-style explanation',
  'Data, values, and calculation with units',
  'Assertion-style reasoning tied to textbook facts',
]);

/**
 * @param {number} variantIndex
 * @returns {string}
 */
export function getPrecisionVariantFocus(variantIndex) {
  const n = Math.max(1, Math.floor(Number(variantIndex) || 1));
  return PRECISION_VARIANT_FOCUSES[(n - 1) % PRECISION_VARIANT_FOCUSES.length];
}

/**
 * Ground-level classroom + textbook exercise alignment (all tools).
 * @returns {string}
 */
export function buildClassroomTextbookMethodologyBlock() {
  return [
    'CLASSROOM TEXTBOOK METHODOLOGY (mandatory):',
    '- Write like NCERT/CBSE classroom material: easy for teachers to teach and students to follow.',
    '- Match question TYPES from the textbook that work in text-only UI: MCQ, fill-in-the-blank, true/false, very short answer, short answer, numerical. NEVER match-the-following, NEVER image/figure/diagram-based or label-the-diagram prompts.',
    '- Mirror the STYLE of in-chapter Examples, Intext Questions, and end-of-section Exercises — same difficulty band and wording pattern.',
    '- Activities = simplified versions of textbook Activities/Projects (materials, steps, observation table) — not invented story-based tasks.',
    '- Teacher-facing text: who does what, with what material, for how long — plain classroom language.',
    '- Student-facing questions: one clear instruction per item; answers should match what the textbook would accept.',
    '- MATH / SCIENCE NOTATION: Prefer Unicode classroom style in plain text — sin²θ, (a+b)², H₂O, CO₂. Do NOT write computer ASCII like sin^2, (...)^2, or H2O when a Unicode form exists. Greek letters as θ α β π when natural.',
    '- Prefer exercises that drill the same skill as the textbook (define, calculate, explain, compare) on the SAME subtopic.',
    '- Do NOT add content that is not teachable directly from the chapter (no generic life-skills wrappers).',
  ].join('\n');
}

/**
 * Core precision block — direct, subtopic-stuck content.
 * @returns {string}
 */
export function buildPrecisionGenerationBlock() {
  return [
    buildClassroomTextbookMethodologyBlock(),
    '',
    buildUnsupportedQuestionBanBlock(),
    '',
    'PRECISION MODE (mandatory):',
    '- Every question/task names the exact SUBTOPIC and tests one clear skill.',
    '- Write exam-ready stems: define, state, calculate, explain, justify — no story setup.',
    '- BAN: "Imagine…", "During a school fair…", "Role-play…", "Design a poster…", "In your community…", "Set the scene…".',
    '- BAN: Match-the-Following / Column A–B matching, and any image/figure/diagram/picture-based stems (refer to figure, as shown in the diagram, label the diagram, etc.).',
    '- BAN: Literature-style prompts (summarise the message, speaking situations) for Science/Maths.',
    '- Science/Maths: definitions, formulas, numericals, units, cause–effect — not observation diaries.',
    '- Depth = substantive content on the subtopic (steps, formulas, evidence), not activity wrappers.',
    '- Each section must match its purpose (concept vs practice vs application) in plain wording.',
  ].join('\n');
}

/**
 * When textbook RAG passages are attached.
 * @param {{ topic?: string, subTopic?: string, subject?: string }} [ctx]
 * @returns {string}
 */
export function buildBookGroundingPromptBlock(ctx = {}) {
  const sub = String(ctx.subTopic || ctx.subtopic || '').trim();
  const topic = String(ctx.topic || '').trim();
  const subject = String(ctx.subject || '').trim();
  const scope = sub || topic || 'the selected sub-topic';
  return [
    'TEXTBOOK-GROUNDED GENERATION (mandatory when passages are attached):',
    `- Scope: ${scope}${subject ? ` (${subject})` : ''}.`,
    '- Use the REFERENCE TEXTBOOK CONTENT as the PRIMARY source for facts, definitions, formulae, examples, and terminology.',
    '- Base MCQs, worksheets, and practice on the same kinds of tasks as the textbook Exercises and Activities in the passages.',
    '- Reuse textbook numerical patterns, terminology, and question phrasing where appropriate (paraphrase, do not copy verbatim).',
    '- Questions must be answerable from the passages + standard curriculum for this subtopic.',
    '- Quote or paraphrase textbook ideas accurately; never invent fake textbook lines.',
    '- If a passage mentions a formula, numerical, or definition — prefer that in questions and explanations.',
    '- Do NOT ignore the book and generate generic English/Literature or off-topic filler.',
    '- Do NOT wrap book content in fictional scenarios — ask directly about the subtopic using book facts.',
    '- When passages are thin, use curriculum knowledge for the same subtopic only — still no scenario framing.',
  ].join('\n');
}

/**
 * Batch variant uniqueness without scenario/angle wrappers.
 * @param {number} variantIndex
 * @param {string} [subject]
 * @returns {string}
 */
export function buildVariantUniquenessBlock(variantIndex, subject = '') {
  const focus = getPrecisionVariantFocus(variantIndex);
  return [
    `VARIANT FOCUS: ${focus}.`,
    subject ? `Subject: ${subject}.` : '',
    'Vary question stems, numerical values, definitions emphasised, and textbook facts cited.',
    'Do NOT reuse the same stems, options, or worked examples as other variants on this subtopic.',
    'Do NOT add fictional settings, role-play, or activity frames for uniqueness.',
  ]
    .filter(Boolean)
    .join('\n');
}
