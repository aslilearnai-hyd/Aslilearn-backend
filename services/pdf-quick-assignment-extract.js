/**
 * Regex-based Quick Assignment Builder extraction from PDF text (11-section template).
 * @module services/pdf-quick-assignment-extract
 */

import { splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';
import {
  cleanPdfEducationalContent,
  contextualizeAssignmentPlaceholders,
  filterChecklistBullets,
  sanitizeAssignmentTextField,
} from './pdf-content-cleaner.js';
import {
  detectAssignmentSectionNum,
  parseAssignmentSections,
  parseBulletListBlock,
  parseConceptQuestionBlock,
} from './pdf-assignment-section-parser.js';
import {
  GENERATION_START_RE,
  isAssignmentBankNoiseLine,
  isGenerationBoundaryLine,
  isolateGenerationBlock,
  selectGenerationBlock,
  splitByGenerationMarkers,
  splitByRepeatedSectionOne,
} from './pdf-assignment-boundaries.js';

const ASSIGNMENT_MARKER = /^(?:Item|Assignment)\s+\d+\b/i;
const MY_ASSIGNMENT_TITLE_RE = /^my\s+assignment\s*:/i;

/**
 * @param {string} text
 * @returns {string}
 */
function isolateSingleAssignmentText(text) {
  const cleaned = cleanPdfEducationalContent(text);

  const generations = splitByGenerationMarkers(cleaned);
  if (generations.length > 0) {
    return generations[0].text;
  }

  const assignmentChunks = splitPdfTextByMarkerLines(cleaned, ASSIGNMENT_MARKER, 80);
  if (assignmentChunks.length > 1) {
    return isolateGenerationBlock(assignmentChunks[0], 1);
  }

  const sectionBlocks = splitByRepeatedSectionOne(cleaned);
  if (sectionBlocks.length > 1) {
    return sectionBlocks[0];
  }

  return isolateGenerationBlock(cleaned, 1);
}

/**
 * Pick one assignment from bulk PDF using topic / generation match.
 * @param {string} text
 * @param {Record<string, unknown>} [params]
 */
function selectAssignmentText(text, params = {}) {
  const cleaned = cleanPdfEducationalContent(text);
  const generations = splitByGenerationMarkers(cleaned);

  if (generations.length > 1) {
    return selectGenerationBlock(generations, params);
  }
  if (generations.length === 1) {
    return generations[0].text;
  }

  const assignmentChunks = splitPdfTextByMarkerLines(cleaned, ASSIGNMENT_MARKER, 80);
  if (assignmentChunks.length > 1) {
    const topic = str(params.subtopic || params.topic || '').toLowerCase();
    if (topic) {
      const hit = assignmentChunks.find((c) => c.toLowerCase().includes(topic));
      if (hit) return isolateGenerationBlock(hit, 1);
    }
    return isolateGenerationBlock(assignmentChunks[0], 1);
  }

  const sectionBlocks = splitByRepeatedSectionOne(cleaned);
  if (sectionBlocks.length > 1) {
    const topic = str(params.subtopic || params.topic || '').toLowerCase();
    if (topic) {
      const hit = sectionBlocks.find((b) => b.toLowerCase().includes(topic));
      if (hit) return isolateGenerationBlock(hit, 1);
    }
    return sectionBlocks[0];
  }

  return isolateGenerationBlock(cleaned, 1);
}

/**
 * @param {string} block
 * @param {number} index
 * @param {Record<string, unknown>} [params]
 */
function parseAssignmentBlock(block, index, params = {}) {
  const isolated = isolateGenerationBlock(
    contextualizeAssignmentPlaceholders(cleanPdfEducationalContent(block), params),
    Number(params.generation || params.generationNumber || 1),
  );
  const sections = parseAssignmentSections(isolated);

  const titleRaw =
    sections.get(1) ||
    isolated
      .split('\n')
      .map((l) => str(l))
      .find((l) => MY_ASSIGNMENT_TITLE_RE.test(l) || (l.length >= 8 && l.length <= 200)) ||
    '';

  let assignment_title = str(titleRaw.split('\n')[0]);
  if (MY_ASSIGNMENT_TITLE_RE.test(assignment_title)) {
    assignment_title = str(assignment_title.replace(MY_ASSIGNMENT_TITLE_RE, ''));
  }
  const sub = str(params.subtopic || params.topic);
  if (sub && /final\s+mastery|mastery\s+assignment/i.test(assignment_title)) {
    assignment_title = `${sub} Assignment`;
  }
  if (!assignment_title) assignment_title = `Assignment ${index + 1}`;

  const row = {
    sl_no: index + 1,
    assignment_title,
    title: assignment_title,
    learning_objectives: filterChecklistBullets(parseBulletListBlock(sections.get(2) || '')),
    instructions: sanitizeAssignmentTextField(sections.get(3) || ''),
    concept_based_questions: parseConceptQuestionBlock(sections.get(4) || ''),
    application_oriented_tasks: filterChecklistBullets(parseBulletListBlock(sections.get(5) || '')),
    real_life_competency_activity: sanitizeAssignmentTextField(sections.get(6) || ''),
    creative_thinking_question: sanitizeAssignmentTextField(sections.get(7) || ''),
    collaborative_discussion_task: sanitizeAssignmentTextField(sections.get(8) || ''),
    challenge_question_advanced: sanitizeAssignmentTextField(sections.get(9) || ''),
    assessment_criteria_rubric: sanitizeAssignmentTextField(sections.get(10) || ''),
    expected_learning_outcomes: filterChecklistBullets(parseBulletListBlock(sections.get(11) || '')),
    _fromPdf: true,
  };

  const hasBody =
    row.learning_objectives.length > 0 ||
    str(row.instructions).length > 8 ||
    row.concept_based_questions.length > 0 ||
    row.application_oriented_tasks.length > 0 ||
    str(row.real_life_competency_activity).length > 8 ||
    str(row.creative_thinking_question).length > 8 ||
    str(row.collaborative_discussion_task).length > 8 ||
    str(row.challenge_question_advanced).length > 8 ||
    str(row.assessment_criteria_rubric).length > 8 ||
    row.expected_learning_outcomes.length > 0;

  if (!hasBody) return null;
  return row;
}

/**
 * @param {string} text
 * @param {Record<string, unknown>} [params]
 * @returns {{ text: string, generation: number }}
 */
function resolveSelectedAssignment(text, params = {}) {
  const cleaned = cleanPdfEducationalContent(str(text));
  const generations = splitByGenerationMarkers(cleaned);

  if (generations.length > 1) {
    const topic = str(params.subtopic || params.topic || '').toLowerCase();
    const titleNeedle = str(params.assignmentTitle || '').toLowerCase();
    const needles = [titleNeedle, topic].filter((n) => n.length >= 3);

    let picked = generations[0];
    if (needles.length) {
      const scored = generations.map((g) => {
        const head = `${g.title}\n${g.text.slice(0, 2500)}`.toLowerCase();
        const score = needles.reduce((n, needle) => n + (head.includes(needle) ? 20 : 0), 0);
        return { g, score };
      });
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score > 0) picked = scored[0].g;
    }

    return { text: picked.text, generation: picked.generation };
  }

  if (generations.length === 1) {
    return { text: generations[0].text, generation: generations[0].generation };
  }

  return { text: selectAssignmentText(text, params), generation: 1 };
}

/**
 * @param {string} text
 * @param {number} [limit=50]
 * @param {Record<string, unknown>} [params]
 */
export function extractQuickAssignmentItemsFromPdfText(text, limit = 50, params = {}) {
  const { text: selected, generation } = resolveSelectedAssignment(text, params);
  const parsed = parseAssignmentBlock(selected, 0, { ...params, generation, generationNumber: generation });
  if (!parsed) return [];

  return [parsed].slice(0, limit);
}

export {
  GENERATION_START_RE,
  isGenerationBoundaryLine,
  isolateGenerationBlock,
  splitByGenerationMarkers,
};
