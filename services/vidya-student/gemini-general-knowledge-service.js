import { callModel, buildContentsFromHistory } from '../model-router.js';

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

  // Build a richer system instruction using student context
  const systemInstruction = [
    `You are Vidya AI, an educational tutor for ${classText} students following the ${boardText}.`,
    `Answer clearly and accurately for a student at this level.`,
    `Use step-by-step explanations for Maths and Science problems.`,
    `Use bullet points and short paragraphs where helpful.`,
    enrolledSubjects.length
      ? `The student's enrolled subjects are: ${enrolledSubjects.join(', ')}.`
      : '',
    weakChapters.length
      ? `Note: This student has shown difficulty in: ${weakChapters.slice(0, 3).join(', ')}. If this question touches on these topics, give a particularly clear, step-by-step answer.`
      : '',
    `Do not ask clarifying questions. Give a complete, direct answer.`,
    `Do not say "as an AI" or "I cannot". If unsure, give your best explanation and note any uncertainty.`,
  ].filter(Boolean).join('\n');

  const userMessage = [
    subjectContext ? `Subject: ${subjectContext}` : '',
    String(question || '').slice(0, 3000),
  ].filter(Boolean).join('\n');

  const content = buildContentsFromHistory({ userMessage });

  const result = await callModel({
    systemInstruction,
    contents: content,
    generationConfig: { temperature: 0.3, maxOutputTokens: 1800 },
  });

  const text = String(result?.text || '').trim();
  if (!text) throw new Error('General knowledge response is empty');
  return text;
}
