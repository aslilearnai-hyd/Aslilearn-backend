import mongoose from 'mongoose';
import Book from '../models/Book.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { beginTokenUsageSession, endTokenUsageSession, getTokenUsageSession, isTransientGeminiError } from './gemini-service.js';
import {
  generateStructuredContentForAiGenerator,
  finalizeExamPaperStructuredContent,
  finalizeMockTestStructuredContent,
  finalizeHomeworkStructuredContent,
  finalizeWorksheetStructuredContent,
  repairWorksheetBatchDuplicates,
  ensureWorksheetSectionsComplete,
  rebuildWorksheetBatchVariant,
  rebuildWorksheetBatchVariantSmart,
  resolveWorksheetTopicLabel,
  finalizePracticeQaStructuredContent,
  finalizeQuickAssignmentStructuredContent,
  finalizeConceptMasteryStructuredContent,
  finalizeConceptBreakdownStructuredContent,
  finalizeChapterSummaryStructuredContent,
  finalizeKeyPointsStructuredContent,
  finalizeActivityStructuredContent,
  finalizeDailyClassPlanStructuredContent,
  finalizeStoryPassageStructuredContent,
  finalizeFlashcardDeckStructuredContent,
  normalizeLessonPlannerStructuredContent,
  normalizeStudyGuideStructuredContent,
  normalizeReadingPracticeStructuredContent,
} from './ai-content-engine-service.js';
import { buildBookHistoricalGenerationContext } from './book-generator-historical.js';
import {
  collectQuestionTextsFromStructured,
  dedupeIntraRecordQuestions,
  renumberIntraRecordQuestions,
  validateRecordUniqueness,
} from './ai-generator-uniqueness-engine.js';
import { extractTitleFromStructured } from './ai-generator-content-extractor.js';
import { persistGenerationFingerprints } from './ai-generator-fingerprint-service.js';
import { computeGeminiCostFromTokenUsage } from '../utils/gemini-token-cost.js';
import {
  getAiGeneratorVariantAngle,
  getAiGeneratorVariantScenario,
} from '../constants/ai-generator-variant-angles.js';
import { resolveLanguageSubjectForGeneration } from '../utils/story-passage-subject.js';
import { acquireGenerationLock, forceReleaseGenerationLock, releaseGenerationLock } from './ai-generator-lock-service.js';
import {
  getBookBatchSlotMaxAttempts,
  shouldUseFlashForAiGeneratorRun,
} from '../utils/ai-generator-batch-config.js';
import { retrieveBookContextForGeneration, buildBookContextTextForVariant } from './book-rag-service.js';
import {
  isBookBasedToolSlug,
  getBookBasedToolDisplayName,
  BOOK_GENERATOR_DEFAULT_BATCH_SIZE,
  BOOK_GENERATOR_MAX_INR,
} from '../config/bookBasedTools.js';
import { canonicalBoardLabel, lockBoardKey, normalizeClassLabelForLock, resolveClassLabelForAiToolStorage } from '../utils/board-label.js';
import { withMongoRetry, isMongoTransientError } from '../utils/mongo-retry.js';
import { resolveQualityTierSettings, getQualityTierBatchConcurrency } from '../utils/ai-generator-quality-tier.js';
import { isAiGeneratorGreatQualityEnabled } from '../utils/ai-generator-batch-config.js';
import { formatStructuredToolOutput } from '../config/aiToolTemplates.js';
import { stripMarkdownSyntax, deepStripMarkdownValues } from '../utils/strip-markdown-syntax.js';

