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
} from './ai-content-engine-service.js';
import { buildBookHistoricalGenerationContext } from './book-generator-historical.js';
import {
  validateRecordUniqueness,
  collectQuestionTextsFromStructured,
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
  isAiGeneratorCostSaverEnabled,
  isAiGeneratorUltraEconomyEnabled,
} from '../utils/ai-generator-batch-config.js';
import { retrieveBookContextForGeneration } from './book-rag-service.js';
import {
  isBookBasedToolSlug,
  getBookBasedToolDisplayName,
  BOOK_GENERATOR_DEFAULT_BATCH_SIZE,
  BOOK_GENERATOR_MAX_INR,
} from '../config/bookBasedTools.js';
import { canonicalBoardLabel, lockBoardKey, normalizeClassLabelForLock } from '../utils/board-label.js';

const DEFAULT_CONCURRENCY = Number(process.env.BOOK_GENERATOR_CONCURRENCY || process.env.AI_GENERATOR_BATCH_CONCURRENCY || 3);

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
  if (isAiGeneratorUltraEconomyEnabled()) return 1;
  const n = Number(process.env.BOOK_GENERATOR_SLOT_MAX_ATTEMPTS || process.env.AI_GENERATOR_BATCH_SLOT_MAX_ATTEMPTS);
  if (Number.isFinite(n) && n > 0) return n;
  return isAiGeneratorCostSaverEnabled() ? 2 : 3;
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
  const className = normalizeClassLabelForLock(String(params.className || book.class || '').trim());
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
            className,
            subjectName,
            topicName,
            subtopicName,
            toolSlug,
            bookTitle: book.title,
          })
        : { contextText: '', chunkCount: 0, chunks: [] };

      const slots = Array.from({ length: batchSize }, (_, i) => ({
        batchIndex: i + 1,
        variantIndex: historical.existingCount + i + 1,
      }));
      let completedSlots = 0;

      const slotResults = await runPool(slots, DEFAULT_CONCURRENCY, async (slot) => {
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
              strictUniqueness: true,
              ...(attempt > 1 ? { recoveryPass: true } : {}),
            };

            const generated = await generateStructuredContentForAiGenerator(toolSlug, {
              board,
              classLabel: className,
              gradeLevel: className,
              subject: subjectName,
              topic: topicName || book.title,
              subTopic: subtopicName,
              extraParams,
              pdfContext: ragBase.contextText,
              historicalPromptBlock: '',
              upgradeToFlash:
                !isAiGeneratorCostSaverEnabled() &&
                !isAiGeneratorUltraEconomyEnabled() &&
                attempt > 2,
              recoveryPass: attempt > 1,
            });

            const finalizeMeta = {
              subject: subjectName,
              topic: topicName,
              subTopic: subtopicName,
              subtopic: subtopicName,
              board,
              className,
            };
            const structuredContent = finalizeBookStructuredContent(
              toolSlug,
              generated.structuredContent,
              finalizeMeta,
            );

            const uniqueness = validateRecordUniqueness(toolSlug, structuredContent, {
              batchTitles,
              batchTexts: batchQuestionTexts,
              historicalTexts: [],
              historicalTitles: [],
            });

            if (!uniqueness.valid) {
              lastError = uniqueness.errors.join('; ');
              if (isAiGeneratorUltraEconomyEnabled()) {
                /* one shot — accept first valid structure even if similar */
              } else if (attempt < maxAttempts) continue;
              else return { ok: false, variantIndex, batchIndex, error: lastError };
            }

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

            await persistGenerationFingerprints(toolSlug, structuredContent, scope, record._id);

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
          }
        }
        return { ok: false, variantIndex, batchIndex, error: lastError };
      });

      for (const result of slotResults.sort((a, b) => a.batchIndex - b.batchIndex)) {
        if (result.ok) savedRecords.push(result.record);
        else failures.push(`Slot ${result.batchIndex}: ${result.error}`);
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
