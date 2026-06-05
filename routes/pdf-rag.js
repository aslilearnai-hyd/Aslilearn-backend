import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { verifyToken, authorizeRoles } from '../middleware/auth.js';
import AiContentEngineSource from '../models/AiContentEngineSource.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import { processPdfSourceWithModels, runHybridRagQuery, archiveSupersededSources } from '../services/pdf-rag-service.js';
import { uploadPdfToConfiguredStorage, deleteFromConfiguredStorage } from '../services/cloud-storage.js';
import { isPdfQueueEnabled } from '../queues/pdfProcessingQueue.js';
import {
  buildLocalPdfAnalysisFromSelection,
  classifyPdfContentWithFallback,
  extractTextFromPdfBuffer,
  resolveToolSlugFromLabel,
  getToolLabelFromSlug,
  validateToolSpecificStructuredContent,
  buildRenderableContent,
  buildConceptRenderableFromStructured,
  buildHomeworkRenderableFromStructured,
  buildLessonPlanRenderableFromStructured,
  buildDailyClassPlanRenderableFromStructured,
  buildRubricRenderableFromStructured,
  buildExamPaperRenderableFromStructured,
  buildMockTestRenderableFromStructured,
  buildWorksheetRenderableFromStructured,
  finalizeActivityStructuredContent,
  canonicalizeActivityExtractedItem,
  canonicalizeConceptExtractedItem,
  canonicalizeHomeworkExtractedItem,
  canonicalizeRubricExtractedItem,
  canonicalizeLessonPlannerExtractedItem,
  canonicalizeDailyClassPlanExtractedItem,
  canonicalizeExamPaperExtractedItem,
  canonicalizeWorksheetExtractedItem,
  canonicalizePracticeQaExtractedItem,
  canonicalizeStudyGuideExtractedItem,
  canonicalizeChapterSummaryExtractedItem,
  canonicalizeKeyPointsExtractedItem,
  canonicalizeQuickAssignmentExtractedItem,
  canonicalizeConceptBreakdownExtractedItem,
  canonicalizeStoryExtractedItem,
  buildStoryRenderableFromStructured,
  canonicalizeShortNotesExtractedItem,
  buildShortNotesRenderableFromStructured,
  canonicalizeFlashcardExtractedItem,
  buildFlashcardRenderableFromStructured,
  normalizeLessonPlannerStructuredContent,
  generateStructuredContentFromPdf,
} from '../services/ai-content-engine-service.js';
import {
  extractActivityTitleFromMarkdown,
  isCurriculumBreadcrumbTitle,
  resolveActivityDisplayTitle,
} from '../services/activity-title-utils.js';
import { formatItemToContent } from '../controllers/aiToolsController.js';
import { boardMongoMatch } from '../utils/board-label.js';
import { expandStructuredToFormatItems, isDeprecatedAiToolIdentifier } from '../config/aiToolTemplates.js';
import {
  beginTokenUsageSession,
  endTokenUsageSession,
  extractAndGenerateAllItems,
  getLastPdfExtractionMeta,
} from '../services/gemini-service.js';
import {
  activityPatternExtractIsComplete,
  scoreActivityExtractRow,
} from '../services/pdf-activity-extract.js';
import {
  consolidateWorksheetExtractItems,
  extractWorksheetItemsFromPdfText,
} from '../services/pdf-worksheet-extract.js';
import { countExpectedPdfItems } from '../services/pdf-extract-validation.js';
import {
  canonicalPdfHasExtractableContent,
  extractCanonicalPdfDocument,
} from '../services/pdf-canonical-extract.js';
import {
  mapCanonicalPdfToToolBulkItems,
  postProcessCanonicalBulkItems,
} from '../services/pdf-canonical-mapper.js';

function isDeprecatedPdfListRow(row) {
  return (
    isDeprecatedAiToolIdentifier(row?.toolType) ||
    isDeprecatedAiToolIdentifier(row?.contentType) ||
    isDeprecatedAiToolIdentifier(row?.originalName)
  );
}
/** One viewer-friendly render blob per bulk-saved item (matches `buildRenderableContent` shapes). */
function buildBulkRenderContent(toolSlug, contentType, item) {
  const ct = String(contentType || 'Generated Content').trim() || 'Generated Content';
  const row = item && typeof item === 'object' ? { ...item } : {};
  delete row._fromPdf;
  if (toolSlug === 'worksheet-mcq-generator') {
    return buildWorksheetRenderableFromStructured(row);
  }
  if (toolSlug === 'homework-creator') {
    return buildHomeworkRenderableFromStructured(row);
  }
  if (toolSlug === 'mock-test-builder') {
    return buildMockTestRenderableFromStructured(row);
  }
  if (toolSlug === 'exam-question-paper-generator') {
    return buildExamPaperRenderableFromStructured(row);
  }
  if (toolSlug === 'my-study-decks' || toolSlug === 'flashcard-generator') {
    return buildFlashcardRenderableFromStructured(row, toolSlug);
  }
  if (toolSlug === 'rubrics-evaluation-generator') {
    return buildRubricRenderableFromStructured(row);
  }
  if (toolSlug === 'concept-mastery-helper') {
    return buildConceptRenderableFromStructured(row);
  }
  if (toolSlug === 'lesson-planner' || toolSlug === 'study-schedule-maker') {
    return buildLessonPlanRenderableFromStructured(row, toolSlug);
  }
  if (toolSlug === 'daily-class-plan-maker') {
    return buildDailyClassPlanRenderableFromStructured(row);
  }
  if (toolSlug === 'reading-practice-room' || toolSlug === 'story-passage-creator') {
    return buildStoryRenderableFromStructured(row, toolSlug);
  }
  if (toolSlug === 'short-notes-summaries-maker') {
    return buildShortNotesRenderableFromStructured(row);
  }
  return buildRenderableContent(toolSlug, ct, row);
}

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Matches express.json/urlencoded limit in index.js; raise nginx `client_max_body_size` if you increase this. */
const AI_PDF_MAX_FILE_BYTES = 100 * 1024 * 1024;
const AI_PDF_MAX_MB = Math.round(AI_PDF_MAX_FILE_BYTES / (1024 * 1024));

/** Tools where PDF questions should all land in one document (not 1 DB row per question). */
const PDF_QUESTION_DOCUMENT_TOOLS = new Set([
  'worksheet-mcq-generator',
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-qa-practice-generator',
]);

const PDF_EXTRACT_GENERATION_MODES = new Set(['extract', 'regex-extract', 'canonical-json']);

const ZERO_LLM_TOKEN_USAGE = {
  sessionLabel: 'ai-pdf-upload-zero-llm',
  totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 },
  calls: [],
};

function shouldSkipPdfRagIndexing(toolSlug, generationMeta) {
  if (generationMeta?.generationMode === 'regex-extract' || generationMeta?.generationMode === 'canonical-json') {
    return true;
  }
  if (
    PDF_QUESTION_DOCUMENT_TOOLS.has(toolSlug) &&
    generationMeta?.generationMode &&
    generationMeta.generationMode !== 'rag-fallback'
  ) {
    return true;
  }
  return false;
}

const ACTIVITY_TOOL_SLUGS = new Set(['activity-project-generator', 'project-idea-lab']);

function canonicalMappedItemsAreUsable(toolSlug, items = []) {
  if (!Array.isArray(items) || !items.length) return false;
  if (ACTIVITY_TOOL_SLUGS.has(toolSlug)) {
    const rich = items.filter((row) => scoreActivityExtractRow(row) >= 6);
    return activityPatternExtractIsComplete(rich, items.length);
  }
  if (
    PDF_QUESTION_DOCUMENT_TOOLS.has(toolSlug) ||
    toolSlug === 'my-study-decks' ||
    toolSlug === 'flashcard-generator' ||
    toolSlug === 'quick-assignment-builder'
  ) {
    return countQuestionsInBulkItems(items) > 0 || items.length > 0;
  }
  return items.length > 0;
}

/** Worksheet PDFs: regex/canonical only — never Gemini classify or extract (cost). */
function canUseZeroLlmCanonicalPath(toolSlug, extractedText) {
  if (toolSlug === 'worksheet-mcq-generator') {
    return Boolean(String(extractedText || '').trim());
  }
  const canonical = extractCanonicalPdfDocument(extractedText, { toolSlug });
  const mapped = mapCanonicalPdfToToolBulkItems(toolSlug, canonical, extractedText, {});
  return canonicalMappedItemsAreUsable(toolSlug, mapped.items);
}

function buildWorksheetRegexOnlyBulkItems(extractedText, params = {}) {
  const title = String(params.topic || params.subtopic || 'Worksheet').trim() || 'Worksheet';
  const consolidated = consolidateWorksheetExtractItems(
    [{ title, worksheet_title: title }],
    { ...params, rawPdfText: extractedText, forceSingleDocument: true },
  );
  return consolidated
    .slice(0, 1)
    .map((item) => canonicalizeWorksheetExtractedItem(item, extractedText))
    .filter(Boolean);
}

function canonicalizeBulkItemForTool(toolSlug, item, extractedText = '') {
  const metaClean = item && typeof item === 'object' ? { ...item } : {};
  delete metaClean._fromPdf;
  delete metaClean._fromAiGeneration;
  switch (toolSlug) {
    case 'activity-project-generator':
    case 'project-idea-lab':
      return canonicalizeActivityExtractedItem(metaClean, toolSlug);
    case 'concept-mastery-helper':
      return canonicalizeConceptExtractedItem(metaClean);
    case 'concept-breakdown-explainer':
      return canonicalizeConceptBreakdownExtractedItem(metaClean);
    case 'homework-creator':
      return canonicalizeHomeworkExtractedItem(metaClean);
    case 'rubrics-evaluation-generator':
      return canonicalizeRubricExtractedItem(metaClean);
    case 'lesson-planner':
    case 'study-schedule-maker':
      return canonicalizeLessonPlannerExtractedItem(metaClean, toolSlug);
    case 'daily-class-plan-maker':
      return canonicalizeDailyClassPlanExtractedItem(metaClean);
    case 'mock-test-builder':
    case 'exam-question-paper-generator':
      return canonicalizeExamPaperExtractedItem(metaClean, toolSlug);
    case 'worksheet-mcq-generator':
      return canonicalizeWorksheetExtractedItem(metaClean, extractedText);
    case 'smart-qa-practice-generator':
      return canonicalizePracticeQaExtractedItem(metaClean, extractedText);
    case 'reading-practice-room':
    case 'story-passage-creator':
      return canonicalizeStoryExtractedItem(metaClean, toolSlug);
    case 'short-notes-summaries-maker':
      return canonicalizeShortNotesExtractedItem(metaClean);
    case 'smart-study-guide-generator':
      return canonicalizeStudyGuideExtractedItem(metaClean);
    case 'chapter-summary-creator':
      return canonicalizeChapterSummaryExtractedItem(metaClean);
    case 'key-points-formula-extractor':
      return canonicalizeKeyPointsExtractedItem(metaClean);
    case 'quick-assignment-builder':
      return canonicalizeQuickAssignmentExtractedItem(metaClean);
    case 'my-study-decks':
    case 'flashcard-generator':
      return canonicalizeFlashcardExtractedItem(metaClean, toolSlug);
    default:
      return metaClean;
  }
}