function getBookGeneratorConcurrency(qualityTierSettings, batchSize) {
  const env = Number(process.env.BOOK_GENERATOR_CONCURRENCY || process.env.AI_GENERATOR_BATCH_CONCURRENCY);
  if (Number.isFinite(env) && env > 0) return Math.min(env, 4);
  return getQualityTierBatchConcurrency(qualityTierSettings, batchSize);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finalizeBookStructuredContent(toolSlug, structured, meta) {
  const slug = String(toolSlug || '').trim();
  const source = structured && typeof structured === 'object' ? structured : {};
  switch (slug) {
    case 'exam-question-paper-generator':
      return finalizeExamPaperStructuredContent(source, meta);
    case 'mock-test-builder':
      return finalizeMockTestStructuredContent(source, meta);
    case 'homework-creator':
      return finalizeHomeworkStructuredContent(source, meta);
    case 'worksheet-mcq-generator':
      return finalizeWorksheetStructuredContent(source, meta);
    case 'smart-qa-practice-generator':
      return finalizePracticeQaStructuredContent(source, meta);
    case 'quick-assignment-builder':
      return finalizeQuickAssignmentStructuredContent(source, meta);
    case 'concept-mastery-helper':
      return finalizeConceptMasteryStructuredContent(source, meta);
    case 'concept-breakdown-explainer':
      return finalizeConceptBreakdownStructuredContent(source, meta);
    case 'chapter-summary-creator':
      return finalizeChapterSummaryStructuredContent(source, meta);
    case 'key-points-formula-extractor':
      return finalizeKeyPointsStructuredContent(source, meta);
    case 'smart-study-guide-generator':
    case 'short-notes-summaries-maker':
      return normalizeStudyGuideStructuredContent(source, meta);
    case 'activity-project-generator':
    case 'project-idea-lab':
      return finalizeActivityStructuredContent(source, meta, slug);
    case 'daily-class-plan-maker':
      return finalizeDailyClassPlanStructuredContent(source, meta);
    case 'story-passage-creator':
      return finalizeStoryPassageStructuredContent(source, meta);
    case 'reading-practice-room':
      return normalizeReadingPracticeStructuredContent(source);
    case 'lesson-planner':
    case 'study-schedule-maker':
      return normalizeLessonPlannerStructuredContent(source, slug);
    case 'flashcard-generator':
      return finalizeFlashcardDeckStructuredContent(source, meta, 'flashcard-generator');
    case 'my-study-decks':
      return finalizeFlashcardDeckStructuredContent(source, meta, 'my-study-decks');
    default:
      return source;
  }
}

function getBookGeneratorMaxInr() {
  const raw = process.env.BOOK_GENERATOR_MAX_INR;
  if (raw === '0' || raw === 'off' || raw === 'false' || raw === '') return Infinity;
  const n = Number(raw ?? BOOK_GENERATOR_MAX_INR);
  if (!Number.isFinite(n) || n <= 0) return Infinity;
  return n;
}

function estimateSessionCostInr() {
  const session = getTokenUsageSession();
  if (!session) return 0;
  return computeGeminiCostFromTokenUsage(session).inr;
}

function getBatchSize(override) {
  const n = Number(override ?? process.env.BOOK_GENERATOR_BATCH_SIZE ?? BOOK_GENERATOR_DEFAULT_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 25;
}

function getMaxAttemptsPerSlot(qualityTierSettings) {
  const envMax = getBookBatchSlotMaxAttempts();
  const tierMax = qualityTierSettings?.maxSlotAttempts || envMax;
  return Math.max(envMax, tierMax);
}

function formatBookSlotFailureMessage(batchIndex, error) {
  const msg = String(error || 'Unknown error').trim();
  if (isTransientGeminiError({ message: msg })) {
    return `Slot ${batchIndex}: Gemini temporarily busy — wait a minute and retry.`;
  }
  if (msg.length > 140) return `Slot ${batchIndex}: ${msg.slice(0, 140)}…`;
  return `Slot ${batchIndex}: ${msg}`;
}

function formatBookBatchProgress({ saved, batchSize, batchIndex, callCount, costInr }) {
  const maxInr = getBookGeneratorMaxInr();
  const costNote =
    costInr > 0
      ? maxInr < Infinity
        ? ` · ~₹${costInr.toFixed(2)}/${maxInr}`
        : ` · ~₹${costInr.toFixed(2)}`
      : '';
  return `Generating with Gemini… ${saved}/${batchSize} saved · slot ${batchIndex}/${batchSize}${callCount > 0 ? ` · ${callCount} LLM calls` : ''}${costNote}`;
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

/**
 * Book-grounded batch generation — always uses textbook RAG context.
 */
export async function generateBookBatchAndSave(params = {}, opts = {}) {
  const toolSlug = String(params.toolSlug || params.toolName || '').trim();
  if (!isBookBasedToolSlug(toolSlug)) {
    throw new Error(`Tool "${toolSlug}" is not enabled for Book-Based generation.`);
  }

  const bookId = String(params.bookId || '').trim();
  if (!bookId) throw new Error('bookId is required for Book-Based generation.');

  const book = await Book.findById(bookId).lean();
  if (!book) throw new Error('Book not found.');
  if (book.processingStatus !== 'indexed' || !book.embeddingsCreated) {
    throw new Error('Book is not indexed yet. Upload and reindex the book first.');
  }

  const board = lockBoardKey(String(params.board || book.board || 'CBSE').trim());
  const classInput = String(params.className || book.class || '').trim();
  const className = resolveClassLabelForAiToolStorage(classInput, board);
  const classNameForRag = normalizeClassLabelForLock(classInput);
  const subjectName = resolveLanguageSubjectForGeneration(
    String(params.subjectName || '').trim(),
    String(book.subject || '').trim(),
  );
  const topicName = String(params.topicName || '').trim();
  const subtopicName = String(params.subtopicName || '').trim();
  const batchSize = getBatchSize(params.batchSize);
  const toolDisplayName = getBookBasedToolDisplayName(toolSlug);
  const qualityTierSettings = resolveQualityTierSettings(
    params.qualityTier || params.extraParams?.qualityTier,
    { batchSize },
  );
  const useBookKnowledge = params.useBookKnowledge !== false;

  const scope = {
    toolSlug,
    board,
    className,
    subject: subjectName,
    topic: topicName,
    subtopic: subtopicName,
    bookId,
    bookTitle: book.title,
  };

  const lockScope = {
    ...scope,
    subtopic: `${subtopicName}::book:${bookId}`,
  };

  const lockedBy = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';
  const lock = await acquireGenerationLock(lockScope, lockedBy, {
    forceUnlock: params.forceUnlock === true,
  });
  if (!lock.acquired) {
    return {
      success: false,
      locked: true,
      message: lock.message || 'Generation already in progress.',
      batchSize,
      savedCount: 0,
      failedCount: 0,
      records: [],
      failures: [lock.message || 'Generation already in progress.'],
    };
  }

  try {
    opts.onProgress?.('Preparing batch…');
    const historical = await buildBookHistoricalGenerationContext(scope);
    const batchTitles = [];
    const batchQuestionTexts = [];
    const historicalQuestionTexts = [...historical.questionSnippets];
    const historicalTitles = [...historical.titles];
    const conceptMasteryBatch = toolSlug === 'concept-mastery-helper';
    const savedRecords = [];
    const failures = [];
    let tokenUsage = null;
    let cost = null;

    beginTokenUsageSession('book-generator-batch');

    try {
      opts.onProgress?.('Retrieving textbook chunks for your topic…');
      const ragBase = useBookKnowledge
        ? await retrieveBookContextForGeneration({
            bookId,
            board,
            className: classNameForRag,
            subjectName,
            topicName,
            subtopicName,
            toolSlug,
            bookTitle: book.title,
            topK: conceptMasteryBatch ? 8 : undefined,
          })
        : { contextText: '', chunkCount: 0, chunks: [] };

      const ragScope = {
        bookId,
        board,
        className: classNameForRag,
        subjectName,
        topicName,
        subtopicName,
        toolSlug,
        bookTitle: book.title,
      };

      const slots = Array.from({ length: batchSize }, (_, i) => ({
        batchIndex: i + 1,
        variantIndex: historical.existingCount + i + 1,
      }));
      let completedSlots = 0;

      const worksheetUniquenessBatch =
        toolSlug === 'worksheet-mcq-generator' && qualityTierSettings.enforceBatchUniqueness;
      const poolConcurrency = worksheetUniquenessBatch
        ? 1
        : getBookGeneratorConcurrency(qualityTierSettings, batchSize);

      const slotResults = await runPool(slots, poolConcurrency, async (slot) => {
        const { batchIndex, variantIndex } = slot;
        const maxAttempts = getMaxAttemptsPerSlot(qualityTierSettings);
        let lastError = 'Unknown error';

        const staggerMs = Number(qualityTierSettings.slotStaggerMs) || 0;
        if (batchIndex > 1 && staggerMs > 0) {
          await sleep(staggerMs + Math.floor(Math.random() * 200));
        }

        if (estimateSessionCostInr() >= getBookGeneratorMaxInr()) {
          return {
            ok: false,
            variantIndex,
            batchIndex,
            error: `Batch budget cap (₹${getBookGeneratorMaxInr()}) reached`,
          };
        }

        const session = getTokenUsageSession();
        const callCount = session?.totals?.callCount ?? 0;
        opts.onProgress?.(
          formatBookBatchProgress({
            saved: completedSlots,
            batchSize,
            batchIndex,
            callCount,
            costInr: estimateSessionCostInr(),
          }),
        );

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (estimateSessionCostInr() >= getBookGeneratorMaxInr()) {
            lastError = `Batch budget cap (₹${getBookGeneratorMaxInr()}) reached`;
            break;
          }
          try {
            const extraParams = {
              ...(params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {}),
              generationVariant: variantIndex,
              variantIndex,
              variantAngle: getAiGeneratorVariantAngle(variantIndex, subjectName),
              variantScenario: getAiGeneratorVariantScenario(variantIndex, subjectName),
              batchSize,
              bookId,
              useBookKnowledge,
              bookGenerator: true,
              qualityTier: qualityTierSettings.tier,
              uniqueSeed: `${Date.now()}-book-v${variantIndex}-a${attempt}`,
              strictUniqueness: qualityTierSettings.enforceBatchUniqueness,
              ...(attempt > 1 ? { recoveryPass: true, dedupAttempt: attempt } : {}),
              ...(historical.forbiddenOpenings?.length
                ? { forbiddenOpenings: historical.forbiddenOpenings }
                : {}),
            };

            const pdfContext = useBookKnowledge
              ? buildBookContextTextForVariant(ragBase, ragScope, variantIndex)
              : ragBase.contextText;

            const generated = await generateStructuredContentForAiGenerator(toolSlug, {
              board,
              classLabel: className,
              gradeLevel: className,
              subject: subjectName,
              bookSubject: String(book.subject || '').trim(),
              topic: topicName || book.title,
              subTopic: subtopicName,
              qualityTier: qualityTierSettings.tier,
              extraParams,
              pdfContext,
              historicalPromptBlock: qualityTierSettings.useHistoricalPrompt ? historical.promptBlock : '',
              upgradeToFlash: shouldUseFlashForAiGeneratorRun({
                upgradeRequested:
                  attempt > 1 || isAiGeneratorGreatQualityEnabled() || qualityTierSettings.tier === 'premium',
                recoveryPass: attempt > 1,
              }),
              recoveryPass: attempt > 1,
            });

            const worksheetBatch = toolSlug === 'worksheet-mcq-generator';
            const worksheetTopic = resolveWorksheetTopicLabel({
              subTopic: subtopicName,
              subtopic: subtopicName,
              topic: topicName,
              bookTitle: book.title,
              subject: subjectName,
              bookSubject: String(book.subject || '').trim(),
              generationVariant: variantIndex,
            });
            const finalizeMeta = {
              subject: subjectName,
              bookSubject: String(book.subject || '').trim(),
              topic: worksheetTopic,
              subTopic: subtopicName || worksheetTopic,
              subtopic: subtopicName || worksheetTopic,
              bookTitle: book.title,
              board,
              className,
              generationVariant: variantIndex,
              variantAngle: extraParams.variantAngle,
              variantScenario: extraParams.variantScenario,
              qualityTier: qualityTierSettings.tier,
              strictValidation: false, // book RAG: repair + save — never Premium placeholder lock
              batchOrchestrator: true,
              bookGenerator: true,
              pdfContext,
              uniqueSeed: extraParams.uniqueSeed,
              avoidQuestionTexts: batchQuestionTexts,
              greatQuality: isAiGeneratorGreatQualityEnabled(),
            };
            let structuredContent = finalizeBookStructuredContent(
              toolSlug,
              generated.structuredContent,
              finalizeMeta,
            );
            structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
            structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);

            if (worksheetBatch && batchQuestionTexts.length > 0) {
              structuredContent = rebuildWorksheetBatchVariantSmart(structuredContent, {
                ...finalizeMeta,
                generationVariant: variantIndex + batchIndex * 10007,
                uniqueSeed: `${extraParams.uniqueSeed}-proactive-v${variantIndex}`,
                avoidQuestionTexts: batchQuestionTexts,
              });
              structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
              structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
            }

            if (worksheetBatch) {
              structuredContent = ensureWorksheetSectionsComplete(structuredContent, finalizeMeta);
              structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
              structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
            }

            if (qualityTierSettings.enforceBatchUniqueness) {
              // Book worksheets: compare only within this batch. Historical check against
              // 10k+ prior records blocks every save with near-identical topic stems.
              const uniquenessCtx = {
                batchTitles,
                batchTexts: batchQuestionTexts,
                historicalTexts: worksheetBatch ? [] : historicalQuestionTexts,
                historicalTitles: worksheetBatch ? [] : historicalTitles,
              };
              let uniqueness = validateRecordUniqueness(toolSlug, structuredContent, uniquenessCtx);

              if (!uniqueness.valid && worksheetBatch) {
                for (
                  let dupPass = 0;
                  !uniqueness.valid && dupPass < 10;
                  dupPass += 1
                ) {
                  const regenSeed = variantIndex + attempt * 10000 + dupPass * 7919;
                  const recoveryMeta = {
                    ...finalizeMeta,
                    generationVariant: regenSeed,
                    variantAngle: getAiGeneratorVariantAngle(regenSeed, subjectName),
                    variantScenario: getAiGeneratorVariantScenario(regenSeed, subjectName),
                    uniqueSeed: `${extraParams.uniqueSeed || ''}-dup${attempt}-v${variantIndex}-p${dupPass}`,
                    avoidQuestionTexts: [
                      ...batchQuestionTexts,
                      ...collectQuestionTextsFromStructured(structuredContent, toolSlug),
                    ],
                  };

                  if (dupPass === 0 && batchQuestionTexts.length === 0) {
                    structuredContent = repairWorksheetBatchDuplicates(structuredContent, recoveryMeta);
                  } else {
                    structuredContent = rebuildWorksheetBatchVariantSmart(structuredContent, recoveryMeta);
                  }
                  structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
                  structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
                  uniqueness = validateRecordUniqueness(toolSlug, structuredContent, uniquenessCtx);
                }

                if (!uniqueness.valid) {
                  structuredContent = rebuildWorksheetBatchVariantSmart(structuredContent, {
                    ...finalizeMeta,
                    generationVariant: variantIndex + batchIndex * 50000 + attempt * 1000,
                    uniqueSeed: `${extraParams.uniqueSeed}-final-v${variantIndex}-${Date.now()}`,
                    avoidQuestionTexts: [
                      ...batchQuestionTexts,
                      ...collectQuestionTextsFromStructured(structuredContent, toolSlug),
                    ],
                  });
                  structuredContent = ensureWorksheetSectionsComplete(structuredContent, finalizeMeta);
                  structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
                  structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
                  uniqueness = validateRecordUniqueness(toolSlug, structuredContent, uniquenessCtx);
                }

                // Last resort for book worksheets: keep batch uniqueness only; never drop RPC batch.
                if (!uniqueness.valid) {
                  const qCount = collectQuestionTextsFromStructured(structuredContent, toolSlug).length;
                  if (qCount >= 3) {
                    console.warn(
                      `[book-generator] Slot ${batchIndex}: uniqueness soft-pass after repair (${qCount} questions). ${uniqueness.errors.slice(0, 2).join('; ')}`,
                    );
                    uniqueness = { valid: true, errors: [], duplicates: [] };
                  }
                }
              }

              if (!uniqueness.valid) {
                lastError = uniqueness.errors.join('; ');
                if (attempt < maxAttempts) continue;
                throw new Error(`Duplicate content: ${lastError}`);
              }
            }

            if (!structuredContent || typeof structuredContent !== 'object') {
              lastError = 'Model returned empty structured content.';
              if (attempt < maxAttempts) continue;
              throw new Error(lastError);
            }

            // Prefer freshly formatted text from repaired structured content when available.
            let formattedContent = String(generated.generatedContent || '').trim();
            if (worksheetBatch && structuredContent) {
              try {
                const rebuilt = stripMarkdownSyntax(
                  formatStructuredToolOutput(toolSlug, deepStripMarkdownValues(structuredContent)),
                );
                if (String(rebuilt || '').trim()) {
                  formattedContent = String(rebuilt).trim();
                  generated.generatedContent = formattedContent;
                  generated.structuredContent = structuredContent;
                }
              } catch (fmtErr) {
                console.warn('[book-generator] reformat skipped:', fmtErr?.message || fmtErr);
              }
            }
            if (!formattedContent) {
              lastError = 'Model returned empty formatted content.';
              if (attempt < maxAttempts) continue;
              throw new Error(lastError);
            }

            const title = extractTitleFromStructured(structuredContent);
            if (title) batchTitles.push(title);
            batchQuestionTexts.push(...collectQuestionTextsFromStructured(structuredContent, toolSlug));

            const uid = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';
            const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;

            const record = await withMongoRetry(() =>
              AiToolGeneration.create({
              toolName: toolSlug,
              toolDisplayName,
              sourceType: 'book_rag',
              board,
              classLabel: className,
              subject: subjectName,
              topic: topicName,
              subtopic: subtopicName,
              section: '',
              content: formattedContent,
              generatedContent: formattedContent,
              generatedBy: uid,
              status: 'active',
              reviewStatus: params.reviewStatus || 'approved',
              metadata: {
                board,
                bookId: String(book._id),
                bookTitle: book.title,
                useBookKnowledge,
                ragChunkCount: ragBase.chunkCount,
                createdByName: opts.reqUser?.name || 'Super Admin',
                createdByRole: 'super-admin',
                extraParams,
                contentType: generated.contentType,
                structuredContent,
                formatSource: 'bookRag',
                generationVariant: variantIndex,
                batchSize,
                batchOrchestrator: true,
                bookGenerator: true,
                qualityTier: qualityTierSettings.tier,
                geminiModel: qualityTierSettings.primaryGeminiModel,
                uniquenessTarget: historical.uniquenessTarget,
              },
              ...(teacherId ? { teacherId } : {}),
            })
            );

            await persistGenerationFingerprints(toolSlug, structuredContent, scope, record._id).catch(
              (fpErr) => {
                console.warn('[book-generator] fingerprint persist failed (record saved):', fpErr?.message || fpErr);
              },
            );
            await Book.updateOne(
              { _id: book._id },
              {
                $inc: { 'generationStats.totalGenerations': 1, [`generationStats.toolBreakdown.${toolSlug}`]: 1 },
                $set: { 'generationStats.lastGeneratedAt': new Date() },
              },
            );

            completedSlots += 1;
            opts.onProgress?.(
              formatBookBatchProgress({
                saved: completedSlots,
                batchSize,
                batchIndex,
                callCount: getTokenUsageSession()?.totals?.callCount ?? 0,
                costInr: estimateSessionCostInr(),
              }),
            );

            return { ok: true, variantIndex, batchIndex, record: record.toObject() };
          } catch (err) {
            lastError = err?.message || String(err);
            if (
              (isTransientGeminiError(err) || isMongoTransientError(err)) &&
              attempt < maxAttempts
            ) {
              await sleep(Math.min(12_000, 2500 * attempt));
              continue;
            }
            if (attempt < maxAttempts) continue;
          }
        }
        return { ok: false, variantIndex, batchIndex, error: lastError };
      });

      for (const result of slotResults.sort((a, b) => a.batchIndex - b.batchIndex)) {
        if (result.ok) savedRecords.push(result.record);
        else {
          console.warn(
            `[Book Generator batch] Slot ${result.batchIndex} failed (${qualityTierSettings.tier}): ${result.error}`,
          );
          failures.push(formatBookSlotFailureMessage(result.batchIndex, result.error));
        }
      }
    } finally {
      tokenUsage = endTokenUsageSession();
      cost = computeGeminiCostFromTokenUsage(tokenUsage);
    }

    return {
      success: savedRecords.length === batchSize,
      batchSize,
      savedCount: savedRecords.length,
      failedCount: batchSize - savedRecords.length,
      records: savedRecords,
      failures,
      existingCountBefore: historical.existingCount,
      uniquenessTarget: historical.uniquenessTarget,
      tokenUsage,
      cost,
      mode: 'book_rag',
      bookId: String(book._id),
      bookTitle: book.title,
      message: `Book-grounded batch: ${savedRecords.length}/${batchSize} saved from "${book.title}" (~₹${Number(cost?.inr || 0).toFixed(2)}).`,
    };
  } finally {
    try {
      await releaseGenerationLock(lockScope, lock.lockToken);
    } catch (releaseErr) {
      console.error('book-generator: releaseGenerationLock failed, forcing scope release', releaseErr);
      await forceReleaseGenerationLock(lockScope);
    }
  }
}
