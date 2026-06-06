/**
 * Rule-based PDF content classifier — no Gemini.
 * Detects content family and recommends AI tools.
 * @module services/pdf-content-classifier
 */

import { AI_TOOL_ORDERED_SLUGS } from '../config/aiToolTemplates.js';
import { getAiToolTemplate } from '../config/aiToolTemplates.js';

export const CONTENT_FAMILIES = Object.freeze([
  'QUESTION_BASED',
  'CONCEPT_BASED',
  'PLANNING_BASED',
  'FLASHCARD_BASED',
  'STORY_BASED',
  'ACTIVITY_BASED',
  'ASSESSMENT_BASED',
  'NOTES_BASED',
  'MIXED',
  'UNKNOWN',
]);

/** @type {Record<string, string[]>} */
export const FAMILY_TOOL_SLUGS = Object.freeze({
  QUESTION_BASED: [
    'worksheet-mcq-generator',
    'homework-creator',
    'mock-test-builder',
    'exam-question-paper-generator',
    'smart-qa-practice-generator',
    'quick-assignment-builder',
  ],
  CONCEPT_BASED: [
    'concept-mastery-helper',
    'smart-study-guide-generator',
    'concept-breakdown-explainer',
    'chapter-summary-creator',
    'key-points-formula-extractor',
  ],
  PLANNING_BASED: ['lesson-planner', 'study-schedule-maker', 'daily-class-plan-maker'],
  FLASHCARD_BASED: ['flashcard-generator', 'my-study-decks'],
  STORY_BASED: ['story-passage-creator', 'reading-practice-room'],
  ACTIVITY_BASED: ['activity-project-generator', 'project-idea-lab'],
  ASSESSMENT_BASED: ['rubrics-evaluation-generator'],
  NOTES_BASED: ['short-notes-summaries-maker'],
});

const SIGNAL_RULES = [
  {
    family: 'QUESTION_BASED',
    weight: 3,
    test: (t, c) =>
      (t.match(/\?/g) || []).length >= 5 ||
      /\bsection\s+[a-e]\s*:/i.test(t) ||
      /\b(?:mcq|multiple\s*choice)\b/i.test(t) ||
      (c?.stats?.questionCount || 0) >= 5,
    signals: ['question_marks', 'section_headers', 'mcq_keywords'],
  },
  {
    family: 'ACTIVITY_BASED',
    weight: 4,
    test: (t, c) =>
      /\bactivity\s*(?:\/\s*project)?\s*\d+/i.test(t) ||
      /\bproject\s*(?:idea|lab)?\s*\d+/i.test(t) ||
      (c?.activities?.length || 0) >= 1,
    signals: ['activity_heading', 'project_heading'],
  },
  {
    family: 'FLASHCARD_BASED',
    weight: 4,
    test: (t, c) =>
      /\bfront\s*:/i.test(t) && /\bback\s*:/i.test(t) ||
      (c?.flashcards?.length || 0) >= 3,
    signals: ['front_back_pairs'],
  },
  {
    family: 'STORY_BASED',
    weight: 3,
    test: (t, c) =>
      /\b(?:passage|story)\b/i.test(t) &&
      (/\bcomprehension\b/i.test(t) || (t.match(/\?/g) || []).length >= 2) ||
      (c?.stories?.length || 0) >= 1,
    signals: ['passage_story', 'comprehension'],
  },
  {
    family: 'PLANNING_BASED',
    weight: 3,
    test: (t, c) =>
      /\b(?:lesson\s*plan|class\s*plan|study\s*schedule|timeline|period\s*\d+)\b/i.test(t) ||
      (c?.timelines?.length || 0) >= 1,
    signals: ['lesson_plan', 'timeline'],
  },
  {
    family: 'CONCEPT_BASED',
    weight: 2,
    test: (t, c) =>
      /\b(?:concept|definition|learning\s*objective|chapter\s*summary|study\s*guide)\b/i.test(t) ||
      (c?.concepts?.length || 0) >= 2,
    signals: ['concept_keywords', 'definitions'],
  },
  {
    family: 'ASSESSMENT_BASED',
    weight: 3,
    test: (t) =>
      /\b(?:rubric|evaluation|report\s*card|grading\s*criteria|needs\s*improvement)\b/i.test(t),
    signals: ['rubric_keywords'],
  },
  {
    family: 'NOTES_BASED',
    weight: 2,
    test: (t, c) =>
      /\b(?:short\s*notes?|summary|key\s*points?\s*to\s*remember)\b/i.test(t) ||
      (c?.contentBlocks?.length || 0) >= 3,
    signals: ['notes_keywords', 'content_blocks'],
  },
];

function toolTitle(slug) {
  const t = getAiToolTemplate(slug);
  return t?.title || slug;
}

/**
 * @param {string} pdfText
 * @param {Record<string, unknown>} [canonical]
 * @returns {{
 *   family: string,
 *   confidence: number,
 *   matchedSignals: string[],
 *   familyScores: Record<string, number>,
 *   recommendedTools: { tool: string, toolLabel: string, confidence: number }[]
 * }}
 */
export function classifyPdfContent(pdfText, canonical = {}) {
  const text = String(pdfText || '');
  const scores = Object.fromEntries(CONTENT_FAMILIES.map((f) => [f, 0]));
  const matchedSignals = [];

  for (const rule of SIGNAL_RULES) {
    if (rule.test(text, canonical)) {
      scores[rule.family] = (scores[rule.family] || 0) + rule.weight;
      matchedSignals.push(...rule.signals);
    }
  }

  const ranked = Object.entries(scores)
    .filter(([f]) => f !== 'UNKNOWN' && f !== 'MIXED')
    .sort((a, b) => b[1] - a[1]);

  const topScore = ranked[0]?.[1] || 0;
  const secondScore = ranked[1]?.[1] || 0;
  let family = ranked[0]?.[0] || 'UNKNOWN';

  if (topScore === 0) family = 'UNKNOWN';
  else if (topScore > 0 && secondScore > 0 && topScore - secondScore <= 1) family = 'MIXED';

  const maxPossible = 12;
  const confidence = Math.min(100, Math.round((topScore / maxPossible) * 100));

  const toolSlugs =
    family === 'MIXED'
      ? [...new Set(ranked.slice(0, 2).flatMap(([f]) => FAMILY_TOOL_SLUGS[f] || []))]
      : FAMILY_TOOL_SLUGS[family] || [];

  const recommendedTools = toolSlugs
    .filter((slug) => AI_TOOL_ORDERED_SLUGS.includes(slug))
    .map((slug, idx) => ({
      tool: slug,
      toolLabel: toolTitle(slug),
      confidence: Math.max(40, confidence - idx * 7),
    }))
    .slice(0, 5);

  return {
    family,
    confidence,
    matchedSignals: [...new Set(matchedSignals)],
    familyScores: scores,
    recommendedTools,
  };
}

/** Gemini fallback threshold */
export const GEMINI_FALLBACK_CONFIDENCE_THRESHOLD = 60;

export function shouldUseGeminiFallback(classification, extractionOk = true) {
  if (!extractionOk) return true;
  if (!classification) return true;
  return Number(classification.confidence || 0) < GEMINI_FALLBACK_CONFIDENCE_THRESHOLD;
}
