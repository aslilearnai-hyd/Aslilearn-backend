import { callModel, buildContentsFromHistory } from '../model-router.js';

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
  if (newlines < 4 && bullets + numbered < 2) return true;
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
  question,
  classLevel,
  subjectContext,
  board = '',
  weakChapters = [],
  enrolledSubjects = [],
}) {
  const classText = classLevel ? `Class ${classLevel}` : 'school level';
  const boardText = board ? `${board} board` : 'Indian school curriculum';
  const q = String(question || '').slice(0, 3000);

  const systemInstruction = [
    `You are Vidya AI, an educational tutor for ${classText} students following the ${boardText}.`,
    `Answer clearly and accurately for a student at this level.`,
    TEACHING_FORMAT_RULES,
    `Use step-by-step numbered steps for Maths and Science problems.`,
    enrolledSubjects.length
      ? `The student's enrolled subjects are: ${enrolledSubjects.join(', ')}.`
      : '',
    weakChapters.length
      ? `Note: This student has shown difficulty in: ${weakChapters.slice(0, 3).join(', ')}. If this question touches on these topics, give a particularly clear, step-by-step answer.`
      : '',
    `Do not ask clarifying questions. Give a complete, direct answer.`,
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
      contents: buildContentsFromHistory({ userMessage: message }),
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

  return text;
}

/**
 * ChatGPT-style answer: student app data + natural-language question.
 * Do NOT use the tutor lesson template here — that caused generic "let's learn about reports" replies.
 */
export async function generateContextAwareAnswer({
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
  const subjectsLine = enrolledSubjects.length
    ? `Enrolled subjects: ${enrolledSubjects.join(', ')}.`
    : '';

  const systemInstruction = [
    `You are Vidya, a personal assistant for a ${classText} student on Asli Learn (${boardText}). ${subjectsLine}`,
    `You already have this student's live app data in the user message.`,
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
    studentDataSummary || '(No data available yet — student is new)',
    ``,
    `=== STUDENT'S QUESTION ===`,
    q,
  ].join('\n');

  const safeHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .slice(-12)
    .map((item) => ({
      role: String(item?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').slice(0, 4000),
    }))
    .filter((item) => item.content.trim());

  const result = await callModel({
    systemInstruction,
    contents: buildContentsFromHistory({ history: safeHistory, userMessage }),
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
  });
  const text = String(result?.text || '').trim();
  if (!text) throw new Error('Context-aware response is empty');
  return text;
}
