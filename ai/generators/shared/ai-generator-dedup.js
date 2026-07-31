import crypto from 'crypto';

/** Normalize text for similarity checks (ignore case, spacing, variant labels). */
export function normalizeContentForDedup(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/variant\s*\d+/gi, ' ')
    .replace(/\b(set|version)\s*\d+/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();
}

export function contentFingerprint(text) {
  const normalized = normalizeContentForDedup(text);
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function tokenSet(text) {
  const words = normalizeContentForDedup(text)
    .split(' ')
    .filter((w) => w.length > 2);
  return new Set(words);
}

/** Jaccard similarity on word tokens (0..1). */
export function wordJaccardSimilarity(a, b) {
  const na = normalizeContentForDedup(a);
  const nb = normalizeContentForDedup(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sa = tokenSet(na);
  const sb = tokenSet(nb);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) {
    if (sb.has(w)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 0;
}

export function getDedupSimilarityThreshold() {
  const n = Number(process.env.AI_GENERATOR_DEDUP_THRESHOLD);
  if (Number.isFinite(n) && n > 0 && n < 1) return n;
  return 0.86;
}

/**
 * @param {string} candidate
 * @param {string[]} existingBodies
 * @param {{ threshold?: number }} [options]
 * @returns {{ duplicate: boolean; matchIndex: number; similarity: number }}
 */
export function findNearDuplicate(candidate, existingBodies = [], options = {}) {
  const threshold =
    Number.isFinite(options.threshold) && options.threshold > 0 && options.threshold < 1
      ? options.threshold
      : getDedupSimilarityThreshold();
  const bodies = Array.isArray(existingBodies) ? existingBodies : [];
  let bestSim = 0;
  let bestIdx = -1;

  for (let i = 0; i < bodies.length; i += 1) {
    const existing = String(bodies[i] || '').trim();
    if (!existing) continue;
    const sim = wordJaccardSimilarity(candidate, existing);
    if (sim > bestSim) {
      bestSim = sim;
      bestIdx = i;
    }
    if (sim >= threshold) {
      return { duplicate: true, matchIndex: i, similarity: sim };
    }
  }

  return { duplicate: false, matchIndex: bestIdx, similarity: bestSim };
}

/**
 * Batch mode: strict vs in-flight batch samples; looser vs old DB rows.
 * @param {string} candidate
 * @param {string[]} batchSamples
 * @param {string[]} dbBodies
 * @param {{ batchThreshold?: number; dbThreshold?: number }} [options]
 */
export function findBatchNearDuplicate(candidate, batchSamples = [], dbBodies = [], options = {}) {
  const batchThreshold = options.batchThreshold ?? getDedupSimilarityThreshold();
  const dbThreshold = options.dbThreshold ?? 0.96;
  const batchDup = findNearDuplicate(candidate, batchSamples, { threshold: batchThreshold });
  if (batchDup.duplicate) return { ...batchDup, source: 'batch' };
  const dbDup = findNearDuplicate(candidate, dbBodies, { threshold: dbThreshold });
  if (dbDup.duplicate) return { ...dbDup, source: 'db' };
  const bestSim = Math.max(batchDup.similarity, dbDup.similarity);
  return { duplicate: false, matchIndex: -1, similarity: bestSim, source: null };
}

/** Short openings fed back into the prompt on dedup retry. */
export function extractDedupOpeningSnippet(text, maxLen = 160) {
  const plain = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .trim();
  const line = plain.split('\n').find((l) => String(l || '').trim().length > 20) || plain;
  return line.trim().slice(0, maxLen);
}

export function collectForbiddenOpenings(existingBodies = [], limit = 6) {
  const out = [];
  const seen = new Set();
  for (const body of existingBodies) {
    const snippet = extractDedupOpeningSnippet(body);
    const key = normalizeContentForDedup(snippet).slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(snippet);
    if (out.length >= limit) break;
  }
  return out;
}
