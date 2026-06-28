import AiToolGeneration from '../models/AiToolGeneration.js';
import { wordJaccardSimilarity } from '../utils/ai-generator-dedup.js';
import { normalizeScope, scopeQuery } from './ai-generator-fingerprint-service.js';
import { extractTitleFromStructured } from './ai-generator-content-extractor.js';
import {
  isStoryPassageLanguageToolSlug,
  mustEnforceStoryPassageLanguageCompliance,
  storyPassageRecordLanguageValid,
} from '../utils/story-passage-subject.js';

const DEFAULT_BATCH_SIZE = 25;

function getBatchSize(n) {
  const size = Number(n);
  return Number.isFinite(size) && size > 0 ? Math.min(size, 50) : DEFAULT_BATCH_SIZE;
}

function recordFingerprintMeta(rec) {
  return {
    contentFp: String(rec?.metadata?.contentFingerprint || ''),
    questionFps: Array.isArray(rec?.metadata?.questionFingerprints)
      ? rec.metadata.questionFingerprints
      : [],
    createdAt: rec?.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : '',
    variant: rec?.metadata?.generationVariant || rec?.metadata?.extraParams?.generationVariant,
    difficulty: String(
      rec?.metadata?.extraParams?.difficulty ||
        rec?.metadata?.structuredContent?.difficulty_level ||
        rec?.metadata?.structuredContent?.difficulty ||
        '',
    ).trim(),
  };
}

function isTooSimilarToSelected(candidate, selected, titleThreshold = 0.82) {
  const cTitle = extractTitleFromStructured(candidate?.metadata?.structuredContent || {});
  const cMeta = recordFingerprintMeta(candidate);

  for (const sel of selected) {
    const sTitle = extractTitleFromStructured(sel?.metadata?.structuredContent || {});
    const sMeta = recordFingerprintMeta(sel);

    if (cMeta.contentFp && sMeta.contentFp && cMeta.contentFp === sMeta.contentFp) return true;
    if (cTitle && sTitle && wordJaccardSimilarity(cTitle, sTitle) >= titleThreshold) return true;
    if (cMeta.createdAt && cMeta.createdAt === sMeta.createdAt && selected.length > 5) {
      // soft penalty — skip only if titles also similar
      if (cTitle && sTitle && wordJaccardSimilarity(cTitle, sTitle) >= 0.6) return true;
    }
  }
  return false;
}

/**
 * Select diverse random records from existing pool (no Gemini cost).
 * Uses $sample then diversity filter.
 */
export async function selectRandomUniqueRecords(scope, opts = {}) {
  const batchSize = getBatchSize(opts.batchSize);
  const s = normalizeScope(scope);
  const query = scopeQuery(s);

  const total = await AiToolGeneration.countDocuments(query);
  if (total === 0) {
    return { records: [], total, mode: 'random_retrieval', geminiGenerationsAvoided: batchSize };
  }

  const sampleSize = Math.min(Math.max(batchSize * 4, 60), total, 500);

  let pool = await AiToolGeneration.aggregate([
    { $match: query },
    { $sample: { size: sampleSize } },
    {
      $project: {
        toolName: 1,
        toolDisplayName: 1,
        board: 1,
        classLabel: 1,
        subject: 1,
        topic: 1,
        subtopic: 1,
        generatedContent: 1,
        content: 1,
        metadata: 1,
        createdAt: 1,
        reviewStatus: 1,
      },
    },
  ]);

  // Prefer records with structuredContent + fingerprints
  pool.sort((a, b) => {
    const aScore =
      (a.metadata?.structuredContent ? 2 : 0) + (a.metadata?.contentFingerprint ? 1 : 0);
    const bScore =
      (b.metadata?.structuredContent ? 2 : 0) + (b.metadata?.contentFingerprint ? 1 : 0);
    return bScore - aScore;
  });

  if (
    isStoryPassageLanguageToolSlug(s.toolSlug) &&
    mustEnforceStoryPassageLanguageCompliance(s.subject)
  ) {
    pool = pool.filter((rec) => storyPassageRecordLanguageValid(s.toolSlug, s.subject, rec));
  }

  const selected = [];
  const usedDifficulties = new Set();
  const usedDates = new Set();

  for (const rec of pool) {
    if (selected.length >= batchSize) break;
    if (isTooSimilarToSelected(rec, selected)) continue;

    const meta = recordFingerprintMeta(rec);
    // Prefer balanced difficulty/date distribution when possible
    if (selected.length > 5 && meta.difficulty && usedDifficulties.has(meta.difficulty)) {
      if (usedDifficulties.size < 3) continue;
    }
    if (selected.length > 10 && meta.createdAt && usedDates.has(meta.createdAt)) {
      if (usedDates.size < 5) continue;
    }

    selected.push(rec);
    if (meta.difficulty) usedDifficulties.add(meta.difficulty);
    if (meta.createdAt) usedDates.add(meta.createdAt);
  }

  // Fill remaining slots if diversity filter was too strict
  if (selected.length < batchSize) {
    for (const rec of pool) {
      if (selected.length >= batchSize) break;
      if (selected.some((s) => String(s._id) === String(rec._id))) continue;
      if (isTooSimilarToSelected(rec, selected)) continue;
      selected.push(rec);
    }
  }

  return {
    records: selected.slice(0, batchSize),
    total,
    mode: 'random_retrieval',
    geminiGenerationsAvoided: batchSize,
    tokenSavingsEstimate: batchSize,
  };
}
