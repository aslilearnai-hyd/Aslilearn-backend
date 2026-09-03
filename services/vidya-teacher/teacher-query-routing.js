/**
 * Teacher Vidya routing: school exam records vs tutor/lesson questions.
 * Kept separate from desk-facts so tests can mock Mongo without losing this logic.
 */

export function isTeacherExamDataQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (!/\bexams?\b/.test(q)) return false;
  if (
    /\b(prepare|preparation|exam-ready|board exam tips|how to study for)\b/.test(q) &&
    !/\b(list|show|latest|recent|upcoming|schedule|last month|this month)\b/.test(q)
  ) {
    return false;
  }
  if (
    /\b(what is|define|meaning of|explain the concept)\b/.test(q) &&
    !/\b(list|show|latest|recent|upcoming|schedule|last month|this month)\b/.test(q)
  ) {
    return false;
  }
  // Named-student exam marks stay on the person-detail path.
  if (
    /\b(marks?|scores?|results?|performance)\b/.test(q) &&
    /(?:'s|’s|\bstudent\b|\babout\b|\bnamed\b|\bcalled\b)/.test(q)
  ) {
    return false;
  }
  return true;
}

export function isTeacherExamFollowUp(question, history = []) {
  if (isTeacherExamDataQuestion(question)) return true;
  const q = String(question || '').toLowerCase().trim();
  if (!q) return false;
  const recent = (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((item) => String(item?.content || item?.text || '').toLowerCase())
    .join('\n');
  if (!/\bexams?\b/.test(recent)) return false;
  return (
    /\b(last|this|previous|past)\s+month\b/.test(q) ||
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b/.test(q) ||
    /\b20\d{2}\b/.test(q) ||
    /\b(filter|latest|recent|those|them|the dates|chronological|identify)\b/.test(q) ||
    /^(?:list|show)(?:\s+them)?\??$/.test(q)
  );
}

export function resolveTeacherExamQuestion(question, history = []) {
  const q = String(question || '').trim();
  if (!q) return q;
  if (isTeacherExamDataQuestion(q)) return q;
  if (isTeacherExamFollowUp(q, history) && !/\bexams?\b/i.test(q)) {
    return `${q} exams`;
  }
  return q;
}
