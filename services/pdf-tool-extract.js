/**
 * Central registry: extractToolItemsFromPdfText(slug, text) for all 11 AI tools.
 * @module services/pdf-tool-extract
 */

import { AI_TOOL_ORDERED_SLUGS } from '../config/aiToolTemplates.js';
import { extractActivityProjectItemsFromPdfText } from './pdf-activity-extract.js';
import { extractConceptMasteryItemsFromPdfText } from './pdf-concept-extract.js';
import { extractDailyPlanItemsFromPdfText } from './pdf-dailyplan-extract.js';
import { extractExamPaperItemsFromPdfText } from './pdf-exam-paper-extract.js';
import { extractFlashcardItemsFromPdfText } from './pdf-flashcard-extract.js';
import { extractHomeworkItemsFromPdfText } from './pdf-homework-extract.js';
import { extractLessonPlannerItemsFromPdfText } from './pdf-lesson-extract.js';
import { extractRubricItemsFromPdfText } from './pdf-rubric-extract.js';
import { extractShortNotesItemsFromPdfText } from './pdf-shortnotes-extract.js';
import { extractStoryPassageItemsFromPdfText } from './pdf-story-extract.js';
import { extractWorksheetItemsFromPdfText } from './pdf-worksheet-extract.js';

/** @type {Record<string, (text: string, limit?: number) => unknown[]>} */
export const PDF_TOOL_EXTRACTORS = Object.freeze({
  'activity-project-generator': extractActivityProjectItemsFromPdfText,
  'worksheet-mcq-generator': extractWorksheetItemsFromPdfText,
  'concept-mastery-helper': extractConceptMasteryItemsFromPdfText,
  'lesson-planner': extractLessonPlannerItemsFromPdfText,
  'homework-creator': extractHomeworkItemsFromPdfText,
  'rubrics-evaluation-generator': extractRubricItemsFromPdfText,
  'story-passage-creator': extractStoryPassageItemsFromPdfText,
  'short-notes-summaries-maker': extractShortNotesItemsFromPdfText,
  'flashcard-generator': extractFlashcardItemsFromPdfText,
  'daily-class-plan-maker': extractDailyPlanItemsFromPdfText,
  'exam-question-paper-generator': extractExamPaperItemsFromPdfText,
});

/**
 * Extract structured items from PDF plain text for any supported AI tool.
 * @param {string} toolSlug
 * @param {string} text
 * @param {{ limit?: number }} [options]
 * @returns {unknown[]}
 */
export function extractToolItemsFromPdfText(toolSlug, text, options = {}) {
  const slug = String(toolSlug || '').trim();
  const fn = PDF_TOOL_EXTRACTORS[slug];
  if (!fn) return [];
  const limit = options.limit ?? 200;
  return fn(String(text || ''), limit);
}

export function isPdfExtractToolSupported(toolSlug) {
  return AI_TOOL_ORDERED_SLUGS.includes(String(toolSlug || '').trim());
}

export function listPdfExtractTools() {
  return [...AI_TOOL_ORDERED_SLUGS];
}
