import AiToolGeneration from '../models/AiToolGeneration.js';
import AiGenerationFingerprint from '../models/AiGenerationFingerprint.js';
import { wordJaccardSimilarity } from '../utils/ai-generator-dedup.js';
import { getQuestionSimilarityThreshold } from './ai-generator-uniqueness-engine.js';
import {
  computeTopicSaturation,
  getTopicSaturationAnalytics,
  classifySaturationLevel,
  getSaturationThresholds,
} from './ai-generator-topic-saturation.js';
import { getUsdToInrRate } from '../utils/gemini-token-cost.js';

/**
 * Duplicate audit metrics for admin dashboard.
 */
export async function getDuplicateAuditSummary(scope = {}) {
  const toolSlug = String(scope.toolSlug || '').trim();
  const match = {};
  if (toolSlug) match.toolSlug = toolSlug;
  if (scope.board) match.board = scope.board;
  if (scope.className) match.className = scope.className;
  if (scope.subject) match.subject = scope.subject;
  if (scope.topic) match.topic = scope.topic;
  if (scope.subtopic) match.subtopic = scope.subtopic;

  const [totalRecords, totalFingerprints, fingerprintRows] = await Promise.all([
    AiToolGeneration.countDocuments({
      sourceType: { $ne: 'ai_pdf' },
      ...(toolSlug ? { toolName: toolSlug } : {}),
      ...(scope.className ? { classLabel: scope.className } : {}),
      ...(scope.subject ? { subject: scope.subject } : {}),
    }),
    AiGenerationFingerprint.countDocuments(match),
    AiGenerationFingerprint.find(match)
      .select('fingerprint contentType originalText toolSlug subject topic subtopic createdAt')
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean(),
  ]);

  const byFingerprint = new Map();
  for (const row of fingerprintRows) {
    const key = `${row.contentType}:${row.fingerprint}`;
    if (!byFingerprint.has(key)) {
      byFingerprint.set(key, []);
    }
    byFingerprint.get(key).push(row);
  }

  let exactDuplicateCount = 0;
  const duplicateGroups = [];
  for (const [, rows] of byFingerprint) {
    if (rows.length > 1) {
      exactDuplicateCount += rows.length - 1;
      duplicateGroups.push({
        contentType: rows[0].contentType,
        fingerprint: rows[0].fingerprint,
        count: rows.length,
        sample: String(rows[0].originalText || '').slice(0, 120),
        generationIds: rows.map((r) => r.generationId).filter(Boolean),
      });
    }
  }

  duplicateGroups.sort((a, b) => b.count - a.count);

  const questionRows = fingerprintRows.filter((r) => r.contentType === 'question');
  let similarPairs = 0;
  let comparisons = 0;
  const threshold = getQuestionSimilarityThreshold();
  const sampleSize = Math.min(questionRows.length, 400);
  for (let i = 0; i < sampleSize; i += 1) {
    for (let j = i + 1; j < Math.min(i + 20, sampleSize); j += 1) {
      comparisons += 1;
      const sim = wordJaccardSimilarity(questionRows[i].originalText, questionRows[j].originalText);
      if (sim >= threshold) similarPairs += 1;
    }
  }

  const questionDuplicationPct =
    comparisons > 0 ? Math.round((similarPairs / comparisons) * 1000) / 10 : 0;

  const topicSaturationRaw = await getTopicSaturationAnalytics(scope);
  const thresholds = getSaturationThresholds();

  const duplicatePreventionSuccessRate =
    totalRecords > 0
      ? Math.round(((totalRecords - exactDuplicateCount) / totalRecords) * 1000) / 10
      : 100;

  return {
    totalRecords,
    totalFingerprints,
    exactDuplicateCount,
    duplicateGroupCount: duplicateGroups.length,
    topDuplicates: duplicateGroups.slice(0, 20),
    questionDuplicationPct,
    questionSimilarityThreshold: threshold,
    duplicatePreventionSuccessRate,
    topicSaturation: topicSaturationRaw.map((row) => ({
      ...row,
      saturationLevel: classifySaturationLevel(row.recordCount, thresholds),
    })),
  };
}

/**
 * Generation analytics for admin dashboard.
 */
