/**
 * Shared Super Admin analytics metric helpers.
 * Pass threshold and content volume definitions must stay consistent across
 * dashboard, realtime, detailed AI, and board surfaces.
 */

export const PASS_THRESHOLD = 40;

export function isPassing(percentage) {
  return (Number(percentage) || 0) >= PASS_THRESHOLD;
}

export function avgPercentage(results = []) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return 0;
  const sum = list.reduce((acc, r) => {
    const pct =
      typeof r === 'number'
        ? r
        : Number(r?.percentage ?? r?.score ?? 0);
    return acc + (Number.isFinite(pct) ? pct : 0);
  }, 0);
  return Math.round((sum / list.length) * 100) / 100;
}

export function passRateFromPercentages(percentages = []) {
  const list = Array.isArray(percentages) ? percentages : [];
  if (!list.length) return 0;
  const passing = list.filter((p) => isPassing(typeof p === 'number' ? p : p?.percentage)).length;
  return Math.round((passing / list.length) * 1000) / 10;
}

export function uniqueIds(values = []) {
  const set = new Set();
  for (const v of values) {
    if (v == null || v === '') continue;
    const id = v?._id?.toString?.() || v?.toString?.() || String(v);
    if (id && id !== 'undefined' && id !== 'null') set.add(id);
  }
  return [...set];
}

export function uniqueCount(values = []) {
  return uniqueIds(values).length;
}

/**
 * Named content volume — never imply a percentage.
 * Includes videos + content docs + assessments + exams by default.
 */
export function contentVolume({
  videos = 0,
  content = 0,
  assessments = 0,
  exams = 0,
} = {}) {
  return (
    (Number(videos) || 0) +
    (Number(content) || 0) +
    (Number(assessments) || 0) +
    (Number(exams) || 0)
  );
}

/** Active students as % of all students (0–100). */
export function activeStudentsPercentage(activeStudents, totalStudents) {
  const total = Number(totalStudents) || 0;
  if (total <= 0) return 0;
  return Math.round(((Number(activeStudents) || 0) / total) * 100);
}

/** Unique attempters / students → participation % (capped at 100 for display). */
export function participationRatePercent(uniqueAttempters, students) {
  const total = Number(students) || 0;
  if (total <= 0) return 0;
  const rate = ((Number(uniqueAttempters) || 0) / total) * 100;
  return Math.min(100, Math.round(rate * 10) / 10);
}

export function formatParticipationRate(uniqueAttempters, students) {
  return participationRatePercent(uniqueAttempters, students).toFixed(1);
}
