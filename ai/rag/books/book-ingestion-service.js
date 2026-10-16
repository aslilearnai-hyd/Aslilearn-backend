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
import geminiService, { callLlmJson, extractTextFromDocument } from '../../providers/gemini-service.js';
import {
  buildSectionKey,
  computeMappingHealth,
  CURRICULUM_MAPPING_VERSION,
  detectBookSections,
  groupMappedSectionsForChunking,
  isRetrievableMapping,
  joinPages,
  lexicalSimilarity,
  mapSectionsToCurriculum,
  MAPPING_STATUS,
  removeRepeatedPageBoilerplate,
  splitPdfPages,
} from './book-curriculum-mapper.js';
import { loadCurriculumTreeForBook } from './book-curriculum-service.js';
import { chapterNumberFromTopicLabel } from '../../shared/ai-tool-topic-order.js';
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

const EMBEDDING_TIMEOUT_MS = Math.max(10_000, Number(process.env.BOOK_EMBEDDING_TIMEOUT_MS || 60_000));
const BOOK_EMBEDDING_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.BOOK_EMBEDDING_CONCURRENCY || 3)),
);

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
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
  const explicitHeadingRe = /^(chapter|unit|part|section|lesson|theme)\s+[\dIVXLC]+\b[\s.:)\-–—]*/i;
  const questionLeadRe = /^(?:if|find|solve|show|prove|evaluate|calculate|simplify|determine|write|choose|which|what|why|how|given|let|state|verify|draw|construct|classify|identify)\b/i;
  const numberedHeading = (line) => {
    const match = String(line || '').match(/^(\d{1,2})[.)]?\s+(.{3,100})$/);
    if (!match) return false;
    const title = match[2].trim();
    // PDF exercises often look like chapter headings ("1. Find ..."). Keep
    // inferred headings conservative: titles must be prose labels, not maths,
    // questions, table-of-contents rows, or decimal sub-sections.
    if (questionLeadRe.test(title)) return false;
    if (/[=<>+*/{}[\]^?]/.test(title)) return false;
    if (/\d\s*$/.test(title) || /\.{2,}/.test(title)) return false;
    return /^[A-Z][A-Za-zÀ-ž '&,:()\-–—]+$/.test(title);
  };

  const chapters = [];
  let current = { title: 'Introduction', lines: [], startOffset: 0 };
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isExplicitHeading = explicitHeadingRe.test(trimmed);
    const isNumberedHeading = numberedHeading(trimmed);
    const currentBody = current.lines.join('\n').trim();
    const currentWords = wordCount(currentBody);
    if ((isExplicitHeading || isNumberedHeading) && current.title === 'Introduction' && currentWords < 40) {
      current = { title: trimmed.slice(0, 200), lines: [line], startOffset: offset };
      offset += line.length + 1;
      continue;
    }
    const canSplit = isExplicitHeading
      ? currentWords >= 40
      : isNumberedHeading && currentWords >= 180;
    if (trimmed && canSplit) {
      const body = currentBody;
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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
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

const activeBookIndexJobs = new Map();

export function keepUniqueBookChunkHash(contentHash, seenHashes = new Set()) {
  const hash = String(contentHash || '');
  if (!hash || seenHashes.has(hash)) return false;
  seenHashes.add(hash);
  return true;
}

/**
 * Pure planning step: clean pages → detect book sections → map to curriculum →
 * group adjacent same-mapping sections. Returns null when the curriculum tree
 * is empty (caller keeps the legacy chapter splitter).
 */
export async function planCurriculumChunks({ fullText, tree, book = {}, embed, classify, overrides = new Map() }) {
  if (!tree || !tree.topics.length) return null;
  const { pages: cleanedPages, removedLines } = removeRepeatedPageBoilerplate(splitPdfPages(fullText));
  const { text, ranges } = joinPages(cleanedPages);
  let sections = detectBookSections(text, ranges);

  const contentSections = sections.filter((s) => s.level > 0);
  const chapterNumbers = new Set(contentSections.map((s) => s.chapterNumber).filter(Boolean));
  const hasChapterHeadings = contentSections.some((s) => s.level === 1);
  if (!contentSections.length) {
    // No headings at all (single-chapter notes/workbooks): the book's own
    // topic/title is the only chapter evidence.
    const chapterTitle = String(book.topic || book.title || '').trim();
    const number = chapterNumberFromTopicLabel(chapterTitle);
    sections = [{
      ...sections[0],
      level: 1,
      number: number != null ? String(number) : '',
      chapterNumber: number != null ? String(number) : '',
      title: chapterTitle,
      chapterTitle,
      text,
      wordCount: wordCount(text),
      startOffset: 0,
      endOffset: text.length,
      pageStart: ranges[0]?.page ?? null,
      pageEnd: ranges[ranges.length - 1]?.page ?? null,
      sectionKey: buildSectionKey({ level: 1, number: '', title: chapterTitle, startOffset: 0 }),
    }];
  } else if (!hasChapterHeadings && chapterNumbers.size === 1 && sections[0]?.level === 0) {
    // One-chapter PDF numbered "3.1, 3.2…": the leading text is that chapter's intro.
    const [onlyChapter] = [...chapterNumbers];
    const intro = sections[0];
    const chapterTitle = String(book.topic || '').trim();
    sections[0] = {
      ...intro,
      level: 1,
      number: onlyChapter,
      chapterNumber: onlyChapter,
      title: chapterTitle || intro.title,
      chapterTitle,
    };
    sections = sections.map((s) => (s.level >= 2 && !s.chapterTitle ? { ...s, chapterTitle } : s));
  }

  const mapping = await mapSectionsToCurriculum(sections, tree, { embed, classify, overrides });
  const groups = groupMappedSectionsForChunking(mapping.sections);
  return {
    tree,
    sections: mapping.sections,
    groups,
    boilerplateLinesRemoved: removedLines,
    geminiCallsUsed: mapping.geminiCallsUsed,
  };
}

async function buildCurriculumChunkPlan(book, fullText) {
  const tree = await loadCurriculumTreeForBook(book);
  const geminiEnabled = String(process.env.BOOK_MAPPING_GEMINI_CLASSIFIER ?? 'true').toLowerCase() !== 'false';
  const overrides = new Map(
    (book.curriculumOverrides || []).map((o) => [o.sectionKey, {
      aiTopicKey: o.aiTopicKey,
      aiSubtopicId: o.aiSubtopicId,
      reject: o.reject,
    }]),
  );
  return planCurriculumChunks({
    fullText,
    tree,
    book,
    overrides,
    embed: async (text) => (await withTimeout(generateEmbedding(text), EMBEDDING_TIMEOUT_MS, 'Mapping embedding')).embedding,
    classify: geminiEnabled
      ? (prompt) => callLlmJson(prompt, { maxTokens: 300, temperature: 0, usageLabel: 'book-curriculum-mapping' })
      : null,
  });
}

/**
 * One entry per detected book chapter (not the legacy line splitter, which
 * reported e.g. 147 "chapters" for a 7-chapter book).
 */
export function chaptersFromCurriculumSections(sections = []) {
  const byChapter = new Map();
  for (const s of sections) {
    if (!s.level || !s.chapterNumber) continue;
    const key = String(s.chapterNumber);
    const entry = byChapter.get(key) || {
      title: '',
      topic: '',
      subtopic: '',
      startOffset: s.startOffset || 0,
      endOffset: s.endOffset || 0,
      wordCount: 0,
    };
    entry.title = entry.title || (s.chapterTitle ? `Chapter ${key} - ${s.chapterTitle}` : '');
    entry.topic = entry.topic || s.aiTopicName || '';
    entry.endOffset = Math.max(entry.endOffset, s.endOffset || 0);
    entry.wordCount += s.wordCount || 0;
    byChapter.set(key, entry);
  }
  return [...byChapter.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, e]) => ({ ...e, title: e.title || e.topic || `Chapter ${key}` }));
}

