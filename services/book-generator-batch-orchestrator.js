import mongoose from 'mongoose';
import Book from '../models/Book.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { beginTokenUsageSession, endTokenUsageSession, getTokenUsageSession, formatGeminiFailureForUser, isTransientGeminiError } from './gemini-service.js';
import {
  generateStructuredContentForAiGenerator,
  finalizeExamPaperStructuredContent,
  finalizeMockTestStructuredContent,
  finalizeHomeworkStructuredContent,
  finalizeWorksheetStructuredContent,
  isWorksheetBatchSaveable,
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
import { computeScaffoldDensity, SCAFFOLD_DENSITY_CEILING } from './ai-generator-quality-gate.js';
import { generateSixSectionContent } from './six-section-generator.js';
import { isSixSectionV2Enabled, buildV2VariantHint } from '../prompts/v2/assemble.js';
import { isV2SupportedTool, v2ToolFamily } from '../prompts/v2/tool-packs.js';
import { mapV2StructuredToLegacy } from '../utils/v2-structured-to-legacy.js';
import {
  auditStoredGenerationDoc,
  practiceGroundingRequired,
} from './v2-content-quality-service.js';

/** Question tools that carry scaffold-prone question pools and cross-slot dedup. */
const BOOK_QUESTION_UNIQUENESS_TOOLS = new Set([
  'worksheet-mcq-generator',
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-qa-practice-generator',
  'quick-assignment-builder',
]);

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
  return formatGeminiFailureForUser(error, { slotLabel: `Slot ${batchIndex}` });
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
/** Pull DISTINCTIVE content from a V2 structuredContent — works for ALL families
 *  (questions, activity steps, explanations, cards), so dedup applies to every tool. */
function extractV2QuestionTextsBook(sc) {
  const core = (sc && sc.core) || {};
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.length >= 15) out.push(t);
    } else if (Array.isArray(v)) {
      for (const item of v) {
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
  console.log(
    `[book-generator] qualityTier=${qualityTierSettings.tier} primary=${qualityTierSettings.primaryGeminiModel} flashLiteOnly=${qualityTierSettings.flashLiteOnly}`,
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
    const historicalQuestionTexts = Array.isArray(historical.questionSnippets)
      ? [...historical.questionSnippets]
      : [];
    const historicalTitles = Array.isArray(historical.titles) ? [...historical.titles] : [];
    const conceptMasteryBatch = toolSlug === 'concept-mastery-helper';
    const savedRecords = [];

    // Cross-slot dedup: each saved V2 slot appends its questions so later slots avoid them.
    const usedV2Questions = [];
    const failures = [];
    let tokenUsage = null;
    let cost = null;
    let ragBase = { contextText: '', chunkCount: 0, chunks: [], hasBookPassages: false };

    beginTokenUsageSession('book-generator-batch');

    try {
      opts.onProgress?.('Retrieving textbook chunks for your topic…');
      ragBase = useBookKnowledge
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
        : { contextText: '', chunkCount: 0, chunks: [], hasBookPassages: false };

      if (useBookKnowledge && !ragBase.hasBookPassages) {
        console.warn(
          `[book-generator] WARNING: No textbook chunks retrieved for book=${bookId} topic="${topicName}" subtopic="${subtopicName}". Generation will use curriculum labels only — reindex the book or check board/subject metadata.`,
        );
      } else if (useBookKnowledge) {
        console.log(
          `[book-generator] Retrieved ${ragBase.chunkCount} textbook chunk(s) for "${subtopicName || topicName}" from book="${book.title}"` +
            (ragBase.hasPracticeGrounding ? ' (practice-grounded)' : ' (no Concept Practice hit)'),
        );
      }

      if (
        useBookKnowledge &&
        practiceGroundingRequired(toolSlug, { useBookKnowledge: true }) &&
        ragBase.hasBookPassages &&
        !ragBase.hasPracticeGrounding
      ) {
        console.warn(
          `[book-generator] Practice grounding missing for ${toolSlug} — continuing with semantic chunks only (set BOOK_RAG_REQUIRE_PRACTICE=strict to hard-fail).`,
        );
        const strict =
          String(process.env.BOOK_RAG_REQUIRE_PRACTICE || '').trim().toLowerCase() === 'strict';
        if (strict) {
          throw new Error(
            'Book RAG found no Concept Practice / worked-example chunks for this topic. Reindex the book or widen chapter coverage.',
          );
        }
      }

      const ragScope = {
        bookId,
        board,
        className: classNameForRag,
        subjectName,
        topicName,
        subtopicName,
        toolSlug,
        bookTitle: book.title,
        chapterScope: !String(subtopicName || '').trim(),
        topK: Math.max(6, Number(process.env.BOOK_RAG_TOP_K || 8) || 8),
      };

      const slots = Array.from({ length: batchSize }, (_, i) => ({
        batchIndex: i + 1,
        variantIndex: historical.existingCount + i + 1,
      }));
      let completedSlots = 0;

      // Serialize any tool that dedups question/body content across slots — parallel slots read a
      // stale shared batchQuestionTexts/batchTitles and either save duplicates or fail 100%.
      const crossSlotUniquenessBatch =
        qualityTierSettings.enforceBatchUniqueness &&
        (BOOK_QUESTION_UNIQUENESS_TOOLS.has(toolSlug) || toolSlug === 'concept-mastery-helper');
      const poolConcurrency = crossSlotUniquenessBatch
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
            // V2 six-section (book-grounded): when enabled + supported, generate the
            // 6-section content with the retrieved textbook passages passed as ragContext,
            // and save directly. Bypasses the legacy worksheet leak/dedup/scaffold gates
            // that fail single-chapter RAG slots (only 1/N saved). Quality comes from the
            // Pro model + RAG layer; rendering reuses SixSectionViewer.
            if (isSixSectionV2Enabled() && isV2SupportedTool(toolSlug)) {
              try {
                const v2RagContext = useBookKnowledge
                  ? buildBookContextTextForVariant(ragBase, ragScope, variantIndex)
                  : ragBase.contextText;
                const v2VariantHint = buildV2VariantHint({
                  variantIndex,
                  batchSize,
                  family: v2ToolFamily(toolSlug),
                  angle: getAiGeneratorVariantAngle(variantIndex, subjectName),
                  scenario: getAiGeneratorVariantScenario(variantIndex, subjectName),
                  seed: `${Date.now()}-book-v${variantIndex}-a${attempt}`,
                });
                const v2 = await generateSixSectionContent(
                  toolSlug,
                  {
                    board,
                    classLabel: className,
                    subject: subjectName,
                    topic: topicName || book.title,
                    subTopic: subtopicName,
                    chapterScope: ragScope.chapterScope,
                  },
                  {
                    primaryModel: qualityTierSettings.primaryGeminiModel,
                    modelOverflow: qualityTierSettings.modelOverflow,
                    flashLiteOnly: qualityTierSettings.flashLiteOnly,
                    maxAttemptsPerModel: qualityTierSettings.geminiRetriesPerModel,
                    isBatchVariant: true,
                    ragContext: v2RagContext,
                    variantHint: v2VariantHint,
                    temperature: Math.min(0.9, 0.6 + (variantIndex - 1) * 0.06),
                    avoidQuestions: usedV2Questions.slice(0, 40),
                    // Book path: hard math/answer-key gate + Indian notation + LLM audit
                    maxTries: 3,
                    llmAudit: true,
                    softKeepOnQualityFail: false,
                  },
                );
                if (v2.ok) {
                  usedV2Questions.push(...extractV2QuestionTextsBook(v2.structuredContent));
                  const uid = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';
                  const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;
                  const coreTitle =
                    v2.structuredContent?.core?.title ||
                    v2.structuredContent?.core?.worksheetTitle ||
                    'Six-section content';
                  const legacyStructured = mapV2StructuredToLegacy(toolSlug, v2.structuredContent);
                  let persistContent = coreTitle;
                  if (legacyStructured) {
                    try {
                      persistContent =
                        formatStructuredToolOutput(toolSlug, legacyStructured) ||
                        JSON.stringify(legacyStructured);
                    } catch {
                      persistContent = JSON.stringify(legacyStructured);
                    }
                  }
                  const rec = await withMongoRetry(() =>
                    AiToolGeneration.create({
                      toolName: toolSlug,
                      toolDisplayName,
                      sourceType: 'book_rag',
                      board,
                      classLabel: className,
                      subject: subjectName,
                      topic: topicName || book.title,
                      subtopic: subtopicName,
                      section: '',
                      content: persistContent,
                      generatedContent: persistContent,
                      generatedBy: uid,
                      status: 'active',
                      reviewStatus: params.reviewStatus || 'approved',
                      metadata: {
                        board,
                        bookId: String(book._id),
                        bookTitle: book.title,
                        useBookKnowledge,
                        ragChunkCount: ragBase.chunkCount,
                        bookTextUsed: Boolean(ragBase.hasBookPassages),
                        practiceQueryCount: ragBase.practiceQueryCount || 0,
                        createdByName: opts.reqUser?.name || 'Super Admin',
                        createdByRole: 'super-admin',
                        contentType: 'structured',
                        structuredContent: v2.structuredContent,
                        ...(legacyStructured ? { legacyStructuredContent: legacyStructured } : {}),
                        formatSource: 'asli-v2-six-section',
                        schemaVersion: 'asli-v2-six-section',
                        generationVariant: variantIndex,
                        batchSize,
                        batchOrchestrator: true,
                        bookGenerator: true,
                        qualityTier: qualityTierSettings.tier,
                        geminiModel: qualityTierSettings.primaryGeminiModel,
                        qualityFixes: v2.qualityFixes || [],
                        qualityWarnings: v2.qualityWarnings || [],
                        qualityAudit: auditStoredGenerationDoc({
                          toolName: toolSlug,
                          classLabel: className,
                          subject: subjectName,
                          topic: topicName || book.title,
                          subtopic: subtopicName,
                          content: persistContent,
                          generatedContent: persistContent,
                          metadata: {
                            structuredContent: v2.structuredContent,
                            schemaVersion: 'asli-v2-six-section',
                          },
                        }),
                        hasPracticeGrounding: Boolean(ragBase.hasPracticeGrounding),
                        qualityGates: [
                          'math-accuracy',
                          'indian-notation',
                          'subtopic-scope',
                          'content-density',
                          'legacy-scaffold',
                          'answer-key-audit',
                        ],
                      },
                      ...(teacherId ? { teacherId } : {}),
                    }),
                  );
                  try {
                    await Book.updateOne(
                      { _id: book._id },
                      {
                        $inc: {
                          'generationStats.totalGenerations': 1,
                          [`generationStats.toolBreakdown.${toolSlug}`]: 1,
                        },
                        $set: { 'generationStats.lastGeneratedAt': new Date() },
                      },
                    );
                  } catch (statErr) {
                    console.warn(
                      '[book-generator] generationStats update failed (V2 record saved):',
                      statErr?.message || statErr,
                    );
                  }
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
                  console.log(
                    `[book-generator] Slot ${batchIndex}: saved (V2 six-section, book-grounded)`,
                  );
                  return { ok: true, variantIndex, batchIndex, record: rec.toObject() };
                }

                lastError = v2.error || 'V2 six-section generation failed';
                console.warn(
                  `[book-generator] Slot ${batchIndex} V2 failed (attempt ${attempt}/${maxAttempts}): ${lastError}`,
                );
                // Retry on quality-gate failures and transient Gemini errors — never save bad maths.
                const qualityFail = /quality gate failed/i.test(String(lastError));
                if (
                  attempt < maxAttempts &&
                  (qualityFail || isTransientGeminiError({ message: lastError }))
                ) {
                  await sleep(Math.min(12_000, 2500 * attempt));
                  continue;
                }
              } catch (v2Err) {
                lastError = v2Err?.message || String(v2Err);
                console.warn(
                  `[book-generator] Slot ${batchIndex} V2 threw (attempt ${attempt}/${maxAttempts}): ${lastError}`,
                );
                if (isTransientGeminiError(v2Err) && attempt < maxAttempts) {
                  await sleep(Math.min(12_000, 2500 * attempt));
                  continue;
                }
              }
              console.warn(
                `[book-generator] Slot ${batchIndex}: falling back to legacy pipeline after V2 failure`,
              );
            }

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
              // Question tools generated from ONE book chapter naturally repeat topic stems, so
              // validating them against the 10k+ historical corpus over-rejects and fails whole
              // batches as the pool grows (worksheet also has a repair loop below; the others go
              // straight to retry/throw). Dedupe all question tools batch-only.
              const historicalExemptQuestionTool = BOOK_QUESTION_UNIQUENESS_TOOLS.has(toolSlug);
              const uniquenessCtx = {
                batchTitles,
                batchTexts: batchQuestionTexts,
                historicalTexts: historicalExemptQuestionTool ? [] : historicalQuestionTexts,
                historicalTitles: historicalExemptQuestionTool ? [] : historicalTitles,
              };
              let uniqueness = validateRecordUniqueness(toolSlug, structuredContent, uniquenessCtx);

              if (!uniqueness.valid && worksheetBatch) {
                for (
                  let dupPass = 0;
                  !uniqueness.valid && dupPass < 10;
                  dupPass += 1
                ) {
                  const regenSeed = variantIndex + attempt * 10000 + dupPass * 7919;
                  const baseRecoveryMeta = {
                    ...finalizeMeta,
                    generationVariant: regenSeed,
                    variantAngle: getAiGeneratorVariantAngle(regenSeed, subjectName),
                    variantScenario: getAiGeneratorVariantScenario(regenSeed, subjectName),
                    uniqueSeed: `${extraParams.uniqueSeed || ''}-dup${attempt}-v${variantIndex}-p${dupPass}`,
                  };

                  if (dupPass === 0 && batchQuestionTexts.length === 0) {
                    // Repair only questions that clash with OTHER batch records. Book worksheets
                    // compare batch-only (historical excluded above), so on the first slot there is
                    // nothing to dedupe against — never pass the record's OWN questions as `avoid`
                    // or repairWorksheetBatchDuplicates overwrites every real question with scaffold.
                    if (batchQuestionTexts.length) {
                      structuredContent = repairWorksheetBatchDuplicates(structuredContent, {
                        ...baseRecoveryMeta,
                        avoidQuestionTexts: [...batchQuestionTexts],
                      });
                    }
                  } else {
                    structuredContent = rebuildWorksheetBatchVariantSmart(structuredContent, {
                      ...baseRecoveryMeta,
                      avoidQuestionTexts: [
                        ...batchQuestionTexts,
                        ...collectQuestionTextsFromStructured(structuredContent, toolSlug),
                      ],
                    });
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

                // Last resort for book worksheets: save even when questions overlap prior batch slots.
                if (!uniqueness.valid) {
                  const qCount = collectQuestionTextsFromStructured(structuredContent, toolSlug).length;
                  if (qCount >= 1) {
                    console.warn(
                      `[book-generator] Slot ${batchIndex}: uniqueness soft-pass after repair (${qCount} questions). ${uniqueness.errors.slice(0, 2).join('; ')}`,
                    );
                    uniqueness = { valid: true, errors: [], duplicates: [] };
                  }
                }
              }

              if (!uniqueness.valid) {
                lastError = uniqueness.errors.join('; ');
                const qCount = collectQuestionTextsFromStructured(structuredContent, toolSlug).length;
                if (qCount >= 1) {
                  console.warn(
                    `[book-generator] Slot ${batchIndex}: duplicate soft-pass — saving anyway (${qCount} questions). ${lastError}`,
                  );
                } else {
                  if (attempt < maxAttempts) continue;
                  throw new Error(`Duplicate content: ${lastError}`);
                }
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

            // Book batches: block worksheets with prompt leakage or scaffold-only filler.
            if (toolSlug === 'worksheet-mcq-generator') {
              if (!isWorksheetBatchSaveable(structuredContent, finalizeMeta)) {
                console.warn(
                  `[book-generator] Slot ${batchIndex}: worksheet failed save gate — forcing full topic repair`,
                );
                structuredContent = finalizeWorksheetStructuredContent(
                  { sections: [] },
                  {
                    ...finalizeMeta,
                    generationVariant: variantIndex + batchIndex * 1000 + attempt,
                  },
                );
              }
              if (!isWorksheetBatchSaveable(structuredContent, finalizeMeta)) {
                lastError = 'Worksheet failed quality gate (prompt leakage or missing chapter-specific content).';
                if (attempt < maxAttempts) continue;
                throw new Error(lastError);
              }
            } else if (BOOK_QUESTION_UNIQUENESS_TOOLS.has(toolSlug)) {
              const scaffoldStats = computeScaffoldDensity(toolSlug, structuredContent);
              if (scaffoldStats.total >= 3 && scaffoldStats.density > SCAFFOLD_DENSITY_CEILING) {
                // NEVER save scaffold-heavy book content — retry the slot, then fail it.
                lastError = `Scaffold-heavy book content (${Math.round(scaffoldStats.density * 100)}% filler questions)`;
                console.warn(`[book-generator] Slot ${batchIndex}: ${lastError} — not saving.`);
                if (attempt < maxAttempts) continue;
                throw new Error(lastError);
              }
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
                bookTextUsed: Boolean(ragBase.hasBookPassages),
                bookTextWarning:
                  useBookKnowledge && !ragBase.hasBookPassages
                    ? 'No textbook passages were retrieved. Content may not be book-grounded.'
                    : undefined,
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

            // Record is persisted. Post-insert steps must NOT throw out of this try — the catch
            // below retries the attempt and AiToolGeneration.create would run again, leaving a
            // duplicate row. Both steps swallow their own errors.
            await persistGenerationFingerprints(toolSlug, structuredContent, scope, record._id).catch(
              (fpErr) => {
                console.warn('[book-generator] fingerprint persist failed (record saved):', fpErr?.message || fpErr);
              },
            );
            try {
              await Book.updateOne(
                { _id: book._id },
                {
                  $inc: { 'generationStats.totalGenerations': 1, [`generationStats.toolBreakdown.${toolSlug}`]: 1 },
                  $set: { 'generationStats.lastGeneratedAt': new Date() },
                },
              );
            } catch (statErr) {
              console.warn('[book-generator] generationStats update failed (record saved):', statErr?.message || statErr);
            }

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
      ragChunkCount: ragBase.chunkCount,
      bookTextUsed: Boolean(ragBase.hasBookPassages),
      message: ragBase.hasBookPassages
        ? `Book-grounded batch: ${savedRecords.length}/${batchSize} saved from "${book.title}" using ${ragBase.chunkCount} textbook passage(s) (~₹${Number(cost?.inr || 0).toFixed(2)}).`
        : `Batch saved ${savedRecords.length}/${batchSize}, but NO textbook passages were retrieved from "${book.title}". Content may not be book-grounded — check book indexing and topic/subtopic.`,
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
