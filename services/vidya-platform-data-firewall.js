/**
 * Zero-LLM safety classifier for questions that must be answered from the
 * authenticated AsliLearn application scope. False negatives may hallucinate;
 * false positives only produce a safe application answer/clarification.
 */
const SOCIAL_RE = /^(?:hi|hello|hey|namaste|thanks|thank you|ok|okay|bye)[\s!.,?]*$/i;
const CONCEPT_RE = /\b(?:define|definition|meaning|explain the concept|what is the meaning|textbook|formula|derive|prove)\b/i;

const COMMON_DATA_RE = /\b(?:dashboard|profile|account|login|logged in|calendar|timetable|attendance|homework|assignment|exam results?|marks?|scores?|rank|progress|performance|report card|learning path|videos? (?:watched|have i watched)|streak|offline results?|omr)\b/i;
const PERSONAL_RE = /\b(?:my|mine|me|i|our|we)\b/i;
const TEACHER_DATA_RE = /\b(?:my students|my classes|student roster|student (?:by name|named|called)|student details?|student report|class performance|who is in my class|how many students|how many classes)\b/i;
const ADMIN_DATA_RE = /\b(?:my school|our school|school students|school teachers|school analytics|subscriptions?|orders?|revenue|usage|active users?|student count|teacher count)\b/i;

export function classifyPlatformDataQuestion(question, role = '') {
  const text = String(question || '').trim();
  const normalizedRole = String(role || '').toLowerCase();
  if (!text || SOCIAL_RE.test(text)) return { protected: false, reason: 'social' };

  // Explicit dictionary/concept language is permitted only when no possessive
  // or operational record terminology is present.
  const conceptual = CONCEPT_RE.test(text) && !PERSONAL_RE.test(text);
  const common = COMMON_DATA_RE.test(text) && (PERSONAL_RE.test(text) || /\b(?:show|list|give|check|open|latest|recent|upcoming|pending|completed|how many)\b/i.test(text));
  const teacher = normalizedRole === 'teacher' && TEACHER_DATA_RE.test(text);
  const admin = ['admin', 'super-admin'].includes(normalizedRole) && ADMIN_DATA_RE.test(text);
  const student = normalizedRole === 'student' && (common || /\b(?:what should i study|where am i weak|am i improving)\b/i.test(text));

  if (conceptual && !teacher && !admin && !student) return { protected: false, reason: 'concept' };
  if (teacher) return { protected: true, reason: 'teacher_school_data' };
  if (admin) return { protected: true, reason: 'admin_platform_data' };
  if (student) return { protected: true, reason: 'student_personal_data' };
  if (common) return { protected: true, reason: 'authenticated_platform_data' };
  return { protected: false, reason: 'knowledge_or_uncertain' };
}

export function enforceGroundingResult(result, firewall) {
  if (!firewall?.protected) return result;
  const grounding = String(result?.groundingStatus || '');
  if (/^(application|application_fallback|platform_data|database_grounded)$/.test(grounding)) {
    return result;
  }
  return {
    ...result,
    mode: 'application',
    groundingStatus: 'grounding_blocked',
    message:
      'I recognized this as a private AsliLearn data question, but I could not verify a database-grounded answer. Please be more specific or try again.',
    facts: null,
  };
}