function toStoredSection(section = {}) {
  return {
    sectionKey: section.sectionKey || '',
    parentSectionKey: section.parentSectionKey || '',
    level: section.level || 0,
    kind: section.kind || '',
    number: section.number || '',
    title: String(section.title || '').slice(0, 300),
    chapterNumber: section.chapterNumber || '',
    chapterTitle: String(section.chapterTitle || '').slice(0, 300),
    pageStart: section.pageStart ?? null,
    pageEnd: section.pageEnd ?? null,
    wordCount: section.wordCount || 0,
    preview: String(section.text || '').replace(/\s+/g, ' ').slice(0, 240),
    aiTopicKey: section.aiTopicKey || '',
    aiTopicName: section.aiTopicName || '',
    aiSubtopicId: section.aiSubtopicId || '',
    aiSubtopicName: section.aiSubtopicName || '',
    mappingStatus: section.mappingStatus || '',
    mappingConfidence: Number(section.mappingConfidence) || 0,
    mappingMethod: section.mappingMethod || '',
    mappingEvidence: section.mappingEvidence || {},
  };
}

/**
 * Give each extracted asset the mapping of the section on its page. When a page
 * holds sections from different subtopics, the asset is only trusted at the
 * level they agree on (same topic → topic-level; otherwise unmapped) unless its
 * caption names one of the section headings.
 */
