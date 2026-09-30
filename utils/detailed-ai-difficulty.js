const emptyDifficultyStats = () => ({
  veryHard: 0,
  hard: 0,
  medium: 0,
  easy: 0,
  veryEasy: 0,
});

const difficultyBucket = (averageScore) => {
  if (averageScore < 40) return 'veryHard';
  if (averageScore < 60) return 'hard';
  if (averageScore < 75) return 'medium';
  if (averageScore < 85) return 'easy';
  return 'veryEasy';
};

export function analyzeOverallDifficulty(exams, results) {
  const stats = emptyDifficultyStats();
  if (!Array.isArray(exams) || !Array.isArray(results)) return stats;

  for (const exam of exams) {
    if (!exam?._id) continue;

    const percentages = results
      .filter((result) => result?.examId?._id?.toString() === exam._id.toString())
      .map((result) => result.percentage)
      .filter((percentage) => typeof percentage === 'number');

    if (percentages.length === 0) continue;
    const averageScore = percentages.reduce((sum, percentage) => sum + percentage, 0) / percentages.length;
    stats[difficultyBucket(averageScore)] += 1;
  }

  return stats;
}
