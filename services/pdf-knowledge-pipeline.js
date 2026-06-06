/**
 * Universal PDF knowledge pipeline: 1 extract → 1 Gemini call → store KB → project tools (zero LLM on view).
 * @module services/pdf-knowledge-pipeline
 */

import { beginTokenUsageSession, endTokenUsageSession } from './gemini-service.js';
import { extractEducationalKnowledgeFromPdfText } from './pdf-knowledge-extractor.js';
import { projectKnowledgeBaseForTool } from './knowledge-projector.js';
import { knowledgeBaseToCanonical } from './knowledge-base-canonical.js';
import { knowledgeBaseHasContent } from './educational-knowledge-schema.js';
import { buildLocalPdfAnalysisFromSelection } from './ai-content-engine-service.js';
import { splitAllPdfGenerations } from './pdf-generation-splitter.js';

/**
 * Process PDF upload — exactly ONE Gemini call, then deterministic tool projection.
 * @param {string} toolSlug
 * @param {string} extractedText
 * @param {Record<string, unknown>} [params]
 */
export async function processPdfKnowledgeUpload(toolSlug, extractedText, params = {}) {
  const slug = String(toolSlug || '').trim();
  const text = String(extractedText || '').trim();
  const pageCount = Number(params.pageCount || 0);

  beginTokenUsageSession('ai-pdf-knowledge-base');
  let knowledgeBase;
  try {
    knowledgeBase = await extractEducationalKnowledgeFromPdfText(text, params);
  } finally {
    // token session ended after extract
  }
  const tokenUsage = endTokenUsageSession();

  if (!knowledgeBaseHasContent(knowledgeBase)) {
    throw new Error('Knowledge base extraction produced no educational content.');
  }

  console.log('[PDF Gen] Pipeline input text length:', text.length);
  const splitResult = splitAllPdfGenerations(text, { pageCount });
  console.log(
    `[PDF Gen] Pipeline summary: pages=${pageCount || '?'}, textLen=${text.length}, headings=${splitResult.extractionStats?.globalHeadingCount || '?'}, blocks=${splitResult.totalGenerations}`,
  );
  const bulkItems = projectKnowledgeBaseForTool(knowledgeBase, slug, params);
  const pdfCanonical = knowledgeBaseToCanonical(knowledgeBase);
  const analysis = buildLocalPdfAnalysisFromSelection({
    subject: params.subject,
    classLabel: params.classLabel,
    chapter: params.chapter || params.topic,
    topic: params.topic,
    subTopic: params.subtopic,
    toolType: slug,
  });

  const questionCount = (knowledgeBase.questions || []).length;

  return {
    knowledgeBase,
    splitResult,
    bulkItems,
    pdfCanonical,
    generatedResult: null,
    analysis,
    tokenUsage,
    generationMeta: {
      extractionEngine: 'knowledge-base-v1',
      extractionStatus: bulkItems.length > 0 ? 'complete' : 'partial',
      validationPassed: bulkItems.length > 0,
      retryCount: 0,
      extractedItemCount: questionCount || bulkItems.length,
      expectedItemCount: splitResult.totalGenerations,
      extractionStats: splitResult.extractionStats,
      validationErrors: [],
      generationMode: 'knowledge-base',
      parser: 'knowledge-projector',
      ragChunkCount: 0,
      formatSource: 'educational-knowledge-base',
      pdfCanonical,
      geminiCallCount: 1,
      family: 'KNOWLEDGE_BASE',
      confidence: 100,
      matchedSignals: ['knowledge-base-v1'],
      recommendedTools: [],
    },
  };
}

/**
 * Re-project any tool from stored knowledge base (zero LLM — for view/switch tool).
 * @param {Record<string, unknown>} knowledgeBase
 * @param {string} toolSlug
 * @param {Record<string, unknown>} [params]
 */
export function projectToolFromStoredKnowledgeBase(knowledgeBase, toolSlug, params = {}) {
  return projectKnowledgeBaseForTool(knowledgeBase, toolSlug, params);
}
