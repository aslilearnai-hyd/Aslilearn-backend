import mongoose from 'mongoose';
import Book from '../models/Book.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { beginTokenUsageSession, endTokenUsageSession } from './gemini-service.js';
import { generateStructuredContentForAiGenerator, finalizeMockTestStructuredContent } from './ai-content-engine-service.js';
import { runAiGeneratorQualityGate } from './ai-generator-quality-gate.js';
import { formatStructuredToolOutput } from '../config/aiToolTemplates.js';
import { deepStripMarkdownValues, stripMarkdownSyntax } from '../utils/strip-markdown-syntax.js';
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
import { acquireGenerationLock, releaseGenerationLock } from './ai-generator-lock-service.js';
import {
  isAiGeneratorCostSaverEnabled,
  isAiGeneratorUltraEconomyEnabled,
} from '../utils/ai-generator-batch-config.js';
import { retrieveBookContextForGeneration } from './book-rag-service.js';
import {
  isBookBasedToolSlug,
  getBookBasedToolDisplayName,
  BOOK_GENERATOR_DEFAULT_BATCH_SIZE,
} from '../config/bookBasedTools.js';
import { canonicalBoardLabel } from '../utils/board-label.js';

const DEFAULT_CONCURRENCY = Number(process.env.BOOK_GENERATOR_CONCURRENCY || process.env.AI_GENERATOR_BATCH_CONCURRENCY || 3);

function getBatchSize(override) {
  const n = Number(override ?? process.env.BOOK_GENERATOR_BATCH_SIZE ?? BOOK_GENERATOR_DEFAULT_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 25;
}

function getMaxAttemptsPerSlot() {
  const n = Number(process.env.BOOK_GENERATOR_SLOT_MAX_ATTEMPTS || process.env.AI_GENERATOR_BATCH_SLOT_MAX_ATTEMPTS);
  return Number.isFinite(n) && n > 0 ? n : 3;
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

  const board = canonicalBoardLabel(String(params.board || book.board || 'CBSE').trim());
  const className = String(params.className || book.class || '').trim();
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
  const lock = await acquireGenerationLock(lockScope, lockedBy);
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
    const historical = await buildBookHistoricalGenerationContext(scope);
    const batchTitles = [];
    const batchQuestionTexts = [];
    const savedRecords = [];
    const failures = [];
    let tokenUsage = null;
    let cost = null;

    beginTokenUsageSession('book-generator-batch');

    try {
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

      const slots = Array.from({ length: batchSize }, (_, i) => historical.existingCount + i + 1);

      const slotResults = await runPool(slots, DEFAULT_CONCURRENCY, async (variantIndex) => {
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
              bookId,
              useBookKnowledge,
              uniqueSeed: `${Date.now()}-book-v${variantIndex}-a${attempt}`,
              strictUniqueness: true,
              ...(attempt > 1 ? { recoveryPass: true } : {}),
            };

            let generated = await generateStructuredContentForAiGenerator(toolSlug, {
              board,
              classLabel: className,
              gradeLevel: className,
              subject: subjectName,
              topic: topicName || book.title,
              subTopic: subtopicName,
              extraParams,
              pdfContext:
                ragBase.contextText +
                (toolSlug === 'mock-test-builder'
                  ? '\n\nMOCK TEST RULES (mandatory): Use the textbook as the only factual source. Every question must be unique — do not repeat the same stem or scenario. Number questions globally as question_number 1, 2, 3… across section_a through section_e (no duplicate numbers). Section A MCQs must each have exactly four labeled options A)–D) and one correct answer.'
                  : ''),
              historicalPromptBlock: historical.promptBlock,
              upgradeToFlash:
                !isAiGeneratorCostSaverEnabled() &&
                !isAiGeneratorUltraEconomyEnabled() &&
                attempt > 2,
              recoveryPass: attempt > 1,
            });

            const genMeta = {
              topic: topicName || book.title,
              subTopic: subtopicName,
              subject: subjectName,
            };

            if (toolSlug === 'mock-test-builder') {
              const polished = finalizeMockTestStructuredContent(generated.structuredContent, genMeta);
              const quality = runAiGeneratorQualityGate(toolSlug, polished, genMeta);
              if (!quality.valid) {
                lastError = quality.errors.join('; ');
                continue;
              }
              generated = {
                ...generated,
                structuredContent: polished,
                generatedContent: stripMarkdownSyntax(
                  formatStructuredToolOutput(toolSlug, deepStripMarkdownValues(polished)),
                ),
              };
            }

            const uniqueness = validateRecordUniqueness(toolSlug, generated.structuredContent, {
              batchTitles,
              batchTexts: batchQuestionTexts,
              historicalTexts: [],
              historicalTitles: historical.titles,
            });

            if (!uniqueness.valid) {
              lastError = uniqueness.errors.join('; ');
              continue;
            }

            const title = extractTitleFromStructured(generated.structuredContent);
            if (title) batchTitles.push(title);
            batchQuestionTexts.push(...collectQuestionTextsFromStructured(generated.structuredContent));

            const uid = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';
            const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;

            const record = await AiToolGeneration.create({
              toolName: toolSlug,
              toolDisplayName,
              sourceType: 'book_rag',
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
                structuredContent: generated.structuredContent,
                formatSource: 'bookRag',
                generationVariant: variantIndex,
                batchSize,
                batchOrchestrator: true,
                bookGenerator: true,
                uniquenessTarget: historical.uniquenessTarget,
              },
              ...(teacherId ? { teacherId } : {}),
            });

            await persistGenerationFingerprints(toolSlug, generated.structuredContent, scope, record._id);

            await Book.updateOne(
              { _id: book._id },
              {
                $inc: { 'generationStats.totalGenerations': 1, [`generationStats.toolBreakdown.${toolSlug}`]: 1 },
                $set: { 'generationStats.lastGeneratedAt': new Date() },
              },
            );

            return { ok: true, variantIndex, record: record.toObject() };
          } catch (err) {
            lastError = err?.message || String(err);
          }
        }
        return { ok: false, variantIndex, error: lastError };
      });

      for (const result of slotResults.sort((a, b) => a.variantIndex - b.variantIndex)) {
        if (result.ok) savedRecords.push(result.record);
        else failures.push(`Variant ${result.variantIndex}: ${result.error}`);
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
      message: `Book-grounded batch: ${savedRecords.length}/${batchSize} saved from "${book.title}".`,
    };
  } finally {
    await releaseGenerationLock(lockScope, lock.lockToken);
  }
}