export async function getGenerationAnalytics(scope = {}) {
  const match = { sourceType: { $ne: 'ai_pdf' } };
  if (scope.toolSlug) match.toolName = scope.toolSlug;
  if (scope.board) match.board = scope.board;

  const [totalGenerations, recent, totalFingerprints] = await Promise.all([
    AiToolGeneration.countDocuments(match),
    AiToolGeneration.find(match)
      .sort({ createdAt: -1 })
      .limit(500)
      .select('metadata createdAt toolName')
      .lean(),
    AiGenerationFingerprint.countDocuments({}),
  ]);

  let totalCostUsd = 0;
  let totalTokens = 0;
  let duplicatePreventionCount = 0;
  let validationFailures = 0;
  let sectionRepairs = 0;
  let batchOrchestratorRuns = 0;
  let randomRetrievalCount = 0;
  let geminiGenerationsAvoided = 0;
  let tokenSavingsEstimate = 0;

  const countedBatchIds = new Set();
  for (const rec of recent) {
    const md = rec.metadata || {};
    const batchId = String(md.batchId || '').trim();
    const skipBatchDuplicate = batchId && countedBatchIds.has(batchId);

    if (!skipBatchDuplicate) {
      let costUsd = 0;
      if (Number.isFinite(Number(md.cost?.batchTotalUsd)) && Number(md.cost.batchTotalUsd) > 0) {
        costUsd = Number(md.cost.batchTotalUsd);
      } else if (Number.isFinite(Number(md.cost?.usd))) {
        costUsd = Number(md.cost.usd);
      } else if (Number.isFinite(Number(md.cost?.totalUsd))) {
        costUsd = Number(md.cost.totalUsd);
      }
      if (costUsd > 0) totalCostUsd += costUsd;

      let tokenCount = 0;
      if (Number.isFinite(Number(md.tokenUsage?.batchTotals?.totalTokens))) {
        tokenCount = Number(md.tokenUsage.batchTotals.totalTokens);
      } else if (Number.isFinite(Number(md.tokenUsage?.totals?.totalTokens))) {
        tokenCount = Number(md.tokenUsage.totals.totalTokens);
      }
      if (tokenCount > 0) totalTokens += tokenCount;

      if (batchId) countedBatchIds.add(batchId);
    }
    if (Number(md.duplicatePreventionCount) > 0) {
      duplicatePreventionCount += Number(md.duplicatePreventionCount);
    }
    if (Number(md.validationFailureCount) > 0) {
      validationFailures += Number(md.validationFailureCount);
    }
    if (Number(md.sectionRepairCount) > 0) sectionRepairs += Number(md.sectionRepairCount);
    if (md.batchOrchestrator) batchOrchestratorRuns += 1;
    if (md.retrievalMode === 'random_pool') {
      randomRetrievalCount += 1;
      geminiGenerationsAvoided += Number(md.batchSize) || 25;
      tokenSavingsEstimate += Number(md.batchSize) || 25;
    }
  }

  const withFingerprints = await AiToolGeneration.countDocuments({
    ...match,
    'metadata.contentFingerprint': { $exists: true, $ne: '' },
  });

  const fingerprintCoveragePct =
    totalGenerations > 0
      ? Math.round((withFingerprints / totalGenerations) * 1000) / 10
      : 0;

  const duplicatePreventionSuccessRate =
    duplicatePreventionCount > 0
      ? Math.round((duplicatePreventionCount / Math.max(batchOrchestratorRuns, 1)) * 100) / 100
      : 100;

  return {
    totalGenerations,
    totalFingerprints,
    recentSampleSize: recent.length,
    estimatedCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    estimatedCostInr: Math.round(totalCostUsd * getUsdToInrRate() * 100) / 100,
    totalTokensLast500: totalTokens,
    recordsWithFingerprints: withFingerprints,
    fingerprintCoveragePct,
    duplicatePreventionCount,
    duplicatePreventionSuccessRate,
    validationFailures,
    sectionRepairs,
    batchOrchestratorRuns,
    randomRetrievalCount,
    geminiGenerationsAvoided,
    tokenSavingsEstimate,
    uniqueContentGenerated: withFingerprints,
    averageQualityScore:
      withFingerprints > 0
        ? Math.round((withFingerprints / Math.max(totalGenerations, 1)) * 100)
        : 0,
  };
}

export async function getTopicSaturationReport(scope = {}) {
  if (scope.toolSlug && scope.className && scope.subject) {
    return computeTopicSaturation(scope);
  }
  return getTopicSaturationAnalytics(scope);
}
