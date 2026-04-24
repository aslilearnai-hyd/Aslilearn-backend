const DIFFICULTY_ORDER = ['easy', 'moderate', 'difficult', 'highly_difficult'];
const QUESTION_TYPE_ORDER = [
  'Numerical',
  'Theory',
  'Formula',
  'Diagram',
  'Graph',
  'Assertion/Reason',
  'Comprehension',
  'Match the Following',
];

const SUBJECT_ORDER = ['physics', 'chemistry', 'maths'];

const IDEAL_TIME_BY_DIFFICULTY = {
  easy: 30,
  moderate: 60,
  difficult: 90,
  highly_difficult: 120,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSubject = (subject) => {
  const normalized = String(subject || '').trim().toLowerCase();
  if (normalized === 'math' || normalized === 'mathematics') return 'maths';
  if (normalized === 'phy') return 'physics';
  if (normalized === 'chem') return 'chemistry';
  return normalized || 'unknown';
};

export const normalizeDifficulty = (rawDifficulty, fallbackMarks = 1) => {
  const text = String(rawDifficulty || '').trim().toLowerCase();
  if (text.includes('high')) return 'highly_difficult';
  if (text.includes('difficult') || text === 'hard') return 'difficult';
  if (text.includes('moderate') || text === 'medium') return 'moderate';
  if (text.includes('easy')) return 'easy';

  // Fallback heuristic from marks when explicit metadata is missing.
  const marks = toNumber(fallbackMarks, 1);
  if (marks >= 4) return 'highly_difficult';
  if (marks >= 3) return 'difficult';
  if (marks >= 2) return 'moderate';
  return 'easy';
};

export const classifyTimeBucket = (timeTakenSec, difficulty) => {
  const ideal = IDEAL_TIME_BY_DIFFICULTY[difficulty] || 60;
  const actual = Math.max(0, toNumber(timeTakenSec, 0));
  if (actual < ideal * 0.75) return 'less_time';
  if (actual > ideal * 1.25) return 'over_time';
  return 'in_time';
};

const inferQuestionTypeCategory = (question = {}) => {
  const explicit = String(
    question.analyticsType ||
      question.questionCategory ||
      question.typeTag ||
      question.questionSubtype ||
      ''
  )
    .trim()
    .toLowerCase();
  const text = String(question.questionText || '').trim().toLowerCase();
  const questionType = String(question.questionType || '').trim().toLowerCase();

  const source = `${explicit} ${text}`;
  if (source.includes('assertion') || source.includes('reason')) return 'Assertion/Reason';
  if (source.includes('comprehension') || source.includes('passage')) return 'Comprehension';
  if (source.includes('match the following') || source.includes('match')) return 'Match the Following';
  if (source.includes('diagram') || source.includes('figure')) return 'Diagram';
  if (source.includes('graph') || source.includes('plot')) return 'Graph';
  if (source.includes('formula') || source.includes('equation')) return 'Formula';
  if (questionType === 'integer' || source.includes('numerical') || source.includes('calculate')) {
    return 'Numerical';
  }
  if (questionType === 'multiple') return 'Comprehension';
  return 'Theory';
};

const inferConceptType = (question = {}) => {
  const explicit = String(question.conceptType || question.skillType || '').trim().toLowerCase();
  if (explicit.includes('application') || explicit.includes('problem')) return 'Application';
  if (explicit.includes('concept') || explicit.includes('theory')) return 'Concept';

  const text = String(question.questionText || '').toLowerCase();
  if (/(calculate|find|solve|evaluate|determine|numerical|compute)/.test(text)) {
    return 'Application';
  }
  return 'Concept';
};

const resolveChapter = (question = {}) => {
  return String(
    question.chapter ||
      question.chapterName ||
      question.topic ||
      question.unit ||
      'General'
  )
    .trim() || 'General';
};

export const buildPerQuestionAttemptAnalytics = ({
  questions = [],
  answers = {},
  questionTimings = {},
  isAnswerCorrect,
}) => {
  const safeAnswers = answers && typeof answers === 'object' ? answers : {};
  const safeTimings = questionTimings && typeof questionTimings === 'object' ? questionTimings : {};

  return questions.map((question, index) => {
    const questionId = String(question?._id || `q-${index}`);
    const userAnswer = safeAnswers[questionId];
    const hasAnswer = !(userAnswer === undefined || userAnswer === null || userAnswer === '');
    const correct = hasAnswer ? Boolean(isAnswerCorrect(question, userAnswer)) : false;
    const difficulty = normalizeDifficulty(question?.difficulty, question?.marks);
    const timeTaken = Math.max(
      0,
      toNumber(
        safeTimings[questionId] ??
          safeTimings[String(index)] ??
          safeTimings[String(index + 1)],
        0
      )
    );
    const timeBucket = classifyTimeBucket(timeTaken, difficulty);
    const status = hasAnswer ? (correct ? 'correct' : 'wrong') : 'not_answered';

    return {
      questionId,
      index,
      subject: normalizeSubject(question?.subject),
      chapter: resolveChapter(question),
      difficulty,
      questionType: inferQuestionTypeCategory(question),
      conceptType: inferConceptType(question),
      timeTaken,
      idealTime: IDEAL_TIME_BY_DIFFICULTY[difficulty] || 60,
      timeBucket,
      status,
      isCorrect: correct,
      isAnswered: hasAnswer,
    };
  });
};

const average = (sum, count) => (count > 0 ? sum / count : 0);

const buildDifficultyTemplate = () => ({
  correctAnswered: {
    count: 0,
    totalTime: 0,
    avgTime: 0,
    inTime: 0,
    lessTime: 0,
    overTime: 0,
  },
  wrongAnswered: {
    count: 0,
    totalTime: 0,
    avgTime: 0,
    inTime: 0,
    lessTime: 0,
    overTime: 0,
  },
});

const buildStatusSubjectTemplate = () => ({
  physics: 0,
  chemistry: 0,
  maths: 0,
});

const toPercent = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

const round2 = (value) => Math.round(toNumber(value, 0) * 100) / 100;

const buildAIObservations = (analytics) => {
  const observations = [];

  const moderate = analytics.difficultyTimeIntelligence.find((d) => d.difficulty === 'moderate');
  if (moderate && moderate.wrongAnswered.overTime > Math.max(2, moderate.wrongAnswered.count * 0.35)) {
    observations.push('You are spending more time than required on Moderate questions and still getting many wrong.');
  }

  const weakConcept = analytics.conceptVsApplication.find((row) => row.type === 'Concept');
  if (weakConcept && weakConcept.accuracy < 65) {
    observations.push('Conceptual weakness detected. Concept-focused revision is needed before high-volume practice.');
  }

  const weakApplication = analytics.conceptVsApplication.find((row) => row.type === 'Application');
  if (weakApplication && weakApplication.accuracy < 65) {
    observations.push('Application-based questions need improvement. Add timed problem-solving drills.');
  }

  const difficultRows = analytics.difficultyTimeIntelligence.filter(
    (row) => row.difficulty === 'difficult' || row.difficulty === 'highly_difficult'
  );
  const skippedDifficult = difficultRows.reduce((sum, row) => {
    const totalAnswered = row.correctAnswered.count + row.wrongAnswered.count;
    const totalSeen = row.totalQuestions || totalAnswered;
    return sum + Math.max(0, totalSeen - totalAnswered);
  }, 0);
  if (skippedDifficult >= 3) {
    observations.push('You are skipping difficult questions frequently. Build a selective-attempt strategy.');
  }

  if (!observations.length) {
    observations.push('Your exam profile is stable. Keep improving speed on medium difficulty and accuracy on difficult sections.');
  }

  return observations.slice(0, 6);
};

const isGenericChapter = (chapter) => {
  const value = String(chapter || '').trim().toLowerCase();
  return !value || value === 'general' || value === 'unknown' || value === 'n/a';
};

const buildRecommendation = (analytics) => {
  const weakRows = analytics.chapterWeakness
    .filter((row) => row.accuracy < 70)
    .slice(0, 6);

  const specificAreas = weakRows
    .filter((row) => !isGenericChapter(row.chapter))
    .map((row) => row.chapter);

  const subjectFallbackAreas = weakRows
    .filter((row) => isGenericChapter(row.chapter))
    .map((row) => `${String(row.subject || 'subject').toUpperCase()} weak accuracy zone`);

  const weakChapters = [...specificAreas, ...subjectFallbackAreas]
    .filter(Boolean)
    .slice(0, 4);

  const riskLevel = weakChapters.length >= 4 ? 'High' : weakChapters.length >= 2 ? 'Medium' : 'Low';
  const strategy =
    analytics.timeEfficiency.timeWastedOnWrongQuestions > 600
      ? 'Improve time management in moderate questions'
      : 'Increase accuracy by revising weak chapters and concept gaps';
  const confidenceTrend =
    analytics.timeEfficiency.efficiencyScore >= 0.45
      ? 'Improving'
      : analytics.timeEfficiency.efficiencyScore >= 0.3
      ? 'Stable'
      : 'Declining';

  return {
    riskLevel,
    focusAreas: weakChapters.length ? weakChapters : ['Mixed Revision', 'Timed Practice'],
    actionPlan: {
      today: [
        'Revise two weakest chapters and solve 20 targeted questions.',
        'Analyze all wrong answers and write one correction rule per mistake pattern.',
      ],
      thisWeek: [
        'Take 2 timed section tests focused on moderate+difficult questions.',
        'Practice concept-to-application conversion using mixed subject drills.',
      ],
      beforeNextExam: [
        'Run one full-length mock with strict timing and review over-time questions first.',
        'Revisit your error notebook and high-frequency formula/concept sheet.',
      ],
    },
    strategy,
    confidenceTrend,
  };
};

export const generateAdvancedAnalytics = ({
  examResult,
  questionAnalytics = [],
}) => {
  const rows = Array.isArray(questionAnalytics) ? questionAnalytics : [];
  const difficultyMap = new Map(DIFFICULTY_ORDER.map((d) => [d, buildDifficultyTemplate()]));
  const totalByDifficulty = new Map(DIFFICULTY_ORDER.map((d) => [d, 0]));

  const matrixMap = new Map(
    QUESTION_TYPE_ORDER.map((type) => [
      type,
      {
        correct: buildStatusSubjectTemplate(),
        wrong: buildStatusSubjectTemplate(),
        notAnswered: buildStatusSubjectTemplate(),
      },
    ])
  );

  const conceptMap = new Map([
    ['Concept', { type: 'Concept', correct: 0, wrong: 0, notAnswered: 0, totalTime: 0 }],
    ['Application', { type: 'Application', correct: 0, wrong: 0, notAnswered: 0, totalTime: 0 }],
  ]);

  const chapterMap = new Map();
  const subjectTimeMap = new Map(SUBJECT_ORDER.map((s) => [s, { totalTime: 0, questions: 0, correct: 0, total: 0 }]));
  let timeWastedOnWrongQuestions = 0;

  rows.forEach((row) => {
    const difficulty = DIFFICULTY_ORDER.includes(row.difficulty) ? row.difficulty : 'moderate';
    const bucket = difficultyMap.get(difficulty);
    totalByDifficulty.set(difficulty, (totalByDifficulty.get(difficulty) || 0) + 1);
    const statusKey = row.status === 'correct' ? 'correctAnswered' : row.status === 'wrong' ? 'wrongAnswered' : null;
    if (bucket && statusKey) {
      const target = bucket[statusKey];
      target.count += 1;
      target.totalTime += toNumber(row.timeTaken, 0);
      if (row.timeBucket === 'in_time') target.inTime += 1;
      if (row.timeBucket === 'less_time') target.lessTime += 1;
      if (row.timeBucket === 'over_time') target.overTime += 1;
    }

    const matrixType = QUESTION_TYPE_ORDER.includes(row.questionType) ? row.questionType : 'Theory';
    const subject = SUBJECT_ORDER.includes(row.subject) ? row.subject : 'maths';
    const matrix = matrixMap.get(matrixType);
    if (matrix) {
      if (row.status === 'correct') matrix.correct[subject] += 1;
      else if (row.status === 'wrong') matrix.wrong[subject] += 1;
      else matrix.notAnswered[subject] += 1;
    }

    const conceptType = row.conceptType === 'Application' ? 'Application' : 'Concept';
    const concept = conceptMap.get(conceptType);
    if (concept) {
      if (row.status === 'correct') concept.correct += 1;
      else if (row.status === 'wrong') concept.wrong += 1;
      else concept.notAnswered += 1;
      concept.totalTime += toNumber(row.timeTaken, 0);
    }

    const chapterKey = `${row.subject || 'unknown'}::${row.chapter || 'General'}`;
    if (!chapterMap.has(chapterKey)) {
      chapterMap.set(chapterKey, {
        chapter: row.chapter || 'General',
        subject: row.subject || 'unknown',
        correct: 0,
        wrong: 0,
        notAnswered: 0,
        total: 0,
      });
    }
    const chapter = chapterMap.get(chapterKey);
    chapter.total += 1;
    if (row.status === 'correct') chapter.correct += 1;
    else if (row.status === 'wrong') chapter.wrong += 1;
    else chapter.notAnswered += 1;

    if (!subjectTimeMap.has(subject)) {
      subjectTimeMap.set(subject, { totalTime: 0, questions: 0, correct: 0, total: 0 });
    }
    const subjectTime = subjectTimeMap.get(subject);
    subjectTime.totalTime += toNumber(row.timeTaken, 0);
    subjectTime.questions += 1;
    subjectTime.total += 1;
    if (row.status === 'correct') subjectTime.correct += 1;

    if (row.status === 'wrong') {
      timeWastedOnWrongQuestions += toNumber(row.timeTaken, 0);
    }
  });

  const difficultyTimeIntelligence = DIFFICULTY_ORDER.map((difficulty) => {
    const data = difficultyMap.get(difficulty) || buildDifficultyTemplate();
    data.correctAnswered.avgTime = round2(average(data.correctAnswered.totalTime, data.correctAnswered.count));
    data.wrongAnswered.avgTime = round2(average(data.wrongAnswered.totalTime, data.wrongAnswered.count));
    return {
      difficulty,
      idealTimeSec: IDEAL_TIME_BY_DIFFICULTY[difficulty] || 60,
      totalQuestions: totalByDifficulty.get(difficulty) || 0,
      correctAnswered: data.correctAnswered,
      wrongAnswered: data.wrongAnswered,
    };
  });

  const questionTypeMatrix = QUESTION_TYPE_ORDER.map((type) => ({
    type,
    correct: matrixMap.get(type)?.correct || buildStatusSubjectTemplate(),
    wrong: matrixMap.get(type)?.wrong || buildStatusSubjectTemplate(),
    notAnswered: matrixMap.get(type)?.notAnswered || buildStatusSubjectTemplate(),
  }));

  const conceptVsApplication = ['Concept', 'Application'].map((type) => {
    const row = conceptMap.get(type) || { correct: 0, wrong: 0, notAnswered: 0, totalTime: 0 };
    const total = row.correct + row.wrong + row.notAnswered;
    return {
      type,
      accuracy: toPercent(row.correct, total),
      correct: row.correct,
      wrong: row.wrong,
      notAnswered: row.notAnswered,
      totalTime: round2(row.totalTime),
      avgTimePerQuestion: round2(average(row.totalTime, total)),
    };
  });

  const chapterWeakness = Array.from(chapterMap.values())
    .map((row) => ({
      ...row,
      accuracy: toPercent(row.correct, row.total),
      errors: row.wrong,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const avgTimePerSubject = Array.from(subjectTimeMap.entries()).map(([subject, stats]) => {
    const avgTime = round2(average(stats.totalTime, stats.questions));
    const accuracy = toPercent(stats.correct, stats.total);
    return { subject, avgTime, accuracy, totalQuestions: stats.total };
  });

  const sortedByTime = [...avgTimePerSubject].sort((a, b) => b.avgTime - a.avgTime);
  const slowestSubject = sortedByTime[0]?.subject || 'n/a';
  const fastestSubject = sortedByTime[sortedByTime.length - 1]?.subject || 'n/a';
  const totalTimeTaken = toNumber(examResult?.timeTaken, rows.reduce((sum, row) => sum + toNumber(row.timeTaken, 0), 0));
  const efficiencyScore = round2(
    toNumber(examResult?.correctAnswers, 0) / Math.max(1, totalTimeTaken)
  );

  const visuals = {
    chapterHeatmap: chapterWeakness.map((row) => ({
      chapter: row.chapter,
      subject: row.subject,
      accuracy: row.accuracy,
    })),
    subjectPerformanceBars: avgTimePerSubject.map((s) => ({
      subject: s.subject,
      accuracy: s.accuracy,
      avgTime: s.avgTime,
    })),
    outcomePie: [
      { name: 'Correct', value: toNumber(examResult?.correctAnswers, 0) },
      { name: 'Wrong', value: toNumber(examResult?.wrongAnswers, 0) },
      { name: 'Skipped', value: toNumber(examResult?.unattempted, 0) },
    ],
    timeVsAccuracy: avgTimePerSubject.map((s) => ({
      subject: s.subject,
      avgTime: s.avgTime,
      accuracy: s.accuracy,
    })),
  };

  const analytics = {
    difficultyTimeIntelligence,
    questionTypeMatrix,
    conceptVsApplication,
    chapterWeakness,
    aiObservations: [],
    timeEfficiency: {
      avgTimePerSubject,
      slowestSubject,
      fastestSubject,
      timeWastedOnWrongQuestions: round2(timeWastedOnWrongQuestions),
      efficiencyScore,
      totalTimeTaken,
    },
    visuals,
    recommendation: null,
    metadata: {
      generatedAt: new Date().toISOString(),
      totalQuestionsAnalyzed: rows.length,
    },
  };

  analytics.aiObservations = buildAIObservations(analytics);
  analytics.recommendation = buildRecommendation(analytics);
  return analytics;
};

export const advancedAnalyticsMockData = {
  difficultyTimeIntelligence: [
    {
      difficulty: 'easy',
      idealTimeSec: 30,
      totalQuestions: 8,
      correctAnswered: { count: 6, avgTime: 27, inTime: 4, lessTime: 1, overTime: 1 },
      wrongAnswered: { count: 2, avgTime: 39, inTime: 0, lessTime: 0, overTime: 2 },
    },
    {
      difficulty: 'moderate',
      idealTimeSec: 60,
      totalQuestions: 12,
      correctAnswered: { count: 7, avgTime: 64, inTime: 3, lessTime: 1, overTime: 3 },
      wrongAnswered: { count: 3, avgTime: 88, inTime: 0, lessTime: 0, overTime: 3 },
    },
    {
      difficulty: 'difficult',
      idealTimeSec: 90,
      totalQuestions: 7,
      correctAnswered: { count: 2, avgTime: 94, inTime: 1, lessTime: 0, overTime: 1 },
      wrongAnswered: { count: 3, avgTime: 121, inTime: 0, lessTime: 0, overTime: 3 },
    },
    {
      difficulty: 'highly_difficult',
      idealTimeSec: 120,
      totalQuestions: 3,
      correctAnswered: { count: 1, avgTime: 135, inTime: 0, lessTime: 0, overTime: 1 },
      wrongAnswered: { count: 1, avgTime: 150, inTime: 0, lessTime: 0, overTime: 1 },
    },
  ],
  questionTypeMatrix: [],
  conceptVsApplication: [],
  chapterWeakness: [],
  aiObservations: [
    'You are spending more time than required on Moderate Physics questions.',
    'Application-based questions in Mathematics need improvement.',
  ],
  timeEfficiency: {
    avgTimePerSubject: [
      { subject: 'physics', avgTime: 86, accuracy: 52.4, totalQuestions: 7 },
      { subject: 'chemistry', avgTime: 67, accuracy: 61.2, totalQuestions: 9 },
      { subject: 'maths', avgTime: 79, accuracy: 58.7, totalQuestions: 10 },
    ],
    slowestSubject: 'physics',
    fastestSubject: 'chemistry',
    timeWastedOnWrongQuestions: 612,
    efficiencyScore: 0.36,
    totalTimeTaken: 3300,
  },
  visuals: {
    chapterHeatmap: [],
    subjectPerformanceBars: [],
    outcomePie: [
      { name: 'Correct', value: 16 },
      { name: 'Wrong', value: 9 },
      { name: 'Skipped', value: 5 },
    ],
    timeVsAccuracy: [],
  },
  recommendation: {
    riskLevel: 'Medium',
    focusAreas: ['Electrostatics', 'Organic Chemistry'],
    actionPlan: {
      today: ['Revise Electrostatics examples', 'Solve 15 Organic reaction-based questions'],
      thisWeek: ['Take two timed moderate-level tests', 'Review all mistakes using error notebook'],
      beforeNextExam: ['One full mock under strict timing', 'Revise weak chapters summary notes'],
    },
    strategy: 'Improve time management in moderate questions',
    confidenceTrend: 'Improving',
  },
  metadata: {
    generatedAt: new Date().toISOString(),
    totalQuestionsAnalyzed: 30,
  },
};