export function mapAssetsToSections(assets = [], sections = []) {
  const result = new Map();
  const usable = sections.filter((s) => s.level > 0 && s.pageStart != null);
  for (const asset of assets) {
    const page = Number(asset.page);
    if (!Number.isFinite(page)) continue;
    const onPage = usable.filter((s) => s.pageStart <= page && (s.pageEnd ?? s.pageStart) >= page && isRetrievableMapping(s));
    if (!onPage.length) continue;
    const subtopicIds = new Set(onPage.map((s) => s.aiSubtopicId).filter(Boolean));
    let chosen = null;
    if (subtopicIds.size <= 1 && onPage.every((s) => s.aiTopicKey === onPage[0].aiTopicKey)) {
      chosen = onPage.find((s) => s.aiSubtopicId) || onPage[0];
    } else {
      const assetText = `${asset.caption || ''} ${asset.description || ''}`;
      const scored = onPage
        .map((s) => ({ s, score: Math.max(lexicalSimilarity(assetText, s.title), lexicalSimilarity(assetText, s.aiSubtopicName)) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0]?.score >= 0.6 && (scored.length < 2 || scored[0].score - scored[1].score >= 0.1)) {
        chosen = scored[0].s;
      } else if (onPage.every((s) => s.aiTopicKey === onPage[0].aiTopicKey)) {
        chosen = { ...onPage[0], aiSubtopicId: '', aiSubtopicName: '', mappingMethod: 'page_topic_only' };
      }
    }
    if (chosen) result.set(asset.assetId, chosen);
  }
  return result;
}

async function persistAssetMappings(bookId, assets = [], mappings = new Map()) {
  if (!assets.length) return;
  const ops = assets.map((asset) => {
    const m = mappings.get(asset.assetId);
    return {
      updateOne: {
        filter: { bookId, assetId: asset.assetId },
        update: {
          $set: {
            aiTopicKey: m?.aiTopicKey || '',
            aiTopicName: m?.aiTopicName || '',
            aiSubtopicId: m?.aiSubtopicId || '',
            aiSubtopicName: m?.aiSubtopicName || '',
            sectionKey: m?.sectionKey || '',
            mappingStatus: m ? m.mappingStatus : MAPPING_STATUS.UNMAPPED,
            mappingConfidence: Number(m?.mappingConfidence) || 0,
            mappingMethod: m ? (m.mappingMethod === 'page_topic_only' ? 'page_topic_only' : 'page_section') : '',
          },
        },
      },
    };
  });
  await BookAsset.bulkWrite(ops, { ordered: false });
}

/**
 * Chunk + embed all content for a book. Concurrent refresh/reindex requests for
 * the same book share one job, so their delete/insert phases cannot interleave.
 */
export async function indexBook(bookId) {
  const key = String(bookId || '');
  const active = activeBookIndexJobs.get(key);
  if (active) return active;
  const job = runBookIndex(bookId).finally(() => {
    if (activeBookIndexJobs.get(key) === job) activeBookIndexJobs.delete(key);
  });
  activeBookIndexJobs.set(key, job);
  return job;
}

async function runBookIndex(bookId) {
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

    const indexedAssets = await BookAsset.find({ bookId: book._id })
      .select('assetId chapter subtopic page caption description')
      .lean();
    // Map book sections onto AI Tools topics BEFORE chunking, so no chunk can
    // straddle two curriculum subtopics. Falls back to the legacy splitter when
    // the curriculum has no rows for this board/class/subject.
    const curriculumPlan = await buildCurriculumChunkPlan(book, fullText).catch((error) => {
      console.warn('[book-knowledge] curriculum mapping failed; using legacy chapters:', error?.message || error);
      return null;
    });

    await BookChunk.deleteMany({ bookId: book._id });

    const chapterSegments = splitIntoChapters(fullText);
    const allChunkDocs = [];
    const chunkCandidates = [];
    // A BookChunk belongs to a concrete source book. Do not deduplicate against
    // sibling books in the same curriculum corpus: doing so made a newly linked
    // Alpha/Beta book report "Indexed · 0 chunks" whenever another book happened
    // to contain the same paragraphs. Retrieval already ranks/deduplicates across
    // sources; ingestion only removes repeats inside this one book.
    const existingHashes = new Set();
    let duplicateChunkCount = 0;
    let globalIndex = 0;

    const sharedChunkFields = {
      bookId: book._id,
      board: book.board,
      class: book.class,
      subject: book.subject,
      corpusId: book.corpusId || '',
      sourcePriority: book.sourcePriority || 100,
      sourceType: book.source || '',
      difficultyBand: book.difficultyBand || '',
      approvalStatus: book.approvalStatus || 'approved',
    };

    let assetMappings = new Map();
    if (curriculumPlan) {
      assetMappings = mapAssetsToSections(indexedAssets, curriculumPlan.sections);
      for (const group of curriculumPlan.groups) {
        const groupAssetIds = indexedAssets
          .filter((asset) => group.sectionKeys.includes(assetMappings.get(asset.assetId)?.sectionKey))
          .map((asset) => asset.assetId);
        for (const chunk of chunkChapterText(group.text, { title: group.chapterTitle })) {
          const contentHash = crypto.createHash('sha256').update(chunk.content).digest('hex');
          if (!keepUniqueBookChunkHash(contentHash, existingHashes)) {
            duplicateChunkCount += 1;
            continue;
          }
          chunkCandidates.push({
            ...sharedChunkFields,
            chunkIndex: globalIndex,
            // Book-native provenance + legacy string fields.
            chapter: group.chapterTitle || group.title || '',
            topic: group.aiTopicName || group.chapterTitle || '',
            subtopic: group.aiSubtopicName || '',
            bookChapterNumber: group.chapterNumber || '',
            bookChapterTitle: group.chapterTitle || '',
            bookSubtopicNumber: group.level >= 2 ? group.number || '' : '',
            bookSubtopicTitle: group.level >= 2 ? group.headings.join(' | ').slice(0, 300) : '',
            sourcePage: group.pageStart ?? null,
            sourcePageStart: group.pageStart ?? null,
            sourcePageEnd: group.pageEnd ?? null,
            sectionKey: group.sectionKeys[0] || '',
            sectionKeys: group.sectionKeys,
            aiTopicKey: group.aiTopicKey || '',
            aiTopicName: group.aiTopicName || '',
            aiSubtopicId: group.aiSubtopicId || '',
            aiSubtopicName: group.aiSubtopicName || '',
            mappingStatus: group.mappingStatus || MAPPING_STATUS.UNMAPPED,
            mappingConfidence: Number(group.mappingConfidence) || 0,
            mappingMethod: group.mappingMethod || '',
            mappingVersion: CURRICULUM_MAPPING_VERSION,
            assetIds: groupAssetIds,
            content: chunk.content,
            contentHash,
            wordCount: chunk.wordCount,
            tokenCount: chunk.tokenCount,
          });
          globalIndex += 1;
        }
      }
    }

    for (const chapter of curriculumPlan ? [] : chapterSegments) {
      const chapterChunks = chunkChapterText(chapter.text || fullText.slice(chapter.startOffset, chapter.endOffset), chapter);
      for (const chunk of chapterChunks) {
        const contentHash = crypto.createHash('sha256').update(chunk.content).digest('hex');
        if (!keepUniqueBookChunkHash(contentHash, existingHashes)) {
          duplicateChunkCount += 1;
          continue;
        }
        chunkCandidates.push({
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

    // Persist progress in bounded batches. A restart no longer leaves a large
    // book at 0 chunks after hundreds of successful embedding calls.
    const insertBatchSize = 25;
    for (let start = 0; start < chunkCandidates.length; start += insertBatchSize) {
      const candidates = chunkCandidates.slice(start, start + insertBatchSize);
      if (!candidates.length) continue;
      const embeddedBatch = await mapWithConcurrency(
        candidates,
        BOOK_EMBEDDING_CONCURRENCY,
        async (candidate, batchIndex) => {
          const { embedding, embeddingModel } = await withTimeout(
            generateEmbedding(candidate.content),
            EMBEDDING_TIMEOUT_MS,
            `Embedding chunk ${start + batchIndex + 1}`,
          );
          return { ...candidate, embedding, embeddingModel };
        },
      );
      // Reindex requests can overlap across app instances. Idempotent upserts
      // prevent the unique {bookId, chunkIndex} index from turning a successful
      // refresh into E11000 after most chunks have already been written.
      await BookChunk.bulkWrite(
        embeddedBatch.map((doc) => ({
          replaceOne: {
            filter: { bookId: doc.bookId, chunkIndex: doc.chunkIndex },
            replacement: doc,
            upsert: true,
          },
        })),
        { ordered: false },
      );
      allChunkDocs.push(...embeddedBatch);
      await Book.updateOne(
        { _id: book._id },
        { $set: { chunkCount: allChunkDocs.length, processingStatus: 'processing' } },
      );
    }

    const persistedChunkCount = await BookChunk.countDocuments({ bookId: book._id });
    if (persistedChunkCount < 1) {
      throw new Error('No book chunks were produced from the extracted source text.');
    }
    if (curriculumPlan) {
      await persistAssetMappings(book._id, indexedAssets, assetMappings);
      book.curriculumSections = curriculumPlan.sections.map(toStoredSection);
      book.curriculumMapping = {
        ...computeMappingHealth(curriculumPlan.sections, curriculumPlan.tree, { chunks: chunkCandidates }),
        boilerplateLinesRemoved: curriculumPlan.boilerplateLinesRemoved,
        geminiCallsUsed: curriculumPlan.geminiCallsUsed,
        mappedAt: new Date(),
      };
    } else {
      book.curriculumSections = [];
      book.curriculumMapping = { status: 'no_curriculum', version: CURRICULUM_MAPPING_VERSION, mappedAt: new Date() };
    }
    book.chunkCount = persistedChunkCount;
    book.duplicateChunkCount = duplicateChunkCount;
    book.embeddingsCreated = persistedChunkCount > 0;
    book.processingStatus = 'indexed';
    book.chapters = curriculumPlan
      ? chaptersFromCurriculumSections(curriculumPlan.sections)
      : chapterSegments.map(({ text: _t, ...ch }) => ch);
    book.lastIndexedAt = new Date();
    await book.save();

    return {
      bookId: book._id,
      chunkCount: persistedChunkCount,
      duplicateChunkCount,
      curriculumMapping: book.curriculumMapping?.status || 'no_curriculum',
    };
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
  // "IIT", "IIT/NEET" and "IIT / NEET" are the same board; show one label so
  // a manual upload and a Learning Path import of the same track look alike.
  const board = boardGrouped === 'IIT/NEET' ? 'IIT / NEET' : boardRaw;
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
  const { book, alreadyImported } = await saveContentLinkedBook({
    existingBook: existing,
    sharedFields,
  });

  scheduleExtractAndIndexFromContentFile(book._id);
  return { book, alreadyImported };
}

/** Persist the current Content snapshot into its linked Book record. */
export async function saveContentLinkedBook({ existingBook, sharedFields }) {
  if (existingBook) {
    Object.assign(existingBook, sharedFields);
    await existingBook.save();
    return { book: existingBook, alreadyImported: true };
  }

  const book = await Book.create(sharedFields);
  return { book, alreadyImported: false };
}

/** Refresh a linked Book after its Subjects & Content row changes.
 * Unlinked content remains available in the manual import list.
 */
export async function refreshLinkedBookFromContent({ contentId, uploadedBy, uploadedByRole }) {
  const existing = await Book.findOne({ contentId });
  if (!existing) return { refreshed: false };

  const result = await createBookFromContent({ contentId, uploadedBy, uploadedByRole });
  return {
    refreshed: true,
    bookId: String(result.book?._id || ''),
    processingStatus: result.book?.processingStatus || 'pending',
  };
}
