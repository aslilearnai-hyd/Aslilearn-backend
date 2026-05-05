export function detectWeakAndStrongTopics(ctx) {
  const results = Array.isArray(ctx?.exams?.recentResults) ? ctx.exams.recentResults : [];
  const chapterStats = new Map();

  for (const r of results) {
    const qa = Array.isArray(r.questionAnalytics) ? r.questionAnalytics : [];
    for (const q of qa) {
      const chapter = String(q.chapter || 'General').trim();
      const row = chapterStats.get(chapter) || { wrong: 0, total: 0, correct: 0 };
      row.total += 1;
      if (q.status === 'wrong' || q.status === 'not_answered') row.wrong += 1;
      if (q.status === 'correct') row.correct += 1;
      chapterStats.set(chapter, row);
    }
  }

  const ranking = Array.from(chapterStats.entries()).map(([chapter, stat]) => ({
    chapter,
    wrongRate: stat.total > 0 ? Math.round((stat.wrong / stat.total) * 1000) / 10 : 0,
    correctRate: stat.total > 0 ? Math.round((stat.correct / stat.total) * 1000) / 10 : 0,
    attempts: stat.total,
  }));

  const weakTopics = [...ranking]
    .filter((x) => x.attempts >= 2)
    .sort((a, b) => b.wrongRate - a.wrongRate)
    .slice(0, 6);
  const strongTopics = [...ranking]
    .filter((x) => x.attempts >= 2)
    .sort((a, b) => b.correctRate - a.correctRate)
    .slice(0, 6);

  return {
    weakTopics,
    strongTopics,
    topicRanking: ranking.slice(0, 20),
  };
}

