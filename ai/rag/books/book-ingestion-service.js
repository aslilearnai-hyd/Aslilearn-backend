import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import Book from '../../../models/Book.js';
import BookChunk from '../../../models/BookChunk.js';
import BookSourcePart from '../../../models/BookSourcePart.js';
import BookAsset from '../../../models/BookAsset.js';
import Content from '../../../models/Content.js';
import Subject from '../../../models/Subject.js';
import { generateEmbedding } from '../pdf/pdf-rag-service.js';
import { getPdfBufferFromStorage, uploadPdfToConfiguredStorage } from '../../../services/cloud-storage.js';
import geminiService, { extractTextFromDocument } from '../../providers/gemini-service.js';
import { extractAndStoreBookAssets } from './book-multimodal-service.js';
import { subjectDisplayName } from '../../../utils/subjectDelete.js';
import {
  canonicalBoardLabel,
  lockBoardKey,
  resolveClassLabelForAiToolStorage,
} from '../../../utils/board-label.js';
import { normalizeIitCategoryLoose, inferProductCategoryFromPath, buildMaterialSlotTitle } from '../../../constants/products.js';

let bookContentIdIndexReady = false;

/** Drop legacy unique-on-null contentId index; allow many PDF uploads without Content link. */
export async function ensureBookContentIdIndex() {
  if (bookContentIdIndexReady) return;
  try {
    const coll = Book.collection;
    await coll.updateMany(
      { $or: [{ contentId: null }, { contentId: { $type: 'null' } }] },
      { $unset: { contentId: '' } }
    );
    for (const name of ['contentId_1', 'contentId_1_sparse']) {
      try {
        await coll.dropIndex(name);
      } catch {
        /* missing */
      }
    }
    const indexes = await coll.indexes();
    const hasPartial = indexes.some((i) => i.name === 'contentId_1_partial');
    if (!hasPartial) {
      await coll.createIndex(
        { contentId: 1 },
        {
          unique: true,
          name: 'contentId_1_partial',
          partialFilterExpression: { contentId: { $exists: true, $type: 'objectId' } },
        }
      );
    }
    bookContentIdIndexReady = true;
  } catch (err) {
    console.warn('ensureBookContentIdIndex:', err.message);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Controllers live under ai/rag/books — resolve to backend/uploads (same as express.static).
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const BOOK_UPLOAD_DIR = path.join(BACKEND_ROOT, 'uploads', 'book-knowledge');
const CONTENT_UPLOAD_DIR = path.join(BACKEND_ROOT, 'uploads', 'content');

const IMPORTABLE_CONTENT_TYPES = new Set(['TextBook', 'Workbook', 'Material']);
const IMPORTABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.txt']);

const CHUNK_WORDS_MIN = Number(process.env.BOOK_CHUNK_WORDS_MIN || 500);
const CHUNK_WORDS_MAX = Number(process.env.BOOK_CHUNK_WORDS_MAX || 1000);
const CHUNK_OVERLAP_WORDS = Number(process.env.BOOK_CHUNK_OVERLAP_WORDS || 80);
const BOOK_SOURCE_PART_CHARS = Math.max(
  100000,
  Math.min(750000, Number(process.env.BOOK_SOURCE_PART_CHARS) || 400000),
);
const BOOK_EXTRACTED_TEXT_PREVIEW_CHARS = Math.max(
  50000,
  Math.min(500000, Number(process.env.BOOK_EXTRACTED_TEXT_PREVIEW_CHARS) || 500000),
);
const BOOK_DIFFICULTY_BANDS = new Set(['', 'foundation', 'board', 'jee_main', 'jee_advanced', 'neet']);
const BOOK_APPROVAL_STATUSES = new Set(['approved', 'pending_review', 'rejected', 'archived']);

function enumValue(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeSpaces(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

export function bookExtractionCorruptionStats(text) {
  const value = String(text || '');
  const junkCount = (value.match(/[\uFFFD\u25A1\u25AF\u25A0▯]/g) || []).length;
  const visibleLength = value.replace(/\s/g, '').length;
  return {
    junkCount,
    visibleLength,
    junkRatio: visibleLength > 0 ? junkCount / visibleLength : 0,
    needsOcr: junkCount >= 8 && visibleLength > 0 && junkCount / visibleLength >= 0.002,
  };
}

function wordCount(text) {
  return normalizeSpaces(text).split(/\s+/).filter(Boolean).length;
}

/** Extract plain text from DOCX (no extra dependency — read word/document.xml). */
async function extractDocxText(buffer) {
  try {
    const { default: AdmZip } = await import('adm-zip').catch(() => ({ default: null }));
    if (!AdmZip) {
      return extractDocxTextFallback(buffer);
    }
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return '';
    const xml = entry.getData().toString('utf8');
    return extractDocxParagraphsFromXml(xml);
  } catch {
    return extractDocxTextFallback(buffer);
  }
}

function extractDocxTextFallback(buffer) {
  const raw = buffer.toString('utf8');
  const paragraphs = extractDocxParagraphsFromXml(raw);
  if (paragraphs) return paragraphs;
  return normalizeSpaces(raw.replace(/<[^>]+>/g, ' '));
}

function decodeXmlText(text = '') {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Preserve Word paragraph/list boundaries for heading detection and equations. */
export function extractDocxParagraphsFromXml(xml = '') {
  const paragraphs = [];
  for (const match of String(xml).matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const body = match[1];
    const parts = [...body.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((item) => decodeXmlText(item[1]))
      .filter(Boolean);
    const line = parts.join('').replace(/[ \t]+/g, ' ').trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return normalizeSpaces(parsed?.text || '');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** OCR fallback for scanned PDFs via Gemini (when enabled and text is empty). */
async function ocrFallbackWithGemini(buffer, fileName = 'document.pdf', mimeType = 'application/pdf') {
  const enabled = String(process.env.BOOK_OCR_FALLBACK || 'true').toLowerCase() !== 'false';
  if (!enabled) return '';
  try {
    const b64 = buffer.toString('base64');
    // Gemini inline data is capped around 20MB base64; oversized scans must be split/reindexed.
    if (b64.length > 20 * 1024 * 1024) {
      console.warn(`[Book OCR] "${fileName}" too large for inline OCR (${b64.length} b64 bytes) — skipping.`);
      return '';
    }
    const prompt =
      'Extract ALL readable educational text from this document. Return plain text only — preserve headings, numbered lists, and paragraph breaks. Do not summarize or add commentary.';
    // Send the ACTUAL document bytes so Gemini can OCR scanned pages (not just the filename).
    const raw = await extractTextFromDocument(b64, mimeType, prompt, {
      temperature: 0.1,
      maxTokens: Math.max(8000, Number(process.env.BOOK_OCR_MAX_TOKENS) || 32000),
    });
    return normalizeSpaces(raw);
  } catch (err) {
    console.warn('[Book OCR] Gemini fallback failed:', err?.message || err);
    return '';
  }
}

export async function extractTextFromUpload(buffer, mimeType, originalName = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('pdf') || originalName.toLowerCase().endsWith('.pdf')) {
    let text = await extractPdfText(buffer);
    const extractionStats = bookExtractionCorruptionStats(text);
    if (text.length < 80 || extractionStats.needsOcr) {
      const ocrText = await ocrFallbackWithGemini(buffer, originalName, 'application/pdf');
      const ocrStats = bookExtractionCorruptionStats(ocrText);
      const hasUsefulCoverage = ocrText.length >= Math.min(80, text.length) &&
        (text.length < 80 || ocrText.length >= text.length * 0.6);
      if (hasUsefulCoverage && ocrStats.junkRatio < extractionStats.junkRatio) text = ocrText;
    }
    return { text, requiresOcr: text.length < 80 || bookExtractionCorruptionStats(text).needsOcr };
  }
  if (
    mime.includes('word') ||
    mime.includes('docx') ||
    originalName.toLowerCase().endsWith('.docx')
  ) {
    return { text: await extractDocxText(buffer), requiresOcr: false };
  }
  if (mime.includes('text') || originalName.toLowerCase().endsWith('.txt')) {
    return { text: normalizeSpaces(buffer.toString('utf8')), requiresOcr: false };
  }
  return { text: normalizeSpaces(buffer.toString('utf8')), requiresOcr: false };
}

/** Split full book text into chapter segments. */
export function splitIntoChapters(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  if (!clean.trim()) return [];

  const lines = clean.split('\n');
  const headingRe =
    /^(chapter\s+[\dIVXLC]+[\s.:)\-–—]*|unit\s+[\dIVXLC]+[\s.:)\-–—]*|part\s+[\dIVXLC]+[\s.:)\-–—]*|section\s+[\dIVXLC]+[\s.:)\-–—]*|lesson\s+[\dIVXLC]+[\s.:)\-–—]*|theme\s+[\dIVXLC]+[\s.:)\-–—]*|\d{1,3}(?:\.\d{1,3}){0,2}[.)]?\s+[A-Z][^.!?]{2,120}$)/i;

  const chapters = [];
  let current = { title: 'Introduction', lines: [], startOffset: 0 };
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && headingRe.test(trimmed) && current.lines.length > 20) {
      const body = current.lines.join('\n').trim();
      chapters.push({
        title: current.title,
        topic: current.title,
        subtopic: '',
        startOffset: current.startOffset,
        endOffset: offset,
        wordCount: wordCount(body),
        text: body,
      });
      current = { title: trimmed.slice(0, 200), lines: [], startOffset: offset };
    }
    current.lines.push(line);
    offset += line.length + 1;
  }

  const lastBody = current.lines.join('\n').trim();
  if (lastBody) {
    chapters.push({
      title: current.title,
      topic: current.title,
      subtopic: '',
      startOffset: current.startOffset,
      endOffset: offset,
      wordCount: wordCount(lastBody),
      text: lastBody,
    });
  }

  if (chapters.length <= 1 && clean.length > 500) {
    return [{ title: 'Full Book', topic: 'Full Book', subtopic: '', startOffset: 0, endOffset: clean.length, wordCount: wordCount(clean), text: clean }];
  }
  return chapters;
}

