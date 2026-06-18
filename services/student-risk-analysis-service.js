/**
 * Rule-based student risk analysis — no Gemini / external LLM required.
 * Returns the same JSON shape expected by admin web + mobile modals.
 */

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function capitalizeSubject(subject) {
  const raw = String(subject || 'general').trim();
  if (!raw) return 'General';
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ');
}

/** @param {string} timeRange */
export function parseRiskAnalysisTimeRange(timeRange) {
  if (timeRange === 'all') return 365 * 5;
  if (timeRange === '30days') return 30;
  if (timeRange === '90days') return 90;
  const parsed = parseInt(String(timeRange || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}

/** @param {import('mongoose').Document | Record<string, unknown>} result */
function getSubjectScoreEntries(result) {
  const raw = result?.subjectWiseScore;
  if (!raw) return [];
  if (raw instanceof Map) return [...raw.entries()];
  if (typeof raw === 'object') return Object.entries(raw);
  return [];
}

function subjectAttemptPercent(data) {
  const total = toNumber(data?.total, 0);
  const correct = toNumber(data?.correct, 0);
  if (total <= 0) return 0;
  return (correct / total) * 100;
}

/**
 * @param {Array<import('mongoose').Document>} examResults
 * @returns {Record<string, { avg: number, scores: number[], firstAvg: number, lastAvg: number }>}
 */
function buildSubjectAggregates(examResults) {
  /** @type {Record<string, number[]>} */
  const series = {};

  for (const result of examResults) {
    for (const [subject, data] of getSubjectScoreEntries(result)) {
      const key = String(subject || 'general').toLowerCase();
      if (!series[key]) series[key] = [];
      series[key].push(subjectAttemptPercent(data));
    }
  }

  /** @type {Record<string, { avg: number, scores: number[], firstAvg: number, lastAvg: number }>} */
  const out = {};
  for (const [subject, scores] of Object.entries(series)) {
    if (!scores.length) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const mid = Math.max(1, Math.floor(scores.length / 2));
    const firstHalf = scores.slice(0, mid);
    const secondHalf = scores.slice(mid);
    const firstAvg =
      firstHalf.reduce((a, b) => a + b, 0) / Math.max(1, firstHalf.length);
    const lastAvg =
      secondHalf.reduce((a, b) => a + b, 0) / Math.max(1, secondHalf.length);
    out[subject] = { avg, scores, firstAvg, lastAvg };
  }
  return out;
}

/**
 * @param {Array<import('mongoose').Document>} examResults
 */
function computeExamPercentages(examResults) {
  return examResults.map((r) => toNumber(r.percentage, 0));
}

function performanceBand(avg) {
  if (avg >= 72) return 'strong';
  if (avg >= 50) return 'average';
  return 'weak';
}

function subjectTrend(firstAvg, lastAvg) {
  const delta = lastAvg - firstAvg;
  if (delta >= 5) return 'improving';
  if (delta <= -5) return 'declining';
  return 'stable';
}

function overallTrendLabel(delta) {
  if (delta >= 5) return 'improving';
  if (delta <= -5) return 'declining';
  return 'stable';
}

function subjectRecommendation(subject, perf, trend, avg) {
  const label = capitalizeSubject(subject);
  if (perf === 'weak' && trend === 'declining') {
    return `Priority focus for ${label}: rebuild fundamentals with daily 20–30 min drills and weekly mixed practice; current average ${avg.toFixed(0)}% and trending down.`;
  }
  if (perf === 'weak') {
    return `Strengthen ${label} with concept revision, worked examples, and 15–20 targeted questions per session; current average ${avg.toFixed(0)}%.`;
  }
  if (perf === 'average' && trend === 'declining') {
    return `Stabilize ${label} before scores slip further: review recent mistakes and run one timed mini-mock this week.`;
  }
  if (perf === 'strong') {
    return `Maintain ${label} with light revision and occasional challenge questions to keep momentum (avg ${avg.toFixed(0)}%).`;
  }
  return `Consistent practice in ${label} — aim for 72%+ accuracy through spaced revision and error logging.`;
}

function buildInterventions({
  riskLevel,
  worstSubjects,
  avgScore,
  trendDelta,
  examCount,
}) {
  const weakList =
    worstSubjects.length > 0
      ? worstSubjects.map((s) => capitalizeSubject(s)).join(', ')
      : 'weakest subjects from the breakdown';

  /** @type {Array<{ priority: string, action: string, reasoning: string, expectedImpact: string }>} */
  const items = [];

  if (riskLevel === 'high' || avgScore < 50) {
    items.push({
      priority: 'high',
      action: 'Daily weak-topic correction loop',
      reasoning: `Average score is ${avgScore.toFixed(1)}% across ${examCount} exam(s) with ${trendDelta >= 0 ? 'limited' : 'negative'} momentum (${trendDelta >= 0 ? '+' : ''}${trendDelta.toFixed(1)} pts overall).`,
      expectedImpact: '8–15% score improvement over 3–4 weeks with consistent daily error review.',
    });
  }

  items.push({
    priority: riskLevel === 'high' ? 'high' : 'medium',
    action: 'Subject-focused drill block',
    reasoning: `Relative weakness detected in: ${weakList}.`,
    expectedImpact: 'Clearer recall and fewer repeat mistakes within 2 weeks of focused practice.',
  });

  if (trendDelta < -5) {
    items.push({
      priority: 'high',
      action: 'Trend recovery plan',
      reasoning: `Performance dropped ${Math.abs(trendDelta).toFixed(1)} percentage points from first to latest exam in this window.`,
      expectedImpact: 'Stabilize scores within 2–3 attempts by fixing recurring error themes first.',
    });
  } else {
    items.push({
      priority: 'medium',
      action: 'Timed mixed mini-mock',
      reasoning: 'Build exam stamina and completion rate under timed conditions.',
      expectedImpact: 'Better pacing and fewer skipped items on the next full attempt.',
    });
  }

  if (riskLevel === 'low') {
    items.push({
      priority: 'low',
      action: 'Stretch goals on strong subjects',
      reasoning: 'Overall risk is low — use strong areas to build confidence while maintaining weak-subject drills.',
      expectedImpact: 'Sustained performance band with reduced slip risk before major exams.',
    });
  }

  return items.slice(0, 4);
}

/**
 * @param {{
 *   student: { fullName?: string, email?: string, classNumber?: string | number },
 *   examResults: Array<import('mongoose').Document>,
 *   studentId: string,
 *   analysisType?: string,
 *   timeRange?: string,
 * }} params
 */
export function buildRuleBasedStudentRiskAnalysis({
  student,
  examResults,
  studentId,
  analysisType = 'comprehensive',
  timeRange = '90days',
}) {
  const percentages = computeExamPercentages(examResults);
  const examCount = percentages.length;
  const avgScore = percentages.reduce((a, b) => a + b, 0) / Math.max(1, examCount);
  const latestScore = percentages[examCount - 1];
  const firstScore = percentages[0];
  const trendDelta = examCount >= 2 ? latestScore - firstScore : 0;
  const trendWord = overallTrendLabel(trendDelta);

  const subjectAgg = buildSubjectAggregates(examResults);
  const subjectEntries = Object.entries(subjectAgg).sort((a, b) => a[1].avg - b[1].avg);
  const weakSubjects = subjectEntries.filter(([, v]) => v.avg < 50).map(([k]) => k);
  const strongSubjects = subjectEntries.filter(([, v]) => v.avg >= 72).map(([k]) => k);
  const worstSubjects = subjectEntries.slice(0, Math.min(2, subjectEntries.length)).map(([k]) => k);
  const bestSubject = subjectEntries.length
    ? subjectEntries[subjectEntries.length - 1][0]
    : null;
  const worstSubject = subjectEntries.length ? subjectEntries[0][0] : null;

  let volatility = 0;
  if (examCount >= 2) {
    const mean = avgScore;
    const variance =
      percentages.reduce((sum, p) => sum + (p - mean) ** 2, 0) / examCount;
    volatility = Math.sqrt(variance);
  }

  const weakSubjectPenalty =
    weakSubjects.length >= 2 ? 0.22 : weakSubjects.length === 1 ? 0.12 : 0.04;
  const avgPenalty =
    avgScore < 35 ? 0.28 : avgScore < 50 ? 0.18 : avgScore < 65 ? 0.08 : 0;
  const trendPenalty =
    trendDelta <= -15 ? 0.2 : trendDelta <= -8 ? 0.12 : trendDelta <= -3 ? 0.06 : 0;
  const latestGapPenalty = latestScore < avgScore - 10 ? 0.1 : 0;
  const volatilityPenalty = volatility >= 18 ? 0.08 : volatility >= 12 ? 0.04 : 0;

  const riskScore = clamp(
    0.08 +
      weakSubjectPenalty +
      avgPenalty +
      trendPenalty +
      latestGapPenalty +
      volatilityPenalty -
      (trendDelta >= 10 ? 0.06 : trendDelta >= 5 ? 0.03 : 0) -
      (avgScore >= 75 ? 0.06 : 0),
    0.08,
    0.95,
  );

  const riskLevel = riskScore >= 0.62 ? 'high' : riskScore >= 0.38 ? 'medium' : 'low';

  const studentName = String(student?.fullName || 'This student').trim();
  const classLabel = student?.classNumber ? ` (Class ${student.classNumber})` : '';

  const summaryParts = [
    `${studentName}${classLabel} completed ${examCount} exam${examCount !== 1 ? 's' : ''} in the selected period with an average score of ${avgScore.toFixed(1)}% and a latest score of ${latestScore.toFixed(1)}%.`,
    riskLevel === 'high'
      ? 'Multiple indicators point to elevated academic risk — weak subjects, low averages, or a declining trend need immediate attention.'
      : riskLevel === 'medium'
        ? 'Performance is mixed with identifiable gaps; targeted revision should prevent further decline.'
        : 'Overall performance is stable or strong relative to typical thresholds; maintain consistency on weaker topics.',
    'AI analysis identifies key performance patterns from exam history, subject averages, and score trends.',
  ];

  const examTimeline =
    examCount >= 2
      ? `Scores moved from ${firstScore.toFixed(1)}% (earliest) to ${latestScore.toFixed(1)}% (latest), a ${trendDelta >= 0 ? '+' : ''}${trendDelta.toFixed(1)} point change — trend: ${trendWord}.`
      : `Only one exam in range (${latestScore.toFixed(1)}%); trend analysis will improve as more attempts are recorded.`;

  const volatilityNote =
    examCount >= 3 && volatility >= 12
      ? ` Score volatility is ${volatility.toFixed(1)} pts — inconsistent attempt quality suggests focus issues or uneven preparation.`
      : '';

  const trends = `${examTimeline}${volatilityNote}${
    bestSubject && worstSubject
      ? ` Strongest subject: ${capitalizeSubject(bestSubject)}; weakest: ${capitalizeSubject(worstSubject)}.`
      : ''
  }`;

  /** @type {string[]} */
  const strengths = [];
  if (strongSubjects.length > 0) {
    strongSubjects.slice(0, 3).forEach((s) => {
      strengths.push(
        `${capitalizeSubject(s)} averaging ${subjectAgg[s].avg.toFixed(1)}% — use as a confidence anchor.`,
      );
    });
  }
  if (avgScore >= 65 && strengths.length < 3) {
    strengths.push(`Overall average ${avgScore.toFixed(1)}% is above the medium-risk band.`);
  }
  if (trendDelta >= 5 && strengths.length < 3) {
    strengths.push(`Upward trend (+${trendDelta.toFixed(1)} pts) shows recent improvement.`);
  }
  if (!strengths.length) {
    strengths.push('Complete exam history provides a clear baseline for targeted improvement.');
    if (examCount > 0) {
      strengths.push(`${examCount} recorded attempt(s) enable measurable progress tracking.`);
    }
  }

  /** @type {string[]} */
  const weaknesses = [];
  if (weakSubjects.length > 0) {
    weakSubjects.slice(0, 3).forEach((s) => {
      weaknesses.push(
        `${capitalizeSubject(s)} below 50% average (${subjectAgg[s].avg.toFixed(1)}%).`,
      );
    });
  }
  if (avgScore < 50 && weaknesses.length < 3) {
    weaknesses.push(`Overall average ${avgScore.toFixed(1)}% is below the pass-comfort zone.`);
  }
  if (trendDelta <= -5 && weaknesses.length < 3) {
    weaknesses.push(`Declining trajectory (${trendDelta.toFixed(1)} pts) over the analysis window.`);
  }
  if (volatility >= 15 && weaknesses.length < 3) {
    weaknesses.push(`Inconsistent scores (±${volatility.toFixed(0)} pt spread) between attempts.`);
  }
  if (!weaknesses.length) {
    weaknesses.push('No major weak-subject flags — focus on maintaining accuracy under time pressure.');
  }

  /** @type {string[]} */
  const rootCauses = [];
  if (weakSubjects.length >= 2) {
    rootCauses.push(
      `Multiple subjects below 50% (${weakSubjects.map(capitalizeSubject).join(', ')}) — likely conceptual gaps rather than isolated mistakes.`,
    );
  } else if (weakSubjects.length === 1) {
    rootCauses.push(
      `Primary weakness in ${capitalizeSubject(weakSubjects[0])} may be pulling overall performance down.`,
    );
  }
  if (trendDelta <= -8) {
    rootCauses.push(
      'Sustained score decline suggests reduced revision quality, growing syllabus backlog, or exam anxiety.',
    );
  }
  if (volatility >= 15) {
    rootCauses.push(
      'High score variance between attempts often indicates inconsistent study habits or selective topic preparation.',
    );
  }
  if (latestScore < avgScore - 8) {
    rootCauses.push(
      'Latest exam below personal average — recent preparation may not match exam demands.',
    );
  }
  if (!rootCauses.length) {
    rootCauses.push('Performance is relatively balanced; remaining gaps are likely topic-specific.');
    rootCauses.push('Continued spaced practice should consolidate current level.');
  }

  const trendBoost = trendWord === 'improving' ? 4 : trendWord === 'declining' ? -3 : 0;
  const completionBoost = avgScore < 50 ? 6 : avgScore < 65 ? 3 : 0;
  const nextExamPrediction = Math.round(
    clamp(latestScore + trendBoost + completionBoost, 28, 92),
  );
  const confidence = clamp(0.45 + Math.min(examCount, 6) * 0.06, 0.45, 0.82);

  /** @type {Record<string, { performance: string, trend: string, recommendation: string }>} */
  const subjectBreakdown = {};
  for (const [subject, data] of subjectEntries) {
    const perf = performanceBand(data.avg);
    const trend = subjectTrend(data.firstAvg, data.lastAvg);
    subjectBreakdown[capitalizeSubject(subject)] = {
      performance: perf,
      trend,
      recommendation: subjectRecommendation(subject, perf, trend, data.avg),
    };
  }

  if (!Object.keys(subjectBreakdown).length && examCount > 0) {
    subjectBreakdown.General = {
      performance: performanceBand(avgScore),
      trend: overallTrendLabel(trendDelta),
      recommendation: subjectRecommendation('general', performanceBand(avgScore), overallTrendLabel(trendDelta), avgScore),
    };
  }

  return {
    riskLevel,
    riskScore,
    riskScoreMethod: 'model-based',
    riskScoreMethodLabel:
      'AI-generated estimate based on performance patterns; intended as a guide, not a guarantee.',
    analysis: {
      summary: summaryParts.join(' '),
      trends,
      strengths: strengths.slice(0, 3),
      weaknesses: weaknesses.slice(0, 3),
      rootCauses: rootCauses.slice(0, 3),
    },
    predictions: {
      nextExamPrediction,
      confidence,
      confidenceMethod: 'model-based',
      confidenceMethodLabel:
        'AI-generated estimate based on recent performance patterns; intended as a guide, not a guarantee.',
      trend: trendWord,
    },
    interventions: buildInterventions({
      riskLevel,
      worstSubjects,
      avgScore,
      trendDelta,
      examCount,
    }),
    subjectBreakdown,
    generatedAt: new Date(),
    studentId,
    dataPoints: examCount,
    analysisType,
    timeRange,
    analysisMethod: 'ai-based',
  };
}
