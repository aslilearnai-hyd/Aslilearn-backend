import { callModel, buildContentsFromHistory } from '../model-router.js';
import { resolveVidyaCurriculum } from '../vidya-curriculum.js';
import { retrieveVidyaTextbookContext, appendTextbookSources } from '../vidya-textbook-context.js';
import { maybeExplainStoredSources } from '../vidya-citation-registry.js';
import { prepareConversationHistory } from '../../ai/shared/conversation-history.js';

export const TEACHING_FORMAT_RULES = `You are a sharp school tutor. Teach so the student can solve the next exercise without guessing.

Layout (neat markdown, real newlines, blank line between sections):
- One specific opener naming the exact topic. Never write "Hello! Let's learn this simply" or any generic greeting.
- Numbered headings (1. 2. 3.) for each idea, in textbook order.
- Under each heading: short bullets (•). Bold key terms with **like this**.
- For Maths/Science include a **Worked example** with full steps, then a **Check** (inverse operation, units, or substitution).
- Add **Common mistake** when students usually slip.
- End with **Try this**: 2 short practice questions (do not print the answers unless asked).
- Then one-line **Tip**.

Quality:
- Prefer the retrieved textbook's definitions, terms, and methods. Cite used passages as [B1] in the sentence.
- Write in clear Indian English. For newly created money examples use Indian rupees (₹ / INR), paise, lakh/crore and Indian digit grouping; never introduce dollars, pounds or cents unless the user or retrieved textbook specifically requires that foreign currency.
- Prefer familiar Indian school and everyday contexts and SI units. Preserve foreign places, currencies and facts when they are genuinely part of the requested textbook passage—do not rewrite source facts.
- Be concrete: numbers, expressions, and reasons — not filler ("in this chapter we will", "it is important to note").
- Maths: never say that increasing a term always increases the total (false for subtraction). Never tell students to check by doing the operation in a different order. Use inverse operations, substitution, or estimation.
- If you add identities, inverses, or isolating variables beyond the retrieved chapter, label that section **Enrichment** (not from this textbook excerpt).
- Match the student's class. Do not skip steps. Do not dump the whole PDF.
- For an entire-chapter request, cover every subtopic in the authoritative AI Tool Topics checklist and synthesize all supplied chapter-wide textbook evidence. Do not present one passage as the complete chapter.
- Never write a Sources list. Never cite a book from a different subject. Cite only IDs supplied in the retrieved passages.`;

const TEACHING_GENERATION = { temperature: 0.35, maxOutputTokens: 4096 };

