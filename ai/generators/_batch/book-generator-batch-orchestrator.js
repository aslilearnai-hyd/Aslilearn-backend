import mongoose from 'mongoose';
import Book from '../../../models/Book.js';
import AiToolGeneration from '../../../models/AiToolGeneration.js';
import { beginTokenUsageSession, endTokenUsageSession, getTokenUsageSession, formatGeminiFailureForUser, isTransientGeminiError, isGeminiAuthConfigError, isGeminiSpendingCapError } from '../../providers/gemini-service.js';
import { generateContentCompat } from '../../providers/google-genai-compat.js';
import { GEMINI_LITE_MODEL } from '../../providers/gemini-models.js';
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
} from '../core/ai-content-engine-service.js';
import { buildBookHistoricalGenerationContext } from './book-generator-historical.js';
import {
  collectQuestionTextsFromStructured,
  dedupeIntraRecordQuestions,
  renumberIntraRecordQuestions,
  validateRecordUniqueness,
} from '../shared/ai-generator-uniqueness-engine.js';
import { extractTitleFromStructured } from '../shared/ai-generator-content-extractor.js';
import { persistGenerationFingerprints } from '../shared/ai-generator-fingerprint-service.js';
import { computeGeminiCostFromTokenUsage } from '../../providers/gemini-token-cost.js';
import {
  getAiGeneratorVariantAngle,
  getAiGeneratorVariantScenario,
} from '../shared/ai-generator-variant-angles.js';
import { resolveLanguageSubjectForGeneration } from '../../shared/story-passage-subject.js';
import { acquireGenerationLock, forceReleaseGenerationLock, releaseGenerationLock } from '../shared/ai-generator-lock-service.js';
import {
  getBookBatchSlotMaxAttempts,
  isAiGeneratorCompleteOnlySaveEnabled,
  shouldUseFlashForAiGeneratorRun,
} from '../shared/ai-generator-batch-config.js';
import { getAiGeneratorMaxTokens } from '../shared/ai-generator-llm-budget.js';
import { validateDashboardAiToolDoc } from '../../validation/ai-tool-dashboard-validation.js';
import { retrieveBookContextForGeneration, buildBookContextForVariant } from '../../rag/books/book-rag-service.js';
import {
  isBookBasedToolSlug,
  getBookBasedToolDisplayName,
  BOOK_BASED_TOOL_META,
  BOOK_GENERATOR_DEFAULT_BATCH_SIZE,
  BOOK_GENERATOR_MAX_INR,
  BOOK_GENERATOR_PROJECTED_CALL_INR,
} from '../shared/bookBasedTools.js';
import { canonicalBoardLabel, lockBoardKey, normalizeClassLabelForLock, resolveClassLabelForAiToolStorage } from '../../../utils/board-label.js';
import { withMongoRetry, isMongoTransientError } from '../../../utils/mongo-retry.js';
import { resolveQualityTierSettings, getQualityTierBatchConcurrency } from '../../quality-gates/ai-generator-quality-tier.js';
import { isAiGeneratorGreatQualityEnabled } from '../shared/ai-generator-batch-config.js';
import { formatStructuredToolOutput } from '../../../config/aiToolTemplates.js';
import { stripMarkdownSyntax, deepStripMarkdownValues } from '../../../utils/strip-markdown-syntax.js';
import { computeScaffoldDensity, SCAFFOLD_DENSITY_CEILING } from '../../quality-gates/ai-generator-quality-gate.js';
import { generateSixSectionContent } from '../_v2/six-section-generator.js';
import { isSixSectionV2Enabled, buildV2VariantHint } from '../../prompt-versioning/assemble.js';
import { isV2SupportedTool, v2ToolFamily } from '../../prompt-versioning/tool-packs.js';
import { mapV2StructuredToLegacy, ensureV2WorksheetCoreSections, syncLegacyWorksheetSectionsIntoV2, countUsableQuestionsFromV2OrLegacy, trimUsableQuestionsToCount } from '../../../utils/v2-structured-to-legacy.js';
import { pickQuestionCountParams } from '../../../utils/questionComposition.js';
import {
  applyQuestionSlotMetadata,
  buildGenerationCountTelemetry,
  buildQuestionSlotPrompt,
  planQuestionSlots,
} from '../../planning/question-slot-planner.js';
import { validateStemQuestionSet } from '../../validation/stem-question-validator.js';
import {
  assertGenerationCostWithinGuardrail,
  evaluateGenerationCostGuardrail,
  resolveCostBaseline,
} from '../../governance/ai-cost-guardrail.js';

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
  // Premium Pro calls are slow (often 2–6 min each). Parallel slots look "stuck" at 0/N
  // and fight for Gemini quota — run one at a time for book batches.
  if (String(qualityTierSettings?.tier || '') === 'premium') return 1;
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

export function getBookGeneratorMaxInr(batchSize = 1) {
  const raw = process.env.BOOK_GENERATOR_MAX_INR;
  const explicit = Number(raw ?? BOOK_GENERATOR_MAX_INR);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  // A stale 0/off setting must not silently disable the safety ceiling.
  return 1;
}

