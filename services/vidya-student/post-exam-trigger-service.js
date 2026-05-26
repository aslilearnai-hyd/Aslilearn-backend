import VidyaProactivePrompt from '../../models/VidyaProactivePrompt.js';

function formatWeakAreaLabels(weakTopics = [], weakSubjects = []) {
  const labels = [];
  const seen = new Set();

  const push = (raw) => {
    const label = String(raw || '').trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (key === 'general' || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };

  for (const item of weakTopics) {
    const chapter = String(item?.chapter || item?.topic || '').trim();
    const subject = String(item?.subject || '').trim();
    if (chapter && chapter.toLowerCase() !== 'general') {
      push(subject ? `${subject}: ${chapter}` : chapter);
    } else if (subject) {
      push(subject);
    }
  }

  for (const s of weakSubjects) {
    push(String(s || '').trim());
  }

  return labels.slice(0, 3);
}

function buildScoreLine({
  examTitle,
  obtainedMarks,
  totalMarks,
  percentage,
  correctAnswers,
  totalQuestions,
}) {
  const title = String(examTitle || 'your exam').trim();
  const pct = Number(percentage);
  const correct = Number(correctAnswers);
  const totalQ = Number(totalQuestions);
  const obtained = Number(obtainedMarks);
  const total = Number(totalMarks);

  if (Number.isFinite(pct)) {
    let line = `you scored ${pct}% on ${title}`;
    if (Number.isFinite(correct) && Number.isFinite(totalQ) && totalQ > 0) {
      line += ` (${correct} of ${totalQ} questions correct)`;
    }
    return line;
  }

  if (Number.isFinite(obtained) && Number.isFinite(total) && total > 0) {
    if (obtained < 0) {
      return `you finished ${title} with ${obtained}/${total} net marks after negative marking`;
    }
    return `you scored ${obtained}/${total} marks in ${title}`;
  }

  return `you completed ${title}`;
}

export async function createPostExamPrompt({
  studentId,
  examId,
  examResultId,
  examTitle,
  obtainedMarks,
  totalMarks,
  percentage,
  correctAnswers,
  totalQuestions,
  weakTopics = [],
  weakSubjects = [],
}) {
  const weak = formatWeakAreaLabels(weakTopics, weakSubjects);
  const scoreLine = buildScoreLine({
    examTitle,
    obtainedMarks,
    totalMarks,
    percentage,
    correctAnswers,
    totalQuestions,
  });

  const promptText = `Hi, ${scoreLine}. ${
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
        metadata: {
          examTitle,
          weakTopics: weak,
          obtainedMarks,
          totalMarks,
          percentage,
          correctAnswers,
          totalQuestions,
        },
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
