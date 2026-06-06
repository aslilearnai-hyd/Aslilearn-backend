/**
 * Save PDF → N generation records (one per detected generation block).
 * @module services/pdf-generation-service
 */

import PdfGeneration from '../models/PdfGeneration.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import {
  splitAllPdfGenerations,
  generatePdfCode,
  detectDuplicateGenerationContent,
  detectConsecutiveDuplicateGenerationContent,
} from './pdf-generation-splitter.js';
import { formatPdfUploadSaveError } from '../utils/pdf-upload-errors.js';
import {
  projectGenerationBlock,
  generationBlockToContentString,
} from './pdf-generation-projector.js';
import { buildToolRenderContent } from './tool-formatters/index.js';

/**
 * @param {string} toolSlug
 * @param {string} extractedText
 * @param {Record<string, unknown>} uploadContext
 */
export function detectPdfGenerations(extractedText, uploadContext = {}) {
  return splitAllPdfGenerations(extractedText);
}

/**
 * @param {object} args
 */
export async function savePdfGenerationRecords({
  source,
  toolSlug,
  splitResult,
  uploadContext,
  knowledgeBase,
  generationMeta,
  tokenUsage,
  inferredContentType,
  analysis,
  validation,
}) {
  const pdfId = source._id;
  const pdfCode = source.pdfCode || generatePdfCode();
  const now = new Date();
  const saved = [];
  let generations = splitResult.generations || [];
  const pageCount = Number(splitResult.extractionStats?.totalPages || 0);
  const duplicateWarnings = detectDuplicateGenerationContent(generations);
  const consecutiveDuplicateWarnings = detectConsecutiveDuplicateGenerationContent(generations);

  if (consecutiveDuplicateWarnings.length) {
    console.warn(
      '[PDF Gen] Consecutive identical chunks at save:',
      consecutiveDuplicateWarnings.slice(0, 5).join(' | '),
    );
  }

  if (pageCount > 5 && generations.length >= Math.floor(pageCount * 0.75)) {
    const msg = `Refusing to save ${generations.length} records for a ${pageCount}-page PDF — likely page-count false split. Re-upload after backend restart.`;
    console.error('[PDF Gen]', msg);
    const err = new Error(msg);
    err.code = 'PDF_GENERATION_PAGE_SPLIT_REJECTED';
    throw err;
  }

  if (duplicateWarnings.length >= Math.max(3, Math.floor(generations.length * 0.25))) {
    console.warn(
      '[PDF Gen] High duplicate-content rate:',
      duplicateWarnings.length,
      'of',
      generations.length,
      '— check marker detection',
    );
  }

  const globalHeadingCount = Number(splitResult.extractionStats?.globalHeadingCount || 0);
  const pdfTextLength = Number(splitResult.extractionStats?.pdfTextLengthRaw || 0);

  console.log('PDF Pages:', pageCount || '(unknown)');
  console.log('PDF Text Length:', pdfTextLength);
  console.log('Detected Generation Count:', globalHeadingCount || generations.length);
  console.log('Records Created:', 0, '(starting save)');

  if (globalHeadingCount > 1 && generations.length === 1) {
    const msg = `Found ${globalHeadingCount} Generation headings in PDF text but only 1 record would be saved. Check PDF text extraction — full document may not be loaded.`;
    console.error('[PDF Gen] CRITICAL:', msg);
    const err = new Error(msg);
    err.code = 'PDF_GENERATION_HEADING_MISMATCH';
    throw err;
  }

  for (const gen of generations) {
    const chunkText = String(gen.text || gen.content || '').trim();
    console.log(gen.generationNumber, chunkText.substring(0, 200));
    console.log(`Generation ${gen.generationNumber} chunk length: ${chunkText.length}`);

    const blockParams = {
      ...uploadContext,
      generationTitle: gen.generationTitle,
      generation: gen.generationNumber,
      generationNumber: gen.generationNumber,
    };
    const bulkItems = projectGenerationBlock(toolSlug, chunkText, blockParams);
    const structuredForRow = {
      ...(bulkItems[0] || {}),
      extractedPdfText: chunkText,
      generationNumber: gen.generationNumber,
      generationTitle: gen.generationTitle,
    };
    const contentStr = generationBlockToContentString(toolSlug, structuredForRow, gen.generationNumber - 1);
    const renderContent = buildToolRenderContent(toolSlug, structuredForRow, chunkText);

    let pdfGen;
    try {
      pdfGen = await PdfGeneration.create({
      pdfId,
      pdfCode,
      toolType: toolSlug,
      generationNumber: gen.generationNumber,
      generationTitle: gen.generationTitle,
      markerType: gen.markerType,
      markerLabel: gen.markerLabel,
      board: uploadContext.board,
      classLabel: uploadContext.classLabel,
      subject: uploadContext.subject,
      topic: uploadContext.topic,
      subTopic: uploadContext.subtopic,
      contentType: inferredContentType,
      structuredContent: structuredForRow,
      renderContent,
      content: contentStr,
      generatedContent: contentStr,
      approvalStatus: 'pending',
      uploadedBy: uploadContext.uploaderId,
      uploadedByRole: uploadContext.uploadedByRole,
      metadata: {
        knowledgeBase,
        generationBlockText: chunkText,
        extractedPdfText: chunkText,
        projectedFromKnowledgeBase: false,
        formatSource: generationMeta?.formatSource,
        generationMode: generationMeta?.generationMode,
        extractionEngine: generationMeta?.extractionEngine,
        pdfCanonical: generationMeta?.pdfCanonical,
        geminiCallCount: generationMeta?.geminiCallCount ?? 1,
        tokenUsage: gen.generationNumber === 1 ? tokenUsage : undefined,
      },
    });
    } catch (createErr) {
      const formatted = formatPdfUploadSaveError(createErr, {
        pdfCode,
        generationNumber: gen.generationNumber,
        totalGenerations: generations.length,
      });
      const wrapped = new Error(formatted.message);
      wrapped.code = formatted.code;
      throw wrapped;
    }

    await AiToolGeneration.create({
      toolName: toolSlug,
      toolDisplayName: uploadContext.toolDisplayName || toolSlug,
      sourceType: 'ai_pdf',
      board: uploadContext.board,
      classLabel: uploadContext.classLabel,
      subject: uploadContext.subject,
      topic: uploadContext.topic,
      subtopic: uploadContext.subtopic,
      content: contentStr,
      generatedContent: contentStr,
      pdfFileUrl: uploadContext.fileUrl,
      pdfFileName: uploadContext.originalName,
      generatedBy: uploadContext.uploaderId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      metadata: {
        pdfGenerationId: String(pdfGen._id),
        pdfId: String(pdfId),
        pdfCode,
        generationNumber: gen.generationNumber,
        generationTitle: gen.generationTitle,
        markerType: gen.markerType,
        markerLabel: gen.markerLabel,
        contentEngineSourceId: String(pdfId),
        aiPdfSourceId: String(pdfId),
        bulkItemIndex: gen.generationNumber - 1,
        bulkItemCount: generations.length,
        structuredContent: structuredForRow,
        renderContent,
        generationBlockText: chunkText,
        extractedPdfText: chunkText,
        knowledgeBase,
        contentType: inferredContentType,
        approvalStatus: 'pending',
        processingStatus: 'processed',
        uploadedByRole: uploadContext.uploadedByRole,
        generatedByAI: false,
        sourceLabel: 'PDF Upload (Generation Split)',
        formatSource: generationMeta?.formatSource,
        generationMode: generationMeta?.generationMode,
        extractionEngine: generationMeta?.extractionEngine,
        geminiCallCount: generationMeta?.geminiCallCount ?? 1,
        geminiDetected: analysis?.geminiDetected,
        validation,
        extractionStatus: generationMeta?.extractionStatus,
        validationPassed: generationMeta?.validationPassed,
        ...(gen.generationNumber === 1 ? { tokenUsage } : {}),
      },
    });

    saved.push(pdfGen);
  }

  console.log('PDF Pages:', pageCount || '(unknown)');
  console.log('PDF Text Length:', pdfTextLength);
  console.log('Detected Generation Count:', globalHeadingCount || generations.length);
  console.log('Records Created:', saved.length);

  if (globalHeadingCount > 1 && saved.length === 1) {
    console.error(
      `[PDF Gen] CRITICAL: ${globalHeadingCount} headings detected but only ${saved.length} record saved`,
    );
  }

  return saved;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} pdfId
 */
export async function deleteAllGenerationsForPdf(pdfId) {
  const sid = String(pdfId);
  await PdfGeneration.deleteMany({ pdfId: sid });
  await AiToolGeneration.deleteMany({
    $or: [{ 'metadata.pdfId': sid }, { 'metadata.contentEngineSourceId': sid }, { 'metadata.aiPdfSourceId': sid }],
  });
}
