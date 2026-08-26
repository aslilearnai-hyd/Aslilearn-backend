import Exam from '../models/Exam.js';
import Question from '../models/Question.js';

const clean = (value) => String(value ?? '').trim();

function unwrapStructured(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidates = [
    value,
    value.structuredContent,
    value.rawData,
    value.data,
    value.content,
    value.metadata?.structuredContent,
    value.legacyStructuredContent,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {}
    } else if (typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (candidate.schema && candidate.data && typeof candidate.data === 'object') {
        return candidate.data;
      }
      if (candidate.sections || candidate.section_a || candidate.question_paper || candidate.mock_test_title) {
        return candidate;
      }
    }
  }
  return value;
}

function collectSections(source) {
  const root = source?.question_paper && typeof source.question_paper === 'object'
    ? source.question_paper
    : source;
  if (Array.isArray(root?.sections)) return root.sections;
  if (Array.isArray(root?.questions)) {
    return [{ sectionName: clean(root.sectionName || root.title || 'Questions'), questions: root.questions }];
  }
  const keys = ['section_a', 'section_b', 'section_c', 'section_d', 'section_e'];
  return keys.flatMap((key) => {
    const value = root?.[key] ?? source?.[key];
    if (!value) return [];
    return [{ sectionName: key.replace('_', ' ').toUpperCase(), questions: Array.isArray(value) ? value : value.questions || [] }];
  });
}

function normalizeOptions(rawOptions) {
  return (Array.isArray(rawOptions) ? rawOptions : [])
    .map((option, index) => {
      const text = clean(typeof option === 'object' ? option.text ?? option.label ?? option.value : option)
        .replace(/^\s*[A-D][).:\-]\s*/i, '');
      return text ? { text, index } : null;
    })
    .filter(Boolean);
}

function resolveCorrectAnswer(rawAnswer, options) {
  const answer = clean(rawAnswer);
  if (!answer) return null;
  const letter = answer.match(/^\s*([A-D])(?:[).:\-]|\s|$)/i)?.[1]?.toUpperCase();
  if (letter) {
    const idx = letter.charCodeAt(0) - 65;
    return options[idx]?.text || null;
  }
  const stripped = answer.replace(/^\s*[A-D][).:\-]\s*/i, '').toLowerCase();
  return options.find((option) => option.text.toLowerCase() === stripped)?.text || answer;
}

export function extractGeneratedPracticeQuestions(rawData, fallbackContent = '') {
  const source = unwrapStructured(rawData) || unwrapStructured(fallbackContent);
  if (!source) return { title: '', instructions: '', questions: [] };
  const sections = collectSections(source);
  // Text fill-in-the-blank rows are objective too, but the exam player needs
  // selectable or numerical answers. Reuse the other saved blank answers as
  // distractors so those rows remain auto-scoreable instead of being dropped.
  const fillAnswerPool = Array.from(new Set(sections.flatMap((section) => {
    const sectionType = clean(section?.sectionName ?? section?.title ?? section?.name).toLowerCase();
    return (Array.isArray(section?.questions) ? section.questions : []).flatMap((row) => {
      const rowType = clean(row?.type ?? row?.questionType).toLowerCase();
      const questionText = clean(row?.question ?? row?.questionText ?? row?.text);
      const isFillBlank = /fill.*blank|blank/.test(`${rowType} ${sectionType}`) || /_{2,}|\.{3,}/.test(questionText);
      const answer = clean(row?.answer ?? row?.correctAnswer ?? row?.correct_answer);
      return isFillBlank && answer && normalizeOptions(row?.options).length < 2 ? [answer] : [];
    });
  })));
  const questions = [];
  for (const section of sections) {
    const rows = Array.isArray(section?.questions) ? section.questions : [];
    for (const row of rows) {
      const questionText = clean(row?.question ?? row?.questionText ?? row?.text);
      if (!questionText) continue;
      let options = normalizeOptions(row?.options);
      const rawAnswer = row?.answer ?? row?.correctAnswer ?? row?.correct_answer;
      const rowType = clean(row?.type ?? row?.questionType).toLowerCase();
      const sectionType = clean(section?.sectionName ?? section?.title ?? section?.name).toLowerCase();
      const isFillBlank = /fill.*blank|blank/.test(`${rowType} ${sectionType}`) || /_{2,}|\.{3,}/.test(questionText);
      if (options.length < 2 && (/true\s*(?:or|\/)\s*false/.test(rowType) || /true\s*(?:or|\/)\s*false/.test(sectionType))) {
        options = normalizeOptions(['True', 'False']);
      }
      if (options.length < 2 && isFillBlank) {
        const answer = clean(rawAnswer);
        const choices = [answer, ...fillAnswerPool.filter((candidate) => candidate.toLowerCase() !== answer.toLowerCase())]
          .filter(Boolean)
          .slice(0, 4);
        if (choices.length >= 2) options = normalizeOptions(choices);
      }
      const correctAnswer = options.length >= 2
        ? resolveCorrectAnswer(rawAnswer, options)
        : clean(rawAnswer);
      if (!correctAnswer) continue;
      // The existing exam player supports choices and numerical responses.
      // Descriptive model answers remain visible in the generated study view,
      // but are not put into an auto-scored exam as numerical inputs.
      const isNumericAnswer = /^-?\d+(?:\.\d+)?$/.test(correctAnswer);
      if (options.length < 2 && !isNumericAnswer) continue;
      questions.push({
        questionText,
        questionType: options.length >= 2 ? 'mcq' : 'integer',
        options: options.map((option) => ({ text: option.text, isCorrect: option.text === correctAnswer })),
        correctAnswer,
        marks: Math.max(1, Number(row?.marks) || 1),
        negativeMarks: 0,
        explanation: clean(row?.explanation ?? row?.solution),
        chapter: clean(row?.chapter ?? source?.topic) || 'General',
        difficulty: ['easy', 'moderate', 'difficult', 'highly_difficult'].includes(clean(row?.difficulty).toLowerCase())
          ? clean(row.difficulty).toLowerCase()
          : 'moderate',
        sectionHeading: clean(section?.sectionName ?? section?.title ?? section?.name),
      });
    }
  }
  return {
    title: clean(source.mock_test_title ?? source.paper_title ?? source.title),
    instructions: clean(source.instructions),
    questions: questions.slice(0, 60),
  };
}

