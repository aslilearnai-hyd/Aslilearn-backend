import { callModel, buildContentsFromHistory } from '../model-router.js';

export async function generateGeneralKnowledgeAnswer({ question, classLevel, subjectContext }) {
  const classText = classLevel ? `Class ${classLevel}` : 'school level';
  const systemInstruction = `You are Vidya AI, an educational tutor for students.
Answer in clear, simple language for ${classText}.
Use direct explanation with small examples.
Do not return placeholder text.`;

  const content = buildContentsFromHistory({
    userMessage: `${subjectContext ? `Subject: ${subjectContext}\n` : ''}${String(question || '').slice(0, 3000)}`,
  });

  const result = await callModel({
    systemInstruction,
    contents: content,
    generationConfig: { temperature: 0.35, maxOutputTokens: 1500 },
  });

  const text = String(result?.text || '').trim();
  if (!text) throw new Error('General knowledge response is empty');
  return text;
}

