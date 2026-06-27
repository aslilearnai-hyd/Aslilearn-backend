/**
 * Subject ↔ AI tool availability rules shared across teacher, student, and super-admin APIs.
 */

import {
  isStoryPassageAllowedSubject,
  STORY_PASSAGE_SUBJECT_ERROR,
} from './story-passage-subject.js';

export { isStoryPassageAllowedSubject, STORY_PASSAGE_SUBJECT_ERROR };

export const LANGUAGE_EXCLUDED_TOOL_IDS = Object.freeze([
  'worksheet-mcq-generator',
  'short-notes-summaries-maker',
  'concept-mastery-helper',
  'daily-class-plan-maker',
  'concept-breakdown-explainer',
  'chapter-summary-creator',
  'key-points-formula-extractor',
]);

const LANGUAGE_EXCLUDED_TOOL_ID_SET = new Set(LANGUAGE_EXCLUDED_TOOL_IDS);

export const LANGUAGE_EXCLUDED_TOOL_ERROR =
  'This tool is not available for English, Hindi, or Telugu subjects.';

export function isLanguageExcludedTool(toolType) {
  return LANGUAGE_EXCLUDED_TOOL_ID_SET.has(String(toolType || '').trim());
}

export function isStoryLanguageTool(toolType) {
  const t = String(toolType || '').trim();
  return t === 'story-passage-creator' || t === 'reading-practice-room';
}

/** Validate subject for a given tool; returns error message or null if allowed. */
export function validateAiToolSubjectForTool(toolType, subject) {
  const t = String(toolType || '').trim();
  const s = String(subject || '').trim();

  if (isStoryLanguageTool(t) && !isStoryPassageAllowedSubject(s)) {
    return STORY_PASSAGE_SUBJECT_ERROR;
  }

  if (isLanguageExcludedTool(t) && isStoryPassageAllowedSubject(s)) {
    return LANGUAGE_EXCLUDED_TOOL_ERROR;
  }

  return null;
}
