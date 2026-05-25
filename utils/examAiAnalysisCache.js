/** In-memory dedupe for concurrent exam AI analysis requests (single Node process). */
const inFlightByKey = new Map();

export function inFlightKey(userId, examId) {
  return `${String(userId)}:${String(examId)}`;
}

export function getInFlight(key) {
  return inFlightByKey.get(key) || null;
}

export function setInFlight(key, promise) {
  inFlightByKey.set(key, promise);
  promise.finally(() => {
    if (inFlightByKey.get(key) === promise) {
      inFlightByKey.delete(key);
    }
  });
  return promise;
}

export function buildCachedAnalysisResponse(cachedReport, cachedAnalysis) {
  const storedMeta =
    cachedReport?.meta && typeof cachedReport.meta === 'object' ? cachedReport.meta : {};
  return {
    success: true,
    data: {
      analysis: cachedAnalysis,
      meta: {
        weakSubjects: Array.isArray(storedMeta.weakSubjects) ? storedMeta.weakSubjects : [],
        weakTopics: Array.isArray(storedMeta.weakTopics) ? storedMeta.weakTopics : [],
        classNumber: String(storedMeta.classNumber || ''),
        board: String(storedMeta.board || ''),
        generatedAt: (cachedReport.createdAt || cachedReport.updatedAt || new Date()).toISOString(),
        cached: true,
      },
    },
  };
}

/** Regenerate only when summary is corrupt or attempt scores changed — not on schema/meta gaps. */
export function shouldRegenerateCachedReport(cachedReport, scoreSource) {
  const cachedSummary = String(cachedReport?.fullAnalysis?.summary || '');
  if (
    /live ai could not finish \((expected|unexpected|json|syntaxerror)/i.test(cachedSummary) ||
    /line \d+ column \d+/i.test(cachedSummary)
  ) {
    return true;
  }

  const storedMeta =
    cachedReport?.meta && typeof cachedReport.meta === 'object' ? cachedReport.meta : {};
  const cachedSnap = storedMeta.scoreSnapshot;
  if (!cachedSnap || typeof cachedSnap !== 'object') {
    return false;
  }

  const expectedCorrect = Number(scoreSource?.correctAnswers ?? NaN);
  const expectedWrong = Number(scoreSource?.wrongAnswers ?? NaN);
  const expectedUnattempted = Number(scoreSource?.unattempted ?? NaN);
  const expectedMarks = Number(scoreSource?.obtainedMarks ?? NaN);
  const expectedPct = Number(scoreSource?.percentage ?? NaN);

  if (
    !Number.isFinite(expectedCorrect) ||
    !Number.isFinite(expectedWrong) ||
    !Number.isFinite(expectedUnattempted)
  ) {
    return false;
  }

  return (
    Number(cachedSnap.correctAnswers) !== expectedCorrect ||
    Number(cachedSnap.wrongAnswers) !== expectedWrong ||
    Number(cachedSnap.unattempted) !== expectedUnattempted ||
    (Number.isFinite(expectedMarks) && Number(cachedSnap.obtainedMarks) !== expectedMarks) ||
    (Number.isFinite(expectedPct) && Number(cachedSnap.percentage) !== expectedPct)
  );
}

/** Legacy rows stored long Gemini text that may not match the current question/answer. */
export function cachedHasStaleAiExplanations(cachedAnalysis) {
  const rows = Array.isArray(cachedAnalysis?.questionInsights) ? cachedAnalysis.questionInsights : [];
  return rows.some((row) => String(row?.geminiExplanation || '').length > 120);
}

export function collectCachedExplanationsByQuestionId(cachedReport) {
  const insights = Array.isArray(cachedReport?.fullAnalysis?.questionInsights)
    ? cachedReport.fullAnalysis.questionInsights
    : [];
  const map = new Map();
  for (const row of insights) {
    const qid = row?.questionId != null ? String(row.questionId) : '';
    const text = String(row?.geminiExplanation || '').trim();
    if (qid && text) map.set(qid, text);
  }
  return map;
}
