/**
 * Prompt Engine registry — one pack per AI tool slug.
 * @module prompts/registry
 */

import activityProjectGenerator from './tools/activity-project-generator.js';
import projectIdeaLab from './tools/project-idea-lab.js';
import worksheetMcqGenerator from './tools/worksheet-mcq-generator.js';
import conceptMasteryHelper from './tools/concept-mastery-helper.js';
import lessonPlanner from './tools/lesson-planner.js';
import studyScheduleMaker from './tools/study-schedule-maker.js';
import homeworkCreator from './tools/homework-creator.js';
import readingPracticeRoom from './tools/reading-practice-room.js';
import storyPassageCreator from './tools/story-passage-creator.js';
import shortNotesSummariesMaker from './tools/short-notes-summaries-maker.js';
import myStudyDecks from './tools/my-study-decks.js';
import flashcardGenerator from './tools/flashcard-generator.js';
import dailyClassPlanMaker from './tools/daily-class-plan-maker.js';
import mockTestBuilder from './tools/mock-test-builder.js';
import examQuestionPaperGenerator from './tools/exam-question-paper-generator.js';
import smartStudyGuideGenerator from './tools/smart-study-guide-generator.js';
import conceptBreakdownExplainer from './tools/concept-breakdown-explainer.js';
import smartQaPracticeGenerator from './tools/smart-qa-practice-generator.js';
import chapterSummaryCreator from './tools/chapter-summary-creator.js';

/** @type {Record<string, import('./types.js').ToolPromptPack>} */
export const PROMPT_REGISTRY = Object.freeze({
  'activity-project-generator': activityProjectGenerator,
  'project-idea-lab': projectIdeaLab,
  'worksheet-mcq-generator': worksheetMcqGenerator,
  'concept-mastery-helper': conceptMasteryHelper,
  'lesson-planner': lessonPlanner,
  'study-schedule-maker': studyScheduleMaker,
  'homework-creator': homeworkCreator,
  'reading-practice-room': readingPracticeRoom,
  'story-passage-creator': storyPassageCreator,
  'short-notes-summaries-maker': shortNotesSummariesMaker,
  'my-study-decks': myStudyDecks,
  'flashcard-generator': flashcardGenerator,
  'daily-class-plan-maker': dailyClassPlanMaker,
  'mock-test-builder': mockTestBuilder,
  'exam-question-paper-generator': examQuestionPaperGenerator,
  'smart-study-guide-generator': smartStudyGuideGenerator,
  'concept-breakdown-explainer': conceptBreakdownExplainer,
  'smart-qa-practice-generator': smartQaPracticeGenerator,
  'chapter-summary-creator': chapterSummaryCreator,
});

/**
 * Prompt Engine enabled by default. Set AI_PROMPT_ENGINE=false to use legacy prompts only.
 * @returns {boolean}
 */
export function isPromptEngineEnabled() {
  const raw = String(process.env.AI_PROMPT_ENGINE ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/**
 * @param {string} toolSlug
 * @returns {import('./types.js').ToolPromptPack | null}
 */
export function getToolPromptPack(toolSlug) {
  const slug = String(toolSlug || '').trim();
  if (!slug || !isPromptEngineEnabled()) return null;
  return PROMPT_REGISTRY[slug] || null;
}

/**
 * @param {string} toolSlug
 * @param {import('./types.js').PromptContext} [ctx]
 * @returns {string}
 */
export function buildPromptEngineSystemPrompt(toolSlug, ctx = {}) {
  const pack = getToolPromptPack(toolSlug);
  if (!pack) return '';
  return pack.system({ ...ctx, slug: toolSlug, toolTitle: pack.toolTitle });
}

/**
 * @param {string} toolSlug
 * @param {import('./types.js').PromptContext} [ctx]
 * @returns {string}
 */
export function buildPromptEngineGenerationBlock(toolSlug, ctx = {}) {
  const pack = getToolPromptPack(toolSlug);
  if (!pack) return '';
  return pack.generation({ ...ctx, slug: toolSlug, toolTitle: pack.toolTitle });
}

/**
 * @param {string} toolSlug
 * @param {import('./types.js').PromptContext} [ctx]
 * @returns {string}
 */
export function buildPromptEngineRewritePrompt(toolSlug, ctx = {}) {
  const pack = getToolPromptPack(toolSlug);
  if (!pack) return '';
  return pack.rewrite({ ...ctx, slug: toolSlug, toolTitle: pack.toolTitle });
}

/**
 * @param {string} toolSlug
 * @param {import('./types.js').PromptContext} [ctx]
 * @returns {string}
 */
export function buildPromptEngineRepairPrompt(toolSlug, ctx = {}) {
  const pack = getToolPromptPack(toolSlug);
  if (!pack) return '';
  return pack.repair({ ...ctx, slug: toolSlug, toolTitle: pack.toolTitle });
}
