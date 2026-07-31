/**
 * Grade an Assessment quiz server-side from submitted answers.
 * Never trust client-supplied score.
 */
export function gradeAssessmentAttempt(quiz, answers) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const answerList = Array.isArray(answers) ? answers : [];

  let earned = 0;
  let maxPoints = 0;
  const details = [];

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i] || {};
    const pts = Number(q.points) > 0 ? Number(q.points) : 1;
    maxPoints += pts;

    const submitted =
      answerList[i] !== undefined
        ? answerList[i]
        : answerList.find?.(
            (a) =>
              a &&
              (String(a.questionIndex) === String(i) ||
                String(a.questionId) === String(q._id || '')),
          )?.answer;

    const correct = normalizeAnswer(q.correctAnswer);
    const given = normalizeAnswer(
      submitted && typeof submitted === 'object' && 'answer' in submitted
        ? submitted.answer
        : submitted,
    );

    const ok = answersMatch(correct, given, q.type);
    if (ok) earned += pts;
    details.push({ index: i, correct: ok, points: ok ? pts : 0, maxPoints: pts });
  }

  if (maxPoints === 0 && questions.length === 0) {
    // Drive quizzes / empty question banks — cannot server-grade; reject client score
    return {
      score: 0,
      totalPoints: Number(quiz?.totalPoints) || 0,
      graded: false,
      message: 'Quiz has no gradable questions on the server',
      details: [],
    };
  }

  return {
    score: earned,
    totalPoints: maxPoints || Number(quiz?.totalPoints) || earned,
    graded: true,
    details,
  };
}

function normalizeAnswer(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value).trim().toLowerCase();
}

function answersMatch(correct, given, type) {
  if (!correct && correct !== 0 && correct !== false) return false;
  if (type === 'true-false') {
    const c = correct === 'true' || correct === '1' || correct === 'yes';
    const g = given === 'true' || given === '1' || given === 'yes';
    return c === g || correct === given;
  }
  // multiple-choice / short-answer: exact normalized string match
  return correct === given;
}