/** Chunk chapter text into 500–1000 word windows. */
export function chunkChapterText(text, chapterMeta = {}) {
  const words = normalizeSpaces(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const chunks = [];
  const maxWords = Math.max(CHUNK_WORDS_MIN, CHUNK_WORDS_MAX);
  const stride = Math.max(maxWords - Math.max(0, CHUNK_OVERLAP_WORDS), 200);
  let idx = 0;

  for (let start = 0; start < words.length; start += stride) {
    const slice = words.slice(start, start + maxWords);
    if (!slice.length) break;
    const content = slice.join(' ');
    if (wordCount(content) < 40 && chunks.length) break;
    chunks.push({
      chunkIndex: idx,
      chapter: chapterMeta.title || chapterMeta.chapter || '',
      topic: chapterMeta.topic || chapterMeta.title || '',
      subtopic: chapterMeta.subtopic || '',
      content,
      wordCount: slice.length,
      tokenCount: Math.ceil(slice.length * 1.3),
    });
    idx += 1;
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}

async function ensureUploadDir() {
  await fs.mkdir(BOOK_UPLOAD_DIR, { recursive: true });
}

function scheduleBackgroundWork(label, work) {
  setImmediate(() => {
    Promise.resolve()
      .then(work)
      .catch((err) => {
        console.error(`[book-knowledge] ${label} failed:`, err?.message || err);
      });
  });
}

async function markBookFailed(bookId, message) {
  try {
    await Book.findByIdAndUpdate(bookId, {
      processingStatus: 'failed',
      processingError: String(message || 'Indexing failed').slice(0, 2000),
    });
  } catch {
    /* ignore secondary failures */
  }
}

async function replaceBookSourceText(bookId, text = '') {
  const source = String(text || '');
  await BookSourcePart.deleteMany({ bookId });
  if (!source) return 0;
  const docs = [];
  for (let start = 0, partIndex = 0; start < source.length; start += BOOK_SOURCE_PART_CHARS, partIndex += 1) {
    const content = source.slice(start, start + BOOK_SOURCE_PART_CHARS);
    docs.push({ bookId, partIndex, content, charCount: content.length });
  }
  if (docs.length) await BookSourcePart.insertMany(docs, { ordered: true });
  return docs.length;
}

async function loadFullBookSourceText(book) {
  const parts = await BookSourcePart.find({ bookId: book._id })
    .select('content partIndex')
    .sort({ partIndex: 1 })
    .lean();
  if (parts.length) return parts.map((part) => String(part.content || '')).join('');
  return String(book.extractedText || '');
}

/** Apply extracted text onto a book; returns false when OCR/manual text is still required. */
async function applyExtractedTextToBook(book, buffer, mimeType, originalName) {
  const { text, requiresOcr } = await extractTextFromUpload(buffer, mimeType, originalName);
  const chapters = splitIntoChapters(text).map(({ text: _t, ...ch }) => ch);
  book.extractedText = text.slice(0, BOOK_EXTRACTED_TEXT_PREVIEW_CHARS);
  book.extractedTextLength = text.length;
  book.chapters = chapters;
  book.requiresOcr = requiresOcr;
  if (typeof buffer?.length === 'number') book.fileSize = buffer.length;

  if (text.length < 80) {
    book.processingStatus = 'needs_ocr';
    book.processingError = 'No extractable text — scanned PDF may need OCR.';
    await book.save();
    return false;
  }

  book.processingStatus = 'processing';
  book.processingError = '';
  await book.save();
  await replaceBookSourceText(book._id, text);
  return true;
}

/** Fire-and-forget extract + index using an in-memory buffer (upload path). */
export function scheduleExtractAndIndexFromBuffer(bookId, buffer, mimeType, originalName) {
  scheduleBackgroundWork(`extract+index ${bookId}`, async () => {
    try {
      const book = await Book.findById(bookId);
      if (!book) return;
      book.processingStatus = 'processing';
      book.processingError = '';
      await book.save();

      const ok = await applyExtractedTextToBook(
        book,
        buffer,
        mimeType || book.mimeType,
        originalName || book.originalFileName,
      );
      if (!ok) return;
      await extractAndStoreBookAssets({ book, buffer, mimeType: mimeType || book.mimeType }).catch((error) => {
        console.warn('[book-knowledge] multimodal extraction skipped:', error?.message || error);
      });
      await indexBook(bookId);
    } catch (err) {
      await markBookFailed(bookId, err?.message || 'Indexing failed');
    }
  });
}

/** Fire-and-forget extract + index by reading the linked learning-path file (import path). */
export function scheduleExtractAndIndexFromContentFile(bookId) {
  scheduleBackgroundWork(`import-extract+index ${bookId}`, async () => {
    try {
      const book = await Book.findById(bookId);
      if (!book) return;
      book.processingStatus = 'processing';
      book.processingError = '';
      await book.save();

      const buffer = await readContentFileBuffer(book.fileUrl);
      const ok = await applyExtractedTextToBook(
        book,
        buffer,
        book.mimeType || mimeFromFileUrl(book.fileUrl),
        book.originalFileName || path.basename(String(book.fileUrl || '')),
      );
      if (!ok) return;
      await extractAndStoreBookAssets({
        book,
        buffer,
        mimeType: book.mimeType || mimeFromFileUrl(book.fileUrl),
      }).catch((error) => {
        console.warn('[book-knowledge] multimodal extraction skipped:', error?.message || error);
      });
      await indexBook(bookId);
    } catch (err) {
      await markBookFailed(bookId, err?.message || 'Indexing failed');
    }
  });
}

/** Fire-and-forget reindex when extracted text already exists. */
export function scheduleIndexBook(bookId) {
  scheduleBackgroundWork(`index ${bookId}`, async () => {
    try {
      await indexBook(bookId);
    } catch (err) {
      await markBookFailed(bookId, err?.message || 'Indexing failed');
    }
  });
}

/**
 * Re-read the original source before rebuilding chunks. This is intentionally
 * different from scheduleIndexBook: legacy rows may contain only the old
 * extractedText preview, so embedding that preview again would preserve the
 * truncation and could never recover omitted chapters.
 */
export async function reextractAndIndexBook(bookId) {
  const book = await Book.findById(bookId);
  if (!book) throw new Error('Book not found');
  book.processingStatus = 'processing';
  book.processingError = '';
  await book.save();

  const buffer = await getPdfBufferFromStorage(book);
  const mimeType = book.mimeType || mimeFromFileUrl(book.fileUrl);
  const originalName = book.originalFileName || path.basename(String(book.fileUrl || ''));
  const ok = await applyExtractedTextToBook(book, buffer, mimeType, originalName);
  if (!ok) return { bookId: book._id, status: book.processingStatus, indexed: false };
  await extractAndStoreBookAssets({ book, buffer, mimeType }).catch((error) => {
    console.warn('[book-knowledge] multimodal re-extraction skipped:', error?.message || error);
  });
  const indexed = await indexBook(bookId);
  return { ...indexed, status: 'indexed', indexed: true };
}

export function scheduleReextractAndIndexBook(bookId) {
  scheduleBackgroundWork(`reextract+index ${bookId}`, async () => {
    try {
      await reextractAndIndexBook(bookId);
    } catch (err) {
      await markBookFailed(bookId, err?.message || 'Re-extraction and indexing failed');
    }
  });
}

/** Persist uploaded file and create Book record; indexing runs in the background. */
export async function createBookFromUpload({
  buffer,
  originalName,
  mimeType,
  title,
  board,
  class: classLabel,
  subject,
  topic,
  subtopic,
  source,
  uploadedBy,
  uploadedByRole,
  productCategory,
  relativePath,
  corpusId,
  sourcePriority,
  difficultyBand,
  edition,
  approvalStatus,
}) {
  await ensureBookContentIdIndex();
  await ensureUploadDir();
  const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(originalName || '.pdf')}`;
  const localPath = path.join(BOOK_UPLOAD_DIR, safeName);
  await fs.writeFile(localPath, buffer);

  let fileUrl = `/uploads/book-knowledge/${safeName}`;
  let storageProvider = 'local';
  let storageKey = '';
  try {
    const stored = await uploadPdfToConfiguredStorage({
      localPath,
      originalName,
      mimeType,
    });
    fileUrl = stored.fileUrl;
    storageProvider = stored.storageProvider;
    storageKey = stored.storageKey;
    if (stored.shouldDeleteLocal) {
      await fs.unlink(localPath).catch(() => {});
    }
  } catch {
    /* keep local file */
  }

  const resolvedCategory =
    normalizeIitCategoryLoose(productCategory) ||
    inferProductCategoryFromPath(relativePath || originalName) ||
    '';
  const subjectName = String(subject || '').trim();
  const boardLabel = board || 'CBSE';
  const slotTitle = buildMaterialSlotTitle({
    subject: subjectName,
    productCategory: resolvedCategory,
    fallbackTitle: title || originalName || 'Untitled Book',
  });

  const sharedFields = {
    title: String(title || '').trim() || slotTitle,
    board: boardLabel,
    class: classLabel,
    subject: subjectName,
    productCategory: resolvedCategory || '',
    topic: String(topic || '').trim(),
    subtopic: String(subtopic || '').trim(),
    source: source || 'textbook',
    corpusId: String(corpusId || `${boardLabel}:${classLabel}:${subjectName}:${resolvedCategory || 'GENERAL'}`)
      .trim()
      .toLowerCase(),
    sourcePriority: Math.max(1, Number(sourcePriority) || 100),
    difficultyBand: enumValue(difficultyBand, BOOK_DIFFICULTY_BANDS, ''),
    edition: String(edition || '').trim(),
    approvalStatus: enumValue(approvalStatus, BOOK_APPROVAL_STATUSES, 'approved'),
    fileUrl,
    storageProvider,
    storageKey,
    originalFileName: originalName,
    mimeType,
    fileSize: buffer.length,
    extractedText: '',
    extractedTextLength: 0,
    chapters: [],
    requiresOcr: false,
    processingStatus: 'pending',
    processingError: '',
    uploadedBy: String(uploadedBy || '').trim(),
    uploadedByRole: String(uploadedByRole || 'super-admin').trim(),
  };

  // Multiple approved sources may coexist in one curriculum corpus. A new
  // upload must not silently overwrite NCERT/coaching/question-bank material.
  const book = await Book.create(sharedFields);

  scheduleExtractAndIndexFromBuffer(book._id, buffer, mimeType, originalName);
  return book;
}

/** Chunk + embed all content for a book. */
export async function indexBook(bookId) {
  const book = await Book.findById(bookId);
  if (!book) throw new Error('Book not found');

  book.processingStatus = 'processing';
  book.processingError = '';
  await book.save();

  try {
    const fullText = await loadFullBookSourceText(book);
    if (!fullText || fullText.length < 80) {
      book.processingStatus = 'needs_ocr';
      book.processingError = 'Insufficient text for indexing.';
      await book.save();
      throw new Error(book.processingError);
    }

    await BookChunk.deleteMany({ bookId: book._id });

    const chapterSegments = splitIntoChapters(fullText);
    const indexedAssets = await BookAsset.find({ bookId: book._id })
      .select('assetId chapter subtopic page')
      .lean();
    const allChunkDocs = [];
    const corpusId = String(book.corpusId || '').trim();
    const existingHashes = corpusId
      ? new Set(
          (await BookChunk.find({
            corpusId,
            bookId: { $ne: book._id },
            approvalStatus: { $nin: ['rejected', 'archived'] },
          }).distinct('contentHash')).filter(Boolean),
        )
      : new Set();
    let duplicateChunkCount = 0;
    let globalIndex = 0;

    for (const chapter of chapterSegments) {
      const chapterChunks = chunkChapterText(chapter.text || fullText.slice(chapter.startOffset, chapter.endOffset), chapter);
      for (const chunk of chapterChunks) {
        const contentHash = crypto.createHash('sha256').update(chunk.content).digest('hex');
        if (existingHashes.has(contentHash)) {
          duplicateChunkCount += 1;
          continue;
        }
        existingHashes.add(contentHash);
        const { embedding, embeddingModel } = await generateEmbedding(chunk.content);
        allChunkDocs.push({
          bookId: book._id,
          chunkIndex: globalIndex,
          chapter: chunk.chapter || chapter.title,
          topic: chunk.topic || chapter.topic,
          subtopic: chunk.subtopic || chapter.subtopic,
          assetIds: indexedAssets
            .filter((asset) => {
              const assetChapter = String(asset.chapter || '').trim().toLowerCase();
              const chunkChapter = String(chunk.chapter || chapter.title || '').trim().toLowerCase();
              const assetSubtopic = String(asset.subtopic || '').trim().toLowerCase();
              const chunkSubtopic = String(chunk.subtopic || chapter.subtopic || '').trim().toLowerCase();
              return Boolean(
                (assetChapter && chunkChapter && (assetChapter.includes(chunkChapter) || chunkChapter.includes(assetChapter))) ||
                (assetSubtopic && chunkSubtopic && (assetSubtopic.includes(chunkSubtopic) || chunkSubtopic.includes(assetSubtopic))),
              );
            })
            .map((asset) => asset.assetId),
          content: chunk.content,
          contentHash,
          wordCount: chunk.wordCount,
          tokenCount: chunk.tokenCount,
          embedding,
          embeddingModel,
          board: book.board,
          class: book.class,
          subject: book.subject,
          corpusId: book.corpusId || '',
          sourcePriority: book.sourcePriority || 100,
          sourceType: book.source || '',
          difficultyBand: book.difficultyBand || '',
          approvalStatus: book.approvalStatus || 'approved',
        });
        globalIndex += 1;
      }
    }

    if (allChunkDocs.length) {
      await BookChunk.insertMany(allChunkDocs, { ordered: false });
    }

    book.chunkCount = allChunkDocs.length;
    book.duplicateChunkCount = duplicateChunkCount;
    book.embeddingsCreated = allChunkDocs.length > 0;
    book.processingStatus = 'indexed';
    book.chapters = chapterSegments.map(({ text: _t, ...ch }) => ch);
    book.lastIndexedAt = new Date();
    await book.save();

    return { bookId: book._id, chunkCount: allChunkDocs.length, duplicateChunkCount };
  } catch (error) {
    book.processingStatus = 'failed';
    book.processingError = error.message || 'Indexing failed';
    await book.save();
    throw error;
  }
}

export async function deleteBook(bookId) {
  const { default: BookAsset } = await import('../../../models/BookAsset.js');
  await BookChunk.deleteMany({ bookId });
  await BookSourcePart.deleteMany({ bookId });
  await BookAsset.deleteMany({ bookId });
  await Book.findByIdAndDelete(bookId);
  return { deleted: true };
}

export async function getBookStats(bookId) {
  const book = await Book.findById(bookId).lean();
  if (!book) return null;
  const chunkCount = await BookChunk.countDocuments({ bookId });
  return {
    bookId,
    title: book.title,
    chunkCount,
    embeddingsCreated: book.embeddingsCreated,
    extractedTextLength: book.extractedTextLength,
    chapters: book.chapters?.length || 0,
    processingStatus: book.processingStatus,
    generationStats: book.generationStats || {},
  };
}

function normalizeContentFileUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`;
  return trimmed;
}

function isImportableContentFileUrl(url) {
  const normalized = normalizeContentFileUrl(url);
  if (!normalized.startsWith('/uploads/content/')) return false;
  const ext = path.extname(normalized).toLowerCase();
  return IMPORTABLE_EXTENSIONS.has(ext);
}

function mimeFromFileUrl(fileUrl) {
  const ext = path.extname(fileUrl).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

function mapContentTypeToBookSource(contentType) {
  const t = String(contentType || '').trim();
  if (t === 'Workbook') return 'notes';
  if (t === 'Material') return 'other';
  return 'textbook';
}

function classNumberFromSubjectName(name) {
  const base = subjectDisplayName(name);
  const match = String(base || '').match(/\bclass\s*(\d{1,2})\b/i);
  return match ? match[1] : '';
}

function inferClassDigitsFromTitle(title = '') {
  const raw = String(title || '');
  const ordinal = raw.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)\b/i);
  if (ordinal?.[1]) return ordinal[1];
  const classWord = raw.match(/\bclass\s*[-:]?\s*(\d{1,2})\b/i);
  if (classWord?.[1]) return classWord[1];
  return '';
}

