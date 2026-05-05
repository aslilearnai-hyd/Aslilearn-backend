export function analyzeMarks(exams = []) {
  const rows = Array.isArray(exams) ? exams : [];
  if (!rows.length) {
    return { highestMark: null, averagePercentage: null };
  }

  let highest = null;
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const pct = Number(r?.percentage);
    if (Number.isFinite(pct)) {
      sum += pct;
      count += 1;
      if (!highest || pct > Number(highest.percentage || -1)) {
        highest = {
          examTitle: r?.examTitle || r?.title || 'Exam',
          percentage: Math.round(pct * 100) / 100,
          obtainedMarks: Number(r?.obtainedMarks || 0),
          totalMarks: Number(r?.totalMarks || 0),
        };
      }
    }
  }
  return {
    highestMark: highest,
    averagePercentage: count > 0 ? Math.round((sum / count) * 100) / 100 : null,
  };
}

