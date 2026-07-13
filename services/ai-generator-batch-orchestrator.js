import {
  beginTokenUsageSession,

  endTokenUsageSession,

  isTransientGeminiError,

} from './gemini-service.js';

import { generateStructuredContentForAiGenerator, finalizeWorksheetStructuredContent, repairWorksheetBatchDuplicates, ensureWorksheetSectionsComplete, rebuildWorksheetBatchVariant, resolveWorksheetTopicLabel } from './ai-content-engine-service.js';

import { buildHistoricalGenerationContext } from './ai-generator-historical-index.js';

import {
  validateRecordUniqueness,
  collectQuestionTextsFromStructured,
  dedupeIntraRecordQuestions,
  renumberIntraRecordQuestions,
} from './ai-generator-uniqueness-engine.js';

import { extractTitleFromStructured } from './ai-generator-content-extractor.js';

import { computeScaffoldDensity, SCAFFOLD_DENSITY_CEILING } from './ai-generator-quality-gate.js';
import { generateSixSectionContent } from './six-section-generator.js';
import { isSixSectionV2Enabled, buildV2VariantHint } from '../prompts/v2/assemble.js';
import { isV2SupportedTool, v2ToolFamily } from '../prompts/v2/tool-packs.js';

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

import { getBatchSlotMaxAttempts, isAiGeneratorCostSaverEnabled, isAiGeneratorGreatQualityEnabled, shouldEnforceBatchUniquenessRetries, shouldUseFlashForAiGeneratorRun } from '../utils/ai-generator-batch-config.js';
import { resolveQualityTierSettings, getQualityTierBatchConcurrency } from '../utils/ai-generator-quality-tier.js';
import { resolveLanguageSubjectForGeneration } from '../utils/story-passage-subject.js';

import AiToolGeneration from '../models/AiToolGeneration.js';

import mongoose from 'mongoose';



const DEFAULT_BATCH_SIZE = 25;

const DEFAULT_CONCURRENCY = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}



function formatSlotFailureMessage(variantIndex, error) {
  const msg = String(error || 'Unknown error').trim();
  if (isTransientGeminiError({ message: msg })) {
    return `Variant ${variantIndex}: Gemini is temporarily overloaded (503). Wait 1–2 minutes and click Generate again.`;
  }
  if (msg.length > 420) {
    return `Variant ${variantIndex}: ${msg.slice(0, 420)}…`;
  }
  return `Variant ${variantIndex}: ${msg}`;
}



function getBatchSize(override) {

  const n = Number(override ?? process.env.AI_GENERATOR_BATCH_SIZE);

  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : DEFAULT_BATCH_SIZE;

}



function getMaxAttemptsPerSlot(qualityTierSettings) {
  const tierMax = qualityTierSettings?.maxSlotAttempts;
  if (Number.isFinite(tierMax) && tierMax > 0) {
    return Math.min(5, tierMax);
  }
  return getBatchSlotMaxAttempts();
}



function getConcurrency(qualityTierSettings, batchSize, toolSlug = '') {
  const base = getQualityTierBatchConcurrency(qualityTierSettings, batchSize);
  // Parallel slots read a stale shared batchQuestionTexts/batchTitles before peers push,
  // defeating cross-slot dedup (question tools fail 100%; concept-mastery saves duplicates).
  if (qualityTierSettings?.enforceBatchUniqueness && isCrossSlotUniquenessTool(toolSlug)) {
    return 1;
  }
  return base;
}

function isQuestionUniquenessTool(toolSlug) {
  return [
    'worksheet-mcq-generator',
    'homework-creator',
    'mock-test-builder',
    'exam-question-paper-generator',
    'smart-qa-practice-generator',
    'quick-assignment-builder',
  ].includes(String(toolSlug || '').trim());
}

/** Tools that dedup question/body content across batch slots and must run serially under uniqueness. */
function isCrossSlotUniquenessTool(toolSlug) {
  const slug = String(toolSlug || '').trim();
  return isQuestionUniquenessTool(slug) || slug === 'concept-mastery-helper';
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

/** Pull the DISTINCTIVE content out of a V2 six-section structuredContent — works for
 *  ALL families (questions, activity steps, concept explanations, card fronts, …), so
 *  cross-slot dedup applies to every tool, not just question papers. */
function extractV2QuestionTexts(sc) {
  const core = (sc && sc.core) || {};
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.length >= 15) out.push(t);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        // for question objects, prefer the question text; else walk the whole item
        if (item && typeof item === 'object' && typeof item.question === 'string') {
          const t = item.question.trim();
          if (t.length >= 8) out.push(t);
        } else {
          walk(item);
        }
      }
    } else if (v && typeof v === 'object') {
      for (const val of Object.values(v)) walk(val);
    }
  };
  walk(core);
  return out;
}