function inferSubjectFromTitle(title = '') {
  const t = String(title || '').toLowerCase();
  if (/\bmaths?\b|\bmathematics\b/.test(t)) return 'Mathematics';
  if (/\bphysics\b/.test(t)) return 'Physics';
  if (/\bchemistry\b/.test(t)) return 'Chemistry';
  if (/\bbiology\b/.test(t)) return 'Biology';
  if (/\bscience\b/.test(t)) return 'Science';
  if (/\benglish\b/.test(t)) return 'English';
  if (/\bhindi\b/.test(t)) return 'Hindi';
  if (/\bsst\b|\bsocial\s*science|\bsocial\s*studies/.test(t)) return 'Social Science';
  return '';
}

function normalizeImportedSubjectName(name, title = '') {
  const raw = subjectDisplayName(name);
  if (raw && !/^general$/i.test(raw)) {
    const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (compact.includes('math')) return 'Mathematics';
    if (compact.includes('phys')) return 'Physics';
    if (compact.includes('chem')) return 'Chemistry';
    if (compact.includes('bio')) return 'Biology';
    if (compact.includes('sci')) return 'Science';
    if (compact.includes('eng')) return 'English';
    if (compact.includes('hin')) return 'Hindi';
    if (compact.includes('sst') || compact.includes('social')) return 'Social Science';
    return raw;
  }
  return inferSubjectFromTitle(title) || raw || 'General';
}

