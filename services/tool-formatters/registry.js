/**
 * Registry: tool slug → canonicalize + render (formatting only, no extraction).
 * @module services/tool-formatters/registry
 */

import {
  canonicalizeActivityExtractedItem,
  canonicalizeChapterSummaryExtractedItem,
  canonicalizeConceptBreakdownExtractedItem,
  canonicalizeConceptExtractedItem,
  canonicalizeDailyClassPlanExtractedItem,
  canonicalizeExamPaperExtractedItem,
  canonicalizeFlashcardExtractedItem,
  canonicalizeHomeworkExtractedItem,
  canonicalizeKeyPointsExtractedItem,
  canonicalizeLessonPlannerExtractedItem,
  canonicalizePracticeQaExtractedItem,
  canonicalizeQuickAssignmentExtractedItem,
  canonicalizeShortNotesExtractedItem,
  canonicalizeStudyGuideExtractedItem,
  canonicalizeStoryExtractedItem,
  canonicalizeWorksheetExtractedItem,
  buildChapterSummaryRenderableFromStructured,
  buildConceptBreakdownRenderableFromStructured,
  buildConceptRenderableFromStructured,
  buildDailyClassPlanRenderableFromStructured,
  buildExamPaperRenderableFromStructured,
  buildFlashcardRenderableFromStructured,
  buildHomeworkRenderableFromStructured,
  buildKeyPointsRenderableFromStructured,
  buildLessonPlanRenderableFromStructured,
  buildMockTestRenderableFromStructured,
  buildPracticeQaRenderableFromStructured,
  buildQuickAssignmentRenderableFromStructured,
  buildShortNotesRenderableFromStructured,
  buildStoryRenderableFromStructured,
  buildStudyGuideRenderableFromStructured,
  buildWorksheetRenderableFromStructured,
  buildRenderableContent,
} from '../ai-content-engine-service.js';

/** @typedef {{ canonicalize: Function, render: Function, needsSourceText?: boolean }} ToolFormatterEntry */

/** @type {Record<string, ToolFormatterEntry>} */
export const TOOL_FORMATTER_REGISTRY = {
  'activity-project-generator': {
    canonicalize: (item, slug) => canonicalizeActivityExtractedItem(item, slug || 'activity-project-generator'),
    render: (item, slug) => buildRenderableContent(slug || 'activity-project-generator', 'Activity', item),
  },
  'project-idea-lab': {
    canonicalize: (item, slug) => canonicalizeActivityExtractedItem(item, slug || 'project-idea-lab'),
    render: (item, slug) => buildRenderableContent(slug || 'project-idea-lab', 'Activity', item),
  },
  'worksheet-mcq-generator': {
    canonicalize: (item, _slug, text) => canonicalizeWorksheetExtractedItem(item, text || ''),
    render: (item, _slug, text) => buildWorksheetRenderableFromStructured(item, text || ''),
    needsSourceText: true,
  },
  'concept-mastery-helper': {
    canonicalize: (item) => canonicalizeConceptExtractedItem(item),
    render: (item) => buildConceptRenderableFromStructured(item),
  },
  'lesson-planner': {
    canonicalize: (item, slug) => canonicalizeLessonPlannerExtractedItem(item, slug || 'lesson-planner'),
    render: (item, slug) => buildLessonPlanRenderableFromStructured(item, slug || 'lesson-planner'),
  },
  'study-schedule-maker': {
    canonicalize: (item, slug) => canonicalizeLessonPlannerExtractedItem(item, slug || 'study-schedule-maker'),
    render: (item, slug) => buildLessonPlanRenderableFromStructured(item, slug || 'study-schedule-maker'),
  },
  'homework-creator': {
    canonicalize: (item) => canonicalizeHomeworkExtractedItem(item),
    render: (item) => buildHomeworkRenderableFromStructured(item),
  },
  'reading-practice-room': {
    canonicalize: (item, slug) => canonicalizeStoryExtractedItem(item, slug || 'reading-practice-room'),
    render: (item, slug) => buildStoryRenderableFromStructured(item, slug || 'reading-practice-room'),
  },
  'story-passage-creator': {
    canonicalize: (item, slug) => canonicalizeStoryExtractedItem(item, slug || 'story-passage-creator'),
    render: (item, slug) => buildStoryRenderableFromStructured(item, slug || 'story-passage-creator'),
  },
  'short-notes-summaries-maker': {
    canonicalize: (item) => canonicalizeShortNotesExtractedItem(item),
    render: (item) => buildShortNotesRenderableFromStructured(item),
  },
  'my-study-decks': {
    canonicalize: (item, slug) => canonicalizeFlashcardExtractedItem(item, slug || 'my-study-decks'),
    render: (item, slug) => buildFlashcardRenderableFromStructured(item, slug || 'my-study-decks'),
  },
  'flashcard-generator': {
    canonicalize: (item, slug) => canonicalizeFlashcardExtractedItem(item, slug || 'flashcard-generator'),
    render: (item, slug) => buildFlashcardRenderableFromStructured(item, slug || 'flashcard-generator'),
  },
  'daily-class-plan-maker': {
    canonicalize: (item) => canonicalizeDailyClassPlanExtractedItem(item),
    render: (item) => buildDailyClassPlanRenderableFromStructured(item),
  },
  'mock-test-builder': {
    canonicalize: (item, slug) => canonicalizeExamPaperExtractedItem(item, slug || 'mock-test-builder'),
    render: (item) => buildMockTestRenderableFromStructured(item),
  },
  'exam-question-paper-generator': {
    canonicalize: (item, slug) => canonicalizeExamPaperExtractedItem(item, slug || 'exam-question-paper-generator'),
    render: (item) => buildExamPaperRenderableFromStructured(item),
  },
  'smart-study-guide-generator': {
    canonicalize: (item) => canonicalizeStudyGuideExtractedItem(item),
    render: (item) => buildStudyGuideRenderableFromStructured(item),
  },
  'concept-breakdown-explainer': {
    canonicalize: (item) => canonicalizeConceptBreakdownExtractedItem(item),
    render: (item) => buildConceptBreakdownRenderableFromStructured(item),
  },
  'smart-qa-practice-generator': {
    canonicalize: (item, _slug, text) => canonicalizePracticeQaExtractedItem(item, text || ''),
    render: (item) => buildPracticeQaRenderableFromStructured(item),
    needsSourceText: true,
  },
  'chapter-summary-creator': {
    canonicalize: (item) => canonicalizeChapterSummaryExtractedItem(item),
    render: (item) => buildChapterSummaryRenderableFromStructured(item),
  },
  'key-points-formula-extractor': {
    canonicalize: (item) => canonicalizeKeyPointsExtractedItem(item),
    render: (item) => buildKeyPointsRenderableFromStructured(item),
  },
  'quick-assignment-builder': {
    canonicalize: (item) => canonicalizeQuickAssignmentExtractedItem(item),
    render: (item) => buildQuickAssignmentRenderableFromStructured(item),
  },
};

export function getToolFormatter(toolSlug) {
  return TOOL_FORMATTER_REGISTRY[String(toolSlug || '').trim()] || null;
}

export function listRegisteredFormatters() {
  return Object.keys(TOOL_FORMATTER_REGISTRY);
}
