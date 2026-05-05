import VidyaProactivePrompt from '../../models/VidyaProactivePrompt.js';

export async function createPostExamPrompt({
  studentId,
  examId,
  examResultId,
  examTitle,
  obtainedMarks,
  totalMarks,
  weakTopics = [],
}) {
  const weak = weakTopics.slice(0, 2).map((x) => String(x.chapter || x || '')).filter(Boolean);
  const promptText = `Hi, you scored ${obtainedMarks}/${totalMarks} in ${examTitle}. ${
    weak.length ? `You made mistakes in ${weak.join(' and ')}.` : 'Let us review your mistakes.'
  } Would you like me to explain those questions?`;

  const doc = await VidyaProactivePrompt.findOneAndUpdate(
    { studentId, examResultId },
    {
      $set: {
        studentId,
        examId: examId || null,
        examResultId: examResultId || null,
        promptText,
        metadata: { examTitle, weakTopics: weak, obtainedMarks, totalMarks },
      },
      $setOnInsert: { delivered: false, deliveredAt: null },
    },
    { upsert: true, new: true }
  );

  return doc?.toObject ? doc.toObject() : doc;
}

export async function markProactivePromptDelivered(promptId) {
  return VidyaProactivePrompt.findByIdAndUpdate(
    promptId,
    { $set: { delivered: true, deliveredAt: new Date() } },
    { new: true }
  ).lean();
}

