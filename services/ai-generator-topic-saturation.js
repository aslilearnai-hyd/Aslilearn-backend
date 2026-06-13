import AiToolGeneration from '../models/AiToolGeneration.js';
import AiGenerationFingerprint from '../models/AiGenerationFingerprint.js';
import { normalizeScope, scopeQuery, countExistingGenerations } from './ai-generator-fingerprint-service.js';

export const SATURATION_LEVELS = Object.freeze({
  HEALTHY: { min: 0, max: 100, label: 'Healthy' },
  GROWING: { min: 101, max: 500, label: 'Growing' },
  HIGH: { min: 501, max: 1000, label: 'High' },
  SATURATED: { min: 1001, max: Infinity, label: 'Saturated' },
});

export function getSaturationThresholds() {
  return {
    healthyMax: Number(process.env.AI_GENERATOR_SATURATION_HEALTHY_MAX) || 100,
    growingMax: Number(process.env.AI_GENERATOR_SATURATION_GROWING_MAX) || 500,
    highMax: Number(process.env.AI_GENERATOR_SATURATION_HIGH_MAX) || 1000,
    randomRetrievalMin: Number(process.env.AI_GENERATOR_RANDOM_RETRIEVAL_MIN) || 1000,
  };
}

export function classifySaturationLevel(recordCount, thresholds = getSaturationThresholds()) {
  const n = Number(recordCount) || 0;
  if (n <= thresholds.healthyMax) return 'Healthy';
  if (n <= thresholds.growingMax) return 'Growing';
  if (n <= thresholds.highMax) return 'High';
  return 'Saturated';
}

/**
 * Compute topic saturation score and metadata for a curriculum slot.
 */
export async function computeTopicSaturation(scope) {
  const s = normalizeScope(scope);
  const thresholds = getSaturationThresholds();
  const query = scopeQuery(s);

  const [totalGenerations, fingerprintCount, questionFingerprintCount] = await Promise.all([
    countExistingGenerations(s),
    AiGenerationFingerprint.countDocuments({
      toolSlug: s.toolSlug,
      className: s.className,
      subject: s.subject,
      ...(s.board ? { board: s.board } : {}),
      ...(s.topic ? { topic: s.topic } : {}),
      ...(s.subtopic ? { subtopic: s.subtopic } : {}),
    }),
    AiGenerationFingerprint.countDocuments({
      toolSlug: s.toolSlug,
      className: s.className,
      subject: s.subject,
      contentType: 'question',
      ...(s.board ? { board: s.board } : {}),
      ...(s.topic ? { topic: s.topic } : {}),
      ...(s.subtopic ? { subtopic: s.subtopic } : {}),
    }),
  ]);

  const uniqueTitleCount = await AiGenerationFingerprint.distinct('fingerprint', {
    toolSlug: s.toolSlug,
    className: s.className,
    subject: s.subject,
    contentType: 'title',
    ...(s.board ? { board: s.board } : {}),
    ...(s.topic ? { topic: s.topic } : {}),
    ...(s.subtopic ? { subtopic: s.subtopic } : {}),
  }).then((arr) => arr.length);

  const level = classifySaturationLevel(totalGenerations, thresholds);

  // Score 0–1000+ scale aligned with record count + fingerprint density
  const fingerprintDensity =
    totalGenerations > 0 ? Math.round((fingerprintCount / totalGenerations) * 10) / 10 : 0;
  const uniquenessRatio =
    totalGenerations > 0 ? Math.round((uniqueTitleCount / totalGenerations) * 100) : 100;

  const topicSaturationScore = totalGenerations;

  const recordsWithFingerprints = await AiToolGeneration.countDocuments({
    ...query,
    'metadata.contentFingerprint': { $exists: true, $ne: '' },
  });

  const fingerprintCoveragePct =
    totalGenerations > 0
      ? Math.round((recordsWithFingerprints / totalGenerations) * 1000) / 10
      : 0;

  return {
    scope: s,
    topicSaturationScore,
    saturationLevel: level,
    totalGenerations,
    fingerprintCount,
    uniqueQuestionFingerprints: questionFingerprintCount,
    uniqueTitleCount,
    fingerprintDensity,
    uniquenessRatio,
    fingerprintCoveragePct,
    thresholds,
    shouldUseRandomRetrieval:
      totalGenerations >= thresholds.randomRetrievalMin && level === 'Saturated',
    shouldGenerateNew:
      totalGenerations <= thresholds.healthyMax ||
      (totalGenerations <= thresholds.growingMax && level !== 'Saturated'),
    requiresStrictUniqueness: totalGenerations > thresholds.healthyMax,
  };
}

export async function getTopicSaturationAnalytics(scope = {}) {
  const match = { sourceType: { $ne: 'ai_pdf' } };
  if (scope.toolSlug) match.toolName = scope.toolSlug;
  if (scope.board) match.board = scope.board;

  const grouped = await AiToolGeneration.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          toolName: '$toolName',
          subject: '$subject',
          topic: '$topic',
          subtopic: '$subtopic',
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);

  const thresholds = getSaturationThresholds();
  return grouped.map((row) => ({
    toolSlug: row._id.toolName,
    subject: row._id.subject,
    topic: row._id.topic,
    subtopic: row._id.subtopic,
    recordCount: row.count,
    topicSaturationScore: row.count,
    saturationLevel: classifySaturationLevel(row.count, thresholds),
  }));
}