function estimateSessionCostInr() {
  const session = getTokenUsageSession();
  if (!session) return 0;
  return computeGeminiCostFromTokenUsage(session).inr;
}

/** Reserve the likely cost of the next paid call before starting it. */
export function estimateNextBookGeneratorCallInr() {
  const session = getTokenUsageSession();
  const calls = Math.max(0, Number(session?.totals?.callCount) || 0);
  const observedAverage = calls > 0 ? estimateSessionCostInr() / calls : 0;
  const configured =
    Number(process.env.BOOK_GENERATOR_PROJECTED_CALL_INR) || BOOK_GENERATOR_PROJECTED_CALL_INR;
  return Math.max(0.1, configured, observedAverage);
}

function canStartBookGeneratorCall(batchSize) {
  const maxInr = getBookGeneratorMaxInr(batchSize);
  if (maxInr === Infinity) return true;
  return estimateSessionCostInr() + estimateNextBookGeneratorCallInr() <= maxInr;
}

function getBatchSize(override) {
  const n = Number(override ?? process.env.BOOK_GENERATOR_BATCH_SIZE ?? BOOK_GENERATOR_DEFAULT_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 25;
}

function getMaxAttemptsPerSlot(qualityTierSettings) {
  const envMax = getBookBatchSlotMaxAttempts();
  const tierMax = qualityTierSettings?.maxSlotAttempts || envMax;
  // Env is a hard ceiling (cost control). Old Math.max let Premium force 4 attempts
  // even when AI_GENERATOR_BATCH_SLOT_MAX_ATTEMPTS=1.
  return Math.max(1, Math.min(envMax, tierMax));
}

function formatBookSlotFailureMessage(batchIndex, error) {
  return formatGeminiFailureForUser(error, { slotLabel: `Slot ${batchIndex}` });
}

/** Tiny Gemini call before burning N slots — catches bad/leaked/AQ keys immediately. */
async function assertGeminiKeyWorks(primaryModel) {
  const apiKey = String(
    process.env.VIDYA_AI_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
  ).trim();
  if (!apiKey) {
    throw new Error('Gemini API key is missing');
  }
  const model = String(primaryModel || process.env.AI_GENERATOR_GEMINI_MODEL || GEMINI_LITE_MODEL).trim();
  await generateContentCompat({
    apiKey,
    model,
    contents: 'Reply with exactly: OK',
    generationConfig: { temperature: 0, maxOutputTokens: 8 },
  });
}

function formatBookBatchProgress({ saved, batchSize, batchIndex, callCount, costInr, activeSlots }) {
  const maxInr = getBookGeneratorMaxInr(batchSize);
  const costNote =
    costInr > 0
      ? maxInr < Infinity
        ? ` · ~₹${costInr.toFixed(2)}/${maxInr}`
        : ` · ~₹${costInr.toFixed(2)}`
      : '';
  const active =
    Array.isArray(activeSlots) && activeSlots.length > 1
      ? ` · slots ${activeSlots.slice().sort((a, b) => a - b).join('+')}/${batchSize} in parallel`
      : ` · slot ${batchIndex}/${batchSize}`;
  return `Generating with Gemini… ${saved}/${batchSize} saved${active}${callCount > 0 ? ` · ${callCount} LLM calls` : ''}${costNote}`;
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
  const { normalizeTopicProductCategory } = await import('../../shared/ai-tool-topic-taxonomy.js');
  const productCategory =
    normalizeTopicProductCategory(
      params.productCategory ?? params.extraParams?.productCategory ?? '',
    ) ?? '';
  const subTopicList = (
    Array.isArray(params.subTopics)
      ? params.subTopics
      : Array.isArray(params.subtopicNames)
        ? params.subtopicNames
        : []
  )
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const isWholeChapter =
    !subtopicName ||
    params.chapterScope === true ||
    /^whole\s*chapter$/i.test(subtopicName) ||
    subtopicName === 'whole-chapter';
  const combineMulti =
    params.combineSubtopics !== false && !isWholeChapter && subTopicList.length > 1;
  const { canonicalizeGeneratorSubtopic } = await import('../shared/generator-subtopic-label.js');
  // Persist a short label only — never dump every subtopic name into the record field.
  // Full subtopic lists stay in generation params (subTopics) for prompt coverage.
  const storageSubtopic = canonicalizeGeneratorSubtopic(subtopicName, {
    chapterScope: isWholeChapter,
    subTopicList: combineMulti ? subTopicList : [],
    forceWholeChapter: combineMulti || isWholeChapter,
  });
  const isCombinedMulti = combineMulti;
  const batchSize = getBatchSize(params.batchSize);
  const requestedQuestionParams = pickQuestionCountParams(params);
  const requestedQuestionCount = Number(requestedQuestionParams.questionCount);
  const mustMatchRequestedQuestionCount =
    BOOK_QUESTION_UNIQUENESS_TOOLS.has(toolSlug) &&
    Number.isFinite(requestedQuestionCount) &&
    requestedQuestionCount > 0;
  if (
    toolSlug === 'smart-qa-practice-generator' &&
    mustMatchRequestedQuestionCount &&
    requestedQuestionCount < 7
  ) {
    throw new Error('Smart Q&A requires at least 7 questions so every documented section A-G is present.');
  }
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
    subtopic: storageSubtopic,
    productCategory,
    bookId,
    bookTitle: book.title,
  };

  const lockScope = {
    ...scope,
    subtopic: `${isWholeChapter ? 'whole-chapter' : subtopicName}::book:${bookId}`,
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
    const questionSlotCount = mustMatchRequestedQuestionCount ? requestedQuestionCount : 5;
    const buildSlotsForVariant = (variantIndex) => planQuestionSlots({
      count: questionSlotCount,
      examProfile: params.examProfile || productCategory,
      productCategory,
      subject: subjectName,
      topic: topicName,
      subtopic: isWholeChapter ? '' : subtopicName,
      conceptIds: subTopicList.length ? subTopicList : [subtopicName || topicName],
      variantIndex,
      forbiddenSignatures: historical.questionSlotSignatures || [],
    });
    const initialQuestionSlots = buildSlotsForVariant(1);
    const batchTitles = [];
    const batchQuestionTexts = [];
    const historicalQuestionTexts = Array.isArray(historical.validationQuestionTexts)
      ? [...historical.validationQuestionTexts]
      : Array.isArray(historical.questionSnippets)
        ? [...historical.questionSnippets]
        : [];
    const historicalTitles = Array.isArray(historical.validationTitles)
      ? [...historical.validationTitles]
      : Array.isArray(historical.titles)
        ? [...historical.titles]
        : [];
    const conceptMasteryBatch = toolSlug === 'concept-mastery-helper';
    const toolAudience = BOOK_BASED_TOOL_META[toolSlug]?.audience || 'teacher';
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
            subtopicName: isWholeChapter ? '' : subtopicName,
            subTopics: subTopicList.length > 1 ? subTopicList : undefined,
            toolSlug,
            audience: toolAudience,
            bookTitle: book.title,
            examProfile: params.examProfile || productCategory,
            difficultyBand: params.difficultyBand,
            visualRequired: initialQuestionSlots.some((slot) => slot.visualRequired),
            sourceTypePreference: [...new Set(initialQuestionSlots.flatMap((slot) => slot.sourceTypePreference || []))],
            topK: conceptMasteryBatch ? 4 : isWholeChapter || subTopicList.length > 1 ? 6 : undefined,
          })
        : { contextText: '', chunkCount: 0, chunks: [], hasBookPassages: false };

      if (useBookKnowledge && !ragBase.hasBookPassages) {
        const retrievalMessage =
          ragBase.retrievalStatus === 'weak_context'
            ? 'The selected textbook passages were too weak to safely ground an exam. Reindex the book or choose a more specific chapter/subtopic.'
            : 'No matching textbook passages were found for the selected curriculum. Reindex the book or correct its board/class/subject metadata.';
        console.warn(
          `[book-generator] ${retrievalMessage} book=${bookId} topic="${topicName}" subtopic="${isWholeChapter ? 'whole-chapter' : subtopicName}"`,
        );
        tokenUsage = endTokenUsageSession();
        cost = computeGeminiCostFromTokenUsage(tokenUsage || {});
        return {
          success: false,
          batchSize,
          savedCount: 0,
          failedCount: batchSize,
          records: [],
          failures: [retrievalMessage],
          tokenUsage,
          cost,
          mode: 'book_rag',
          bookId: String(book._id),
          bookTitle: book.title,
          ragChunkCount: 0,
          bookTextUsed: false,
          retrievalStatus: ragBase.retrievalStatus,
          retrievalTier: ragBase.retrievalTier,
          message: retrievalMessage,
        };
      } else if (useBookKnowledge) {
        console.log(
          `[book-generator] Retrieved ${ragBase.chunkCount} textbook chunk(s) for "${subtopicName || topicName}" from book="${book.title}"`,
        );
      }

      opts.onProgress?.('Checking Gemini API key…');
      try {
        await assertGeminiKeyWorks(qualityTierSettings.primaryGeminiModel);
      } catch (preflightErr) {
        const msg = formatGeminiFailureForUser(preflightErr, { slotLabel: 'Gemini' });
        console.error('[book-generator] Gemini preflight failed:', preflightErr?.message || preflightErr);
        tokenUsage = endTokenUsageSession();
        cost = computeGeminiCostFromTokenUsage(tokenUsage || {});
        return {
          success: false,
          batchSize,
          savedCount: 0,
          failedCount: batchSize,
          records: [],
          failures: [msg],
          existingCountBefore: historical.existingCount,
          uniquenessTarget: historical.uniquenessTarget,
          tokenUsage,
          cost,
          mode: 'book_rag',
          bookId: String(book._id),
          bookTitle: book.title,
          ragChunkCount: ragBase.chunkCount,
          bookTextUsed: Boolean(ragBase.hasBookPassages),
          message: msg,
        };
      }

      const ragScope = {
        bookId,
        board,
        className: classNameForRag,
        subjectName,
        topicName,
        subtopicName,
        toolSlug,
        audience: toolAudience,
        bookTitle: book.title,
        sourceTypePreference: [...new Set(initialQuestionSlots.flatMap((slot) => slot.sourceTypePreference || []))],
      };

      const slots = Array.from({ length: batchSize }, (_, i) => ({
        batchIndex: i + 1,
        variantIndex: historical.existingCount + i + 1,
      }));
      let completedSlots = 0;
      const activeSlotSet = new Set();
      let fatalAuthError = '';

      const reportProgress = (batchIndex) => {
        opts.onProgress?.(
          formatBookBatchProgress({
            saved: completedSlots,
            batchSize,
            batchIndex,
            callCount: getTokenUsageSession()?.totals?.callCount ?? 0,
            costInr: estimateSessionCostInr(),
            activeSlots: [...activeSlotSet],
          }),
        );
      };

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
        if (fatalAuthError) {
          return { ok: false, variantIndex, batchIndex, error: fatalAuthError };
        }
        const maxAttempts = getMaxAttemptsPerSlot(qualityTierSettings);
        let lastError = 'Unknown error';

        const staggerMs = Number(qualityTierSettings.slotStaggerMs) || 0;
        if (batchIndex > 1 && staggerMs > 0) {
          await sleep(staggerMs + Math.floor(Math.random() * 200));
        }

        if (!canStartBookGeneratorCall(batchSize)) {
          return {
            ok: false,
            variantIndex,
            batchIndex,
            error: `Batch budget cap (₹${getBookGeneratorMaxInr(batchSize)}) reached before the next model call`,
          };
        }

        activeSlotSet.add(batchIndex);
        reportProgress(batchIndex);

        try {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (fatalAuthError) {
            lastError = fatalAuthError;
            break;
          }
          if (!canStartBookGeneratorCall(batchSize)) {
            lastError = `Batch budget cap (₹${getBookGeneratorMaxInr(batchSize)}) reached before the next model call`;
            break;
          }
          try {
            const questionSlots = buildSlotsForVariant(variantIndex).map((slot) =>
              slot.visualRequired && !(ragBase.sourceAssetIds || []).length
                ? { ...slot, representation: slot.equationRequired ? 'equation_numerical' : 'text', visualRequired: false }
                : slot,
            );
            const questionSlotPrompt = buildQuestionSlotPrompt(questionSlots);
            const variantRag = useBookKnowledge
              ? buildBookContextForVariant(ragBase, ragScope, variantIndex)
              : {
                  contextText: ragBase.contextText,
                  sourceChunkIds: ragBase.sourceChunkIds || [],
                };
            // V2 six-section (book-grounded): when enabled + supported, generate the
            // 6-section content with the retrieved textbook passages passed as ragContext,
            // and save directly. Bypasses the legacy worksheet leak/dedup/scaffold gates
            // that fail single-chapter RAG slots (only 1/N saved). Quality comes from the
            // Pro model + RAG layer; rendering reuses SixSectionViewer.
            if (isSixSectionV2Enabled() && isV2SupportedTool(toolSlug)) {
              try {
                const v2RagContextBase = variantRag.contextText;
                const v2RagContext = [v2RagContextBase, questionSlotPrompt].filter(Boolean).join('\n\n');
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
                    subTopic: isWholeChapter ? '' : subtopicName,
                    chapterScope: isWholeChapter,
                    ...(subTopicList.length > 1 ? { subTopics: subTopicList } : {}),
                    examProfile: params.examProfile || productCategory,
                    questionSlots,
                    ...requestedQuestionParams,
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
                    maxTokens: getAiGeneratorMaxTokens(toolSlug, {
                      qualityTier: qualityTierSettings.tier,
                    }),
                    // The outer slot loop owns recovery. A second retry layer could
                    // multiply one failed slot into six full paid generations.
                    maxTries: 1,
                    // Worksheet finalization can complete a short V2 response
                    // deterministically from the retrieved book context.
                    allowUnderfilledQuestionCount: toolSlug === 'worksheet-mcq-generator',
                    canStartCall: () => canStartBookGeneratorCall(batchSize),
                    // A short freshness sample is enough for Smart Q&A and avoids
                    // resending thousands of paid input tokens on every slot.
                    avoidQuestions: usedV2Questions.slice(
                      0,
                      toolSlug === 'smart-qa-practice-generator' ? 15 : 40,
                    ),
                    multimodalParts: ragBase.multimodalParts || [],
                    sourceChunkIds: variantRag.sourceChunkIds || [],
                    sourceAssetIds: ragBase.sourceAssetIds || [],
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
                  const padMeta = {
                    subject: subjectName,
                    topic: topicName || book.title,
                    subTopic: isWholeChapter ? '' : subtopicName,
                    bookGenerator: true,
                    batchOrchestrator: true,
                    pdfContext: v2RagContext,
                    generationVariant: variantIndex,
                    ...requestedQuestionParams,
                  };
                  let structuredV2 = ensureV2WorksheetCoreSections(v2.structuredContent, padMeta);
                  let legacyStructured = mapV2StructuredToLegacy(toolSlug, structuredV2);
                  if (toolSlug === 'worksheet-mcq-generator') {
                    legacyStructured = ensureWorksheetSectionsComplete(
                      legacyStructured && typeof legacyStructured === 'object'
                        ? legacyStructured
                        : { title: coreTitle, sections: [] },
                      padMeta,
                    );
                    structuredV2 = syncLegacyWorksheetSectionsIntoV2(structuredV2, legacyStructured);
                  } else if (toolSlug === 'smart-qa-practice-generator') {
                    // The V2 question schema may omit Section F/G even when earlier
                    // sections overshoot the requested total. Fill the canonical A–G
                    // legacy shape before exact-count trimming so the trim can reserve
                    // one question for every required section.
                    legacyStructured = finalizePracticeQaStructuredContent(
                      legacyStructured && typeof legacyStructured === 'object'
                        ? legacyStructured
                        : { title: coreTitle, sections: [] },
                      padMeta,
                    );
                  }
                  if (mustMatchRequestedQuestionCount) {
                    let actualQuestionCount = countUsableQuestionsFromV2OrLegacy(
                      structuredV2,
                      legacyStructured,
                    );
                    if (actualQuestionCount > requestedQuestionCount) {
                      const trimmed = trimUsableQuestionsToCount(
                        structuredV2,
                        legacyStructured,
                        requestedQuestionCount,
                      );
                      structuredV2 = trimmed.v2;
                      legacyStructured = trimmed.legacy;
                      actualQuestionCount = countUsableQuestionsFromV2OrLegacy(
                        structuredV2,
                        legacyStructured,
                      );
                      console.warn(
                        `[book-generator] Slot ${batchIndex}: trimmed excess questions to ${requestedQuestionCount} (had more from model).`,
                      );
                    }
                    if (actualQuestionCount < requestedQuestionCount) {
                      lastError = `Generated ${actualQuestionCount} of ${requestedQuestionCount} requested questions`;
                      console.warn(
                        `[book-generator] Slot ${batchIndex} attempt ${attempt}: ${lastError} — retrying instead of saving a short paper.`,
                      );
                      continue;
                    }
                  }
                  const v2SlotAssignment = applyQuestionSlotMetadata(structuredV2, questionSlots, {
                    sourceChunkIds: variantRag.sourceChunkIds || [],
                    sourceAssetIds: ragBase.sourceAssetIds || [],
                  });
                  structuredV2 = v2SlotAssignment.structuredContent;
                  if (legacyStructured) {
                    legacyStructured = applyQuestionSlotMetadata(legacyStructured, questionSlots, {
                      sourceChunkIds: variantRag.sourceChunkIds || [],
                      sourceAssetIds: ragBase.sourceAssetIds || [],
                    }).structuredContent;
                  }
                  const stemGate = validateStemQuestionSet(structuredV2, {
                    slots: questionSlots,
                    expectedCount: mustMatchRequestedQuestionCount ? requestedQuestionCount : 0,
                    approvedChunkIds: variantRag.sourceChunkIds || [],
                    approvedAssetIds: ragBase.sourceAssetIds || [],
                  });
                  if (!stemGate.valid) {
                    lastError = stemGate.findings.map((finding) => finding.code).join(', ');
                    console.warn(`[book-generator] Slot ${batchIndex} STEM/slot validation failed: ${lastError}`);
                    continue;
                  }
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

                  /*
                   * Completeness gate — the book path previously had none.
                   *
                   * This orchestrator checked only scaffold density, so an
                   * incomplete generation still saved here while the normal
                   * batch path (AI_GENERATOR_COMPLETE_ONLY_SAVE) refused it.
                   * A 3,000-record sample of the newest book records was 61%
                   * incomplete, worst being daily-class-plan-maker at 150/150
                   * under 200 chars — records that rendered as a bare title yet
                   * were counted as healthy.
                   *
                   * Failing the slot instead of saving feeds the existing
                   * attempt loop (getMaxAttemptsPerSlot), so a bad generation is
                   * retried rather than persisted. Honoured only when
                   * complete-only-save is on, so the flag still governs both
                   * paths from one place.
                   */
                  /*
                   * Render guard — the section gate alone does NOT catch this.
                   *
                   * validateDashboardAiToolDoc reads metadata.structuredContent
                   * in preference to the rendered text, so a record whose
                   * `content` collapsed to just the title still validates as
                   * complete: 150 book daily-class-plan records sat at 51-63
                   * chars ("## Mapping Earths Landmasses: A Silhouette
                   * Activity") and every one passed the gate. Teachers opened an
                   * empty plan the audit scored as healthy.
                   *
                   * A rendered body barely longer than the title while the
                   * structured payload is substantial means the mapper produced
                   * nothing for this tool and formatStructuredToolOutput fell
                   * back to the title. Fail the slot so the attempt loop retries
                   * rather than persisting an empty document.
                   */
                  const renderedLen = String(persistContent || '').trim().length;
                  const payloadLen = JSON.stringify(structuredV2 || {}).length;
                  if (renderedLen <= String(coreTitle || '').trim().length + 20 && payloadLen > 800) {
                    lastError = `Render collapsed to title (${renderedLen} chars from a ${payloadLen}-char payload)`;
                    console.warn(
                      `[book-generator] Slot ${batchIndex} attempt ${attempt}: not saved — ${lastError}`,
                    );
                    continue;
                  }

                  if (isAiGeneratorCompleteOnlySaveEnabled()) {
                    const bookGate = validateDashboardAiToolDoc(toolSlug, {
                      toolName: toolSlug,
                      content: persistContent,
                      generatedContent: persistContent,
                      metadata: {
                        structuredContent: structuredV2,
                        ...(legacyStructured ? { legacyStructuredContent: legacyStructured } : {}),
                      },
                    });
                    if (!bookGate.valid) {
                      const detail =
                        (bookGate.missingSections || []).join(', ') ||
                        String(bookGate.message || 'incomplete').slice(0, 120);
                      lastError = `Incomplete content (${detail})`;
                      console.warn(
                        `[book-generator] Slot ${batchIndex} attempt ${attempt}: not saved — ${detail}`,
                      );
                      continue;
                    }
                  }
                  const costGuardrail = assertGenerationCostWithinGuardrail(
                    { inr: estimateSessionCostInr() / Math.max(1, completedSlots + 1) },
                    { examProfile: params.examProfile || productCategory, productCategory },
                  );
                  const rec = await withMongoRetry(() =>
                    AiToolGeneration.create({
                      toolName: toolSlug,
                      toolDisplayName,
                      sourceType: 'book_rag',
                      board,
                      classLabel: className,
                      subject: subjectName,
                      topic: topicName || book.title,
                      subtopic: storageSubtopic,
                      productCategory: productCategory || undefined,
                      section: '',
                      content: persistContent,
                      generatedContent: persistContent,
                      generatedBy: uid,
                      status: 'active',
                      reviewStatus: params.reviewStatus || 'approved',
                      generationPlan: {
                        examProfile: questionSlots[0]?.examProfile || 'BOARD',
                        slots: questionSlots,
                        sourceChunkIds: variantRag.sourceChunkIds || [],
                        sourceAssetIds: ragBase.sourceAssetIds || [],
                      },
                      generationValidation: {
                        valid: true,
                        flags: [],
                        attemptCount: attempt,
                        generatedCount: stemGate.questionCount,
                        repairedCount: 0,
                      },
                      generationCost: {
                        inr: estimateSessionCostInr() / Math.max(1, completedSlots + 1),
                        baselineInr: costGuardrail.baselineCost,
                        increasePercent: costGuardrail.increasePercent,
                        guardrailStatus: costGuardrail.status,
                      },
                      metadata: {
                        board,
                        productCategory: productCategory || '',
                        bookId: String(book._id),
                        bookTitle: book.title,
                        useBookKnowledge,
                        ragChunkCount: ragBase.chunkCount,
                        ragCandidateCount: ragBase.candidateChunks?.length || ragBase.chunkCount,
                        ragRetrievalTier: ragBase.retrievalTier || '',
                        ragBestScore: ragBase.bestScore || 0,
                        sourceChunkIds: variantRag.sourceChunkIds || [],
                        sourceAssetIds: ragBase.sourceAssetIds || [],
                        questionSlots,
                        questionSlotSignatures: questionSlots.map((slot) => slot.signature),
                        generationCounts: buildGenerationCountTelemetry({
                          attempted: attempt,
                          generated: stemGate.questionCount,
                        }),
                        costGuardrail,
                        bookTextUsed: Boolean(ragBase.hasBookPassages),
                        chapterScope: isWholeChapter,
                        requestedSubtopic: subtopicName,
                        ...(subTopicList.length > 1 ? { coveredSubtopics: subTopicList } : {}),
                        createdByName: opts.reqUser?.name || 'Super Admin',
                        createdByRole: 'super-admin',
                        contentType: 'structured',
                        structuredContent: structuredV2,
                        ...(legacyStructured ? { legacyStructuredContent: legacyStructured } : {}),
                        formatSource: 'asli-v2-six-section',
                        schemaVersion: 'asli-v2-six-section',
                        generationVariant: variantIndex,
                        batchSize,
                        batchOrchestrator: true,
                        bookGenerator: true,
                        qualityTier: qualityTierSettings.tier,
                        geminiModel: qualityTierSettings.primaryGeminiModel,
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
                  activeSlotSet.delete(batchIndex);
                  reportProgress(batchIndex);
                  console.log(
                    `[book-generator] Slot ${batchIndex}: saved (V2 six-section, book-grounded)`,
                  );
                  return { ok: true, variantIndex, batchIndex, record: rec.toObject() };
                }

                lastError = v2.error || 'V2 six-section generation failed';
                console.warn(
                  `[book-generator] Slot ${batchIndex} V2 failed (attempt ${attempt}/${maxAttempts}): ${lastError}`,
                );
                if (isTransientGeminiError({ message: lastError }) && attempt < maxAttempts) {
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
              examProfile: params.examProfile || productCategory,
              questionSlots,
              ...(attempt > 1 ? { recoveryPass: true, dedupAttempt: attempt } : {}),
              ...(historical.forbiddenOpenings?.length
                ? { forbiddenOpenings: historical.forbiddenOpenings }
                : {}),
            };

            const pdfContextBase = variantRag.contextText;
            const pdfContext = [pdfContextBase, questionSlotPrompt].filter(Boolean).join('\n\n');

            const generated = await generateStructuredContentForAiGenerator(toolSlug, {
              board,
              classLabel: className,
              gradeLevel: className,
              subject: subjectName,
              bookSubject: String(book.subject || '').trim(),
              topic: topicName || book.title,
              subTopic: isWholeChapter ? '' : subtopicName,
              chapterScope: isWholeChapter,
              ...(subTopicList.length > 1 ? { subTopics: subTopicList } : {}),
              qualityTier: qualityTierSettings.tier,
              extraParams,
              pdfContext,
              multimodalParts: ragBase.multimodalParts || [],
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
              subTopic: isWholeChapter ? '' : subtopicName,
              subtopic: isWholeChapter ? '' : subtopicName,
              topic: topicName,
              bookTitle: book.title,
              subject: subjectName,
              bookSubject: String(book.subject || '').trim(),
              generationVariant: variantIndex,
              chapterScope: isWholeChapter,
            });
            const finalizeMeta = {
              subject: subjectName,
              bookSubject: String(book.subject || '').trim(),
              topic: worksheetTopic,
              subTopic: isWholeChapter ? worksheetTopic : subtopicName || worksheetTopic,
              subtopic: isWholeChapter ? worksheetTopic : subtopicName || worksheetTopic,
              bookTitle: book.title,
              board,
              chapterScope: isWholeChapter,
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
              ...requestedQuestionParams,
            };
            let structuredContent = finalizeBookStructuredContent(
              toolSlug,
              generated.structuredContent,
              finalizeMeta,
            );
            structuredContent = dedupeIntraRecordQuestions(toolSlug, structuredContent);
            structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
            if (toolSlug === 'smart-qa-practice-generator') {
              // Dedupe/normalization can empty a later section when Gemini repeats
              // a question across A–G. Re-finalize after those destructive passes,
              // immediately before the exact-count trim and save gates.
              structuredContent = finalizePracticeQaStructuredContent(
                structuredContent,
                finalizeMeta,
              );
              structuredContent = renumberIntraRecordQuestions(toolSlug, structuredContent);
            }

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
              const uniquenessCtx = {
                batchTitles,
                batchTexts: batchQuestionTexts,
                historicalTexts: historicalQuestionTexts,
                historicalTitles,
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

            if (mustMatchRequestedQuestionCount) {
              let actualQuestionCount = countUsableQuestionsFromV2OrLegacy(
                null,
                structuredContent,
              );
              if (actualQuestionCount > requestedQuestionCount) {
                const trimmed = trimUsableQuestionsToCount(
                  null,
                  structuredContent,
                  requestedQuestionCount,
                );
                structuredContent = trimmed.legacy;
                actualQuestionCount = countUsableQuestionsFromV2OrLegacy(
                  null,
                  structuredContent,
                );
                console.warn(
                  `[book-generator] Slot ${batchIndex}: trimmed excess questions to ${requestedQuestionCount} (had more from model).`,
                );
              }
              if (actualQuestionCount < requestedQuestionCount) {
                lastError = `Generated ${actualQuestionCount} of ${requestedQuestionCount} requested questions`;
                console.warn(
                  `[book-generator] Slot ${batchIndex} attempt ${attempt}: ${lastError} — retrying instead of saving a short paper.`,
                );
                if (attempt < maxAttempts) continue;
                throw new Error(lastError);
              }
            }

            const slotAssignment = applyQuestionSlotMetadata(structuredContent, questionSlots, {
              sourceChunkIds: variantRag.sourceChunkIds || [],
              sourceAssetIds: ragBase.sourceAssetIds || [],
            });
            structuredContent = slotAssignment.structuredContent;
            const stemGate = validateStemQuestionSet(structuredContent, {
              slots: questionSlots,
              expectedCount: mustMatchRequestedQuestionCount ? requestedQuestionCount : 0,
              approvedChunkIds: variantRag.sourceChunkIds || [],
              approvedAssetIds: ragBase.sourceAssetIds || [],
            });
            if (!stemGate.valid) {
              lastError = `STEM/slot validation failed (${stemGate.findings.map((finding) => finding.code).join(', ')})`;
              if (attempt < maxAttempts) continue;
              throw new Error(lastError);
            }

            // Prefer freshly formatted text from repaired structured content when available.
            let formattedContent = String(generated.generatedContent || '').trim();
            if (
              (worksheetBatch || toolSlug === 'smart-qa-practice-generator') &&
              structuredContent
            ) {
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

            const deliveryGate = validateDashboardAiToolDoc(toolSlug, {
              toolName: toolSlug,
              board,
              classLabel: className,
              subject: subjectName,
              topic: topicName,
              subtopic: storageSubtopic,
              content: formattedContent,
              generatedContent: formattedContent,
              metadata: { structuredContent },
            });
            if (!deliveryGate.valid) {
              lastError = `Incomplete content (${(deliveryGate.missingSections || []).join(', ') || deliveryGate.message || 'schema mismatch'})`;
              console.warn(
                `[book-generator] Slot ${batchIndex} attempt ${attempt}: ${lastError} — not saving.`,
              );
              if (attempt < maxAttempts) continue;
              throw new Error(lastError);
            }

            const title = extractTitleFromStructured(structuredContent);
            if (title) batchTitles.push(title);
            batchQuestionTexts.push(...collectQuestionTextsFromStructured(structuredContent, toolSlug));

            const uid = opts.reqUser?.userId || opts.reqUser?._id || 'unknown';
            const teacherId = mongoose.Types.ObjectId.isValid(uid) ? uid : undefined;

            const costGuardrail = assertGenerationCostWithinGuardrail(
              { inr: estimateSessionCostInr() / Math.max(1, completedSlots + 1) },
              { examProfile: params.examProfile || productCategory, productCategory },
            );

            const record = await withMongoRetry(() =>
              AiToolGeneration.create({
              toolName: toolSlug,
              toolDisplayName,
              sourceType: 'book_rag',
              board,
              classLabel: className,
              subject: subjectName,
              topic: topicName,
              subtopic: storageSubtopic,
              productCategory: productCategory || undefined,
              section: '',
              content: formattedContent,
              generatedContent: formattedContent,
              generatedBy: uid,
              status: 'active',
              reviewStatus: params.reviewStatus || 'approved',
              generationPlan: {
                examProfile: questionSlots[0]?.examProfile || 'BOARD',
                slots: questionSlots,
                sourceChunkIds: variantRag.sourceChunkIds || [],
                sourceAssetIds: ragBase.sourceAssetIds || [],
              },
              generationValidation: {
                valid: true,
                flags: [],
                attemptCount: attempt,
                generatedCount: stemGate.questionCount,
                repairedCount: 0,
              },
              generationCost: {
                inr: estimateSessionCostInr() / Math.max(1, completedSlots + 1),
                baselineInr: costGuardrail.baselineCost,
                increasePercent: costGuardrail.increasePercent,
                guardrailStatus: costGuardrail.status,
              },
              metadata: {
                board,
                productCategory: productCategory || '',
                bookId: String(book._id),
                bookTitle: book.title,
                useBookKnowledge,
                ragChunkCount: ragBase.chunkCount,
                ragCandidateCount: ragBase.candidateChunks?.length || ragBase.chunkCount,
                ragRetrievalTier: ragBase.retrievalTier || '',
                ragBestScore: ragBase.bestScore || 0,
                sourceChunkIds: variantRag.sourceChunkIds || [],
                sourceAssetIds: ragBase.sourceAssetIds || [],
                questionSlots,
                questionSlotSignatures: questionSlots.map((slot) => slot.signature),
                generationCounts: buildGenerationCountTelemetry({
                  attempted: attempt,
                  generated: stemGate.questionCount,
                }),
                costGuardrail,
                bookTextUsed: Boolean(ragBase.hasBookPassages),
                chapterScope: isWholeChapter,
                requestedSubtopic: subtopicName,
                ...(subTopicList.length > 1 ? { coveredSubtopics: subTopicList } : {}),
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
            activeSlotSet.delete(batchIndex);
            reportProgress(batchIndex);

            return { ok: true, variantIndex, batchIndex, record: record.toObject() };
          } catch (err) {
            lastError = err?.message || String(err);
            if (isGeminiAuthConfigError(err) || isGeminiSpendingCapError(err)) {
              fatalAuthError = lastError;
              break;
            }
            if (
              (isTransientGeminiError(err) || isMongoTransientError(err)) &&
              attempt < maxAttempts
            ) {
              await sleep(Math.min(12_000, 2500 * attempt));
              continue;
            }
            // Non-retryable generation/validation errors — do not burn remaining attempts.
            break;
          }
        }
        return { ok: false, variantIndex, batchIndex, error: lastError };
        } finally {
          activeSlotSet.delete(batchIndex);
          reportProgress(batchIndex);
        }
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
      costGuardrail: evaluateGenerationCostGuardrail({
        currentCost: Number(cost?.inr || 0) / Math.max(1, savedRecords.length),
        baselineCost: resolveCostBaseline({ examProfile: params.examProfile || productCategory, productCategory }),
      }),
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
