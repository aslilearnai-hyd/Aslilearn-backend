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
  const trend = summary?.trend || 'steady';
  return `Hi ${student}! Your recent learning trend looks ${trend}. Ask me what to study next.`;
}

