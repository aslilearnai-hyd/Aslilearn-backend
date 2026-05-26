/**
 * Story & Passage Creator — English and Hindi only.
 */

export function isStoryPassageAllowedSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return false;
  if (/(hindi|हिंदी|हिन्दी)/i.test(s)) return true;
  if (/english/i.test(s)) return true;
  return false;
}

/** Map curriculum label → canonical DB subject for lookups. */
export function canonicalStoryPassageSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return null;
  if (/(hindi|हिंदी|हिन्दी)/i.test(s)) return 'Hindi';
  if (/english/i.test(s)) return 'English';
  return null;
}

export const STORY_PASSAGE_SUBJECT_ERROR =
  'Story & Passage Creator is only available for English and Hindi subjects.';