function resolveImportedClassLabel({ content, subjectDoc, title = '' }) {
  const board = content.board || subjectDoc?.board || 'CBSE';
  const rawClass =
    (content.classNumber && String(content.classNumber).trim()) ||
    (subjectDoc?.classNumber && String(subjectDoc.classNumber).trim()) ||
    classNumberFromSubjectName(subjectDoc?.name || '') ||
    inferClassDigitsFromTitle(title) ||
    '';
  return resolveClassLabelForAiToolStorage(rawClass, board) || rawClass || 'General';
}

/** Normalize book row for API consumers (fixes content-import class/subject shapes). */
export function enrichBookCurriculumFields(book = {}) {
  const boardRaw = canonicalBoardLabel(book.board || 'CBSE') || 'CBSE';
  const boardGrouped = lockBoardKey(boardRaw);
  const board =
    boardGrouped === 'IIT/NEET'
      ? String(book.board || '').trim() || 'IIT / NEET'
      : boardRaw;
  const title = String(book.title || '').trim();
  let classLabel = resolveClassLabelForAiToolStorage(book.class, boardRaw);
  if (!classLabel || /^general$/i.test(classLabel)) {
    classLabel = resolveClassLabelForAiToolStorage(inferClassDigitsFromTitle(title), boardRaw) || classLabel;
  }
  let subject = normalizeImportedSubjectName(book.subject, title);
  if (!subject || /^general$/i.test(subject)) {
    subject = inferSubjectFromTitle(title) || subject;
  }
  return {
    ...book,
    board,
    class: classLabel || book.class || '',
    subject: subject || book.subject || '',
  };
}

