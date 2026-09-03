// Explicit stored-record requests must retain authenticated data grounding.
export function isLearningRequest(question) {
  const q = String(question || '').trim().toLowerCase();
  const homeworkLesson = /\bhelp me with (?:my )?homework (?:on|about)\s+\S/.test(q);
  if (/\b(account|profile|login|calendar|timetable|learning path|streak|student|students|classes|school|subscription|revenue|users)\b/.test(q)) return false;
  if (/\b(homework|assignment|exam|video)\b/.test(q) && !homeworkLesson) return false;
  if (/\b(marks?|scores?|results?|attendance|roster|dashboard|performance|progress|rank|omr|my students|my classes)\b/.test(q)) return false;
  return /^(?:please\s+)?(?:teach me\b|explain\b|define\b|solve\b|derive\b|calculate\b|make (?:it|that|this) simpler\b|continue\b|give (?:me )?(?:an?|another|more) examples?\b)/.test(q)
    || /\b(?:give|create|generate|make)\s+(?:me\s+)?(?:a\s+)?(?:quiz|questions?|practice problems?)\s+(?:on|about|in)\s+\S/.test(q)
    || /\b(?:confused about|help me understand)\s+\S/.test(q)
    || /\bhelp me with (?:my )?homework (?:on|about)\s+\S/.test(q);
}
