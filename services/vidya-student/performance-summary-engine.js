export function buildPerformanceSummary({ ctx, performance, weakTopics, marks, recommendations }) {
  return {
    student: ctx?.profile?.fullName || 'Student',
    classNumber: ctx?.profile?.classNumber || '',
    trend: performance?.trendDirection || 'steady',
    highestMark: marks?.highestMark || null,
    weakTopicCount: Array.isArray(weakTopics?.weakTopics) ? weakTopics.weakTopics.length : 0,
    nextAction: recommendations?.actionCard?.action || '',
  };
}

export function buildAutoGreeting(summary) {
  const student = summary?.student || 'Student';
  const trend = String(summary?.trend || 'unknown').toLowerCase();
  const hasHistory = Boolean(summary?.highestMark) || Number(summary?.weakTopicCount) > 0;

  // A student with no attempts yet has no trend to report. The engine returns
  // 'unknown' for them, and the old greeting interpolated it straight in —
  // so a brand-new student was told their learning was "declining".
  if (!hasHistory || trend === 'unknown') {
    return `Hi ${student}! I'm Vidya, your study assistant. Ask me anything about your subjects, or tell me a chapter and I'll help you practise.`;
  }

  if (trend === 'improving') {
    return `Hi ${student}! Your scores are trending up — nice work. Want to keep the momentum going?`;
  }

  if (trend === 'declining') {
    return `Hi ${student}! Let's get you back on track. Want me to go over the topics you've been finding tricky?`;
  }

  return `Hi ${student}! Your progress is holding steady. Ask me what to study next, or pick a topic to practise.`;
}

