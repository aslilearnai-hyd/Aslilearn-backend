/**
 * Which chapters actually have generated AI-tool content.
 *
 * The chapter list offered to teachers and students comes from the syllabus on
 * disk, while the content lives in AiToolGeneration — and most syllabus
 * chapters have never been generated. Both dashboards need the same answer, so
 * the query lives here rather than being copied into each one.
 */
import AiToolGeneration from '../models/AiToolGeneration.js';
import { toolNameFilterValues } from '../ai/generators/shared/ai-tool-rotation-service.js';
import { escapeRegex } from '../ai/shared/ai-tool-data-match.js';
import { subjectFilterForDb } from '../utils/curriculum-subject-validation.js';

/** A record only counts as usable if it actually carries content. */
export const VALID_AI_TOOL_CONTENT_OR = [
  {
    generatedContent: {
      $exists: true,
      $nin: ['', null],
      $not: /no projects available/i,
    },
  },
  {
    content: {
      $exists: true,
      $nin: ['', null],
      $not: /no projects available/i,
    },
  },
];

function toolNameAvailabilityFilter(toolName) {
  const values = toolNameFilterValues(toolName);
  if (!values.length) return {};
  return {
    toolName: {
      $in: values.map((v) => new RegExp(`^${escapeRegex(v)}$`, 'i')),
    },
  };
}

/**
 * Chapters that have content for a class/subject, optionally narrowed to one
 * tool. `subject` must already be normalized (e.g. "Maths") — subjectFilterForDb
 * reconciles the "Maths"/"Mathematics" split in the stored data.
 * Returns [] on failure: availability is a hint, never a gate.
 *
 * toolName matching must use the same slug/alias/title set as content lookup
 * (fetchRotatingAiToolData), otherwise the dropdown greys out chapters that
 * actually open fine.
 */
export async function listTopicsWithContent({ classDisplay, subject, toolName } = {}) {
  if (!classDisplay || !subject) return [];
  try {
    const filter = {
      classLabel: classDisplay,
      subject: subjectFilterForDb(subject),
      $or: VALID_AI_TOOL_CONTENT_OR,
      ...(toolName ? toolNameAvailabilityFilter(toolName) : {}),
    };
    // Prefer distinct over topic with a lean filter — compound indexes cover class/subject/tool.
    const topics = await AiToolGeneration.distinct('topic', filter).maxTimeMS(8_000);
    return topics.map((t) => String(t || '').trim()).filter(Boolean);
  } catch (error) {
    console.warn('[AI_TOOL_AVAILABILITY] lookup failed:', error?.message || error);
    return [];
  }
}

/**
 * The message shown when a chapter has no content. Naming the chapters that do
 * work is the difference between a dead end and a next step.
 */
export function buildNoContentMessage({
  toolLabel,
  classDisplay,
  subject,
  topic,
  subtopic,
  availableTopics = [],
}) {
  const tool = toolLabel || 'this tool';
  if (!availableTopics.length) {
    return (
      `No ${tool} content has been generated for ${classDisplay} ${subject} yet. ` +
      'Ask the Super Admin to generate it under AI Tool Generations.'
    );
  }
  const shown = availableTopics.slice(0, 8).join('; ');
  const more = availableTopics.length > 8 ? `; and ${availableTopics.length - 8} more` : '';
  return (
    `No ${tool} content has been generated for "${topic || 'this chapter'}"` +
    `${subtopic ? ` / "${subtopic}"` : ''} yet. ` +
    `Chapters ready for this tool in ${classDisplay} ${subject}: ${shown}${more}.`
  );
}