/** Recent already-generated question texts for this exact scope (cross-batch dedup). */
async function collectPriorV2Questions(scope, limit = 12) {
  try {
    const docs = await AiToolGeneration.find({
      toolName: scope.toolSlug,
      board: scope.board,
      classLabel: scope.className,
      subject: scope.subject,
      subtopic: scope.subtopic,
      'metadata.schemaVersion': 'asli-v2-six-section',
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('metadata.structuredContent')
      .lean();
    const out = [];
    for (const d of docs) out.push(...extractV2QuestionTexts(d?.metadata?.structuredContent));
    return out;
  } catch {
    return [];
  }
}

export async function generateBatchAndSave(params, opts = {}) {

  const batchSize = getBatchSize(opts.batchSize ?? params.batchSize);

  const toolSlug = String(params.toolSlug || '').trim();

  const board = lockBoardKey(String(params.board || '').trim());

  const className = resolveClassLabelForAiToolStorage(
    String(params.className || params.classLabel || '').trim(),
    board,
  );

  const subjectName = resolveLanguageSubjectForGeneration(
    String(params.subjectName || params.subject || '').trim(),
    String(params.bookSubject || '').trim(),
  );

  const topicName = String(params.topicName || params.topic || '').trim();

  const subtopicName = String(params.subtopicName || params.subTopic || params.subtopic || '').trim();

  // Multi-subtopic (combined paper): request may send an array of subtopics.
  const subTopicList = (
    Array.isArray(params.subTopics)
      ? params.subTopics
      : Array.isArray(params.subtopicNames)
        ? params.subtopicNames
        : []
  )
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const combinedSubtopicLabel =
    subTopicList.length > 1 ? subTopicList.join(', ') : subtopicName;

  const toolDisplayName = String(params.toolName || params.toolDisplayName || toolSlug).trim();
  const qualityTierSettings = resolveQualityTierSettings(
    params.qualityTier || params.extraParams?.qualityTier,
    { batchSize },
  );
  console.log(
    `[AI Generator batch] Starting ${batchSize} record(s) for ${toolSlug} | qualityTier=${qualityTierSettings.tier} primary=${qualityTierSettings.primaryGeminiModel} flashLiteOnly=${qualityTierSettings.flashLiteOnly} overflow=${qualityTierSettings.modelOverflow}`,
  );
  const batchStartedAt = Date.now();

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

    const historicalQuestionTexts = Array.isArray(historical.questionSnippets)
      ? [...historical.questionSnippets]
      : [];
    const historicalTitles = Array.isArray(historical.titles) ? [...historical.titles] : [];



    const batchTitles = [];

    const batchQuestionTexts = [];

    const savedRecords = [];

    // Cross-slot / cross-batch dedup: seed with recent questions already generated
    // for this exact subtopic; each saved slot appends its questions so later slots
    // avoid them. Passed to the V2 generator as avoidQuestions.
    const usedV2Questions = isV2SupportedTool(toolSlug) ? await collectPriorV2Questions(scope) : [];

    const failures = [];

    let tokenUsage = null;

    let cost = null;

    let duplicatePreventionCount = 0;



    beginTokenUsageSession('ai-generator-batch');

    try {

      const slots = Array.from({ length: batchSize }, (_, i) => historical.existingCount + i + 1);



      const slotResults = await runPool(slots, getConcurrency(qualityTierSettings, batchSize, toolSlug), async (variantIndex) => {

        const maxAttempts = getMaxAttemptsPerSlot(qualityTierSettings);

        let lastError = 'Unknown error';
        const variantStartedAt = Date.now();
        console.log(
          `[AI Generator batch] Variant ${variantIndex}/${batchSize} started (${toolSlug})`,
        );

        const staggerMs = Number(qualityTierSettings.slotStaggerMs) || 0;
        if (variantIndex > 1 && staggerMs > 0) {
          await sleep(staggerMs + Math.floor(Math.random() * 200));
        }



        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {

          try {

            // V2 six-section pilot: when enabled + supported, generate the minimized
            // 6-section content and save it directly (renders in SixSectionViewer).
            // Bypasses the legacy pipeline entirely; quality comes from the Pro model.
            if (isSixSectionV2Enabled() && isV2SupportedTool(toolSlug)) {
              const v2VariantHint = buildV2VariantHint({
                variantIndex,
                batchSize,
                family: v2ToolFamily(toolSlug),
                angle: getAiGeneratorVariantAngle(variantIndex, subjectName),
                scenario: getAiGeneratorVariantScenario(variantIndex, subjectName),
                seed: `${Date.now()}-v${variantIndex}-a${attempt}`,
              });
              const v2 = await generateSixSectionContent(
                toolSlug,
                {
                  board,
                  classLabel: className,
                  subject: subjectName,
                  topic: topicName,
                  subTopic: subtopicName,
                  ...(subTopicList.length > 1 ? { subTopics: subTopicList } : {}),
                },
                {
                  primaryModel: qualityTierSettings.primaryGeminiModel,
                  variantHint: v2VariantHint,
                  temperature: Math.min(0.9, 0.6 + (variantIndex - 1) * 0.06),
                  avoidQuestions: usedV2Questions.slice(0, 40),
                },
              );
              if (!v2.ok) {
                lastError = v2.error || 'V2 six-section generation failed';
                if (attempt < maxAttempts) continue;
                throw new Error(lastError);
              }
              // record this slot's questions so later slots avoid repeating them
              usedV2Questions.push(...extractV2QuestionTexts(v2.structuredContent));
              const uid = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';
              const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;
              const coreTitle =
                v2.structuredContent?.core?.title || v2.structuredContent?.core?.worksheetTitle || 'Six-section content';
              const rec = await AiToolGeneration.create({
                toolName: toolSlug,
                toolDisplayName,
                sourceType: 'ai_generator',
                board,
                classLabel: className,
                subject: subjectName,
                topic: topicName,
                subtopic: combinedSubtopicLabel,
                section: '',
                content: coreTitle,
                generatedContent: coreTitle,
                generatedBy: uid,
                status: 'active',
                reviewStatus: params.reviewStatus || 'approved',
                metadata: {
                  board,
                  createdByName: opts.reqUser?.name || 'Super Admin',
                  createdByRole: 'super-admin',
                  contentType: 'structured',
                  ...(subTopicList.length > 1 ? { subTopics: subTopicList } : {}),
                  structuredContent: v2.structuredContent,
                  formatSource: 'asli-v2-six-section',
                  schemaVersion: 'asli-v2-six-section',
                  generationVariant: variantIndex,
                  batchSize,
                  batchOrchestrator: true,
                },
                ...(teacherId ? { teacherId } : {}),
              });
              console.log(`[AI Generator batch] Variant ${variantIndex}/${batchSize} saved (V2 six-section)`);
              return { ok: true, variantIndex, record: rec.toObject() };
            }

            const extraParams = {

              ...(params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {}),

              generationVariant: variantIndex,

              variantIndex,

              variantAngle: getAiGeneratorVariantAngle(variantIndex, subjectName),

              variantScenario: getAiGeneratorVariantScenario(variantIndex, subjectName),

              batchSize,
              qualityTier: qualityTierSettings.tier,

              uniqueSeed: `${Date.now()}-v${variantIndex}-a${attempt}-${Math.random().toString(36).slice(2, 10)}`,

              strictUniqueness: qualityTierSettings.enforceBatchUniqueness && strategy.strictUniqueness,

              avoidQuestionTexts: [...batchQuestionTexts],

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

              qualityTier: qualityTierSettings.tier,

              historicalPromptBlock: qualityTierSettings.useHistoricalPrompt ? historical.promptBlock : '',

              upgradeToFlash: shouldUseFlashForAiGeneratorRun({
                upgradeRequested:
                  attempt > 1 ||
                  isAiGeneratorGreatQualityEnabled() ||
                  strategy.mode === 'strict_generate',
                recoveryPass: attempt > 1,
              }),

              recoveryPass: attempt > 1,

            });



            let structuredContent = generated.structuredContent;
            const worksheetBatch = toolSlug === 'worksheet-mcq-generator';
            const worksheetTopic = resolveWorksheetTopicLabel({
              subTopic: subtopicName,
              subtopic: subtopicName,
              topic: topicName,
              subject: subjectName,
              generationVariant: variantIndex,
            });
            const worksheetMeta = {
              subject: subjectName,
              topic: worksheetTopic,
              subTopic: worksheetTopic,
              subtopic: worksheetTopic,
              board,
              className,
              generationVariant: variantIndex,
              variantAngle: extraParams.variantAngle,
              variantScenario: extraParams.variantScenario,
              batchOrchestrator: true,
              strictValidation: false,
              uniqueSeed: extraParams.uniqueSeed,
              avoidQuestionTexts: batchQuestionTexts,
              greatQuality: isAiGeneratorGreatQualityEnabled(),
            };

            if (worksheetBatch && structuredContent && typeof structuredContent === 'object') {
              structuredContent = finalizeWorksheetStructuredContent(structuredContent, worksheetMeta);
              structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
              structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
              if (batchQuestionTexts.length > 0) {
                structuredContent = rebuildWorksheetBatchVariant(structuredContent, {
                  ...worksheetMeta,
                  generationVariant: variantIndex,
                  uniqueSeed: `${extraParams.uniqueSeed}-proactive-v${variantIndex}`,
                  avoidQuestionTexts: batchQuestionTexts,
                });
                structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
                structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
              }
              structuredContent = ensureWorksheetSectionsComplete(structuredContent, worksheetMeta);
              generated.structuredContent = structuredContent;
            }

            if (structuredContent && typeof structuredContent === 'object') {
              structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
              structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
              generated.structuredContent = structuredContent;
            }

            if (qualityTierSettings.enforceBatchUniqueness) {
              let uniqueness = validateRecordUniqueness(toolSlug, structuredContent, {
                batchTitles,
                batchTexts: batchQuestionTexts,
                historicalTexts: historicalQuestionTexts,
                historicalTitles,
              });

              if (!uniqueness.valid && worksheetBatch) {
                for (let dupPass = 0; !uniqueness.valid && dupPass < 10; dupPass += 1) {
                  const regenSeed = variantIndex + attempt * 10000 + dupPass * 7919;
                  const baseRecoveryMeta = {
                    ...worksheetMeta,
                    generationVariant: regenSeed,
                    variantAngle: getAiGeneratorVariantAngle(regenSeed, subjectName),
                    variantScenario: getAiGeneratorVariantScenario(regenSeed, subjectName),
                    uniqueSeed: `${extraParams.uniqueSeed || ''}-dup${attempt}-p${dupPass}`,
                  };

                  if (dupPass === 0 && batchQuestionTexts.length === 0) {
                    // Repair ONLY questions that clash with OTHER records (batch + historical).
                    // The record's own questions must NOT go in `avoid`: repairWorksheetBatchDuplicates
                    // matches each question against that list, so including self would overwrite every
                    // real LLM question with generic scaffold. Intra-record dups are caught by its
                    // internal usedTexts pass regardless.
                    const crossRecordAvoid = [...batchQuestionTexts, ...historicalQuestionTexts];
                    if (crossRecordAvoid.length) {
                      structuredContent = repairWorksheetBatchDuplicates(structuredContent, {
                        ...baseRecoveryMeta,
                        avoidQuestionTexts: crossRecordAvoid,
                      });
                    }
                  } else {
                    structuredContent = rebuildWorksheetBatchVariant(structuredContent, {
                      ...baseRecoveryMeta,
                      avoidQuestionTexts: [
                        ...batchQuestionTexts,
                        ...collectQuestionTextsFromStructured(structuredContent, toolSlug),
                      ],
                    });
                  }
                  structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
                  structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
                  uniqueness = validateRecordUniqueness(toolSlug, structuredContent, {
                    batchTitles,
                    batchTexts: batchQuestionTexts,
                    historicalTexts: historicalQuestionTexts,
                    historicalTitles,
                  });
                }
                generated.structuredContent = structuredContent;
              }

              // Never fail a Premium/Balanced slot solely for batch uniqueness after all retries —
              // soft-pass when the record has real questions (same policy as book-generator worksheets).
              if (!uniqueness.valid && attempt >= maxAttempts) {
                const qCount = collectQuestionTextsFromStructured(structuredContent, toolSlug).length;
                if (qCount >= 1) {
                  console.warn(
                    `[AI Generator batch] Variant ${variantIndex}: uniqueness soft-pass (${qCount} questions). ${uniqueness.errors.slice(0, 2).join('; ')}`,
                  );
                  uniqueness = { valid: true, errors: [], duplicates: [] };
                }
              }

              if (!uniqueness.valid) {
                lastError = uniqueness.errors.join('; ');
                duplicatePreventionCount += 1;
                if (attempt < maxAttempts) continue;
                throw new Error(`Duplicate content: ${lastError}`);
              }
            }



            // NEVER persist scaffold-heavy question content. Retry the slot, then fail it —
            // a failed slot ("3/5 saved") is acceptable; saving filler ("5/5 junk") is not.
            if (
              isQuestionUniquenessTool(toolSlug) &&
              generated.structuredContent &&
              typeof generated.structuredContent === 'object'
            ) {
              const scaffoldStats = computeScaffoldDensity(toolSlug, generated.structuredContent);
              if (scaffoldStats.total >= 3 && scaffoldStats.density > SCAFFOLD_DENSITY_CEILING) {
                lastError = `Scaffold-heavy after batch repair (${Math.round(scaffoldStats.density * 100)}% filler questions)`;
                duplicatePreventionCount += 1;
                console.warn(`[AI Generator batch] Variant ${variantIndex}: ${lastError} — not saving.`);
                if (attempt < maxAttempts) continue;
                throw new Error(lastError);
              }
            }

            const title = extractTitleFromStructured(generated.structuredContent);

            if (title) batchTitles.push(title);

            batchQuestionTexts.push(...collectQuestionTextsFromStructured(generated.structuredContent, toolSlug));



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



            // Record is already persisted. Post-insert enrichment (fingerprints + updateOne) must NOT
            // throw out of this try — the catch below retries the attempt and AiToolGeneration.create
            // would run a second time, leaving a duplicate row plus an orphaned un-fingerprinted one.
            // Log and continue with the saved record instead.
            let fingerprintMeta = {};

            try {
              fingerprintMeta = await persistGenerationFingerprints(
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
            } catch (fpErr) {
              console.warn(
                `[AI Generator batch] Variant ${variantIndex}: record ${record._id} saved but fingerprint enrichment failed: ${fpErr?.message || fpErr}`,
              );
            }

            const lean = record.toObject();

            lean.metadata = { ...lean.metadata, ...fingerprintMeta };

            console.log(
              `[AI Generator batch] Variant ${variantIndex}/${batchSize} saved in ${Date.now() - variantStartedAt}ms`,
            );
            return { ok: true, variantIndex, record: lean };

          } catch (err) {

            lastError = err?.message || String(err);
            console.warn(
              `[AI Generator batch] Variant ${variantIndex} attempt ${attempt}/${maxAttempts} (${qualityTierSettings.tier}): ${lastError}`,
            );
            if (isTransientGeminiError(err) && attempt < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, Math.min(12_000, 2500 * attempt)));
              continue;
            }

          }

        }



        console.warn(
          `[AI Generator batch] Variant ${variantIndex}/${batchSize} failed after ${Date.now() - variantStartedAt}ms: ${lastError}`,
        );
        return { ok: false, variantIndex, error: lastError };

      });



      for (const result of slotResults.sort((a, b) => a.variantIndex - b.variantIndex)) {

        if (result.ok) {

          savedRecords.push(result.record);

        } else {

          console.warn(
            `[AI Generator batch] Variant ${result.variantIndex} failed (${qualityTierSettings.tier}): ${result.error}`,
          );

          failures.push(formatSlotFailureMessage(result.variantIndex, result.error));

        }

      }

    } finally {

      tokenUsage = endTokenUsageSession();

      cost = computeGeminiCostFromTokenUsage(tokenUsage);
      if (cost && qualityTierSettings.tier === 'premium') {
        const actual = String(cost.model || '');
        const target = String(qualityTierSettings.primaryGeminiModel || '');
        if (target && !actual.toLowerCase().includes('pro')) {
          console.warn(
            `[AI Generator batch] Premium target was ${target} but dominant call model was ${actual || 'unknown'} (overflow/fallback).`,
          );
        }
      }
      if (cost && savedRecords.length > 0) {
        const shareCount = savedRecords.length;
        cost = {
          ...cost,
          batchTotalUsd: cost.usd,
          batchTotalInr: cost.inr,
          perRecordUsd: Number((Number(cost.usd || 0) / shareCount).toFixed(6)),
          perRecordInr: Number((Number(cost.inr || 0) / shareCount).toFixed(4)),
          savedCount: shareCount,
        };
      }

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



    console.log(
      `[AI Generator batch] Finished in ${Date.now() - batchStartedAt}ms — saved ${savedRecords.length}/${batchSize} for ${toolSlug}`,
    );

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


