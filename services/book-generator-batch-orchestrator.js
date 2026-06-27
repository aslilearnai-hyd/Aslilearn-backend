import mongoose from 'mongoose';
import Book from '../models/Book.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { beginTokenUsageSession, endTokenUsageSession, getTokenUsageSession } from './gemini-service.js';
import {
  generateStructuredContentForAiGenerator,
  finalizeExamPaperStructuredContent,
  finalizeMockTestStructuredContent,
  finalizeHomeworkStructuredContent,
  finalizeWorksheetStructuredContent,
  finalizePracticeQaStructuredContent,
  finalizeQuickAssignmentStructuredContent,
  finalizeConceptMasteryStructuredContent,
} from './ai-content-engine-service.js';
import { buildBookHistoricalGenerationContext } from './book-generator-historical.js';
import {
  collectQuestionTextsFromStructured,
  dedupeIntraRecordQuestions,
  renumberIntraRecordQuestions,
} from './ai-generator-uniqueness-engine.js';
import { extractTitleFromStructured } from './ai-generator-content-extractor.js';
import { persistGenerationFingerprints } from './ai-generator-fingerprint-service.js';
import { computeGeminiCostFromTokenUsage } from '../utils/gemini-token-cost.js';
import {
  getAiGeneratorVariantAngle,
  getAiGeneratorVariantScenario,
} from '../constants/ai-generator-variant-angles.js';
import { acquireGenerationLock, forceReleaseGenerationLock, releaseGenerationLock } from './ai-generator-lock-service.js';
import {
  getBatchSlotMaxAttempts,
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

function getBookGeneratorConcurrency() {
  const n = Number(process.env.BOOK_GENERATOR_CONCURRENCY || process.env.AI_GENERATOR_BATCH_CONCURRENCY || 5);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 5;
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

function getMaxAttemptsPerSlot() {
  return getBatchSlotMaxAttempts();
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
  const subjectName = String(params.subjectName || book.subject || '').trim();
  const topicName = String(params.topicName || '').trim();
  const subtopicName = String(params.subtopicName || '').trim();
  const batchSize = getBatchSize(params.batchSize);
  const toolDisplayName = getBookBasedToolDisplayName(toolSlug);
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

      const slotResults = await runPool(slots, getBookGeneratorConcurrency(), async (slot) => {
        const { batchIndex, variantIndex } = slot;
        const maxAttempts = getMaxAttemptsPerSlot();
        let lastError = 'Unknown error';

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
              variantAngle: getAiGeneratorVariantAngle(variantIndex),
              variantScenario: getAiGeneratorVariantScenario(variantIndex),
              batchSize,
              bookId,
              useBookKnowledge,
              uniqueSeed: `${Date.now()}-book-v${variantIndex}-a${attempt}`,
              strictUniqueness: false,
              ...(attempt > 1 ? { recoveryPass: true } : {}),
            };

            const pdfContext = conceptMasteryBatch
              ? buildBookContextTextForVariant(ragBase, ragScope, variantIndex)
              : ragBase.contextText;

            const generated = await generateStructuredContentForAiGenerator(toolSlug, {
              board,
              classLabel: className,
              gradeLevel: className,
              subject: subjectName,
              topic: topicName || book.title,
              subTopic: subtopicName,
              extraParams,
              pdfContext,
              historicalPromptBlock: '',
              upgradeToFlash: shouldUseFlashForAiGeneratorRun({
                upgradeRequested: attempt > 2,
                recoveryPass: attempt > 1,
              }),
              recoveryPass: attempt > 1,
            });

            const finalizeMeta = {
              subject: subjectName,
              topic: topicName,
              subTopic: subtopicName,
              subtopic: subtopicName,
              board,
              className,
              generationVariant: variantIndex,
              variantAngle: extraParams.variantAngle,
              variantScenario: extraParams.variantScenario,
            };
            let structuredContent = finalizeBookStructuredContent(
              toolSlug,
              generated.structuredContent,
              finalizeMeta,
            );
            structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
            structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);

            const title = extractTitleFromStructured(structuredContent);
            if (title) batchTitles.push(title);
            batchQuestionTexts.push(...collectQuestionTextsFromStructured(structuredContent));

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
                uniquenessTarget: historical.uniquenessTarget,
              },
              ...(teacherId ? { teacherId } : {}),
            });

            await Promise.all([
              persistGenerationFingerprints(toolSlug, structuredContent, scope, record._id),
              Book.updateOne(
                { _id: book._id },
                {
                  $inc: { 'generationStats.totalGenerations': 1, [`generationStats.toolBreakdown.${toolSlug}`]: 1 },
                  $set: { 'generationStats.lastGeneratedAt': new Date() },
                },
              ),
            ]);

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
          }
        }
        return { ok: false, variantIndex, batchIndex, error: lastError };
      });

      for (const result of slotResults.sort((a, b) => a.batchIndex - b.batchIndex)) {
        if (result.ok) savedRecords.push(result.record);
        else {
          const err = String(result.error || 'Unknown error');
          const short = err.length > 140 ? `${err.slice(0, 140)}…` : err;
          failures.push(`Slot ${result.batchIndex}: ${short}`);
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
