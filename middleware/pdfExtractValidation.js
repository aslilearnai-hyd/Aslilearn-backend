/**
 * Express middleware helpers for PDF extraction validation.
 * Core logic lives in services/pdf-extract-validation.js.
 */

export {
  validatePdfExtractItems,
  parsePdfExtractResponse,
  cleanPdfTextForExtraction,
  buildPdfExtractionPasses,
  countExpectedPdfItems,
  normalizeExtractedItem,
  PDF_EXTRACT_MAX_RETRIES,
  MULTI_ITEM_PDF_TOOLS,
} from '../services/pdf-extract-validation.js';

/** Run validation for controller use (no Express req mutation). */
export async function runPdfExtractValidation(toolType, items, pdfText, context = {}) {
  const { validatePdfExtractItems } = await import('../services/pdf-extract-validation.js');
  return validatePdfExtractItems(toolType, items, { pdfText, ...context });
}