function countQuestionsInBulkItem(item) {
  if (!item || typeof item !== 'object') return 0;
  if (Array.isArray(item.sections)) {
    return item.sections.reduce(
      (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
      0,
    );
  }
  if (Array.isArray(item.questions)) return item.questions.length;
  if (Array.isArray(item.practice_questions)) return item.practice_questions.length;
  return String(item.question || '').trim() ? 1 : 0;
}

function countQuestionsInBulkItems(items = []) {
  return items.reduce((n, it) => n + countQuestionsInBulkItem(it), 0);
}

/**
 * PDF → canonical JSON → tool format. Falls back to Gemini extract / RAG only when needed.
 */
async function resolvePdfUploadBulkItems(toolSlug, extractedText, params = {}) {
  const expectedQuestionCount = countExpectedPdfItems(toolSlug, extractedText);
  const canonical = extractCanonicalPdfDocument(extractedText, { toolSlug });
  const mapped = mapCanonicalPdfToToolBulkItems(toolSlug, canonical, extractedText, params);

  if (mapped.items.length > 0 && canonicalMappedItemsAreUsable(toolSlug, mapped.items)) {
    let bulkItems = postProcessCanonicalBulkItems(toolSlug, mapped.items, extractedText, params);
    bulkItems = bulkItems.map((item) => canonicalizeBulkItemForTool(toolSlug, item, extractedText));
    const extractedQuestionCount = countQuestionsInBulkItems(bulkItems);
    const questionMarks = (extractedText.match(/\?/g) || []).length;
    if (toolSlug === 'worksheet-mcq-generator') {
      console.log(
        `[AI PDF] Worksheet zero-LLM: ${extractedQuestionCount} questions from ${extractedText.length} chars (~${questionMarks} ? in text, 0 tokens)`,
      );
    }
    return {
      bulkItems,
      pdfCanonical: canonical,
      generatedResult: null,
      generationMeta: {
        extractionStatus: 'complete',
        validationPassed: true,
        retryCount: 0,
        extractedItemCount: extractedQuestionCount || mapped.items.length,
        expectedItemCount: expectedQuestionCount || extractedQuestionCount || mapped.items.length,
        validationErrors: [],
        generationMode: 'canonical-json',
        parser: mapped.parser,
        ragChunkCount: 0,
        formatSource: 'pdf-canonical-json',
        pdfCanonical: canonical,
      },
    };
  }

  if (ACTIVITY_TOOL_SLUGS.has(toolSlug)) {
    let bulkItems = [];
    let extractionMeta = getLastPdfExtractionMeta();
    try {
      bulkItems = await extractAndGenerateAllItems(toolSlug, extractedText, params);
    } catch (extractErr) {
      console.warn('[AI PDF] Activity extract failed:', extractErr?.message || extractErr);
      bulkItems = [];
    }
    extractionMeta = getLastPdfExtractionMeta();
    if (bulkItems.length) {
      bulkItems = bulkItems.map((item) => canonicalizeBulkItemForTool(toolSlug, item, extractedText));
      return {
        bulkItems,
        pdfCanonical: canonical,
        generatedResult: null,
        generationMeta: {
          extractionStatus: extractionMeta.extractionStatus || 'complete',
          validationPassed: Boolean(extractionMeta.validationPassed),
          retryCount: Number(extractionMeta.retryCount || 0),
          extractedItemCount: bulkItems.length,
          expectedItemCount: bulkItems.length,
          validationErrors: extractionMeta.validationErrors || [],
          generationMode: 'extract',
          ragChunkCount: 0,
          formatSource: 'aiToolTemplates',
          pdfCanonical: canonical,
        },
      };
    }
  }

  if (PDF_QUESTION_DOCUMENT_TOOLS.has(toolSlug)) {
    if (toolSlug === 'worksheet-mcq-generator') {
      const bulkItems = buildWorksheetRegexOnlyBulkItems(extractedText, params);
      const extractedQuestionCount = countQuestionsInBulkItems(bulkItems);
      const questionMarks = (extractedText.match(/\?/g) || []).length;
      console.log(
        `[AI PDF] Worksheet zero-LLM fallback: ${extractedQuestionCount} questions (~${questionMarks} ? in text, 0 tokens)`,
      );
      return {
        bulkItems,
        pdfCanonical: canonical,
        generatedResult: null,
        generationMeta: {
          extractionStatus: extractedQuestionCount > 0 ? 'complete' : 'partial',
          validationPassed: extractedQuestionCount > 0,
          retryCount: 0,
          extractedItemCount: extractedQuestionCount,
          expectedItemCount: expectedQuestionCount || extractedQuestionCount,
          validationErrors: extractedQuestionCount > 0 ? [] : ['No worksheet questions matched regex extractors'],
          generationMode: 'regex-extract',
          parser: 'pdf-worksheet-regex',
          ragChunkCount: 0,
          formatSource: 'pdf-worksheet-extract',
          pdfCanonical: canonical,
        },
      };
    }

    let bulkItems = [];
    let extractionMeta = getLastPdfExtractionMeta();
    try {
      bulkItems = await extractAndGenerateAllItems(toolSlug, extractedText, params);
    } catch (extractErr) {
      console.warn('[AI PDF] Full PDF extract failed:', extractErr?.message || extractErr);
      bulkItems = [];
    }
    extractionMeta = getLastPdfExtractionMeta();

    if (
      (toolSlug === 'homework-creator' ||
        toolSlug === 'mock-test-builder' ||
        toolSlug === 'exam-question-paper-generator' ||
        toolSlug === 'smart-qa-practice-generator') &&
      bulkItems.length > 1
    ) {
      bulkItems = bulkItems.slice(0, 1);
    }

    const extractedQuestionCount = countQuestionsInBulkItems(bulkItems);
    if (bulkItems.length) {
      return {
        bulkItems,
        pdfCanonical: canonical,
        generatedResult: null,
        generationMeta: {
          extractionStatus: extractionMeta.extractionStatus || 'complete',
          validationPassed: Boolean(extractionMeta.validationPassed),
          retryCount: Number(extractionMeta.retryCount || 0),
          extractedItemCount: extractedQuestionCount,
          expectedItemCount: expectedQuestionCount || extractedQuestionCount,
          validationErrors: extractionMeta.validationErrors || [],
          generationMode: 'extract',
          ragChunkCount: 0,
          formatSource: 'aiToolTemplates',
          pdfCanonical: canonical,
        },
      };
    }

    const generatedResult = await generateStructuredContentFromPdf(toolSlug, extractedText, {
      ...params,
      questionCount: expectedQuestionCount > 0 ? expectedQuestionCount : undefined,
    });
    return {
      bulkItems: [generatedResult.structuredContent || {}],
      pdfCanonical: canonical,
      generatedResult,
      generationMeta: {
        extractionStatus: 'complete',
        validationPassed: true,
        retryCount: 0,
        extractedItemCount: 0,
        expectedItemCount: expectedQuestionCount,
        validationErrors: [],
        generationMode: 'rag-fallback',
        ragChunkCount: Number(generatedResult?.ragChunkCount || 0),
        formatSource: 'aiToolTemplates',
        pdfCanonical: canonical,
      },
    };
  }

  const generatedResult = await generateStructuredContentFromPdf(toolSlug, extractedText, params);
  let bulkItems = expandStructuredToFormatItems(
    toolSlug,
    generatedResult?.structuredContent || {},
  );
  if (!Array.isArray(bulkItems) || bulkItems.length === 0) {
    bulkItems = [generatedResult?.structuredContent || {}];
  }

  return {
    bulkItems,
    pdfCanonical: canonical,
    generatedResult,
    generationMeta: {
      extractionStatus: 'complete',
      validationPassed: true,
      retryCount: 0,
      extractedItemCount: 0,
      expectedItemCount: bulkItems.length,
      validationErrors: [],
      generationMode: generatedResult?.generationMode || 'rag',
      ragChunkCount: Number(generatedResult?.ragChunkCount || 0),
      formatSource: 'aiToolTemplates',
      pdfCanonical: canonical,
    },
  };
}

function respondPdfUploadError(err, res) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: `PDF file too large. Maximum size is ${AI_PDF_MAX_MB} MB.`,
    });
  }
  return res.status(400).json({
    success: false,
    message: err?.message || 'PDF upload failed',
  });
}

const pdfStorage = multer.diskStorage({
  destination: function destination(req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/pdf-knowledge');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `pdf-${uniqueSuffix}${ext}`);
  },
});

const pdfUpload = multer({
  storage: pdfStorage,
  limits: { fileSize: AI_PDF_MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (String(file.mimetype || '').includes('pdf')) return cb(null, true);
    return cb(new Error('Only PDF files are allowed'));
  },
});

const toClassLabel = (classValue) => {
  const raw = String(classValue || '').trim();
  if (!raw) return '';
  if (/^class\s+/i.test(raw)) return raw.replace(/\s+/g, ' ').trim();
  if (/^\d+$/.test(raw)) return `Class ${raw}`;
  return raw;
};

const normalizeBoard = (value) => {
  let t = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (t === 'CBSC') t = 'CBSE';
  return t;
};

const toUploadedByRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'super-admin' || normalized === 'admin' || normalized === 'teacher') {
    return normalized;
  }
  return 'admin';
};

