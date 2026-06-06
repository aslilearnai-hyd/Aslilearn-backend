/**
 * User-facing messages for PDF upload / generation save failures.
 */

/**
 * @param {unknown} err
 * @param {{ pdfCode?: string, generationNumber?: number, totalGenerations?: number }} [ctx]
 * @returns {{ code: string, message: string, status: number }}
 */
export function formatPdfUploadSaveError(err, ctx = {}) {
  const raw = String(err?.message || err || 'Upload failed');
  const mongoCode = err?.code;

  if (mongoCode === 11000 || raw.includes('E11000')) {
    const genMatch = raw.match(/generationNumber:\s*(\d+)/);
    const generationNumber = Number(genMatch?.[1] || ctx.generationNumber || 1);
    const pdfRef = ctx.pdfCode ? ` (${ctx.pdfCode})` : '';
    return {
      code: 'PDF_GENERATION_DUPLICATE',
      status: 409,
      message:
        `Could not save Generation ${generationNumber}${pdfRef}: a record with the same number already exists for this PDF. ` +
        'This usually happens when a previous upload was interrupted partway through, or when the PDF contains duplicate "Generation N" headings. ' +
        'Any partial data from this attempt was rolled back — please try uploading again. ' +
        'If the error persists, delete leftover records for this subject/topic from the dashboard and re-upload.',
    };
  }

  if (
    mongoCode === 'PDF_GENERATION_HEADING_MISMATCH' ||
    raw.includes('Generation headings in PDF text but only 1 record')
  ) {
    return {
      code: 'PDF_GENERATION_HEADING_MISMATCH',
      status: 422,
      message: raw,
    };
  }

  if (mongoCode === 'PDF_GENERATION_PAGE_SPLIT_REJECTED' || raw.includes('page-count false split')) {
    return {
      code: 'PDF_GENERATION_PAGE_SPLIT_REJECTED',
      status: 422,
      message: raw,
    };
  }

  if (/validation failed/i.test(raw)) {
    return { code: 'PDF_VALIDATION_FAILED', status: 422, message: raw };
  }

  if (raw.length > 300) {
    return {
      code: 'PDF_GENERATION_SAVE_FAILED',
      status: 500,
      message:
        'Upload failed while saving generation records. Please try again. If the problem continues, contact support.',
    };
  }

  return {
    code: 'PDF_GENERATION_SAVE_FAILED',
    status: 500,
    message: raw,
  };
}
