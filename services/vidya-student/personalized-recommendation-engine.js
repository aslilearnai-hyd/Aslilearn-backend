export function buildPersonalizedRecommendations({ ctx, performance, weakTopics, platform, desk }) {
  const weak = Array.isArray(weakTopics?.weakTopics) ? weakTopics.weakTopics : [];
  const subjectPerf = Array.isArray(performance?.subjectPerformance) ? performance.subjectPerformance : [];
  const attendanceRows = Array.isArray(ctx?.attendance?.sessions30d) ? ctx.attendance.sessions30d : [];
  const attendedDays = new Set(attendanceRows.map((x) => String(x.date || ''))).size;
  const attendanceRate = Math.round((attendedDays / 30) * 1000) / 10;
  const homework = platform?.homework || {};
  const homeworkRows = Array.isArray(ctx?.academics?.homeworkRows) ? ctx.academics.homeworkRows : [];
  const deskHw = desk?.homework || {};
  const pendingHomeworkCount =
    Array.isArray(deskHw.pending) && deskHw.pending.length
      ? deskHw.pending.length
      : typeof homework.pendingReview === 'number'
        ? homework.pendingReview
        : homeworkRows.filter((h) => !h.isMarkedAsDone && (h.grade == null || h.grade === '')).length;
  const homeworkTodayCount = Array.isArray(deskHw.today) ? deskHw.today.length : 0;
  const overdueCount = Array.isArray(deskHw.overdue) ? deskHw.overdue.length : 0;
  const videosInProgress = Number(platform?.videos?.inProgress || 0);
  const upcomingExam = Array.isArray(desk?.upcomingExams) ? desk.upcomingExams[0] : null;
  const openExam = Array.isArray(desk?.openExams) ? desk.openExams[0] : null;

  const focusTopic = weak[0]?.chapter || (subjectPerf[subjectPerf.length - 1]?.subject || 'Revision');
  let action = `Practice ${focusTopic}`;
  let reason = weak[0]
    ? `${focusTopic} shows a high mistake rate (${weak[0].wrongRate}%).`
    : 'Continue consistent revision to improve next exam performance.';

  if (overdueCount > 0) {
    action = `Submit ${overdueCount} overdue homework item(s)`;
    reason = 'Overdue homework should be cleared first.';
  } else if (homeworkTodayCount > 0) {
    action = `Complete today's homework (${homeworkTodayCount})`;
    reason = 'You have homework due today.';
  } else if (openExam) {
    action = `Attempt open exam: ${openExam.title}`;
    reason = 'An exam window is open for your class right now.';
  } else if (upcomingExam) {
    action = `Prepare for ${upcomingExam.title}`;
    reason = upcomingExam.startLabel
      ? `Starts ${upcomingExam.startLabel}.`
      : 'An exam is coming up on your schedule.';
  } else if (videosInProgress > 0 && !weak[0]) {
    action = `Finish ${videosInProgress} video(s) already in progress`;
    reason = 'Completing started videos keeps your learning streak moving.';
  }

  const actionCard = {
    title: 'Today Focus On This',
    action,
    reason,
  };

  const nextActions = [
    overdueCount > 0 ? `Clear ${overdueCount} overdue homework.` : null,
    homeworkTodayCount > 0 ? `Finish today's homework assignments.` : null,
    openExam ? `Take open exam: ${openExam.title}.` : null,
    upcomingExam ? `Revise for upcoming exam: ${upcomingExam.title}.` : null,
    weak[0] ? `Solve 10 questions from ${weak[0].chapter}.` : null,
    weak[1] ? `Revise ${weak[1].chapter} with formula recap.` : null,
    videosInProgress > 0 ? `Resume ${videosInProgress} unfinished video lesson(s).` : null,
    performance?.trendDirection === 'declining' ? 'Review your last exam mistakes before new practice.' : null,
    attendanceRate < 75 ? 'Improve daily study attendance to at least 75% this month.' : null,
    pendingHomeworkCount > 0 && homeworkTodayCount === 0 && overdueCount === 0
      ? `Follow up on ${pendingHomeworkCount} pending homework item(s).`
      : null,
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

