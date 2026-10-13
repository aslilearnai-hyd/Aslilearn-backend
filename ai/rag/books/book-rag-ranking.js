function vectorNorm(values = []) {
  let sum = 0;
  for (const value of values) {
    const numeric = Number(value) || 0;
    sum += numeric * numeric;
  }
  return Math.sqrt(sum);
}

/** True cosine similarity. Works with normalized and non-normalized embeddings. */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += (Number(a[i]) || 0) * (Number(b[i]) || 0);
  const denominator = vectorNorm(a.slice(0, n)) * vectorNorm(b.slice(0, n));
  return denominator > 0 ? dot / denominator : 0;
}

function metadataKey(chunk = {}) {
  return [chunk.chapter, chunk.topic, chunk.subtopic]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join('|');
}

/**
 * Maximal marginal relevance selection: keep query relevance while penalising
 * near-duplicate chunks and repeated chapter/subtopic coverage.
 */
export function selectDiverseBookChunks(chunks = [], limit = 4, options = {}) {
  const pool = Array.isArray(chunks) ? chunks.filter(Boolean) : [];
  const target = Math.max(1, Math.min(pool.length, Number(limit) || 4));
  if (pool.length <= target) return [...pool];

  const lambda = Math.min(0.95, Math.max(0.4, Number(options.lambda) || 0.72));
  const coveragePenalty = Math.min(0.2, Math.max(0, Number(options.coveragePenalty) || 0.06));
  const selected = [];
  const remaining = [...pool];
  const coverageCounts = new Map();

  while (selected.length < target && remaining.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const relevance = Number(candidate.score ?? candidate.rawScore) || 0;
      let maxSimilarity = 0;
      for (const chosen of selected) {
        maxSimilarity = Math.max(
          maxSimilarity,
          cosineSimilarity(candidate.embedding || [], chosen.embedding || []),
        );
      }
      const key = metadataKey(candidate);
      const repeatedCoverage = coverageCounts.get(key) || 0;
      const mmr = lambda * relevance - (1 - lambda) * maxSimilarity - coveragePenalty * repeatedCoverage;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIndex = i;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    const key = metadataKey(picked);
    coverageCounts.set(key, (coverageCounts.get(key) || 0) + 1);
  }
  return selected;
}

export function retrievalTier(score, thresholds = {}) {
  const strong = Number.isFinite(Number(thresholds.strong)) ? Number(thresholds.strong) : 0.42;
  const acceptable = Number.isFinite(Number(thresholds.acceptable))
    ? Number(thresholds.acceptable)
    : 0.2;
  const numeric = Number(score) || 0;
  if (numeric >= strong) return 'strong';
  if (numeric >= acceptable) return 'acceptable';
  return 'weak';
}

