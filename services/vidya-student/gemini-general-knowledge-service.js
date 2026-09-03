import { callModel, buildContentsFromHistory } from '../model-router.js';
import { resolveVidyaCurriculum } from '../vidya-curriculum.js';
import { retrieveVidyaTextbookContext, textbookSourceFooter } from '../vidya-textbook-context.js';
import { prepareConversationHistory } from '../../ai/shared/conversation-history.js';

const TEACHING_FORMAT_RULES = `You MUST format every reply exactly like this (use real newlines):

Hello! Let's learn this simply.

1. First idea
• Point one
• Point two

2. Second idea
• Point one
• Point two

Tip: one short memory tip or check-question.

Rules:
- Never write the whole answer as one continuous paragraph.
- Use numbered headings (1. 2. 3.) for each concept.
- Use • bullets under each heading (short lines).
- Put a blank line between sections.
- Bold key terms with **like this**.
- Keep the opener to 1 short line.`;

const STRUCTURE_EXAMPLE = `Example for "Teach me concave and convex mirrors":

Hello! Let's compare concave and convex mirrors.

1. **Concave mirror**
• Shape: cave inward (like a bowl)
• Rays: converge to a focus
• Uses: shaving mirror, headlights, solar cooker

2. **Convex mirror**
• Shape: bulges outward
• Rays: diverge (spread out)
• Uses: vehicle side mirrors, shop security mirrors

Tip: Remember — concave collects light, convex spreads it.`;

/**
 * If the model ignored structure, ask once more with an explicit repair instruction.
 */
function looksUnstructured(text) {
  const t = String(text || '');
  const newlines = (t.match(/\n/g) || []).length;
  const bullets = (t.match(/[•●]|(^|\n)\s*[-*]\s+/g) || []).length;
  const numbered = (t.match(/(^|\n)\s*\d{1,2}[.)]\s+/g) || []).length;
  // One blob of prose: few newlines and no list markers
  if (t.length > 600 && newlines < 4 && bullets + numbered < 2) return true;
  // Extremely long single line / paragraph
  const longest = Math.max(...t.split(/\n/).map((l) => l.length), 0);
  if (longest > 420 && bullets + numbered < 2) return true;
  return false;
}

/**
 * Generates a curriculum-grounded answer using Gemini.
 * Accepts optional student context so the answer is relevant to their class, board, and weak topics.
 */
