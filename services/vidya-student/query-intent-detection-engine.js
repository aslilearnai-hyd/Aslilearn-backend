/**
 * APP_HINTS — phrases that signal the student is asking about their OWN data
 * (marks, weak topics, progress, attendance, rank, recommendations).
 * These map to `type: 'application'` — answered from MongoDB context, not Gemini.
 */
const APP_HINTS = [
  // "my" phrased queries
  'my marks', 'my score', 'my exams', 'my attendance', 'my progress', 'my rank',
  'my dashboard', 'my weak', 'my performance', 'my result', 'my subjects',
  'my streak', 'my improvement', 'my recommendation', 'my analysis', 'my report',
  'my standing', 'my average', 'my percentage', 'my chapter', 'my topic',

  // "i am / i have / i scored" phrased queries
  'i am weak', 'i am strong', 'i am failing', 'i am struggling',
  'where am i weak', 'where am i', 'how am i doing', 'how am i performing',
  'what am i bad', 'what am i good',
  'i scored', 'i got', 'i passed', 'i failed',
  'i have been', 'i need to improve',

  // "where / which / what" subject/topic queries
  'where i am weak', 'where i am strong', 'which subject am i weak',
  'which subject i am weak', 'where am i weak in', 'weak in subject',
  'weak in which', 'which topic am i', 'which chapter am i',
  'what subject i am', 'what topic i am', 'what chapter i am',
  'in which subject', 'in which topic', 'in which chapter',

  // performance queries
  'am i improving', 'am i getting better', 'am i doing well',
  'did i pass', 'did i fail', 'did i improve',
  'how did i do', 'how did i score', 'how did i perform',
  'tell me my', 'show me my', 'give me my',

  // recommendation queries
  'what should i study', 'what should i focus', 'what should i revise',
  'what should i practice', 'where should i focus', 'where should i study',
  'suggest me', 'recommend me', 'help me improve', 'what to study',
  'what to focus', 'what to revise', 'what to practice',

  // weak/strong topic queries
  'weak topic', 'weak chapter', 'weak subject', 'weak area',
  'strong topic', 'strong chapter', 'strong subject', 'strong area',
  'difficult topic', 'difficult chapter', 'difficult subject',
  'struggling with', 'trouble with', 'problem in',

  // exam count / planning (short phrases that must not fall through to uncertain/general)
  'study plan',
  'how many exams',
  'exams did i take',
  'exams have i taken',
  'all exam result',
  'all exam results',
  'my exam result',
  'exam history',
];

/**
 * GENERAL_HINTS — phrases that signal a subject-matter / concept question.
 * These map to `type: 'general'` — answered by Gemini with curriculum context.
 */
const GENERAL_HINTS = [
  'what is', 'what are', 'what was', 'what were',
  'explain', 'define', 'definition of', 'meaning of',
  'how does', 'how do', 'how is', 'how are',
  'how to', 'how can i', 'how should i',
  'difference between', 'compare', 'contrast',
  'formula for', 'formula of', 'equation for',
  'example of', 'example for', 'give example',
  'solve', 'calculate', 'find the', 'compute',
  'derive', 'prove', 'theorem', 'law of',
  'types of', 'kinds of', 'classify',
  'when was', 'when did', 'who discovered', 'who invented',
  'why does', 'why is', 'why are', 'why do',
  'what happens when', 'what happens if',
  'tell me about', 'explain about', 'describe',
];

/**
 * SELF_REFERENCE_PATTERNS — regex patterns that detect "I" / "me" / "my" style
 * self-reference even when not caught by APP_HINTS strings above.
 */
/**
 * Student asking for their own exam records (not a textbook "what is exam result?" definition).
 */
const EXAM_DATA_PATTERNS = [
  /\b(all\s+)?(my\s+)?exam\s*results?\b/,
  /\ball\s+(my\s+)?(exams?|tests?|assessments?)\b/,
  /\b(my\s+)?(exam|test)\s+(scores?|results?|marks?|performance)\b/,
  /\b(show|tell|give|list|get)\s+(me\s+)?(all\s+)?(my\s+)?(exam|test)/,
  /\bhow\s+(many|much)\s+.*\b(exams?|tests?)\b/,
  /\bwhat\s+(are|is)\s+(all\s+)?(my\s+)?(exam|test)/,
  /\bexam\s+history\b/,
  /\bresults?\s+of\s+(all\s+)?(my\s+)?exams?\b/,
];

function isExamDataQuestion(q) {
  return EXAM_DATA_PATTERNS.some((re) => re.test(q));
}

const SELF_REFERENCE_PATTERNS = [
  /\bmy\b/,
  /\bmine\b/,
  /\bi am\b/,
  /\bi'm\b/,
  /\bi have\b/,
  /\bi've\b/,
  /\bi scored\b/,
  /\bi got\b/,
  /\bi did\b/,
  /\bam i\b/,
  /\bwhere am i\b/,
  /\bhow am i\b/,
  /\bwhat am i\b/,
  /\bfor me\b/,
  /\bshow me\b/,
  /\btell me my\b/,
];

export function detectQueryIntent(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return { type: 'uncertain', confidence: 0.0 };

  const appHint = APP_HINTS.some((s) => q.includes(s));
  const selfRef = SELF_REFERENCE_PATTERNS.some((p) => p.test(q));
  const examData = isExamDataQuestion(q);
  const generalHint = GENERAL_HINTS.some((s) => q.includes(s));

  const isApp = appHint || selfRef || examData;

  // "What is all exam result" = student's scores, not a dictionary definition.
  if (examData) return { type: 'application', confidence: 0.96 };

  // Both personal + conceptual → hybrid
  if (isApp && generalHint) return { type: 'hybrid', confidence: 0.85 };

  // Clearly personal/dashboard question
  if (isApp) return { type: 'application', confidence: 0.92 };

  // Clearly a subject-matter concept question
  if (generalHint) return { type: 'general', confidence: 0.88 };

  // IMPORTANT: If the question is long enough (5+ words), treat as general
  // rather than asking a clarification — a student asking a long question
  // almost certainly wants an answer, not a clarification request.
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 5) return { type: 'general', confidence: 0.6 };

  return { type: 'uncertain', confidence: 0.35 };
}

export function buildUncertainClarificationMessage() {
  return 'Could you tell me more? Are you asking about your personal marks and progress, or do you want me to explain a subject topic?';
}
