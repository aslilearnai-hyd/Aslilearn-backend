export function buildPersonalizedRecommendations({ ctx, performance, weakTopics, platform }) {
  const weak = Array.isArray(weakTopics?.weakTopics) ? weakTopics.weakTopics : [];
  const subjectPerf = Array.isArray(performance?.subjectPerformance) ? performance.subjectPerformance : [];
  const attendanceRows = Array.isArray(ctx?.attendance?.sessions30d) ? ctx.attendance.sessions30d : [];
  const attendedDays = new Set(attendanceRows.map((x) => String(x.date || ''))).size;
  const attendanceRate = Math.round((attendedDays / 30) * 1000) / 10;
  const homework = platform?.homework || {};
  const homeworkRows = Array.isArray(ctx?.academics?.homeworkRows) ? ctx.academics.homeworkRows : [];
  const pendingHomeworkCount =
    typeof homework.pendingReview === 'number'
      ? homework.pendingReview
      : homeworkRows.filter((h) => !h.isMarkedAsDone && (h.grade == null || h.grade === '')).length;
  const videosInProgress = Number(platform?.videos?.inProgress || 0);

  const focusTopic = weak[0]?.chapter || (subjectPerf[subjectPerf.length - 1]?.subject || 'Revision');
  const actionCard = {
    title: 'Today Focus On This',
    action:
      videosInProgress > 0 && !weak[0]
        ? `Finish ${videosInProgress} video(s) already in progress`
        : `Practice ${focusTopic}`,
    reason:
      weak[0]
        ? `${focusTopic} shows a high mistake rate (${weak[0].wrongRate}%).`
        : videosInProgress > 0
          ? 'Completing started videos keeps your learning streak moving.'
          : 'Continue consistent revision to improve next exam performance.',
  };

  const nextActions = [
    weak[0] ? `Solve 10 questions from ${weak[0].chapter}.` : null,
    weak[1] ? `Revise ${weak[1].chapter} with formula recap.` : null,
    videosInProgress > 0 ? `Resume ${videosInProgress} unfinished video lesson(s).` : null,
    performance?.trendDirection === 'declining' ? 'Review your last exam mistakes before new practice.' : null,
    attendanceRate < 75 ? 'Improve daily study attendance to at least 75% this month.' : null,
    pendingHomeworkCount > 0
      ? `Follow up on ${pendingHomeworkCount} homework item(s) awaiting review or completion.`
      : 'Keep homework submissions consistent.',
  ].filter(Boolean);

  return {
    actionCard,
    nextActions,
    attendanceRate30d: attendanceRate,
    pendingHomeworkCount,
    interventionAlerts: [
      attendanceRate < 75 ? 'Low attendance risk' : null,
      performance?.trendDirection === 'declining' ? 'Score trend declining' : null,
      weak.length >= 3 ? 'Multiple weak chapters detected' : null,
      videosInProgress >= 3 ? 'Several videos left unfinished' : null,
    ].filter(Boolean),
  };
}

