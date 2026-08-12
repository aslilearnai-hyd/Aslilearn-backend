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
  { generatedContent: { $exists: true, $nin: ['', null] } },
  { content: { $exists: true, $nin: ['', null] } },
  { 'metadata.structuredContent.schema': 'asli-v2-six-section' },
  { 'metadata.legacyStructuredContent': { $exists: true, $ne: null } },
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
 * Neutral miss copy — do not gate UX on a "ready chapters" allow-list.
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
  void topic;
  void subtopic;
  void availableTopics;
  return (
    `No saved ${tool} content matched ${classDisplay} ${subject} for this selection yet. ` +
    'Try Generate again shortly, or ask your school to add this chapter.'
  );
}
