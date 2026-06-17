import {

  beginTokenUsageSession,

  endTokenUsageSession,

} from './gemini-service.js';

import { generateStructuredContentForAiGenerator } from './ai-content-engine-service.js';

import { buildHistoricalGenerationContext } from './ai-generator-historical-index.js';

import {
  validateRecordUniqueness,
  collectQuestionTextsFromStructured,
  dedupeIntraRecordQuestions,
  renumberIntraRecordQuestions,
} from './ai-generator-uniqueness-engine.js';

import { extractTitleFromStructured } from './ai-generator-content-extractor.js';

import { persistGenerationFingerprints } from './ai-generator-fingerprint-service.js';

import { computeGeminiCostFromTokenUsage } from '../utils/gemini-token-cost.js';
import { lockBoardKey, resolveClassLabelForAiToolStorage } from '../utils/board-label.js';

import {

  getAiGeneratorVariantAngle,

  getAiGeneratorVariantScenario,

} from '../constants/ai-generator-variant-angles.js';

import {

  acquireGenerationLock,

  releaseGenerationLock,

} from './ai-generator-lock-service.js';

import {

  resolveContentStrategy,

  executeRandomRetrievalBatch,

} from './ai-generator-content-strategy.js';

import { isAiGeneratorCostSaverEnabled, isAiGeneratorUltraEconomyEnabled, getBatchSlotMaxAttempts, shouldEnforceBatchUniquenessRetries } from '../utils/ai-generator-batch-config.js';

import AiToolGeneration from '../models/AiToolGeneration.js';

import mongoose from 'mongoose';



const DEFAULT_BATCH_SIZE = 25;

const DEFAULT_CONCURRENCY = 3;



function getBatchSize(override) {

  const n = Number(override ?? process.env.AI_GENERATOR_BATCH_SIZE);

  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : DEFAULT_BATCH_SIZE;

}



function getMaxAttemptsPerSlot() {
  return getBatchSlotMaxAttempts();
}



function getConcurrency() {

  const n = Number(process.env.AI_GENERATOR_BATCH_CONCURRENCY);

  return Number.isFinite(n) && n > 0 ? Math.min(n, 6) : DEFAULT_CONCURRENCY;

}



async function runPool(items, concurrency, worker) {

  const results = new Array(items.length);

  let nextIndex = 0;



  async function runOne() {

    while (nextIndex < items.length) {

      const idx = nextIndex;

      nextIndex += 1;

      results[idx] = await worker(items[idx], idx);

    }

  }



  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());

  await Promise.all(workers);

  return results;

}



function mapRandomRecord(rec) {

  return {

    ...rec,

    _id: rec._id,

    toolSlug: rec.toolName,

    className: rec.classLabel,

    subjectName: rec.subject,

    topicName: rec.topic,

    subtopicName: rec.subtopic,

    generatedContent: rec.generatedContent || rec.content,

    metadata: {

      ...(rec.metadata || {}),

      retrievalMode: 'random_pool',

    },

  };

}



/**

 * Generate or retrieve exactly `batchSize` unique records for one curriculum slot.

 * @param {Record<string, unknown>} params

 * @param {{ reqUser?: Record<string, unknown>, batchSize?: number }} opts

 */

