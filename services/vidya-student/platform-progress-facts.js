/**
 * Aggregate in-platform learning activity for Vidya student chat.
 * Sources: UserProgress, StudentVideoChapterProgress, LearningPath, HomeworkSubmission.
 */

function pct(n, d) {
  if (!d || d <= 0) return null;
  return Math.round((Number(n) / Number(d)) * 1000) / 10;
}

function titleFromMap(id, map, fallback) {
  const key = String(id || '');
  if (!key) return fallback;
  return map[key] || fallback;
}

/**
 * @param {object} ctx - from buildStudentAiContext
 * @returns {object} platform facts for appOnlyReply
 */
export function buildPlatformProgressFacts(ctx) {
  const progressRows = Array.isArray(ctx?.academics?.progressRows) ? ctx.academics.progressRows : [];
  const videoChapters = Array.isArray(ctx?.academics?.videoChapterProgress)
    ? ctx.academics.videoChapterProgress
    : [];
  const learningPaths = Array.isArray(ctx?.academics?.learningPaths) ? ctx.academics.learningPaths : [];
  const homeworkRows = Array.isArray(ctx?.academics?.homeworkRows) ? ctx.academics.homeworkRows : [];
  const videoTitles = ctx?.academics?.videoTitleById || {};
  const contentTitles = ctx?.academics?.contentTitleById || {};
  const subjectNames = ctx?.academics?.subjectNameById || {};

  const videoProgressRows = progressRows.filter((r) => r?.videoId);
  const contentProgressRows = progressRows.filter((r) => r?.contentId && !r?.videoId);
  const pathProgressRows = progressRows.filter((r) => r?.learningPathId);

  const videosCompleted = videoProgressRows.filter((r) => r.completed || Number(r.progress) >= 95).length;
  const videosInProgress = videoProgressRows.filter(
    (r) => !r.completed && Number(r.progress) > 0 && Number(r.progress) < 95,
  ).length;

  const recentVideos = [...videoProgressRows]
    .sort((a, b) => new Date(b.lastAccessed || 0) - new Date(a.lastAccessed || 0))
    .slice(0, 8)
    .map((r) => ({
      title: titleFromMap(r.videoId, videoTitles, r.topic || r.subject || 'Video lesson'),
      progress: Math.round(Number(r.progress) || (r.completed ? 100 : 0)),
      completed: Boolean(r.completed || Number(r.progress) >= 95),
      subject: String(r.subject || '').trim(),
      lastAccessed: r.lastAccessed || null,
    }));

  const recentContent = [...contentProgressRows]
    .sort((a, b) => new Date(b.lastAccessed || 0) - new Date(a.lastAccessed || 0))
    .slice(0, 6)
    .map((r) => ({
      title: titleFromMap(r.contentId, contentTitles, r.topic || 'Library content'),
      progress: Math.round(Number(r.progress) || (r.completed ? 100 : 0)),
      completed: Boolean(r.completed || Number(r.progress) >= 95),
      lastAccessed: r.lastAccessed || null,
    }));

  const chaptersBySubject = videoChapters.map((row) => {
    const completedMap = row?.chapterCompletedAt && typeof row.chapterCompletedAt === 'object'
      ? row.chapterCompletedAt
      : {};
    const completedChapters = Object.keys(completedMap).filter((k) => completedMap[k]);
    return {
      subjectId: String(row.subjectId || ''),
      subjectName: titleFromMap(row.subjectId, subjectNames, 'Subject'),
      completedChapterCount: completedChapters.length,
      completedChapters: completedChapters.slice(0, 12),
    };
  });
  const totalChaptersCompleted = chaptersBySubject.reduce(
    (sum, s) => sum + (s.completedChapterCount || 0),
    0,
  );

  const pathFacts = learningPaths.map((lp) => {
    const pathId = String(lp._id || '');
    const totalVideos = Array.isArray(lp.videoIds) ? lp.videoIds.length : 0;
    const related = pathProgressRows.filter((r) => String(r.learningPathId) === pathId);
    const completedItems = related.filter((r) => r.completed || Number(r.progress) >= 95).length;
    const avgProgress =
      related.length > 0
        ? Math.round(
            related.reduce((s, r) => s + (Number(r.progress) || (r.completed ? 100 : 0)), 0) /
              related.length,
          )
        : totalVideos > 0
          ? pct(completedItems, totalVideos)
          : related.length
            ? 0
            : null;
    return {
      title: lp.title || 'Learning path',
      totalVideos,
      completedItems,
      progressPct: avgProgress,
      difficulty: lp.difficulty || '',
    };
  });

  const homeworkSubmitted = homeworkRows.length;
  const homeworkGraded = homeworkRows.filter((h) => h.grade != null && h.grade !== '').length;
  const homeworkPendingReview = homeworkRows.filter(
    (h) => h.isMarkedAsDone !== true && (h.grade == null || h.grade === ''),
  ).length;
  const recentHomework = homeworkRows.slice(0, 5).map((h) => ({
    submittedAt: h.submittedAt || h.createdAt || null,
    grade: h.grade ?? null,
    isMarkedAsDone: Boolean(h.isMarkedAsDone),
  }));

  const totalTracked = videoProgressRows.length + contentProgressRows.length;
  const totalCompleted =
    videosCompleted + contentProgressRows.filter((r) => r.completed || Number(r.progress) >= 95).length;
  const overallLearningPct = pct(totalCompleted, totalTracked);

  return {
    overallLearningPct,
    videos: {
      tracked: videoProgressRows.length,
      completed: videosCompleted,
      inProgress: videosInProgress,
      recent: recentVideos,
      chaptersCompleted: totalChaptersCompleted,
      chaptersBySubject,
    },
    libraryContent: {
      tracked: contentProgressRows.length,
      completed: contentProgressRows.filter((r) => r.completed || Number(r.progress) >= 95).length,
      recent: recentContent,
    },
    learningPaths: pathFacts,
    homework: {
      submitted: homeworkSubmitted,
      graded: homeworkGraded,
      pendingReview: homeworkPendingReview,
      recent: recentHomework,
    },
    hasAnyActivity:
      videoProgressRows.length > 0 ||
      contentProgressRows.length > 0 ||
      totalChaptersCompleted > 0 ||
      learningPaths.length > 0 ||
      homeworkRows.length > 0,
  };
}
