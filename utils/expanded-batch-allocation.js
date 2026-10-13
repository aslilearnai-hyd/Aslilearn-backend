/**
 * Split one user-requested record total across expanded curriculum scopes.
 * The record count is a hard total, never a per-scope multiplier.
 */
export function allocateExpandedBatchTargets(targets, requestedTotal) {
  const total = Math.max(1, Math.floor(Number(requestedTotal) || 1));
  const usable = (Array.isArray(targets) ? targets : []).filter(Boolean);
  if (!usable.length) return [];

  // Prefer concrete subtopics when the requested total cannot cover every
  // subtopic plus the optional Whole chapter summary.
  const ordered = [
    ...usable.filter((target) => !target.chapterScope),
    ...usable.filter((target) => target.chapterScope),
  ];
  const selected = ordered.slice(0, Math.min(total, ordered.length));
  const base = Math.floor(total / selected.length);
  const remainder = total % selected.length;
  return selected.map((target, index) => ({
    ...target,
    batchSize: base + (index < remainder ? 1 : 0),
  }));
}