export async function generateBatchAndSave(params, opts = {}) {

  const batchSize = getBatchSize(opts.batchSize ?? params.batchSize);

  const toolSlug = String(params.toolSlug || '').trim();

  const board = lockBoardKey(String(params.board || '').trim());

  const className = resolveClassLabelForAiToolStorage(
    String(params.className || params.classLabel || '').trim(),
    board,
  );

  const subjectName = String(params.subjectName || params.subject || '').trim();

  const topicName = String(params.topicName || params.topic || '').trim();

  const subtopicName = String(params.subtopicName || params.subTopic || params.subtopic || '').trim();

  const toolDisplayName = String(params.toolName || params.toolDisplayName || toolSlug).trim();

  const forceGenerate =

    params.forceGenerate === true ||

    params.forceGenerateNew === true ||

    params.extraParams?.forceGenerate === true;



  const scope = {

    toolSlug,

    board,

    className,

    subject: subjectName,

    topic: topicName,

    subtopic: subtopicName,

  };



  const lockedBy = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';

  const lock = await acquireGenerationLock(scope, lockedBy, {
    forceUnlock: params.forceUnlock === true,
  });

  if (!lock.acquired) {

    return {

      success: false,

      locked: true,

      message: lock.message || 'Generation already in progress.',

      batchSize,

      savedCount: 0,

      failedCount: batchSize,

      records: [],

      failures: [lock.message || 'Generation already in progress.'],

    };

  }



  try {

    const strategy = await resolveContentStrategy(scope, { forceGenerate, batchSize });



    if (strategy.action === 'random_retrieval') {

      const randomResult = await executeRandomRetrievalBatch(scope, { batchSize });

      return {

        ...randomResult,

        success: randomResult.savedCount === batchSize,

        batchSize,

        strategy,

        saturation: strategy.saturation,

        mode: 'random_retrieval',

        geminiGenerationsAvoided: randomResult.geminiGenerationsAvoided,

        tokenSavingsEstimate: randomResult.tokenSavingsEstimate,

        records: randomResult.records.map(mapRandomRecord),

        message: `Retrieved ${randomResult.savedCount} random unique records from pool of ${randomResult.totalPoolSize} (no Gemini tokens used).`,

      };

    }



    const historical = await buildHistoricalGenerationContext(scope);

    const historicalQuestionTexts = [...historical.questionSnippets];

    const historicalTitles = [...historical.titles];



    const batchTitles = [];

    const batchQuestionTexts = [];

    const savedRecords = [];

    const failures = [];

    let tokenUsage = null;

    let cost = null;

    let duplicatePreventionCount = 0;



    beginTokenUsageSession('ai-generator-batch');

    try {

      const slots = Array.from({ length: batchSize }, (_, i) => historical.existingCount + i + 1);



      const slotResults = await runPool(slots, getConcurrency(), async (variantIndex) => {

        const maxAttempts = getMaxAttemptsPerSlot();

        let lastError = 'Unknown error';



        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {

          try {

            const extraParams = {

              ...(params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {}),

              generationVariant: variantIndex,

              variantIndex,

              variantAngle: getAiGeneratorVariantAngle(variantIndex),

              variantScenario: getAiGeneratorVariantScenario(variantIndex),

              batchSize,

              uniqueSeed: `${Date.now()}-v${variantIndex}-a${attempt}-${Math.random().toString(36).slice(2, 10)}`,

              strictUniqueness: shouldEnforceBatchUniquenessRetries() && strategy.strictUniqueness,

              ...(attempt > 1 ? { recoveryPass: true } : {}),

            };



            const generated = await generateStructuredContentForAiGenerator(toolSlug, {

              board,

              classLabel: className,

              gradeLevel: className,

              subject: subjectName,

              topic: topicName || 'General',

              subTopic: subtopicName,

              extraParams,

              historicalPromptBlock: historical.promptBlock,

              upgradeToFlash:
                !isAiGeneratorCostSaverEnabled() &&
                !isAiGeneratorUltraEconomyEnabled() &&
                (attempt > 2 || strategy.mode === 'strict_generate'),

              recoveryPass: attempt > 1,

            });



            let structuredContent = generated.structuredContent;
            if (structuredContent && typeof structuredContent === 'object') {
              structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
              structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
              generated.structuredContent = structuredContent;
            }

            if (shouldEnforceBatchUniquenessRetries()) {
              const uniqueness = validateRecordUniqueness(toolSlug, structuredContent, {
                batchTitles,
                batchTexts: batchQuestionTexts,
                historicalTexts: historicalQuestionTexts,
                historicalTitles,
              });

              if (!uniqueness.valid) {
                lastError = uniqueness.errors.join('; ');
                duplicatePreventionCount += 1;
                if (attempt < maxAttempts) continue;
              }
            }



            const title = extractTitleFromStructured(generated.structuredContent);

            if (title) batchTitles.push(title);

            batchQuestionTexts.push(...collectQuestionTextsFromStructured(generated.structuredContent));



            const uid = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';

            const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;



            const record = await AiToolGeneration.create({

              toolName: toolSlug,

              toolDisplayName,

              sourceType: 'ai_generator',

              board,

              classLabel: className,

              subject: subjectName,

              topic: topicName,

              subtopic: subtopicName,

              section: '',

              content: generated.generatedContent,

              generatedContent: generated.generatedContent,

              generatedBy: uid,

              status: 'active',

              reviewStatus: params.reviewStatus || 'approved',

              metadata: {

                board,

                createdByName: opts.reqUser?.name || 'Super Admin',

                createdByRole: 'super-admin',

                extraParams,

                contentType: generated.contentType,

                structuredContent: generated.structuredContent,

                formatSource: 'aiToolTemplates',

                generationVariant: variantIndex,

                batchSize,

                batchOrchestrator: true,

                contentStrategy: strategy.mode,

                topicSaturationScore: strategy.saturation.topicSaturationScore,

                saturationLevel: strategy.saturation.saturationLevel,

                sectionRepairCount: generated.sectionRepairCount || 0,

                duplicatePreventionCount,

              },

              ...(teacherId ? { teacherId } : {}),

            });



            const fingerprintMeta = await persistGenerationFingerprints(

              toolSlug,

              generated.structuredContent,

              scope,

              record._id,

            );



            await AiToolGeneration.updateOne(

              { _id: record._id },

              {

                $set: {

                  'metadata.contentFingerprint': fingerprintMeta.contentFingerprint,

                  'metadata.questionFingerprints': fingerprintMeta.questionFingerprints,

                  'metadata.objectiveFingerprints': fingerprintMeta.objectiveFingerprints,

                  'metadata.activityFingerprints': fingerprintMeta.activityFingerprints,

                },

              },

            );



            const lean = record.toObject();

            lean.metadata = { ...lean.metadata, ...fingerprintMeta };

            return { ok: true, variantIndex, record: lean };

          } catch (err) {

            lastError = err?.message || String(err);

          }

        }



        return { ok: false, variantIndex, error: lastError };

      });



      for (const result of slotResults.sort((a, b) => a.variantIndex - b.variantIndex)) {

        if (result.ok) {

          savedRecords.push(result.record);

        } else {

          failures.push(`Variant ${result.variantIndex}: ${result.error}`);

        }

      }

    } finally {

      tokenUsage = endTokenUsageSession();

      cost = computeGeminiCostFromTokenUsage(tokenUsage);

    }

    if (savedRecords.length > 0 && cost && tokenUsage) {
      const shareCount = savedRecords.length;
      const costShare = {
        usd: Number((Number(cost.usd || 0) / shareCount).toFixed(6)),
        inr: Number((Number(cost.inr || 0) / shareCount).toFixed(4)),
        exchangeRateInr: cost.exchangeRateInr,
        model: cost.model,
        pricingNote: cost.pricingNote,
        batchTotalUsd: cost.usd,
        batchTotalInr: cost.inr,
        batchSize: shareCount,
      };
      const totals = tokenUsage.totals || {};
      const tokenShare = {
        totals: {
          promptTokens: Math.round(Number(totals.promptTokens || 0) / shareCount),
          completionTokens: Math.round(Number(totals.completionTokens || 0) / shareCount),
          totalTokens: Math.round(Number(totals.totalTokens || 0) / shareCount),
          callCount: Math.max(1, Math.round(Number(totals.callCount || 0) / shareCount)),
        },
        batchTotals: totals,
        batchCallCount: totals.callCount || 0,
      };
      const batchId = new mongoose.Types.ObjectId().toString();
      const ids = savedRecords.map((r) => r._id).filter(Boolean);
      if (ids.length) {
        await AiToolGeneration.updateMany(
          { _id: { $in: ids } },
          {
            $set: {
              'metadata.cost': costShare,
              'metadata.tokenUsage': tokenShare,
              'metadata.batchId': batchId,
              'metadata.batchOrchestrator': true,
            },
          },
        );
        for (const record of savedRecords) {
          record.metadata = {
            ...(record.metadata || {}),
            cost: costShare,
            tokenUsage: tokenShare,
            batchId,
            batchOrchestrator: true,
          };
        }
      }
    }



    return {

      success: savedRecords.length === batchSize,

      batchSize,

      savedCount: savedRecords.length,

      failedCount: batchSize - savedRecords.length,

      records: savedRecords,

      failures,

      existingCountBefore: historical.existingCount,

      tokenUsage,

      cost,

      strategy,

      saturation: strategy.saturation,

      mode: strategy.mode,

      duplicatePreventionCount,

      geminiGenerationsAvoided: 0,

    };

  } finally {

    await releaseGenerationLock(scope, lock.lockToken);

  }

}