export function tidyVidyaReply(answer = '') {
  let text = String(answer || '').replace(/\r\n/g, '\n');
  text = text.replace(/^\s*(?:hello!\s*)?let'?s learn (?:this|about this|it) simply\.?\s*/i, '');
  text = text.replace(/^\s*hello!\s+/i, '');
  text = text.replace(/^[ \t]+|[ \t]+$/gm, '');
  text = text.replace(/^(?:[-*]|•)\s+/gm, '• ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/([^\n])\n(?=(?:#{1,3}\s|\d{1,2}\.\s|\*\*(?:Worked example|Common mistake|Try this|Tip|Check)))/g, '$1\n\n');
  return text.trim();
}

function looksUnstructured(text) {
  const t = String(text || '');
  const newlines = (t.match(/\n/g) || []).length;
  const bullets = (t.match(/[•●]|(^|\n)\s*[-*]\s+/g) || []).length;
  const numbered = (t.match(/(^|\n)\s*\d{1,2}[.)]\s+/g) || []).length;
  if (t.length > 600 && newlines < 4 && bullets + numbered < 2) return true;
  const longest = Math.max(...t.split(/\n/).map((l) => l.length), 0);
  if (longest > 420 && bullets + numbered < 2) return true;
  return false;
}

function looksGenericLesson(text) {
  return /^\s*(?:hello!\s*)?let'?s learn this simply/i.test(String(text || ''));
}

function citationRules() {
  return 'Cite a retrieved passage only as [B1] in the sentence you used. Do not write a Sources list — the system appends sources. Cite only passages you actually used. Never cite a book from a different subject than the student asked about.';
}

function conversationRules() {
  return 'Use earlier conversation to understand follow-ups and named books. Do not ask again for information already established. Earlier assistant statements are not verified source evidence. Never count retrieved chunks as lessons or claim a complete lesson count from partial excerpts. Do not print internal indexed-section labels.';
}

function buildTeachingSystemInstruction({
  classText,
  boardText,
  curriculum,
  textbook,
  enrolledSubjects = [],
  weakChapters = [],
}) {
  return [
    `You are Vidya AI, an expert tutor for ${classText} students following the ${boardText}.`,
    'Localisation is India-first: use Indian English, ₹/INR for invented money examples, Indian number formatting, SI units, and age-appropriate Indian contexts. Do not replace a foreign context when it is an explicit fact in the textbook or question.',
    'Answer with exam-ready accuracy. Teach the asked topic fully — not a two-bullet summary.',
    curriculum.context,
    conversationRules(),
    citationRules(),
    textbook.context || 'No textbook passages were retrieved. Label this as a general explanation, not an answer verified against the school PDF.',
    TEACHING_FORMAT_RULES,
    enrolledSubjects.length ? `The student's enrolled subjects are: ${enrolledSubjects.join(', ')}. Teach only the subject they asked about.` : '',
    weakChapters.length
      ? `This student has struggled with: ${weakChapters.slice(0, 3).join(', ')}. Explain those links extra clearly.`
      : '',
    'If the topic is ambiguous, ask one brief clarification instead of guessing.',
    'Do not say "as an AI" or "I cannot". If unsure, give your best explanation and note the uncertainty.',
    'Do not invent exam scores, school exam lists, or personal student data.',
    'Never invent a default calendar year such as 2024. If the user asked for live school exams, dates, or last-month filters, do not write a filtering tutorial or worked example; say the live school exam list is required instead.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function generateTeachingAnswer({
  viewerUserId,
  viewerRole = 'student',
  question,
  classLevel,
  subjectContext,
  board = '',
  weakChapters = [],
  enrolledSubjects = [],
  conversationHistory = [],
}) {
  const classText = classLevel ? `Class ${classLevel}` : 'school level';
  const boardText = board ? `${board} board` : 'Indian school curriculum';
  const q = String(question || '').slice(0, 3000);
  const storedSources = maybeExplainStoredSources(q, conversationHistory);
  if (storedSources) return storedSources;
  const curriculum = await resolveVidyaCurriculum({ question: q, history: conversationHistory, userId: viewerUserId, role: viewerRole, forLearning: true });
  if (curriculum.clarification) return curriculum.clarification;
  const textbook = await retrieveVidyaTextbookContext({ question: q, history: conversationHistory, curriculum });
  if (textbook.directAnswer) return textbook.directAnswer;
  if (curriculum.scope && !curriculum.context && !textbook.context) {
    return 'I checked the configured AI Tool Topics and matching indexed textbooks for your curriculum, but could not identify this chapter reliably. Please share the chapter title or relevant PDF passage; an unindexed or scanned PDF may need indexing/OCR first.';
  }

  const systemInstruction = buildTeachingSystemInstruction({
    classText,
    boardText,
    curriculum,
    textbook,
    enrolledSubjects,
    weakChapters,
  });

  const userMessage = [
    subjectContext ? `Subject: ${subjectContext}` : '',
    classLevel ? `Class: ${classLevel}` : '',
    'Teach this question completely, accurately, and neatly:',
    q,
  ]
    .filter(Boolean)
    .join('\n');

  const callOnce = async (message) => {
    const result = await callModel({
      systemInstruction,
      contents: buildContentsFromHistory({ history: prepareConversationHistory(conversationHistory), userMessage: message }),
      generationConfig: TEACHING_GENERATION,
    });
    return String(result?.text || '').trim();
  };

  let text = await callOnce(userMessage);
  if (!text) throw new Error('General knowledge response is empty');

  if (looksUnstructured(text) || looksGenericLesson(text)) {
    const repairMessage = [
      'Rewrite this as a complete, neat lesson — not one paragraph and not a generic greeting.',
      '',
      'Use:',
      'Specific opener.',
      '',
      '1. **Idea**',
      '• definition from the textbook',
      '• worked example with steps',
      '• check',
      '',
      '2. **Next idea**',
      '• …',
      '',
      '**Try this:** two practice questions',
      '**Tip:** …',
      '',
      `Student question: ${q}`,
      '',
      'Draft to rewrite:',
      text.slice(0, 3500),
    ].join('\n');

    try {
      const repaired = await callOnce(repairMessage);
      if (repaired && !looksUnstructured(repaired) && !looksGenericLesson(repaired)) {
        text = repaired;
      } else if (repaired && !looksGenericLesson(repaired)) {
        text = repaired;
      }
    } catch {
      /* keep original */
    }
  }

  return appendTextbookSources(textbook.sources, tidyVidyaReply(text));
}

/**
 * Generates a curriculum-grounded answer using Gemini.
 * Accepts optional student context so the answer is relevant to their class, board, and weak topics.
 */
export async function generateGeneralKnowledgeAnswer(opts) {
  return generateTeachingAnswer({ ...opts, viewerRole: opts.viewerRole || 'teacher' });
}

/**
 * ChatGPT-style answer: student app data + natural-language question.
 * Learning questions use the tutor path so they stay precise and neat.
 */
export async function generateContextAwareAnswer({
  viewerUserId,
  useTextbooks = false,
  question,
  classLevel,
  board = '',
  enrolledSubjects = [],
  studentDataSummary = '',
  conversationHistory = [],
  subjectContext,
  weakChapters = [],
}) {
  if (useTextbooks) {
    return generateTeachingAnswer({
      viewerUserId,
      viewerRole: 'student',
      question,
      classLevel,
      subjectContext,
      board,
      weakChapters,
      enrolledSubjects,
      conversationHistory,
    });
  }

  const classText = classLevel ? `Class ${classLevel}` : 'school level';
  const boardText = board ? `${board} board` : 'Indian school curriculum';
  const q = String(question || '').slice(0, 3000);
  const storedSources = maybeExplainStoredSources(q, conversationHistory);
  if (storedSources) return storedSources;
  const curriculum = await resolveVidyaCurriculum({ question: q, history: conversationHistory, userId: viewerUserId, role: 'student', forLearning: false });
  if (curriculum.clarification) return curriculum.clarification;
  const textbook = await retrieveVidyaTextbookContext({ question: q, history: conversationHistory, curriculum });
  if (textbook.directAnswer) return textbook.directAnswer;
  if (curriculum.scope && !curriculum.context && !textbook.context) {
    return 'I checked the configured AI Tool Topics and matching indexed textbooks for your curriculum, but could not identify this chapter reliably. Please share the chapter title or relevant PDF passage; an unindexed or scanned PDF may need indexing/OCR first.';
  }
  const subjectsLine = enrolledSubjects.length
    ? `Enrolled subjects: ${enrolledSubjects.join(', ')}.`
    : '';

  const systemInstruction = [
    `You are Vidya, a personal assistant for a ${classText} student on Asli Learn (${boardText}). ${subjectsLine}`,
    `Use only data supplied for this question. For textbook questions, answer the textbook question directly; do not introduce marks, video progress, weaknesses or exam advice.`,
    curriculum.context,
    conversationRules(),
    citationRules(),
    textbook.context || 'No textbook passages were retrieved. Do not claim to have checked the PDF; label any teaching as a general explanation.',
    ``,
    `Decide what they want from the question itself (any phrasing is fine: "I want videos", "report", "how am I doing").`,
    ``,
    `If they want THEIR data (videos, exams, marks, report, homework, attendance, progress, timetable, rank, OMR):`,
    `- Answer with the real numbers and titles from the data. Never invent scores, video names, or ranks.`,
    `- Lead with their facts, not a definition of what a report card is.`,
    `- If a list is empty, say so honestly and suggest the next step in the app.`,
    `- Do NOT start with "Hello! Let's learn…".`,
    `- Keep the reply neat: short paragraphs, bullets for lists, no filler.`,
    ``,
    `If they want a school topic explained (photosynthesis, quadratic equations, etc.):`,
    TEACHING_FORMAT_RULES,
    ``,
    `If they mix both (e.g. "why am I weak in physics"), use their real marks first, then a short explanation.`,
    `Be warm, concise, and markdown-formatted. Never say you lack access to their data.`,
  ]
    .filter(Boolean)
    .join('\n');

  const userMessage = [
    `=== STUDENT'S REAL APP DATA ===`,
    studentDataSummary || '(No data available yet — student is new)',
    ``,
    `=== STUDENT'S QUESTION ===`,
    q,
  ].join('\n');

  const safeHistory = prepareConversationHistory(conversationHistory);

  const result = await callModel({
    systemInstruction,
    contents: buildContentsFromHistory({ history: safeHistory, userMessage }),
    generationConfig: { temperature: 0.3, maxOutputTokens: 2500 },
  });
  const text = String(result?.text || '').trim();
  if (!text) throw new Error('Context-aware response is empty');
  return appendTextbookSources(textbook.sources, tidyVidyaReply(text));
}
