/**
 * Universal PDF Content Engine — extract → classify → format → optional Gemini fallback.
 * @module services/pdf-content-engine
 */

import { extractCanonicalPdfDocument, canonicalPdfHasExtractableContent } from './pdf-canonical-extract.js';
import {
  classifyPdfContent,
  shouldUseGeminiFallback,
  GEMINI_FALLBACK_CONFIDENCE_THRESHOLD,
} from './pdf-content-classifier.js';
import {
  formatCanonicalForTool,
  canonicalizeBulkItems,
  assertAllToolsHaveFormatters,
} from './tool-formatters/index.js';
import { mapCanonicalPdfToToolBulkItems, postProcessCanonicalBulkItems } from './pdf-canonical-mapper.js';
import { consolidateWorksheetExtractItems } from './pdf-worksheet-extract.js';
import { countExpectedPdfItems } from './pdf-extract-validation.js';
import {
  activityPatternExtractIsComplete,
  scoreActivityExtractRow,
} from './pdf-activity-extract.js';
import { extractAndGenerateAllItems, getLastPdfExtractionMeta } from './gemini-service.js';
import {
  generateStructuredContentFromPdf,
} from './ai-content-engine-service.js';
import { expandStructuredToFormatItems } from '../config/aiToolTemplates.js';

assertAllToolsHaveFormatters();

const WORKSHEET_SLUG = 'worksheet-mcq-generator';

const PDF_QUESTION_DOCUMENT_TOOLS = new Set([
  WORKSHEET_SLUG,
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-qa-practice-generator',
]);

const ACTIVITY_TOOL_SLUGS = new Set(['activity-project-generator', 'project-idea-lab']);

const SINGLE_DOCUMENT_TRIM_TOOLS = new Set([
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-qa-practice-generator',
]);

/**
 * Analyze PDF text without saving (classifier + canonical).
 * @param {string} extractedText
 * @param {{ toolSlug?: string, userToolSlug?: string }} [options]
 */