const resolveAuthenticatedUserId = (req) => {
  const candidates = [
    req.userId,
    req.user?.userId,
    req.user?.id,
    req.user?._id,
    req.user?.sub,
  ];
  for (const value of candidates) {
    const s = String(value || '').trim();
    if (s) return s;
  }
  return '';
};

const normalizeForMatch = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isSemanticTextMatch = (selectedValue, detectedValue) => {
  const selected = normalizeForMatch(selectedValue);
  const detected = normalizeForMatch(detectedValue);
  if (!selected || !detected) return true;
  if (selected === detected) return true;
  return selected.includes(detected) || detected.includes(selected);
};

const validateSubjectTopicMatch = ({
  selectedSubject,
  selectedTopic,
  detectedSubject,
  detectedTopic,
  subjectTopicValidation,
}) => {
  const geminiSubjectMatched = typeof subjectTopicValidation?.subjectMatched === 'boolean'
    ? subjectTopicValidation.subjectMatched
    : null;
  const geminiTopicMatched = typeof subjectTopicValidation?.topicMatched === 'boolean'
    ? subjectTopicValidation.topicMatched
    : null;

  const fallbackSubjectMatch = isSemanticTextMatch(selectedSubject, detectedSubject);
  const fallbackTopicMatch = isSemanticTextMatch(selectedTopic, detectedTopic);

  const subjectMatched = geminiSubjectMatched === null ? fallbackSubjectMatch : geminiSubjectMatched;
  const topicMatched = geminiTopicMatched === null ? fallbackTopicMatch : geminiTopicMatched;

  return {
    subjectMatched,
    topicMatched,
    reason: String(subjectTopicValidation?.reason || '').trim(),
    confidence: Number(subjectTopicValidation?.confidence || 0),
  };
};

const buildAiToolContentFromPdfSource = (source) => {
  const sections = [];
  sections.push(`Tool: ${getToolLabelFromSlug(String(source.toolType || '').trim()) || source.toolType || '-'}`);
  sections.push(`Class: ${String(source.classLabel || '').trim() || '-'}`);
  sections.push(`Subject: ${String(source.subject || '').trim() || '-'}`);
  sections.push(`Topic: ${String(source.topic || source.chapter || '').trim() || '-'}`);
  sections.push(`Subtopic: ${String(source.subTopic || '').trim() || '-'}`);

  const renderContent = source.renderContent && typeof source.renderContent === 'object'
    ? source.renderContent
    : source.structuredContent;
  const jsonBlock = renderContent ? JSON.stringify(renderContent, null, 2) : '';
  if (jsonBlock) {
    sections.push('Content:');
    sections.push(jsonBlock);
  }

  return sections.join('\n');
};

const syncPdfSourceToAiToolData = async (source) => {
  if (!source?._id) return;
  const toolSlug = String(source.toolType || '').trim();
  const textContent = buildAiToolContentFromPdfSource(source);
  const payload = {
    toolName: toolSlug,
    toolDisplayName: getToolLabelFromSlug(toolSlug) || toolSlug,
    sourceType: 'ai_pdf',
    board: normalizeBoard(source.board || ''),
    classLabel: String(source.classLabel || '').trim(),
    subject: String(source.subject || '').trim(),
    topic: String(source.topic || source.chapter || '').trim(),
    subtopic: String(source.subTopic || '').trim(),
    section: '',
    content: textContent,
    generatedContent: textContent,
    pdfFileUrl: String(source.fileUrl || '').trim(),
    pdfFileName: String(source.originalName || '').trim(),
    generatedBy: source.uploadedBy ?? null,
    status: String(source.processingStatus || 'pending'),
    metadata: {
      board: normalizeBoard(source.board || ''),
      contentEngineSourceId: String(source._id),
      aiPdfSourceId: String(source._id),
      structuredContent: source.structuredContent,
      renderContent: source.renderContent,
      contentType: String(source.contentType || '').trim(),
      approvalStatus: String(source.approvalStatus || 'pending'),
      processingStatus: String(source.processingStatus || 'pending'),
      chunkCount: source.chunkCount || 0,
      processingError: String(source.processingError || '').trim(),
      uploadedByRole: String(source.uploadedByRole || '').trim(),
      geminiDetected: source.geminiDetected,
      validation: source.validation,
    },
  };

  if (source.uploadedBy && mongoose.Types.ObjectId.isValid(source.uploadedBy)) {
    payload.teacherId = source.uploadedBy;
  }

  await AiToolGeneration.findOneAndUpdate(
    {
      $or: [
        { 'metadata.contentEngineSourceId': String(source._id) },
        { 'metadata.aiPdfSourceId': String(source._id) },
      ],
    },
    { $set: payload },
    { upsert: true, new: true },
  );
};

/** Recompute viewer blobs from stored structured fields (fixes stale metadata.renderContent for lesson tools). */
function enrichConceptRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'concept-mastery-helper') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeConceptExtractedItem(structured);
  const ct = String(data.contentType || '').trim() || 'Concept Notes';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildConceptRenderableFromStructured(normalized),
    contentType: ct,
  };
}

function enrichActivityRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'activity-project-generator' && tool !== 'project-idea-lab') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeActivityExtractedItem(structured, tool);
  const ct = String(data.contentType || '').trim() || 'Activity Plan';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildRenderableContent(tool, ct, normalized),
    contentType: ct,
  };
}

function enrichRubricRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'rubrics-evaluation-generator') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeRubricExtractedItem(structured);
  const ct = String(data.contentType || '').trim() || 'Rubric';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildRubricRenderableFromStructured(normalized),
    contentType: ct,
  };
}

function enrichFlashcardRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'my-study-decks' && tool !== 'flashcard-generator') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeFlashcardExtractedItem(structured, tool);
  const ct = String(data.contentType || '').trim() || 'Flashcards';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildFlashcardRenderableFromStructured(normalized, tool),
    contentType: ct,
  };
}

function enrichShortNotesRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'short-notes-summaries-maker') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeShortNotesExtractedItem(structured);
  const ct = String(data.contentType || '').trim() || 'Notes';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildShortNotesRenderableFromStructured(normalized),
    contentType: ct,
  };
}

function enrichStoryRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'reading-practice-room' && tool !== 'story-passage-creator') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeStoryExtractedItem(structured, tool);
  const ct =
    String(data.contentType || '').trim() ||
    (tool === 'reading-practice-room' ? 'Reading Practice' : 'Story');
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildStoryRenderableFromStructured(normalized, tool),
    contentType: ct,
  };
}

function enrichWorksheetRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'worksheet-mcq-generator') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const storedQuestionCount = Object.values(structured.sections || {}).length
    ? (structured.sections || []).reduce(
        (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
        0,
      )
    : Array.isArray(structured.questions)
      ? structured.questions.length
      : 0;
  const pdfText = String(
    data.metadata?.extractedPdfText || data.structuredContent?.extractedPdfText || '',
  ).trim();
  const questionMarks = (pdfText.match(/\?/g) || []).length;
  const needsPdfReparse =
    pdfText.length > 400 &&
    (storedQuestionCount < 2 ||
      (questionMarks > 12 && storedQuestionCount < Math.max(10, Math.floor(questionMarks * 0.45))));
  const sourceText = needsPdfReparse
    ? pdfText
    : storedQuestionCount >= 2
      ? ''
      : pdfText;
  const normalized = canonicalizeWorksheetExtractedItem(structured, sourceText);
  const ct = String(data.contentType || '').trim() || 'Worksheet';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildWorksheetRenderableFromStructured(normalized, sourceText),
    contentType: ct,
  };
}

function enrichHomeworkRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'homework-creator') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeHomeworkExtractedItem(structured);
  const ct = String(data.contentType || '').trim() || 'Homework';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildHomeworkRenderableFromStructured(normalized),
    contentType: ct,
  };
}

function enrichExamPaperRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'mock-test-builder' && tool !== 'exam-question-paper-generator') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeExamPaperExtractedItem(structured, tool);
  const ct =
    String(data.contentType || '').trim() ||
    (tool === 'mock-test-builder' ? 'Mock Test' : 'Exam Paper');
  return {
    ...data,
    structuredContent: normalized,
    renderContent:
      tool === 'mock-test-builder'
        ? buildMockTestRenderableFromStructured(normalized)
        : buildExamPaperRenderableFromStructured(normalized),
    contentType: ct,
  };
}

function enrichDailyClassPlanRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'daily-class-plan-maker') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeDailyClassPlanExtractedItem(structured);
  const ct = String(data.contentType || '').trim() || 'Daily Plan';
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildDailyClassPlanRenderableFromStructured(normalized),
    contentType: ct,
  };
}

function enrichLessonPlanRowForApi(data) {
  if (!data || typeof data !== 'object') return data;
  const tool = String(data.toolType || data.toolName || '').trim();
  if (tool !== 'lesson-planner' && tool !== 'study-schedule-maker') return data;
  let structured =
    data.structuredContent && typeof data.structuredContent === 'object' && !Array.isArray(data.structuredContent)
      ? { ...data.structuredContent }
      : {};
  const normalized = canonicalizeLessonPlannerExtractedItem(structured, tool);
  const ct =
    String(data.contentType || '').trim() ||
    (tool === 'study-schedule-maker' ? 'Study Schedule' : 'Lesson Plan');
  return {
    ...data,
    structuredContent: normalized,
    renderContent: buildLessonPlanRenderableFromStructured(normalized, tool),
    contentType: ct,
  };
}

