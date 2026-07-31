/**
 * Canonical subtopic labels for AI/book generator storage + grouped lists.
 * Prevents duplicate "Whole chapter" buckets (empty / aliases / true multi-joins).
 *
 * IMPORTANT: Do NOT treat natural-language commas in a single curriculum title as a
 * multi-list (e.g. "Speed, Velocity and Acceleration"). Combined papers use "|" or
 * an explicit subTopics[] array with combineSubtopics=true.
 */
import { isWholeChapterSubtopic } from '../../../utils/questionComposition.js';

const WHOLE_CHAPTER_LABEL = 'Whole chapter';

/**
 * True when the value is an intentional joined multi-subtopic list, not one title.
 * Only "|" (and similar explicit joiners) count — commas appear in real chapter titles.
 */
export function isJoinedMultiSubtopicLabel(value) {
  const t = String(value || '').trim();
  if (!t) return false;
  // App join separator when combining selected subtopics into one paper
  if (t.includes('|') && t.split('|').map((p) => p.trim()).filter(Boolean).length >= 2) {
    return true;
  }
  // Explicit " + " joins (rare, but used in some combine UIs)
  if (/\s\+\s/.test(t) && t.split(/\s\+\s/).map((p) => p.trim()).filter(Boolean).length >= 2) {
    return true;
  }
  return false;
}

export function isSingleSubtopicLabel(value) {
  const t = String(value || '').trim();
  if (!t) return false;
  if (isWholeChapterSubtopic(t)) return false;
  if (isJoinedMultiSubtopicLabel(t)) return false;
  return true;
}

/**
 * Normalize what we persist / group under.
 * - empty, aliases, explicit multi-joins, chapterScope / combine → "Whole chapter"
 * - otherwise keep the trimmed single subtopic name (commas allowed)
 */
export function canonicalizeGeneratorSubtopic(value, opts = {}) {
  const forceWhole =
    opts.forceWholeChapter === true ||
    opts.chapterScope === true ||
    (Array.isArray(opts.subTopicList) && opts.subTopicList.filter(Boolean).length > 1);

  if (forceWhole) return WHOLE_CHAPTER_LABEL;

  const raw = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!raw || isWholeChapterSubtopic(raw) || isJoinedMultiSubtopicLabel(raw)) {
    return WHOLE_CHAPTER_LABEL;
  }

  return raw;
}

export function generatorSubtopicGroupKey(value) {
  return canonicalizeGeneratorSubtopic(value);
}

export { WHOLE_CHAPTER_LABEL };
