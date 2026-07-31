/**
 * Canonical subtopic labels for AI/book generator storage + grouped lists.
 * Prevents duplicate "Whole chapter" buckets (empty / aliases / joined lists).
 */
import { isWholeChapterSubtopic } from '../../../utils/questionComposition.js';

const WHOLE_CHAPTER_LABEL = 'Whole chapter';

/** True when the value is a joined multi-subtopic list, not one focused subtopic. */
export function isJoinedMultiSubtopicLabel(value) {
  const t = String(value || '').trim();
  if (!t) return false;
  if (/\|\s*/.test(t) && t.split('|').filter((p) => p.trim()).length >= 2) return true;
  const commaParts = t.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
  return commaParts.length >= 2;
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
 * - empty, aliases, joined lists, explicit multi-subtopic scope → "Whole chapter"
 * - otherwise keep the trimmed single subtopic name
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