function resolveContentPrimaryFileUrl(content) {
  const urls = Array.isArray(content.fileUrls) ? content.fileUrls : [];
  const candidates = [
    ...urls.map(normalizeContentFileUrl),
    normalizeContentFileUrl(content.fileUrl),
  ].filter(Boolean);
  return candidates.find(isImportableContentFileUrl) || '';
}

async function readContentFileBuffer(fileUrl) {
  const normalized = normalizeContentFileUrl(fileUrl);
  if (!normalized.startsWith('/uploads/content/')) {
    throw new Error('Only server-uploaded learning-path files can be imported.');
  }
  const relative = normalized.replace(/^\/uploads\/content\//, '');
  // Prevent path traversal outside the content uploads folder.
  const localPath = path.resolve(CONTENT_UPLOAD_DIR, relative);
  if (!localPath.startsWith(path.resolve(CONTENT_UPLOAD_DIR) + path.sep) && localPath !== path.resolve(CONTENT_UPLOAD_DIR)) {
    throw new Error('Invalid content file path.');
  }
  try {
    return await fs.readFile(localPath);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Learning-path file missing on disk: ${normalized}`);
    }
    throw err;
  }
}

/** List learning-path textbooks/materials that can be linked to the book knowledge base. */
export async function listImportableLearningContent({ board, type, imported } = {}) {
  const filter = {
    type: { $in: [...IMPORTABLE_CONTENT_TYPES] },
    isActive: { $ne: false },
  };
  if (board) filter.board = board;
  if (type && IMPORTABLE_CONTENT_TYPES.has(type)) filter.type = type;

  const rows = await Content.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  const subjectIds = [...new Set(rows.map((r) => String(r.subject || '')).filter(Boolean))];
  const subjects = subjectIds.length
    ? await Subject.find({ _id: { $in: subjectIds } })
        .select('name classNumber board productCategory')
        .lean()
    : [];
  const subjectById = new Map(subjects.map((s) => [String(s._id), s]));

  const contentIds = rows.map((r) => r._id);
  const linkedBooks = await Book.find({ contentId: { $in: contentIds } })
    .select('_id contentId processingStatus chunkCount title productCategory')
    .lean();
  const bookByContentId = new Map(linkedBooks.map((b) => [String(b.contentId), b]));

  const items = rows
    .map((row) => {
      const fileUrl = resolveContentPrimaryFileUrl(row);
      if (!fileUrl) return null;

      const subjectDoc = row.subject ? subjectById.get(String(row.subject)) : null;
      const subjectName = normalizeImportedSubjectName(subjectDoc?.name, row.title);
      const classLabel = resolveImportedClassLabel({ content: row, subjectDoc, title: row.title });
      const productCategory =
        normalizeIitCategoryLoose(row.productCategory) ||
        normalizeIitCategoryLoose(subjectDoc?.productCategory) ||
        '';

      const linked = bookByContentId.get(String(row._id));
      return {
        contentId: row._id,
        title: row.title,
        type: row.type,
        board: row.board,
        classNumber: classLabel,
        subjectName,
        productCategory,
        topic: row.topic || row.chapter || '',
        fileUrl,
        imported: Boolean(linked),
        bookId: linked?._id || null,
        bookStatus: linked?.processingStatus || null,
        bookChunkCount: linked?.chunkCount || 0,
      };
    })
    .filter(Boolean);

  if (imported === 'true') return items.filter((i) => i.imported);
  if (imported === 'false') return items.filter((i) => !i.imported);
  return items;
}

/** Create a Book from an existing learning-path Content row (reuses file, no re-upload).
 * Returns quickly after linking; extract + embedding run in the background.
 */
export async function createBookFromContent({ contentId, uploadedBy, uploadedByRole }) {
  await ensureBookContentIdIndex();
  const content = await Content.findById(contentId).lean();
  if (!content) throw new Error('Content not found.');
  if (!IMPORTABLE_CONTENT_TYPES.has(content.type)) {
    throw new Error(`Content type "${content.type}" cannot be imported. Use TextBook, Workbook, or Material.`);
  }

  const existing = await Book.findOne({ contentId: content._id });
  if (existing) {
    return { book: existing, alreadyImported: true };
  }

  const fileUrl = resolveContentPrimaryFileUrl(content);
  if (!fileUrl) {
    throw new Error('No importable PDF/DOCX/TXT file found on this content item.');
  }

  // Fail fast if the PDF is missing on disk — without reading the full file.
  const normalized = normalizeContentFileUrl(fileUrl);
  const relative = normalized.replace(/^\/uploads\/content\//, '');
  const localPath = path.resolve(CONTENT_UPLOAD_DIR, relative);
  if (
    !localPath.startsWith(path.resolve(CONTENT_UPLOAD_DIR) + path.sep) &&
    localPath !== path.resolve(CONTENT_UPLOAD_DIR)
  ) {
    throw new Error('Invalid content file path.');
  }
  try {
    await fs.access(localPath);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Learning-path file missing on disk: ${normalized}`);
    }
    throw err;
  }

  const subjectDoc = content.subject ? await Subject.findById(content.subject).lean() : null;
  const subjectName = normalizeImportedSubjectName(subjectDoc?.name, content.title);
  const classLabel = resolveImportedClassLabel({ content, subjectDoc, title: content.title });
  const boardLabel = canonicalBoardLabel(content.board || subjectDoc?.board || 'CBSE') || 'CBSE';
  const productCategory =
    normalizeIitCategoryLoose(content.productCategory) ||
    normalizeIitCategoryLoose(subjectDoc?.productCategory) ||
    inferProductCategoryFromPath(content.title) ||
    inferProductCategoryFromPath(content.fileUrl) ||
    '';
  const slotTitle = buildMaterialSlotTitle({
    subject: subjectName,
    productCategory,
    fallbackTitle: content.title,
  });

  const mimeType = mimeFromFileUrl(fileUrl);
  const originalName = path.basename(fileUrl);

  const sharedFields = {
    title: slotTitle,
    board: boardLabel,
    class: classLabel,
    subject: subjectName,
    productCategory: productCategory || '',
    topic: String(content.topic || content.chapter || '').trim(),
    subtopic: String(content.module || '').trim(),
    source: mapContentTypeToBookSource(content.type),
    corpusId: `${boardLabel}:${classLabel}:${subjectName}:${productCategory || 'GENERAL'}`.toLowerCase(),
    sourcePriority: content.type === 'TextBook' ? 10 : content.type === 'Workbook' ? 30 : 50,
    approvalStatus: 'approved',
    contentId: content._id,
    fileUrl,
    storageProvider: 'local',
    storageKey: '',
    originalFileName: originalName,
    mimeType,
    fileSize: 0,
    extractedText: '',
    extractedTextLength: 0,
    chapters: [],
    requiresOcr: false,
    processingStatus: 'pending',
    processingError: '',
    uploadedBy: String(uploadedBy || '').trim(),
    uploadedByRole: String(uploadedByRole || 'super-admin').trim(),
  };

  // Re-importing the same Content row is idempotent, while distinct Content
  // rows in the same curriculum corpus remain separate approved sources.
  let book = await Book.findOne({ contentId: content._id });
  const alreadyImported = Boolean(book);
  if (book) {
    Object.assign(book, sharedFields);
    await book.save();
  } else {
    book = await Book.create(sharedFields);
  }

  scheduleExtractAndIndexFromContentFile(book._id);
  return { book, alreadyImported };
}
