import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import BookAsset from '../../../models/BookAsset.js';
import Book from '../../../models/Book.js';
import { extractTextFromDocument } from '../../providers/gemini-service.js';
import { getPdfBufferFromStorage } from '../../../services/cloud-storage.js';

const ALLOWED_ASSET_TYPES = new Set([
  'equation',
  'chemical_equation',
  'figure',
  'graph',
  'table',
  'chemical_structure',
]);

function cleanJson(text = '') {
  return String(text)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function parseMultimodalBookAssets(raw = '') {
  let parsed;
  try {
    parsed = JSON.parse(cleanJson(raw));
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : [];
  return rows
    .map((row) => {
      const type = String(row?.type || '').trim().toLowerCase();
      if (!ALLOWED_ASSET_TYPES.has(type)) return null;
      const page = Number(row.page);
      const canonicalData = row.canonicalData && typeof row.canonicalData === 'object'
        ? row.canonicalData
        : {};
      const semanticText = String(
        row.semanticText || row.description || row.caption || canonicalData.latex || canonicalData.display || '',
      ).trim();
      if (!semanticText) return null;
      return {
        page: Number.isFinite(page) && page > 0 ? page : null,
        type,
        caption: String(row.caption || '').trim(),
        description: String(row.description || '').trim(),
        semanticText,
        canonicalData,
        labels: Array.isArray(row.labels)
          ? row.labels.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 100)
          : [],
        sourceBBox: Array.isArray(row.sourceBBox)
          ? row.sourceBBox.map(Number).filter(Number.isFinite).slice(0, 4)
          : [],
        chapter: String(row.chapter || '').trim(),
        subtopic: String(row.subtopic || '').trim(),
      };
    })
    .filter(Boolean);
}

function assetIdFor(bookId, asset, index) {
  const digest = crypto
    .createHash('sha256')
    .update(`${bookId}|${asset.page || ''}|${asset.type}|${asset.semanticText}|${index}`)
    .digest('hex')
    .slice(0, 20);
  return `BOOK_ASSET_${digest}`;
}

export function resolveBookAssetApprovalStatus(book = {}) {
  return book.approvalStatus === 'approved' ? 'approved' : 'pending_review';
}

export async function extractAndStoreBookAssets({ book, buffer, mimeType = 'application/pdf' }) {
  const enabled = String(process.env.BOOK_MULTIMODAL_INGESTION ?? 'true').toLowerCase() !== 'false';
  if (!enabled || !book?._id || !Buffer.isBuffer(buffer)) return { assetCount: 0, skipped: true };
  const base64 = buffer.toString('base64');
  if (base64.length > 20 * 1024 * 1024) {
    return { assetCount: 0, skipped: true, reason: 'document_too_large_for_inline_analysis' };
  }

  const prompt = `Analyse this educational document page by page and extract only assessment-relevant STEM assets.
Return valid JSON with this exact shape: {"assets":[{"page":1,"type":"equation|chemical_equation|figure|graph|table|chemical_structure","caption":"","description":"","semanticText":"searchable meaning","canonicalData":{"latex":"","display":"","data":{}},"labels":[],"sourceBBox":[],"chapter":"","subtopic":""}]}.
Preserve equations, subscripts, superscripts, charges, equilibrium arrows, labels and numeric values exactly.
Do not invent missing labels or values. Exclude decorative images. Return JSON only.`;
  const raw = await extractTextFromDocument(base64, mimeType, prompt, {
    temperature: 0,
    maxTokens: Number(process.env.BOOK_MULTIMODAL_MAX_OUTPUT_TOKENS) || 12000,
  });
  const assets = parseMultimodalBookAssets(raw);
  const autoApprove = resolveBookAssetApprovalStatus(book) === 'approved';
  await BookAsset.deleteMany(
    autoApprove
      ? { bookId: book._id }
      : { bookId: book._id, approvalStatus: { $ne: 'approved' } },
  );
  if (!assets.length) return { assetCount: 0, skipped: false };

  const docs = assets.map((asset, index) => ({
    ...asset,
    assetId: assetIdFor(book._id, asset, index),
    bookId: book._id,
    board: book.board || '',
    class: book.class || '',
    subject: book.subject || '',
    extractionModel: process.env.GEMINI_FALLBACK_MODEL || process.env.VIDYA_AI_GEMINI_MODEL || '',
    extractionVersion: 1,
    // Super-admin uploads and linked learning-path books are trusted sources.
    // Keeping their assets pending made every visual invisible to retrieval
    // because there is currently no BookAsset review surface in the product.
    approvalStatus: resolveBookAssetApprovalStatus(book),
  }));
  await BookAsset.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { assetId: doc.assetId },
        update: {
          $set: doc,
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return { assetCount: docs.length, skipped: false };
}

function queryTokens(value = '') {
  return new Set(
    String(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

export async function retrieveApprovedBookAssets(scope = {}, limit = 4) {
  if (!scope.bookId) return [];
  const filter = { bookId: scope.bookId, approvalStatus: 'approved' };
  // Curriculum-mapped books: never borrow a figure/equation from another
  // subtopic just because its caption looks similar.
  const curriculumFilter = scope.curriculumFilter || null;
  if (curriculumFilter?.aiSubtopicId) filter.aiSubtopicId = curriculumFilter.aiSubtopicId;
  else if (curriculumFilter?.aiTopicKey) filter.aiTopicKey = curriculumFilter.aiTopicKey;
  const assets = await BookAsset.find(filter)
    .select('assetId page type caption description semanticText canonicalData labels chapter subtopic assetPath aiTopicKey aiSubtopicId aiSubtopicName')
    .lean();
  const query = queryTokens(
    [scope.subjectName || scope.subject, scope.topicName || scope.topic, scope.subtopicName || scope.subtopic]
      .filter(Boolean)
      .join(' '),
  );
  return assets
    .map((asset) => {
      const haystack = queryTokens(
        [asset.caption, asset.description, asset.semanticText, asset.chapter, asset.subtopic].join(' '),
      );
      let score = 0;
      for (const token of query) if (haystack.has(token)) score += 1;
      return { ...asset, score };
    })
    .sort((a, b) => b.score - a.score || Number(a.page || 0) - Number(b.page || 0))
    .slice(0, Math.max(1, Math.min(8, Number(limit) || 4)));
}

export function formatBookAssetsForPrompt(assets = []) {
  if (!Array.isArray(assets) || !assets.length) return '';
  const blocks = assets.map((asset, index) => {
    const canonical = asset.canonicalData && Object.keys(asset.canonicalData).length
      ? `\nCanonical data: ${JSON.stringify(asset.canonicalData)}`
      : '';
    const labels = Array.isArray(asset.labels) && asset.labels.length
      ? `\nLabels: ${asset.labels.join(', ')}`
      : '';
    return `[Asset ${index + 1}] id=${asset.assetId} type=${asset.type} page=${asset.page || 'unknown'}\n${asset.semanticText || asset.description || asset.caption}${canonical}${labels}`;
  });
  return `<<<APPROVED_MULTIMODAL_ASSETS>>>\nUse only these approved equations/figures/tables/graphs. Return sourceAssetIds for any question that depends on one.\n${blocks.join('\n\n')}\n<<<END_APPROVED_MULTIMODAL_ASSETS>>>`;
}

async function pagePdfPart(sourceBuffer, pageNumber) {
  const source = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true });
  const index = Math.max(0, Math.min(source.getPageCount() - 1, Number(pageNumber) - 1));
  const output = await PDFDocument.create();
  const [page] = await output.copyPages(source, [index]);
  output.addPage(page);
  const bytes = await output.save({ useObjectStreams: true });
  return {
    inlineData: {
      mimeType: 'application/pdf',
      data: Buffer.from(bytes).toString('base64'),
    },
  };
}

/**
 * Load only the approved source pages required by selected visual assets.
 * The complete textbook is never sent during question generation.
 */
export async function buildApprovedAssetMultimodalParts({ bookId, assets = [], maxPages = 2 } = {}) {
  const selectedPages = [...new Set(
    assets.map((asset) => Number(asset?.page)).filter((page) => Number.isInteger(page) && page > 0),
  )].slice(0, Math.max(1, Math.min(3, Number(maxPages) || 2)));
  if (!bookId || !selectedPages.length) return [];
  const book = await Book.findById(bookId)
    .select('fileUrl storageProvider storageKey mimeType')
    .lean();
  if (!book) return [];

  const mimeType = String(book.mimeType || '').toLowerCase();
  let sourceBuffer;
  if (mimeType.startsWith('image/')) {
    if (book.storageProvider === 'local') {
      const localPath = path.resolve(process.cwd(), String(book.fileUrl || '').replace(/^\//, ''));
      sourceBuffer = await fs.readFile(localPath);
    } else {
      sourceBuffer = await getPdfBufferFromStorage(book);
    }
    return sourceBuffer.length <= 8 * 1024 * 1024
      ? [{ inlineData: { mimeType, data: sourceBuffer.toString('base64') } }]
      : [];
  }
  if (!mimeType.includes('pdf') && !String(book.fileUrl || '').toLowerCase().endsWith('.pdf')) return [];
  sourceBuffer = await getPdfBufferFromStorage(book);
  const parts = [];
  for (const page of selectedPages) {
    const part = await pagePdfPart(sourceBuffer, page);
    if (part.inlineData.data.length <= 8 * 1024 * 1024) parts.push(part);
  }
  return parts;
}

