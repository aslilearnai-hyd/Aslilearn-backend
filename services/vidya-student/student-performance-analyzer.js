function pct(n, d) {
  if (!d) return 0;
  return Math.round((Number(n || 0) / Number(d || 1)) * 1000) / 10;
}

export function analyzeStudentPerformance(ctx) {
  const rows = Array.isArray(ctx?.exams?.recentResults) ? ctx.exams.recentResults : [];
  const subjectMap = new Map();
  const trendSeries = [];

  for (const r of rows) {
    const p = Number(r.percentage || 0);
    trendSeries.push({
      examTitle: r.examTitle || '',
      percentage: p,
      completedAt: r.completedAt,
    });
    const sw = r.subjectWiseScore && typeof r.subjectWiseScore === 'object' ? r.subjectWiseScore : {};
    for (const [subject, stat] of Object.entries(sw)) {
      const current = subjectMap.get(subject) || { attempts: 0, marks: 0, total: 0, weakChapters: new Map() };
      const correct = Number(stat?.correct || 0);
      const total = Number(stat?.total || 0);
      current.attempts += 1;
      current.marks += correct;
      current.total += total;
      subjectMap.set(subject, current);
    }
  }

  const subjectPerformance = Array.from(subjectMap.entries()).map(([subject, v]) => ({
    subject,
    attempts: v.attempts,
    percentage: pct(v.marks, v.total),
  }));
  subjectPerformance.sort((a, b) => b.percentage - a.percentage);

  const latest = trendSeries[0]?.percentage ?? null;
  const previous = trendSeries[1]?.percentage ?? null;
  const delta = latest !== null && previous !== null ? Math.round((latest - previous) * 10) / 10 : null;

  return {
    latestPercentage: latest,
    previousPercentage: previous,
    deltaVsPrevious: delta,
    trendDirection: delta === null ? 'unknown' : delta > 0 ? 'improving' : delta < 0 ? 'declining' : 'flat',
    trendSeries: trendSeries.slice(0, 12),
    subjectPerformance,
  };
}