export function analyzePdfContent(extractedText, options = {}) {
  const text = String(extractedText || '').trim();
  const canonical = extractCanonicalPdfDocument(text, { toolSlug: options.toolSlug });
  const classification = classifyPdfContent(text, canonical);
  const extractionOk = canonicalPdfHasExtractableContent(canonical);

  const userTool = String(options.userToolSlug || '').trim();
  let recommendedTools = classification.recommendedTools || [];
  if (userTool) {
    recommendedTools = [
      { tool: userTool, toolLabel: userTool, confidence: 100 },
      ...recommendedTools.filter((r) => r.tool !== userTool),
    ];
  }

  return {
    canonical,
    classification: {
      ...classification,
      recommendedTools,
    },
    extractionOk,
    useGemini: shouldUseGeminiFallback(classification, extractionOk),
    geminiThreshold: GEMINI_FALLBACK_CONFIDENCE_THRESHOLD,
    analysisMode: 'canonical-rules',
  };
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

function buildWorksheetRegexOnlyBulkItems(extractedText, params = {}) {
  const title = String(params.topic || params.subtopic || 'Worksheet').trim() || 'Worksheet';
  const consolidated = consolidateWorksheetExtractItems(
    [{ title, worksheet_title: title }],
    { ...params, rawPdfText: extractedText, forceSingleDocument: true },
  );
  return canonicalizeBulkItems(WORKSHEET_SLUG, consolidated.slice(0, 1), extractedText).filter(Boolean);
}

function buildZeroLlmMeta(toolSlug, bulkItems, mapped, analysis, extractedText, expectedQuestionCount) {
  const extractedQuestionCount = countQuestionsInBulkItems(bulkItems);
  const questionMarks = (extractedText.match(/\?/g) || []).length;
  if (toolSlug === WORKSHEET_SLUG) {
    console.log(
      `[AI PDF] Worksheet zero-LLM: ${extractedQuestionCount} questions from ${extractedText.length} chars (~${questionMarks} ? in text, 0 tokens)`,
    );
  }
  return {
    extractionEngine: 'canonical',
    extractionStatus: 'complete',
    validationPassed: true,
    retryCount: 0,
    extractedItemCount: extractedQuestionCount || bulkItems.length,
    expectedItemCount: expectedQuestionCount || extractedQuestionCount || bulkItems.length,
    validationErrors: [],
    generationMode: mapped.parser === 'pdf-worksheet-regex' ? 'regex-extract' : 'canonical-json',
    parser: mapped.parser || 'canonical-json',
    ragChunkCount: 0,
    formatSource: 'pdf-content-engine',
    pdfCanonical: analysis.canonical,
    family: analysis.classification?.family,
    confidence: analysis.classification?.confidence,
    matchedSignals: analysis.classification?.matchedSignals,
    recommendedTools: analysis.classification?.recommendedTools,
  };
}

function tryCanonicalZeroLlmPath(toolSlug, extractedText, params, analysis) {
  const mapped = mapCanonicalPdfToToolBulkItems(toolSlug, analysis.canonical, extractedText, params);
  if (!canonicalMappedItemsAreUsable(toolSlug, mapped.items)) {
    return null;
  }
  let bulkItems = postProcessCanonicalBulkItems(toolSlug, mapped.items, extractedText, params);
  bulkItems = canonicalizeBulkItems(toolSlug, bulkItems, extractedText);
  return { bulkItems, mapped };
}

/**
 * Single entry for PDF upload extraction — zero-LLM first, Gemini only when allowed and needed.
 * @param {string} toolSlug
 * @param {string} extractedText
 * @param {Record<string, unknown>} [params]
 */
export async function resolvePdfContentForUpload(toolSlug, extractedText, params = {}) {
  const slug = String(toolSlug || '').trim();
  const text = String(extractedText || '').trim();
  const expectedQuestionCount = countExpectedPdfItems(slug, text);
  const analysis = analyzePdfContent(text, { toolSlug: slug, userToolSlug: slug });
  const allowGemini = slug !== WORKSHEET_SLUG && analysis.useGemini;

  const canonicalResult = tryCanonicalZeroLlmPath(slug, text, params, analysis);
  if (canonicalResult) {
    return {
      bulkItems: canonicalResult.bulkItems,
      pdfCanonical: analysis.canonical,
      generatedResult: null,
      generationMeta: buildZeroLlmMeta(
        slug,
        canonicalResult.bulkItems,
        canonicalResult.mapped,
        analysis,
        text,
        expectedQuestionCount,
      ),
    };
  }

  if (slug === WORKSHEET_SLUG) {
    const bulkItems = buildWorksheetRegexOnlyBulkItems(text, params);
    const extractedQuestionCount = countQuestionsInBulkItems(bulkItems);
    const questionMarks = (text.match(/\?/g) || []).length;
    console.log(
      `[AI PDF] Worksheet zero-LLM fallback: ${extractedQuestionCount} questions (~${questionMarks} ? in text, 0 tokens)`,
    );
    return {
      bulkItems,
      pdfCanonical: analysis.canonical,
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
        pdfCanonical: analysis.canonical,
        family: analysis.classification?.family,
        confidence: analysis.classification?.confidence,
        matchedSignals: analysis.classification?.matchedSignals,
        recommendedTools: analysis.classification?.recommendedTools,
      },
    };
  }

  if (ACTIVITY_TOOL_SLUGS.has(slug) && allowGemini) {
    let bulkItems = [];
    let extractionMeta = getLastPdfExtractionMeta();
    try {
      bulkItems = await extractAndGenerateAllItems(slug, text, params);
    } catch (extractErr) {
      console.warn('[AI PDF] Activity extract failed:', extractErr?.message || extractErr);
      bulkItems = [];
    }
    extractionMeta = getLastPdfExtractionMeta();
    if (bulkItems.length) {
      bulkItems = canonicalizeBulkItems(slug, bulkItems, text);
      return {
        bulkItems,
        pdfCanonical: analysis.canonical,
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
          pdfCanonical: analysis.canonical,
          family: analysis.classification?.family,
          confidence: analysis.classification?.confidence,
        },
      };
    }
  }

  if (PDF_QUESTION_DOCUMENT_TOOLS.has(slug) && allowGemini) {
    let bulkItems = [];
    let extractionMeta = getLastPdfExtractionMeta();
    try {
      bulkItems = await extractAndGenerateAllItems(slug, text, params);
    } catch (extractErr) {
      console.warn('[AI PDF] Full PDF extract failed:', extractErr?.message || extractErr);
      bulkItems = [];
    }
    extractionMeta = getLastPdfExtractionMeta();

    if (SINGLE_DOCUMENT_TRIM_TOOLS.has(slug) && bulkItems.length > 1) {
      bulkItems = bulkItems.slice(0, 1);
    }

    const extractedQuestionCount = countQuestionsInBulkItems(bulkItems);
    if (bulkItems.length) {
      bulkItems = canonicalizeBulkItems(slug, bulkItems, text);
      return {
        bulkItems,
        pdfCanonical: analysis.canonical,
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
          pdfCanonical: analysis.canonical,
        },
      };
    }

    const generatedResult = await generateStructuredContentFromPdf(slug, text, {
      ...params,
      questionCount: expectedQuestionCount > 0 ? expectedQuestionCount : undefined,
    });
    return {
      bulkItems: [generatedResult.structuredContent || {}],
      pdfCanonical: analysis.canonical,
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
        pdfCanonical: analysis.canonical,
      },
    };
  }

  if (allowGemini) {
    const generatedResult = await generateStructuredContentFromPdf(slug, text, params);
    let bulkItems = expandStructuredToFormatItems(slug, generatedResult?.structuredContent || {});
    if (!Array.isArray(bulkItems) || bulkItems.length === 0) {
      bulkItems = [generatedResult?.structuredContent || {}];
    }
    bulkItems = canonicalizeBulkItems(slug, bulkItems, text);
    return {
      bulkItems,
      pdfCanonical: analysis.canonical,
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
        pdfCanonical: analysis.canonical,
        family: analysis.classification?.family,
        confidence: analysis.classification?.confidence,
      },
    };
  }

  const formatted = formatCanonicalForTool(slug, analysis.canonical, text, params);
  const bulkItems = formatted.items || [];
  return {
    bulkItems,
    pdfCanonical: analysis.canonical,
    generatedResult: null,
    generationMeta: {
      extractionStatus: bulkItems.length > 0 ? 'partial' : 'failed',
      validationPassed: bulkItems.length > 0,
      retryCount: 0,
      extractedItemCount: countQuestionsInBulkItems(bulkItems) || bulkItems.length,
      expectedItemCount: expectedQuestionCount || bulkItems.length,
      validationErrors: bulkItems.length ? [] : ['No extractable content without LLM fallback'],
      generationMode: 'canonical-json',
      parser: formatted.parser || 'none',
      ragChunkCount: 0,
      formatSource: 'pdf-content-engine',
      pdfCanonical: analysis.canonical,
      family: analysis.classification?.family,
      confidence: analysis.classification?.confidence,
      matchedSignals: analysis.classification?.matchedSignals,
      recommendedTools: analysis.classification?.recommendedTools,
      skippedGemini: true,
    },
  };
}

/**
 * @deprecated Use resolvePdfContentForUpload — kept for callers that used processPdfForTool.
 */
export async function processPdfForTool(toolSlug, extractedText, params = {}) {
  const result = await resolvePdfContentForUpload(toolSlug, extractedText, params);
  return {
    bulkItems: result.bulkItems,
    pdfCanonical: result.pdfCanonical,
    classification: result.generationMeta,
    extractionOk: Boolean(result.bulkItems?.length),
    useGemini: false,
    generationMeta: result.generationMeta,
  };
}