function mapMasterPdfToListRow(doc) {
  const m = doc.metadata || {};
  const row = {
    _id: doc._id,
    originalName: doc.pdfFileName || m.originalName || '',
    fileUrl: doc.pdfFileUrl || '',
    board: doc.board || m.board || '',
    subject: doc.subject,
    classLabel: doc.classLabel,
    chapter: doc.topic || '',
    topic: doc.topic || '',
    subTopic: doc.subtopic || '',
    processingStatus: m.processingStatus || doc.status || 'pending',
    approvalStatus: m.approvalStatus || 'pending',
    toolType: doc.toolName,
    contentType: m.contentType || '',
    structuredContent:
      m.structuredContent && typeof m.structuredContent === 'object' && !Array.isArray(m.structuredContent)
        ? { ...m.structuredContent }
        : {},
    renderContent:
      m.renderContent && typeof m.renderContent === 'object' && !Array.isArray(m.renderContent)
        ? { ...m.renderContent }
        : {},
    chunkCount: m.chunkCount ?? 0,
    uploadDate: doc.createdAt,
    updatedAt: doc.updatedAt,
    uploadedBy: doc.generatedBy,
    uploadedByRole: m.uploadedByRole || '',
    geminiDetected: m.geminiDetected,
    validation: m.validation,
    generatedContent: String(doc.generatedContent || doc.content || '').trim(),
  };
  const enriched = enrichConceptRowForApi(
    enrichRubricRowForApi(
      enrichHomeworkRowForApi(
        enrichActivityRowForApi(
          enrichLessonPlanRowForApi(
            enrichDailyClassPlanRowForApi(
              enrichExamPaperRowForApi(
                enrichWorksheetRowForApi(
                  enrichStoryRowForApi(enrichShortNotesRowForApi(enrichFlashcardRowForApi(row))),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  const tool = String(enriched.toolType || doc.toolName || '').trim();
  if (tool === 'activity-project-generator' || tool === 'project-idea-lab') {
    enriched.displayTitle = resolveActivityDisplayTitle(
      enriched.structuredContent,
      enriched.generatedContent,
      m,
    );
  }
  return enriched;
}

/** Legacy rows only in aicontentenginesources (no master in aitoolgenerations yet). */
function mapSourcePdfToListRow(source) {
  if (!source) return null;
  const row = {
    _id: source._id,
    originalName: source.originalName || '',
    fileUrl: source.fileUrl || '',
    board: normalizeBoard(source.board || ''),
    subject: source.subject,
    classLabel: source.classLabel,
    chapter: source.chapter || source.topic || '',
    topic: source.topic || '',
    subTopic: source.subTopic || '',
    processingStatus: source.processingStatus || 'pending',
    approvalStatus: source.approvalStatus || 'pending',
    toolType: source.toolType,
    contentType: source.contentType || '',
    structuredContent:
      source.structuredContent && typeof source.structuredContent === 'object' && !Array.isArray(source.structuredContent)
        ? { ...source.structuredContent }
        : {},
    renderContent:
      source.renderContent && typeof source.renderContent === 'object' && !Array.isArray(source.renderContent)
        ? { ...source.renderContent }
        : {},
    chunkCount: source.chunkCount ?? 0,
    uploadDate: source.uploadDate || source.createdAt,
    updatedAt: source.updatedAt,
    uploadedBy: source.uploadedBy,
    uploadedByRole: source.uploadedByRole || '',
    geminiDetected: source.geminiDetected,
    validation: source.validation,
  };
  return enrichConceptRowForApi(
    enrichHomeworkRowForApi(
      enrichActivityRowForApi(
        enrichLessonPlanRowForApi(
          enrichDailyClassPlanRowForApi(
            enrichExamPaperRowForApi(
              enrichWorksheetRowForApi(
                enrichStoryRowForApi(enrichShortNotesRowForApi(enrichFlashcardRowForApi(row))),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** Shallow title fields for list previews without shipping full structured blobs. */
function pickTitleFieldsForListPreview(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const key of ['title', 'name', 'concept_name', 'lesson_name', 'deckTitle', 'front']) {
    if (obj[key] != null && String(obj[key]).trim()) out[key] = obj[key];
  }
  if (Array.isArray(obj.cards) && obj.cards[0] && typeof obj.cards[0] === 'object') {
    const c = obj.cards[0];
    out.cards = [{ front: c.front, title: c.title }];
  }
  return out;
}

function mapMasterPdfToSummaryRow(doc) {
  const m = doc.metadata || {};
  const sc =
    m.structuredContent && typeof m.structuredContent === 'object' && !Array.isArray(m.structuredContent)
      ? m.structuredContent
      : {};
  const rc =
    m.renderContent && typeof m.renderContent === 'object' && !Array.isArray(m.renderContent)
      ? m.renderContent
      : {};
  const tool = String(doc.toolName || '').trim();
  const row = {
    _id: doc._id,
    originalName: doc.pdfFileName || m.originalName || '',
    fileUrl: doc.pdfFileUrl || '',
    board: doc.board || m.board || '',
    subject: doc.subject,
    classLabel: doc.classLabel,
    chapter: doc.topic || '',
    topic: doc.topic || '',
    subTopic: doc.subtopic || '',
    processingStatus: m.processingStatus || doc.status || 'pending',
    approvalStatus: m.approvalStatus || 'pending',
    toolType: doc.toolName,
    contentType: m.contentType || '',
    structuredContent: pickTitleFieldsForListPreview(sc),
    renderContent: pickTitleFieldsForListPreview(rc),
    chunkCount: m.chunkCount ?? 0,
    uploadDate: doc.createdAt,
    updatedAt: doc.updatedAt,
    uploadedBy: doc.generatedBy,
    uploadedByRole: m.uploadedByRole || '',
    metadata: {
      bulkItemIndex: m.bulkItemIndex,
      itemIndex: m.itemIndex,
    },
  };
  if (tool === 'activity-project-generator' || tool === 'project-idea-lab') {
    row.displayTitle = resolveActivityDisplayTitle(sc, '', m);
  }
  return row;
}

function mapSourcePdfToSummaryRow(source) {
  if (!source) return null;
  const sc =
    source.structuredContent && typeof source.structuredContent === 'object' && !Array.isArray(source.structuredContent)
      ? source.structuredContent
      : {};
  const rc =
    source.renderContent && typeof source.renderContent === 'object' && !Array.isArray(source.renderContent)
      ? source.renderContent
      : {};
  const tool = String(source.toolType || '').trim();
  const row = {
    _id: source._id,
    originalName: source.originalName || '',
    fileUrl: source.fileUrl || '',
    board: normalizeBoard(source.board || ''),
    subject: source.subject,
    classLabel: source.classLabel,
    chapter: source.chapter || source.topic || '',
    topic: source.topic || '',
    subTopic: source.subTopic || '',
    processingStatus: source.processingStatus || 'pending',
    approvalStatus: source.approvalStatus || 'pending',
    toolType: source.toolType,
    contentType: source.contentType || '',
    structuredContent: pickTitleFieldsForListPreview(sc),
    renderContent: pickTitleFieldsForListPreview(rc),
    chunkCount: source.chunkCount ?? 0,
    uploadDate: source.uploadDate || source.createdAt,
    updatedAt: source.updatedAt,
    uploadedBy: source.uploadedBy,
    uploadedByRole: source.uploadedByRole || '',
  };
  if (tool === 'activity-project-generator' || tool === 'project-idea-lab') {
    row.displayTitle = resolveActivityDisplayTitle(sc, '', source);
  }
  return row;
}

function buildPdfListMasterMatch(query) {
  const { board, subject, class: classInput, status } = query;
  const filter = { sourceType: 'ai_pdf' };
  if (board) filter.board = boardMongoMatch(normalizeBoard(board));
  if (subject) filter.subject = String(subject).trim();
  if (classInput) filter.classLabel = toClassLabel(classInput);
  if (status) {
    filter.$or = [
      { status: String(status).trim() },
      { 'metadata.processingStatus': String(status).trim() },
    ];
  }
  return filter;
}

function buildPdfListOrphanMatch(query, linkedObjectIds) {
  const { board, subject, class: classInput, status } = query;
  const orphanFilter = {};
  if (board) orphanFilter.board = boardMongoMatch(normalizeBoard(board));
  if (subject) orphanFilter.subject = String(subject).trim();
  if (classInput) orphanFilter.classLabel = toClassLabel(classInput);
  if (status) orphanFilter.processingStatus = String(status).trim();
  if (linkedObjectIds.length > 0) {
    orphanFilter._id = { $nin: linkedObjectIds };
  }
  return orphanFilter;
}

async function collectLinkedSourceObjectIds(masterMatch) {
  const grouped = await AiToolGeneration.aggregate([
    { $match: masterMatch },
    {
      $project: {
        ids: ['$metadata.contentEngineSourceId', '$metadata.aiPdfSourceId'],
      },
    },
    { $unwind: '$ids' },
    {
      $match: {
        ids: { $exists: true, $nin: [null, ''] },
      },
    },
    { $group: { _id: '$ids' } },
  ]);
  return grouped
    .map((row) => String(row._id || '').trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

const PDF_LIST_SUMMARY_MASTER_SELECT = [
  'board',
  'subject',
  'classLabel',
  'topic',
  'subtopic',
  'toolName',
  'pdfFileName',
  'pdfFileUrl',
  'createdAt',
  'updatedAt',
  'status',
  'metadata.contentType',
  'metadata.processingStatus',
  'metadata.approvalStatus',
  'metadata.chunkCount',
  'metadata.originalName',
  'metadata.displayTitle',
  'metadata.bulkItemIndex',
  'metadata.itemIndex',
  'metadata.uploadedByRole',
  'metadata.structuredContent.title',
  'metadata.structuredContent.name',
  'metadata.structuredContent.concept_name',
  'metadata.structuredContent.lesson_name',
  'metadata.structuredContent.deckTitle',
  'metadata.renderContent.title',
  'metadata.renderContent.concept_name',
].join(' ');

const PDF_LIST_SUMMARY_SOURCE_SELECT = [
  'board',
  'subject',
  'classLabel',
  'chapter',
  'topic',
  'subTopic',
  'toolType',
  'contentType',
  'originalName',
  'fileUrl',
  'uploadDate',
  'createdAt',
  'updatedAt',
  'processingStatus',
  'approvalStatus',
  'chunkCount',
  'uploadedBy',
  'uploadedByRole',
  'structuredContent.title',
  'structuredContent.name',
  'structuredContent.concept_name',
  'structuredContent.deckTitle',
  'renderContent.title',
].join(' ');

async function aggregateAiPdfTokenUsage(masterMatch = {}) {
  const rows = await AiToolGeneration.aggregate([
    {
      $match: {
        sourceType: 'ai_pdf',
        'metadata.tokenUsage.totals.totalTokens': { $gt: 0 },
        ...masterMatch,
      },
    },
    {
      $group: {
        _id: null,
        totalTokens: { $sum: '$metadata.tokenUsage.totals.totalTokens' },
        promptTokens: { $sum: '$metadata.tokenUsage.totals.promptTokens' },
        completionTokens: { $sum: '$metadata.tokenUsage.totals.completionTokens' },
        totalCalls: { $sum: '$metadata.tokenUsage.totals.callCount' },
        generationCount: { $sum: 1 },
      },
    },
  ]).catch(() => []);
  const hit = rows[0] || {};
  return {
    totalTokens: Number(hit.totalTokens || 0),
    promptTokens: Number(hit.promptTokens || 0),
    completionTokens: Number(hit.completionTokens || 0),
    totalCalls: Number(hit.totalCalls || 0),
    generationCount: Number(hit.generationCount || 0),
  };
}

async function fetchPaginatedPdfList({ query, page, limit, summary }) {
  const masterMatch = buildPdfListMasterMatch(query);
  const skip = (page - 1) * limit;
  const orphanBaseMatch = buildPdfListOrphanMatch(query, []);

  const masterQuery = AiToolGeneration.find(masterMatch)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  if (summary) {
    masterQuery.select(PDF_LIST_SUMMARY_MASTER_SELECT);
  }

  const [masterCount, masterDocs] = await Promise.all([
    AiToolGeneration.countDocuments(masterMatch),
    masterQuery,
  ]);

  let orphanDocs = [];

  if (masterDocs.length < limit) {
    const linkedObjectIds = await collectLinkedSourceObjectIds(masterMatch);
    const linkedIdSet = new Set(linkedObjectIds.map((id) => String(id)));
    const need = limit - masterDocs.length;
    const orphanQuery = AiContentEngineSource.find(orphanBaseMatch)
      .sort({ uploadDate: -1 })
      .limit(Math.min(need + linkedIdSet.size, 200))
      .lean();
    if (summary) {
      orphanQuery.select(PDF_LIST_SUMMARY_SOURCE_SELECT);
    }
    const orphanDocsRaw = await orphanQuery;
    orphanDocs = orphanDocsRaw.filter((doc) => !linkedIdSet.has(String(doc._id))).slice(0, need);
  }

  const mapRow = (payload, kind) => {
    if (!payload) return null;
    if (kind === 'master') {
      return summary ? mapMasterPdfToSummaryRow(payload) : mapMasterPdfToListRow(payload);
    }
    return summary ? mapSourcePdfToSummaryRow(payload) : mapSourcePdfToListRow(payload);
  };

  const merged = [
    ...masterDocs.map((payload) => ({
      sortDate: payload.createdAt,
      kind: 'master',
      row: mapRow(payload, 'master'),
    })),
    ...orphanDocs.map((payload) => ({
      sortDate: payload.uploadDate || payload.createdAt,
      kind: 'orphan',
      row: mapRow(payload, 'orphan'),
    })),
  ]
    .sort((a, b) => new Date(b.sortDate || 0).getTime() - new Date(a.sortDate || 0).getTime());

  const data = merged.map((entry) => entry.row).filter((row) => row && !isDeprecatedPdfListRow(row));
  const total = masterCount;

  const tokenUsageSummary = await aggregateAiPdfTokenUsage(masterMatch);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    tokenUsageSummary,
  };
}

async function purgePdfSourceDocument(sourceId) {
  const sid = String(sourceId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(sid)) return;
  const srcDoc = await AiContentEngineSource.findById(sid).lean();
  if (!srcDoc?._id) return;
  await AiContentEngineChunk.deleteMany({ sourcePdfId: srcDoc._id });
  await deleteFromConfiguredStorage({
    storageKey: srcDoc.storageKey,
    fileUrl: srcDoc.fileUrl,
    storageProvider: srcDoc.storageProvider,
  });
  await AiContentEngineSource.findByIdAndDelete(srcDoc._id);
}

async function countMastersForPdfSource(sourceIdStr) {
  if (!sourceIdStr) return 0;
  return AiToolGeneration.countDocuments({
    $or: [
      { 'metadata.contentEngineSourceId': sourceIdStr },
      { 'metadata.aiPdfSourceId': sourceIdStr },
    ],
  });
}

async function resolvePdfMasterAndSource(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return { master: null, source: null };
  const master = await AiToolGeneration.findOne({ _id: id, sourceType: 'ai_pdf' }).lean();
  if (master) {
    const ceId = master.metadata?.contentEngineSourceId || master.metadata?.aiPdfSourceId;
    if (ceId) {
      const source = await AiContentEngineSource.findById(ceId).lean();
      return { master, source };
    }
    return { master, source: null };
  }
  const source = await AiContentEngineSource.findById(id).lean();
  if (!source) return { master: null, source: null };
  const m = await AiToolGeneration.findOne({
    $or: [
      { 'metadata.contentEngineSourceId': String(source._id) },
      { 'metadata.aiPdfSourceId': String(source._id) },
    ],
  }).lean();
  return { master: m, source };
}

/** Resolve request id to AiContentEngineSource _id (handles master row id from aitoolgenerations). */
async function resolveContentEngineSourceId(rawId) {
  if (!mongoose.Types.ObjectId.isValid(rawId)) return null;
  const direct = await AiContentEngineSource.findById(rawId).select('_id').lean();
  if (direct) return String(direct._id);
  const { source } = await resolvePdfMasterAndSource(rawId);
  return source?._id ? String(source._id) : null;
}

// POST /api/pdf/analyze — extract text + Gemini classification only (no DB save)
router.post(
  '/pdf/analyze',
  verifyToken,
  authorizeRoles('teacher', 'admin', 'super-admin'),
  (req, res, next) => {
    pdfUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      return respondPdfUploadError(err, res);
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
      }

      let extractedText = '';
      try {
        extractedText = await extractTextFromPdfBuffer(fs.readFileSync(req.file.path));
      } catch {
        try {
          fs.unlink(req.file.path, () => {});
        } catch {
          // ignore
        }
        return res.status(400).json({ success: false, message: 'Invalid or corrupted PDF. Could not extract text.' });
      }

      try {
        fs.unlink(req.file.path, () => {});
      } catch {
        // ignore
      }

      if (!extractedText || !extractedText.trim()) {
        return res.status(400).json({ success: false, message: 'Empty extraction from PDF. Upload a readable educational PDF.' });
      }

      let analysis;
      try {
        analysis = await classifyPdfContentWithFallback(extractedText, {});
      } catch (geminiError) {
        return res.status(502).json({
          success: false,
          message: `Gemini analysis failed: ${geminiError.message || 'Unknown error'}`,
        });
      }

      return res.json({
        success: true,
        data: {
          classLabel: toClassLabel(analysis.classLabel || ''),
          subject: analysis.subject || '',
          topic: analysis.topic || '',
          subTopic: analysis.subTopic || '',
          suggestedToolSlug: resolveToolSlugFromLabel(analysis.bestMatchingToolLabel) || '',
          suggestedToolLabel: analysis.bestMatchingToolLabel || '',
          confidence: analysis.subjectTopicValidation?.confidence || 0,
          analysisMode: analysis.analysisMode || 'gemini',
        },
      });
    } catch (error) {
      console.error('PDF analyze error:', error);
      return res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
    }
  },
);

// POST /api/pdf/upload
router.post(
  '/pdf/upload',
  verifyToken,
  authorizeRoles('teacher', 'admin', 'super-admin'),
  (req, res, next) => {
    pdfUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      return respondPdfUploadError(err, res);
    });
  },
  async (req, res) => {
    try {
      const { board, subject, class: classInput, chapter, topic, subTopic, toolType } = req.body;
      const uploaderId = resolveAuthenticatedUserId(req);
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
      }
      if (!subject || !classInput || !chapter) {
        return res.status(400).json({ success: false, message: 'subject, class and chapter are required' });
      }
      if (!toolType || !String(toolType).trim()) {
        return res.status(400).json({ success: false, message: 'toolType is required' });
      }
      const resolvedToolSlugEarly = String(toolType || '').trim();
      if (
        resolvedToolSlugEarly === 'story-passage-creator' ||
        resolvedToolSlugEarly === 'reading-practice-room'
      ) {
        const { isStoryPassageAllowedSubject, STORY_PASSAGE_SUBJECT_ERROR } = await import(
          '../utils/story-passage-subject.js'
        );
        const subjectCheck = String(req.body.subjectLabel || req.body.subject || '').trim();
        if (!isStoryPassageAllowedSubject(subjectCheck)) {
          return res.status(400).json({ success: false, message: STORY_PASSAGE_SUBJECT_ERROR });
        }
      }
      if (isDeprecatedAiToolIdentifier(toolType)) {
        return res.status(400).json({
          success: false,
          message:
            'This tool format is no longer supported. Choose one of the 17 curriculum tools (e.g. Lesson Planner, Homework Creator).',
        });
      }
      if (!uploaderId) {
        console.error('AI PDF upload auth id missing:', {
          reqUserId: req.userId,
          reqUser: req.user,
        });
        return res.status(400).json({ success: false, message: 'Invalid authenticated user for upload.' });
      }

      const fileUrl = `/uploads/pdf-knowledge/${req.file.filename}`;
      let extractedText = '';
      try {
        extractedText = await extractTextFromPdfBuffer(fs.readFileSync(req.file.path));
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid or corrupted PDF. Could not extract text.' });
      }
      if (!extractedText) {
        return res.status(400).json({ success: false, message: 'Empty extraction from PDF. Upload a readable educational PDF.' });
      }

      const resolvedToolSlug = String(toolType || '').trim();
      const useZeroLlmCanonicalPath = canUseZeroLlmCanonicalPath(resolvedToolSlug, extractedText);
      let tokenUsage = useZeroLlmCanonicalPath ? ZERO_LLM_TOKEN_USAGE : null;

      let analysis;
      if (useZeroLlmCanonicalPath) {
        analysis = buildLocalPdfAnalysisFromSelection({
          subject: String(subject || '').trim(),
          classLabel: toClassLabel(classInput),
          chapter: String(chapter || '').trim(),
          topic: String(topic || '').trim(),
          subTopic: String(subTopic || '').trim(),
          toolType: resolvedToolSlug,
        });
        console.log('[AI PDF] Zero-LLM canonical path: PDF→JSON→tool format (no Gemini classify, no RAG)');
      } else {
        beginTokenUsageSession('ai-pdf-upload');
        try {
          analysis = await classifyPdfContentWithFallback(extractedText, {
            subject: String(subject || '').trim(),
            classLabel: toClassLabel(classInput),
            chapter: String(chapter || '').trim(),
            topic: String(topic || '').trim(),
            subTopic: String(subTopic || '').trim(),
            toolType: resolvedToolSlug,
          });
        } catch (geminiError) {
          tokenUsage = endTokenUsageSession();
          return res.status(502).json({
            success: false,
            message: `Gemini analysis failed: ${geminiError.message || 'Unknown error'}`,
            tokenUsage,
          });
        }
      }

      if (analysis.isFallback) {
        console.warn('[AI PDF] Using fallback analysis. Reason:', analysis.fallbackReason);
      }

      const detectedToolSlug = resolveToolSlugFromLabel(analysis.bestMatchingToolLabel) || '';
      if (detectedToolSlug && detectedToolSlug !== resolvedToolSlug) {
        console.warn(
          `[AI PDF] Tool override: user selected "${resolvedToolSlug}", Gemini detected "${detectedToolSlug}". Using user selection.`,
        );
      }

      const selectedSubject = String(subject || '').trim();
      const selectedTopic = String(topic || chapter || '').trim();
      const detectedSubject = String(analysis.subject || '').trim();
      const detectedTopic = String(analysis.topic || '').trim();
      const subjectTopicMatch = validateSubjectTopicMatch({
        selectedSubject,
        selectedTopic,
        detectedSubject,
        detectedTopic,
        subjectTopicValidation: analysis.subjectTopicValidation,
      });
      const subjectMatched = subjectTopicMatch.subjectMatched;
      const topicMatched = subjectTopicMatch.topicMatched;
      if (!subjectMatched || !topicMatched) {
        console.warn(
          `[AI PDF] Subject/topic mismatch detected but proceeding with user selection. Selected: ${selectedSubject}/${selectedTopic}, Detected: ${detectedSubject}/${detectedTopic}`,
        );
      }

      const bulkParseParams = {
        board: normalizeBoard(board),
        classLabel: toClassLabel(classInput),
        subject: selectedSubject,
        topic: String(topic || chapter || '').trim(),
        subtopic: String(subTopic || '').trim(),
      };

      let generatedResult;
      let generationMeta;
      let bulkItems = [];
      try {
        const resolved = await resolvePdfUploadBulkItems(
          resolvedToolSlug,
          extractedText,
          bulkParseParams,
        );
        bulkItems = resolved.bulkItems;
        generatedResult = resolved.generatedResult;
        generationMeta = resolved.generationMeta;
      } catch (genErr) {
        if (!useZeroLlmCanonicalPath) tokenUsage = endTokenUsageSession();
        console.warn('[AI PDF] PDF processing failed:', genErr?.message || genErr);
        try {
          fs.unlink(req.file.path, () => {});
        } catch {
          // ignore
        }
        return res.status(502).json({
          success: false,
          code: 'PDF_GENERATION_FAILED',
          message: genErr?.message || 'Failed to process PDF content.',
          toolType: resolvedToolSlug,
          tokenUsage,
        });
      }

      if (!useZeroLlmCanonicalPath) tokenUsage = endTokenUsageSession();

      if (Array.isArray(bulkItems) && bulkItems.length > 0) {
        const fileUrl = `/uploads/pdf-knowledge/${req.file.filename}`;
        let uploaded = {
          fileName: req.file.filename,
          fileUrl,
          storageProvider: 'local',
          storageKey: '',
          shouldDeleteLocal: false,
        };
        try {
          uploaded = await uploadPdfToConfiguredStorage({
            localPath: req.file.path,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
          });
        } catch (storageError) {
          console.error('Cloud upload failed, keeping local storage:', storageError.message);
        }
        if (uploaded.shouldDeleteLocal) {
          try {
            fs.unlinkSync(req.file.path);
          } catch {
            // ignore
          }
        }

        const inferredContentType =
          String(generatedResult?.contentType || analysis.contentType || '').trim() || 'Generated Content';
        const skipRagIndexing = shouldSkipPdfRagIndexing(resolvedToolSlug, generationMeta);
        const source = await AiContentEngineSource.create({
          fileName: uploaded.fileName,
          originalName: req.file.originalname,
          fileUrl: uploaded.fileUrl,
          storageProvider: uploaded.storageProvider,
          storageKey: uploaded.storageKey,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          board: normalizeBoard(board),
          subject: selectedSubject,
          classLabel: toClassLabel(classInput),
          chapter: String(chapter).trim(),
          topic: String(topic || analysis.topic || chapter || '').trim(),
          subTopic: String(subTopic || analysis.subTopic || '').trim(),
          toolType: resolvedToolSlug,
          contentType: inferredContentType,
          ...(skipRagIndexing
            ? {
                processingStatus: 'processed',
                extractedTextLength: extractedText.length,
                chunkCount: 0,
                lastProcessedAt: new Date(),
              }
            : {}),
          structuredContent: {
            bulkUpload: true,
            generationMode: generationMeta?.generationMode || 'rag',
            pdfCanonical: generationMeta?.pdfCanonical || null,
            extractedPdfText: String(extractedText || '').slice(0, 200000),
            tokenUsage,
            itemCount: bulkItems.length,
            items: bulkItems.map((it, idx) => ({
              index: idx,
              slNo: it.sl_no ?? it.question_number,
              title:
                (resolvedToolSlug === 'my-study-decks' || resolvedToolSlug === 'flashcard-generator'
                  ? it.front || it.title
                  : it.title) ||
                it.name ||
                it.concept_name ||
                it.question ||
                it.lesson_name ||
                '',
            })),
          },
          renderContent: buildBulkRenderContent(resolvedToolSlug, inferredContentType, bulkItems[0] || {}),
          geminiDetected: {
            classLabel: String(analysis.classLabel || ''),
            subject: String(analysis.subject || ''),
            topic: String(analysis.topic || ''),
            subTopic: String(analysis.subTopic || ''),
            bestMatchingToolLabel: String(analysis.bestMatchingToolLabel || ''),
            contentType: String(analysis.contentType || ''),
          },
          analysisStatus: 'analyzed',
          approvalStatus: 'pending',
          validation: {
            toolMatched: Boolean(detectedToolSlug && resolvedToolSlug && detectedToolSlug === resolvedToolSlug),
            mismatchReason: analysis.isFallback ? String(analysis.fallbackReason || 'Fallback analysis mode') : '',
            subjectTopicMatched: Boolean(subjectMatched && topicMatched),
            subjectTopicReason: subjectTopicMatch.reason || '',
            subjectTopicConfidence: subjectTopicMatch.confidence || 0,
          },
          uploadedBy: uploaderId,
          uploadedByRole: toUploadedByRole(req.user?.role),
        });

        const generatedByAI = PDF_EXTRACT_GENERATION_MODES.has(generationMeta?.generationMode)
          ? 0
          : bulkItems.length;
        const extractedFromPdf = PDF_EXTRACT_GENERATION_MODES.has(generationMeta?.generationMode)
          ? countQuestionsInBulkItems(bulkItems) || bulkItems.length
          : 0;
        const now = new Date();
        const records = bulkItems.map((item, index) => {
          const metaClean = { ...item };
          delete metaClean._fromPdf;
          delete metaClean._fromAiGeneration;
          const structuredForRow = canonicalizeBulkItemForTool(
            resolvedToolSlug,
            metaClean,
            extractedText,
          );
          let contentStr =
            bulkItems.length === 1 && generatedResult?.generatedContent
              ? String(generatedResult.generatedContent)
              : formatItemToContent(resolvedToolSlug, structuredForRow, index);
          if (resolvedToolSlug === 'activity-project-generator' || resolvedToolSlug === 'project-idea-lab') {
            const fromMd = extractActivityTitleFromMarkdown(contentStr);
            const titleBad =
              !structuredForRow?.title ||
              isCurriculumBreadcrumbTitle(structuredForRow.title) ||
              /^Untitled Activity\b/i.test(String(structuredForRow.title || ''));
            if (fromMd && titleBad) {
              structuredForRow = { ...structuredForRow, title: fromMd, name: fromMd };
              contentStr = formatItemToContent(resolvedToolSlug, structuredForRow, index);
            }
          }
          return {
            toolName: resolvedToolSlug,
            toolDisplayName: getToolLabelFromSlug(resolvedToolSlug) || resolvedToolSlug,
            sourceType: 'ai_pdf',
            board: normalizeBoard(board),
            classLabel: toClassLabel(classInput),
            subject: selectedSubject,
            topic: String(topic || analysis.topic || chapter || '').trim(),
            subtopic: String(subTopic || analysis.subTopic || '').trim(),
            content: contentStr,
            generatedContent: contentStr,
            pdfFileUrl: String(uploaded.fileUrl || '').trim(),
            pdfFileName: String(req.file.originalname || '').trim(),
            generatedBy: uploaderId,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            metadata: {
              board: normalizeBoard(board),
              contentEngineSourceId: String(source._id),
              aiPdfSourceId: String(source._id),
              bulkItemIndex: index,
              bulkItemCount: bulkItems.length,
              structuredContent: structuredForRow,
              renderContent: buildBulkRenderContent(resolvedToolSlug, inferredContentType, structuredForRow),
              contentType: inferredContentType,
              approvalStatus: 'pending',
              processingStatus: 'processed',
              uploadedByRole: toUploadedByRole(req.user?.role),
              generatedByAI: !PDF_EXTRACT_GENERATION_MODES.has(generationMeta?.generationMode),
              sourceLabel:
                generationMeta?.generationMode === 'canonical-json'
                  ? 'PDF Upload (Canonical JSON)'
                  : PDF_EXTRACT_GENERATION_MODES.has(generationMeta?.generationMode)
                    ? 'PDF Upload (Full Extract)'
                    : 'PDF Upload (AI Generated)',
              formatSource: generationMeta?.formatSource || 'aiToolTemplates',
              pdfCanonical: generationMeta?.pdfCanonical || null,
              extractedPdfText:
                resolvedToolSlug === 'worksheet-mcq-generator'
                  ? String(extractedText || '').slice(0, 200000)
                  : '',
              generationMode: generationMeta.generationMode,
              ragChunkCount: generationMeta.ragChunkCount,
              geminiDetected: {
                classLabel: String(analysis.classLabel || ''),
                subject: String(analysis.subject || ''),
                topic: String(analysis.topic || ''),
                subTopic: String(analysis.subTopic || ''),
                bestMatchingToolLabel: String(analysis.bestMatchingToolLabel || ''),
                contentType: String(analysis.contentType || ''),
              },
              validation: {
                toolMatched: Boolean(detectedToolSlug && resolvedToolSlug && detectedToolSlug === resolvedToolSlug),
                mismatchReason: analysis.isFallback ? String(analysis.fallbackReason || 'Fallback analysis mode') : '',
                subjectTopicMatched: Boolean(subjectMatched && topicMatched),
                subjectTopicReason: subjectTopicMatch.reason || '',
                subjectTopicConfidence: subjectTopicMatch.confidence || 0,
              },
              extractionStatus: generationMeta.extractionStatus,
              validationPassed: Boolean(generationMeta.validationPassed),
              retryCount: Number(generationMeta.retryCount || 0),
              extractedItemCount: Number(generationMeta.extractedItemCount || 0),
              expectedItemCount: Number(generationMeta.expectedItemCount || bulkItems.length),
              validationErrors: generationMeta.validationErrors || [],
              ...(index === 0 ? { tokenUsage } : {}),
            },
          };
        });

        const inserted = await AiToolGeneration.insertMany(records, { ordered: false });
        const firstId = inserted[0]?._id;
        console.log(
          `[AI PDF] Bulk save: ${bulkItems.length} row(s), mode=${generationMeta?.generationMode || 'unknown'}, questions=${countQuestionsInBulkItems(bulkItems)}, tokens=${tokenUsage?.totals?.totalTokens || 0} (${tokenUsage?.totals?.callCount || 0} LLM calls)`,
        );

        if (!skipRagIndexing) {
          processPdfSourceWithModels(source._id, {
            sourceModel: AiContentEngineSource,
            chunkModel: AiContentEngineChunk,
          }).catch((processErr) => {
            console.warn('[AI PDF] Background chunk/embed failed (non-fatal):', processErr?.message || processErr);
          });
        }

        return res.status(201).json({
          success: true,
          data: {
            id: firstId,
            sourcePdfId: source._id,
            totalSaved: bulkItems.length,
            extractedFromPdf,
            generatedByAI,
            fileName: source.originalName,
            subject: source.subject,
            class: source.classLabel,
            chapter: source.chapter,
            topic: source.topic,
            subTopic: source.subTopic,
            toolType: source.toolType,
            contentType: source.contentType,
            approvalStatus: source.approvalStatus,
            uploadedBy: source.uploadedBy,
            uploadDate: source.uploadDate,
            processingStatus: source.processingStatus,
            analysisMode: analysis.analysisMode || 'gemini',
            extraction: {
              extractionStatus: generationMeta.extractionStatus,
              validationPassed: Boolean(generationMeta.validationPassed),
              retryCount: Number(generationMeta.retryCount || 0),
              extractedItemCount: Number(generationMeta.extractedItemCount || 0),
              expectedItemCount: Number(generationMeta.expectedItemCount || bulkItems.length),
              validationErrors: generationMeta.validationErrors || [],
              generationMode: generationMeta.generationMode,
              parser: generationMeta.parser || '',
              ragChunkCount: generationMeta.ragChunkCount,
              pdfCanonical: generationMeta.pdfCanonical || null,
            },
            tokenUsage,
          },
        });
      }

      if (!useZeroLlmCanonicalPath) endTokenUsageSession();
      try {
        fs.unlink(req.file.path, () => {});
      } catch {
        // ignore
      }
      return res.status(422).json({
        success: false,
        code: 'PDF_GENERATION_EMPTY',
        message: 'No content could be generated from this PDF for the selected tool.',
        toolType: resolvedToolSlug,
      });
    } catch (error) {
      console.error('AI PDF upload error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
    }
  }
);

// POST /api/pdf/process
router.post('/pdf/process', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { sourcePdfId, async: runAsync } = req.body;
    if (!sourcePdfId) {
      return res.status(400).json({ success: false, message: 'sourcePdfId is required' });
    }
    const resolvedSourceId = await resolveContentEngineSourceId(String(sourcePdfId));
    if (!resolvedSourceId) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    if (runAsync) {
      // Keep AI PDF processing isolated from shared queue schema.
      const queued = { enqueued: false, jobId: null };
      if (!queued.enqueued) {
        processPdfSourceWithModels(resolvedSourceId, {
          sourceModel: AiContentEngineSource,
          chunkModel: AiContentEngineChunk,
        })
          .then(async () => {
            const refreshed = await AiContentEngineSource.findById(resolvedSourceId);
            if (refreshed) {
              try {
                await syncPdfSourceToAiToolData(refreshed);
              } catch (syncError) {
                console.error('AI PDF async post-process master sync failed (non-fatal):', syncError);
              }
              try {
                const arch = await archiveSupersededSources({
                  sourceModel: AiContentEngineSource,
                  chunkModel: AiContentEngineChunk,
                  newSource: refreshed,
                });
                if (arch.archivedCount > 0) {
                  console.log(
                    `Re-upload hygiene: archived ${arch.archivedCount} older source(s), deleted ${arch.deletedChunks} stale chunks for (${refreshed.subject} | ${refreshed.classLabel} | ${refreshed.chapter})`
                  );
                }
              } catch (archErr) {
                console.error('Re-upload hygiene async failed (non-fatal):', archErr.message);
              }
            }
          })
          .catch((err) => {
            console.error('Async PDF process failed:', err.message);
          });
      }
      return res.json({
        success: true,
        data: {
          sourceId: resolvedSourceId,
          status: 'processing-started',
          queueEnabled: isPdfQueueEnabled(),
          jobId: queued.jobId || null,
        },
      });
    }
    const result = await processPdfSourceWithModels(resolvedSourceId, {
      sourceModel: AiContentEngineSource,
      chunkModel: AiContentEngineChunk,
    });
    const refreshed = await AiContentEngineSource.findById(resolvedSourceId);
    let archiveResult = null;
    if (refreshed) {
      try {
        await syncPdfSourceToAiToolData(refreshed);
      } catch (syncError) {
        console.error('AI PDF post-process master sync failed (non-fatal):', syncError);
      }
      try {
        archiveResult = await archiveSupersededSources({
          sourceModel: AiContentEngineSource,
          chunkModel: AiContentEngineChunk,
          newSource: refreshed,
        });
        if (archiveResult.archivedCount > 0) {
          console.log(
            `Re-upload hygiene: archived ${archiveResult.archivedCount} older source(s), deleted ${archiveResult.deletedChunks} stale chunks for (${refreshed.subject} | ${refreshed.classLabel} | ${refreshed.chapter})`
          );
        }
      } catch (archErr) {
        console.error('Re-upload hygiene failed (non-fatal):', archErr.message);
      }
    }
    return res.json({ success: true, data: { ...result, archived: archiveResult } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Processing failed' });
  }
});

// GET /api/pdf/list — masters in aitoolgenerations + legacy-only aicontentenginesources
// Query: summary=1 (default) returns lightweight rows; paginated at DB level (not in-memory).
router.get('/pdf/list', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const summary =
      req.query.summary === undefined ||
      req.query.summary === '' ||
      req.query.summary === '1' ||
      req.query.summary === 'true';
    const { data, pagination, tokenUsageSummary } = await fetchPaginatedPdfList({
      query: req.query,
      page,
      limit,
      summary,
    });
    return res.json({
      success: true,
      data,
      pagination,
      tokenUsageSummary,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch list' });
  }
});

async function deletePdfRecordById(requestedId) {
  const id = String(requestedId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { ok: false, status: 400, message: 'Invalid id' };
  }

  const { master, source } = await resolvePdfMasterAndSource(id);
  if (!source && !master) {
    return { ok: false, status: 404, message: 'PDF source not found' };
  }

  const bindSourceIdStr =
    source?._id != null
      ? String(source._id)
      : master?.metadata?.contentEngineSourceId || master?.metadata?.aiPdfSourceId
        ? String(master.metadata.contentEngineSourceId || master.metadata.aiPdfSourceId)
        : '';

  if (master && String(master._id) === id) {
    await AiToolGeneration.findByIdAndDelete(master._id);
    let message = 'Record deleted';
    if (bindSourceIdStr) {
      const remaining = await countMastersForPdfSource(bindSourceIdStr);
      if (remaining === 0) {
        await purgePdfSourceDocument(bindSourceIdStr);
        message = 'Record and PDF source deleted';
      }
    }
    return { ok: true, message };
  }

  if (source && String(source._id) === id) {
    await AiToolGeneration.deleteMany({
      $or: [
        { 'metadata.contentEngineSourceId': String(source._id) },
        { 'metadata.aiPdfSourceId': String(source._id) },
      ],
    });
    await purgePdfSourceDocument(String(source._id));
    return { ok: true, message: 'PDF source and all linked records deleted' };
  }

  if (master?._id) {
    await AiToolGeneration.findByIdAndDelete(master._id);
    if (bindSourceIdStr && (await countMastersForPdfSource(bindSourceIdStr)) === 0) {
      await purgePdfSourceDocument(bindSourceIdStr);
    }
    return { ok: true, message: 'Record deleted' };
  }

  return { ok: false, status: 404, message: 'PDF source not found' };
}

// POST /api/pdf/bulk-delete — delete many master rows (one per list card), not whole PDF source
router.post('/pdf/bulk-delete', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(rawIds.map((x) => String(x || '').trim()).filter(Boolean))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid record ids provided' });
    }

    let deletedCount = 0;
    const errors = [];
    for (const id of ids) {
      const result = await deletePdfRecordById(id);
      if (result.ok) {
        deletedCount += 1;
      } else {
        errors.push({ id, message: result.message || 'Delete failed' });
      }
    }

    return res.json({
      success: deletedCount > 0,
      deletedCount,
      failedCount: errors.length,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
      message: `Deleted ${deletedCount} of ${ids.length} record(s)`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Bulk delete failed' });
  }
});

// DELETE /api/pdf/:id — master id deletes one generation; source id deletes all linked rows + PDF file
router.delete('/pdf/:id', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const result = await deletePdfRecordById(req.params.id);
    if (!result.ok) {
      return res.status(result.status || 500).json({ success: false, message: result.message || 'Delete failed' });
    }
    return res.json({ success: true, message: result.message });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Delete failed' });
  }
});

// GET /api/pdf/:id
router.get('/pdf/:id', verifyToken, authorizeRoles('teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { master, source } = await resolvePdfMasterAndSource(req.params.id);
    if (master && source) {
      return res.json({
        success: true,
        data: enrichLessonPlanRowForApi(
          enrichDailyClassPlanRowForApi(
            enrichExamPaperRowForApi(
              enrichStoryRowForApi(
                enrichWorksheetRowForApi({
                  ...source,
                  _id: master._id,
                  toolType: master.toolName || source.toolType,
                  structuredContent: master.metadata?.structuredContent ?? source.structuredContent,
                  renderContent: master.metadata?.renderContent ?? source.renderContent,
                  generatedContent: String(master.generatedContent || master.content || '').trim(),
                }),
              ),
            ),
          ),
        ),
      });
    }
    if (source) {
      return res.json({
        success: true,
        data: enrichLessonPlanRowForApi(
          enrichDailyClassPlanRowForApi(
            enrichExamPaperRowForApi(
              enrichWorksheetRowForApi(
                enrichStoryRowForApi(enrichShortNotesRowForApi(enrichFlashcardRowForApi(source))),
              ),
            ),
          ),
        ),
      });
    }
    if (master) {
      const m = master.metadata || {};
      return res.json({
        success: true,
        data: enrichLessonPlanRowForApi(
          enrichDailyClassPlanRowForApi(
            enrichExamPaperRowForApi(
              enrichStoryRowForApi(
                enrichWorksheetRowForApi({
                  _id: master._id,
                  originalName: master.pdfFileName,
                  fileUrl: master.pdfFileUrl,
                  subject: master.subject,
                  classLabel: master.classLabel,
                  chapter: master.topic,
                  topic: master.topic,
                  subTopic: master.subtopic,
                  toolType: master.toolName,
                  contentType: m.contentType,
                  structuredContent: m.structuredContent || {},
                  renderContent: m.renderContent || {},
                  generatedContent: String(master.generatedContent || master.content || '').trim(),
                  approvalStatus: m.approvalStatus,
                  processingStatus: m.processingStatus,
                  chunkCount: m.chunkCount,
                  uploadDate: master.createdAt,
                }),
              ),
            ),
          ),
        ),
      });
    }
    return res.status(404).json({ success: false, message: 'PDF source not found' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Fetch failed' });
  }
});

// PATCH /api/pdf/:id
router.patch('/pdf/:id', verifyToken, authorizeRoles('admin', 'super-admin'), async (req, res) => {
  try {
    const { structuredContent, contentType, topic, subTopic, toolType } = req.body || {};
    const { master, source } = await resolvePdfMasterAndSource(req.params.id);
    const existing = source;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    const effectiveToolType = toolType !== undefined ? String(toolType || '').trim() : String(existing.toolType || '').trim();
    const effectiveContentType = contentType !== undefined ? String(contentType || '').trim() : String(existing.contentType || '').trim();
    const effectiveStructuredContent = structuredContent !== undefined ? structuredContent : existing.structuredContent;
    const structuredValidation = validateToolSpecificStructuredContent(
      effectiveToolType,
      effectiveStructuredContent,
      effectiveContentType,
    );
    if (!structuredValidation.valid) {
      return res.status(400).json({ success: false, message: structuredValidation.message || 'Invalid content for selected tool.' });
    }
    const update = {
      ...(structuredContent && typeof structuredContent === 'object'
        ? { structuredContent: structuredValidation.normalizedStructuredContent || structuredContent }
        : {}),
      ...(contentType ? { contentType: String(structuredValidation.normalizedType || contentType).trim() } : {}),
      ...(topic !== undefined ? { topic: String(topic || '').trim() } : {}),
      ...(subTopic !== undefined ? { subTopic: String(subTopic || '').trim() } : {}),
      ...(toolType !== undefined ? { toolType: String(toolType || '').trim() } : {}),
    };
    const nextTool = String(update.toolType || effectiveToolType || '').trim();
    const nextType = String(update.contentType || effectiveContentType || '').trim();
    let nextStructured = update.structuredContent || structuredValidation.normalizedStructuredContent || effectiveStructuredContent || {};
    if (nextTool === 'activity-project-generator' || nextTool === 'project-idea-lab') {
      nextStructured = finalizeActivityStructuredContent(nextStructured, {
        subject: String(existing.subject || '').trim(),
        classLabel: String(existing.classLabel || '').trim(),
        topic: String((topic !== undefined ? topic : existing.topic) || '').trim(),
        subTopic: String((subTopic !== undefined ? subTopic : existing.subTopic) || '').trim(),
        chapter: String(existing.chapter || '').trim(),
      }, nextTool);
      update.structuredContent = nextStructured;
    }
    update.renderContent = buildRenderableContent(nextTool, nextType, nextStructured);
    const doc = await AiContentEngineSource.findByIdAndUpdate(existing._id, update, { new: true }).lean();
    try {
      await syncPdfSourceToAiToolData(doc);
    } catch (syncError) {
      console.error('AI PDF update sync failed (non-fatal):', syncError);
    }
    const out = master ? { ...doc, _id: master._id } : doc;
    return res.json({ success: true, data: out });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Update failed' });
  }
});

// PATCH /api/pdf/:id/review
router.patch('/pdf/:id/review', verifyToken, authorizeRoles('admin', 'super-admin'), async (req, res) => {
  try {
    const { action, comment, toolType } = req.body || {};
    if (!['approve', 'reject', 'reassign'].includes(String(action))) {
      return res.status(400).json({ success: false, message: 'action must be approve/reject/reassign' });
    }
    const { master, source } = await resolvePdfMasterAndSource(req.params.id);
    const existing = source;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    const update = {};
    if (action === 'approve') {
      const structuredValidation = validateToolSpecificStructuredContent(
        String(existing.toolType || '').trim(),
        existing.structuredContent,
        existing.contentType,
      );
      if (!structuredValidation.valid) {
        return res.status(400).json({ success: false, message: structuredValidation.message || 'Cannot approve invalid structured content.' });
      }
      update.approvalStatus = 'approved';
      update.approvedBy = resolveAuthenticatedUserId(req) || null;
      update.approvedAt = new Date();
      update.reviewComment = String(comment || '').trim();
      let approvedStructured =
        structuredValidation.normalizedStructuredContent || existing.structuredContent;
      const approvedTool = String(existing.toolType || '').trim();
      if (approvedTool === 'activity-project-generator' || approvedTool === 'project-idea-lab') {
        approvedStructured = finalizeActivityStructuredContent(approvedStructured, {
          subject: String(existing.subject || '').trim(),
          classLabel: String(existing.classLabel || '').trim(),
          topic: String(existing.topic || '').trim(),
          subTopic: String(existing.subTopic || '').trim(),
          chapter: String(existing.chapter || '').trim(),
        }, approvedTool);
      }
      update.structuredContent = approvedStructured;
      update.contentType = String(structuredValidation.normalizedType || existing.contentType || '').trim();
      update.renderContent = buildRenderableContent(
        String(existing.toolType || '').trim(),
        String(update.contentType || existing.contentType || '').trim(),
        update.structuredContent,
      );
    } else if (action === 'reject') {
      update.approvalStatus = 'rejected';
      update.approvedBy = resolveAuthenticatedUserId(req) || null;
      update.approvedAt = new Date();
      update.reviewComment = String(comment || '').trim();
    } else {
      const reassignedTool = String(toolType || '').trim();
      const structuredValidation = validateToolSpecificStructuredContent(
        reassignedTool,
        existing.structuredContent,
        existing.contentType,
      );
      if (!structuredValidation.valid) {
        return res.status(400).json({ success: false, message: structuredValidation.message || 'Reassigned tool is not compatible with extracted content.' });
      }
      update.toolType = reassignedTool;
      update.contentType = String(structuredValidation.normalizedType || existing.contentType || '').trim();
      let reassignStructured =
        structuredValidation.normalizedStructuredContent || existing.structuredContent;
      if (reassignedTool === 'activity-project-generator' || reassignedTool === 'project-idea-lab') {
        reassignStructured = finalizeActivityStructuredContent(reassignStructured, {
          subject: String(existing.subject || '').trim(),
          classLabel: String(existing.classLabel || '').trim(),
          topic: String(existing.topic || '').trim(),
          subTopic: String(existing.subTopic || '').trim(),
          chapter: String(existing.chapter || '').trim(),
        }, reassignedTool);
      }
      update.structuredContent = reassignStructured;
      update.renderContent = buildRenderableContent(
        reassignedTool,
        String(update.contentType || existing.contentType || '').trim(),
        update.structuredContent,
      );
      update.reviewComment = String(comment || '').trim();
    }
    const doc = await AiContentEngineSource.findByIdAndUpdate(existing._id, update, { new: true }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'PDF source not found' });
    }
    try {
      await syncPdfSourceToAiToolData(doc);
    } catch (syncError) {
      console.error('AI PDF review sync failed (non-fatal):', syncError);
    }
    const out = master ? { ...doc, _id: master._id } : doc;
    return res.json({ success: true, data: out });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Review action failed' });
  }
});

// POST /api/ai/rag-query
router.post('/ai/rag-query', verifyToken, authorizeRoles('student', 'teacher', 'admin', 'super-admin'), async (req, res) => {
  try {
    const { query, subject, class: classInput, toolType } = req.body;
    if (!query || !String(query).trim()) {
      return res.status(400).json({ success: false, message: 'query is required' });
    }
    const result = await runHybridRagQuery({
      query: String(query).trim(),
      subject: String(subject || '').trim(),
      classLabel: toClassLabel(classInput),
      toolType: String(toolType || 'rag-query'),
      role: req.user.role,
      cacheKey: String(query).trim().slice(0, 120),
      metadata: { userId: req.userId, role: req.user.role },
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'RAG query failed' });
  }
});

export default router;

