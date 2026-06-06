/**
 * Central registry: extractToolItemsFromPdfText(slug, text) for all 17 AI tools.
 * @module services/pdf-tool-extract
 */

import { AI_TOOL_ORDERED_SLUGS } from '../config/aiToolTemplates.js';
import { extractActivityProjectItemsFromPdfText } from './pdf-activity-extract.js';
import { extractConceptMasteryItemsFromPdfText } from './pdf-concept-extract.js';
import { extractConceptBreakdownItemsFromPdfText } from './pdf-concept-breakdown-extract.js';
import { extractDailyPlanItemsFromPdfText } from './pdf-dailyplan-extract.js';
import { extractExamPaperItemsFromPdfText } from './pdf-exam-paper-extract.js';
import { extractFlashcardItemsFromPdfText } from './pdf-flashcard-extract.js';
import { extractHomeworkItemsFromPdfText } from './pdf-homework-extract.js';
import { extractLessonPlannerItemsFromPdfText } from './pdf-lesson-extract.js';
import { extractRubricItemsFromPdfText } from './pdf-rubric-extract.js';
import { extractShortNotesItemsFromPdfText } from './pdf-shortnotes-extract.js';
import { extractStudyGuideItemsFromPdfText } from './pdf-study-guide-extract.js';
import { extractChapterSummaryItemsFromPdfText } from './pdf-chapter-summary-extract.js';
import { extractKeyPointsItemsFromPdfText } from './pdf-key-points-extract.js';
import { extractQuickAssignmentItemsFromPdfText } from './pdf-quick-assignment-extract.js';
import { extractStoryPassageItemsFromPdfText } from './pdf-story-extract.js';
import { extractWorksheetItemsFromPdfText } from './pdf-worksheet-extract.js';

/** @type {Record<string, (text: string, limit?: number) => unknown[]>} */
export const PDF_TOOL_EXTRACTORS = Object.freeze({
  'activity-project-generator': extractActivityProjectItemsFromPdfText,
  'project-idea-lab': extractActivityProjectItemsFromPdfText,
  'worksheet-mcq-generator': extractWorksheetItemsFromPdfText,
  'concept-mastery-helper': extractConceptMasteryItemsFromPdfText,
  'lesson-planner': extractLessonPlannerItemsFromPdfText,
  'study-schedule-maker': extractLessonPlannerItemsFromPdfText,
  'homework-creator': extractHomeworkItemsFromPdfText,
  'rubrics-evaluation-generator': extractRubricItemsFromPdfText,
  'reading-practice-room': extractStoryPassageItemsFromPdfText,
  'story-passage-creator': extractStoryPassageItemsFromPdfText,
  'short-notes-summaries-maker': extractShortNotesItemsFromPdfText,
  'my-study-decks': extractFlashcardItemsFromPdfText,
  'flashcard-generator': extractFlashcardItemsFromPdfText,
  'daily-class-plan-maker': extractDailyPlanItemsFromPdfText,
  'mock-test-builder': extractExamPaperItemsFromPdfText,
  'exam-question-paper-generator': extractExamPaperItemsFromPdfText,
  'smart-study-guide-generator': extractStudyGuideItemsFromPdfText,
  'concept-breakdown-explainer': extractConceptBreakdownItemsFromPdfText,
  'smart-qa-practice-generator': extractWorksheetItemsFromPdfText,
  'chapter-summary-creator': extractChapterSummaryItemsFromPdfText,
  'key-points-formula-extractor': extractKeyPointsItemsFromPdfText,
  'quick-assignment-builder': extractQuickAssignmentItemsFromPdfText,
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
  if (slug === 'activity-project-generator' || slug === 'project-idea-lab') {
    return fn(String(text || ''), limit, slug);
  }
  if (slug === 'quick-assignment-builder') {
    return fn(String(text || ''), limit, options);
  }
  return fn(String(text || ''), limit);
}

export function isPdfExtractToolSupported(toolSlug) {
  return AI_TOOL_ORDERED_SLUGS.includes(String(toolSlug || '').trim());
}

export function listPdfExtractTools() {
  return [...AI_TOOL_ORDERED_SLUGS];
}