export async function createOwnedPracticeExam({
  userId,
  board,
  classNumber,
  subject,
  topic,
  duration,
  rawData,
  content,
  questions: suppliedQuestions,
}) {
  const parsed = Array.isArray(suppliedQuestions)
    ? { title: '', instructions: '', questions: suppliedQuestions }
    : extractGeneratedPracticeQuestions(rawData, content);
  if (parsed.questions.length < 2) return null;
  const subjectAliases = {
    mathematics: 'maths',
    math: 'maths',
    social_studies: 'social_science',
    'social science': 'social_science',
  };
  const rawSubject = clean(subject).toLowerCase();
  const normalizedSubject = subjectAliases[rawSubject] || rawSubject.replace(/\s+/g, '_');
  const allowedSubject = ['maths', 'physics', 'chemistry', 'biology', 'science', 'english', 'hindi', 'social_science'].includes(normalizedSubject)
    ? normalizedSubject
    : 'science';
  const now = new Date();
  // Personal practice papers are immediately available. Keep a short, truthful
  // storage window instead of presenting students with an arbitrary 10-year date.
  // Owned practice papers remain startable through the owned-practice exemption.
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const totalMarks = parsed.questions.reduce((sum, question) => sum + question.marks, 0);
  const exam = await Exam.create({
    title: parsed.title || `${clean(topic) || allowedSubject} Personal Mock Test`,
    description: `Personal mock test generated for ${clean(topic) || allowedSubject}.`,
    examType: 'practice',
    classNumber: clean(classNumber),
    assignedClasses: [clean(classNumber)],
    subject: allowedSubject,
    subjects: [allowedSubject],
    maxAttempts: 5,
    duration: Math.max(5, Number(duration) || Math.max(10, parsed.questions.length * 2)),
    totalQuestions: parsed.questions.length,
    totalMarks,
    instructions: parsed.instructions || 'Answer every question, then submit to receive your score and Vidya recommendations.',
    isActive: true,
    startDate: now,
    endDate: end,
    createdBy: userId,
    createdByRole: 'student',
    practiceOwnerUserId: userId,
    board: clean(board).toUpperCase(),
    isSchoolSpecific: false,
    isAllBoards: false,
  });
  const questionDocs = await Question.insertMany(parsed.questions.map((question, index) => ({
    ...question,
    subject: allowedSubject,
    displayOrder: index + 1,
    exam: exam._id,
    createdBy: userId,
    board: clean(board).toUpperCase(),
    isActive: true,
  })));
  exam.questions = questionDocs.map((question) => question._id);
  await exam.save();
  return exam.toObject();
}