export async function generateGeneralKnowledgeAnswer({
  viewerUserId,
  viewerRole = 'teacher',
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
  const curriculum = await resolveVidyaCurriculum({ question: q, history: conversationHistory, userId: viewerUserId, role: viewerRole, forLearning: true });
  if (curriculum.clarification) return curriculum.clarification;
  const textbook = await retrieveVidyaTextbookContext({ question: q, history: conversationHistory, curriculum });
  if (textbook.directAnswer) return textbook.directAnswer;
  if (curriculum.scope && !curriculum.context && !textbook.context) return 'I checked the configured AI Tool Topics and matching indexed textbooks for your curriculum, but could not identify this chapter reliably. Please share the chapter title or relevant PDF passage; an unindexed or scanned PDF may need indexing/OCR first.';

  const systemInstruction = [
    `You are Vidya AI, an educational tutor for ${classText} students following the ${boardText}.`,
    `Answer clearly and accurately for a student at this level.`,
    curriculum.context,
    'Use earlier conversation to understand follow-ups and named books. Do not ask again for information already established. Earlier assistant statements are not verified source evidence. Never count retrieved chunks as lessons or claim a complete lesson count from partial excerpts. Do not print internal indexed-section labels.',
    textbook.context || 'No textbook passages were retrieved. Label this as a general explanation, not an answer verified against the school PDF.',
    TEACHING_FORMAT_RULES,
    `Use step-by-step numbered steps for Maths and Science problems.`,
    enrolledSubjects.length
      ? `The student's enrolled subjects are: ${enrolledSubjects.join(', ')}.`
      : '',
    weakChapters.length
      ? `Note: This student has shown difficulty in: ${weakChapters.slice(0, 3).join(', ')}. If this question touches on these topics, give a particularly clear, step-by-step answer.`
      : '',
    `Use conversation history for follow-ups. If the topic or intended class is ambiguous, ask one brief clarification instead of guessing.`,
    `Do not say "as an AI" or "I cannot". If unsure, give your best explanation and note any uncertainty.`,
    `Do not invent exam scores or personal student data.`,
  ]
    .filter(Boolean)
    .join('\n');

  const userMessage = [
    subjectContext ? `Subject: ${subjectContext}` : '',
    STRUCTURE_EXAMPLE,
    '',
    `Now answer THIS student question using the same structured format (numbered sections + bullets + tip):`,
    q,
  ]
    .filter(Boolean)
    .join('\n');

  const callOnce = async (message) => {
    const result = await callModel({
      systemInstruction,
      contents: buildContentsFromHistory({ history: prepareConversationHistory(conversationHistory), userMessage: message }),
      generationConfig: { temperature: 0.25, maxOutputTokens: 1800 },
    });
    return String(result?.text || '').trim();
  };

  let text = await callOnce(userMessage);
  if (!text) throw new Error('General knowledge response is empty');

  if (looksUnstructured(text)) {
    const repairMessage = [
      `Your previous answer was ONE long paragraph. Rewrite it now using ONLY this format:`,
      ``,
      `Short opener.`,
      ``,
      `1. **Concept A**`,
      `• bullet`,
      `• bullet`,
      ``,
      `2. **Concept B**`,
      `• bullet`,
      `• bullet`,
      ``,
      `Tip: ...`,
      ``,
      `Student question: ${q}`,
      ``,
      `Draft to rewrite:`,
      text.slice(0, 2500),
    ].join('\n');

    try {
      const repaired = await callOnce(repairMessage);
      if (repaired && !looksUnstructured(repaired)) {
        text = repaired;
      } else if (repaired) {
        text = repaired;
      }
    } catch {
      /* keep original */
    }
  }

  return text + textbookSourceFooter(textbook.sources, text);
}

/**
 * ChatGPT-style answer: student app data + natural-language question.
 * Do NOT use the tutor lesson template here — that caused generic "let's learn about reports" replies.
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
}) {
  const classText = classLevel ? `Class ${classLevel}` : 'school level';
  const boardText = board ? `${board} board` : 'Indian school curriculum';
  const q = String(question || '').slice(0, 3000);
  const curriculum = await resolveVidyaCurriculum({ question: q, history: conversationHistory, userId: viewerUserId, role: 'student', forLearning: useTextbooks });
  if (curriculum.clarification) return curriculum.clarification;
  const textbook = await retrieveVidyaTextbookContext({ question: q, history: conversationHistory, curriculum });
  if (textbook.directAnswer) return textbook.directAnswer;
  if (curriculum.scope && !curriculum.context && !textbook.context) return 'I checked the configured AI Tool Topics and matching indexed textbooks for your curriculum, but could not identify this chapter reliably. Please share the chapter title or relevant PDF passage; an unindexed or scanned PDF may need indexing/OCR first.';
  const subjectsLine = enrolledSubjects.length
    ? `Enrolled subjects: ${enrolledSubjects.join(', ')}.`
    : '';

  const systemInstruction = [
    `You are Vidya, a personal assistant for a ${classText} student on Asli Learn (${boardText}). ${subjectsLine}`,
    `Use only data supplied for this question. For textbook questions, answer the textbook question directly; do not introduce marks, video progress, weaknesses or exam advice.`,
    curriculum.context,
    'Use earlier conversation to understand follow-ups and named books. Do not ask again for information already established. Earlier assistant statements are not verified source evidence. Never count retrieved chunks as lessons or claim a complete lesson count from partial excerpts. Do not print internal indexed-section labels.',
    textbook.context || 'No textbook passages were retrieved. Do not claim to have checked the PDF; label any teaching as a general explanation.',
    ``,
    `Decide what they want from the question itself (any phrasing is fine: "I want videos", "report", "how am I doing").`,
    ``,
    `If they want THEIR data (videos, exams, marks, report, homework, attendance, progress, timetable, rank, OMR):`,
    `- Answer with the real numbers and titles from the data. Never invent scores, video names, or ranks.`,
    `- Lead with their facts, not a definition of what a report card is.`,
    `- If a list is empty, say so honestly and suggest the next step in the app.`,
    `- Do NOT start with "Hello! Let's learn…".`,
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
    useTextbooks ? '(Personal performance data omitted for this learning question.)' : studentDataSummary || '(No data available yet — student is new)',
    ``,
    `=== STUDENT'S QUESTION ===`,
    q,
  ].join('\n');

  const safeHistory = prepareConversationHistory(conversationHistory);

  const result = await callModel({
    systemInstruction,
    contents: buildContentsFromHistory({ history: safeHistory, userMessage }),
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
  });
  const text = String(result?.text || '').trim();
  if (!text) throw new Error('Context-aware response is empty');
  return text + textbookSourceFooter(textbook.sources, text);
}
