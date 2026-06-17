import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import Book from '../models/Book.js';
import BookChunk from '../models/BookChunk.js';
import Content from '../models/Content.js';
import Subject from '../models/Subject.js';
import { generateEmbedding } from './pdf-rag-service.js';
import { uploadPdfToConfiguredStorage } from './cloud-storage.js';
import geminiService from './gemini-service.js';
import { subjectDisplayName } from '../utils/subjectDelete.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOK_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'book-knowledge');
const CONTENT_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'content');

const IMPORTABLE_CONTENT_TYPES = new Set(['TextBook', 'Workbook', 'Material']);
const IMPORTABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.txt']);

const CHUNK_WORDS_MIN = Number(process.env.BOOK_CHUNK_WORDS_MIN || 500);
const CHUNK_WORDS_MAX = Number(process.env.BOOK_CHUNK_WORDS_MAX || 1000);
const CHUNK_OVERLAP_WORDS = Number(process.env.BOOK_CHUNK_OVERLAP_WORDS || 80);

function normalizeSpaces(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
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
    const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    return normalizeSpaces(texts.join(' '));
  } catch {
    return extractDocxTextFallback(buffer);
  }
}

function extractDocxTextFallback(buffer) {
  const raw = buffer.toString('utf8');
  const texts = [...raw.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  if (texts.length) return normalizeSpaces(texts.join(' '));
  return normalizeSpaces(raw.replace(/<[^>]+>/g, ' '));
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
async function ocrFallbackWithGemini(buffer, fileName = 'document.pdf') {
  const enabled = String(process.env.BOOK_OCR_FALLBACK || 'true').toLowerCase() !== 'false';
  if (!enabled) return '';
  try {
    const b64 = buffer.toString('base64');
    const prompt =
      'Extract ALL readable educational text from this document. Return plain text only — preserve headings, numbered lists, and paragraph breaks. Do not summarize.';
    const raw = await geminiService.generateStructuredContent(
      `${prompt}\n\n[Document: ${fileName}, base64 length ${b64.length}]`,
      'text',
      { temperature: 0.1, maxTokens: 8000 },
    );
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
    if (text.length < 80) {
      const ocrText = await ocrFallbackWithGemini(buffer, originalName);
      if (ocrText.length > text.length) text = ocrText;
    }
    return { text, requiresOcr: text.length < 80 };
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
    /^(chapter\s+[\dIVXLC]+[\s.:)\-–—]*|unit\s+[\dIVXLC]+[\s.:)\-–—]*|part\s+[\dIVXLC]+[\s.:)\-–—]*|section\s+[\dIVXLC]+[\s.:)\-–—]*)/i;

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
  const minWords = Math.min(CHUNK_WORDS_MIN, maxWords);
  const stride = Math.max(minWords - CHUNK_OVERLAP_WORDS, 200);
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

/** Persist uploaded file and create Book record. */
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
}) {
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

  const { text, requiresOcr } = await extractTextFromUpload(buffer, mimeType, originalName);
  const chapters = splitIntoChapters(text).map(({ text: _t, ...ch }) => ch);

  const book = await Book.create({
    title: String(title || originalName || 'Untitled Book').trim(),
    board: board || 'CBSE',
    class: classLabel,
    subject,
    topic: String(topic || '').trim(),
    subtopic: String(subtopic || '').trim(),
    source: source || 'textbook',
    fileUrl,
    storageProvider,
    storageKey,
    originalFileName: originalName,
    mimeType,
    fileSize: buffer.length,
    extractedText: text.slice(0, 500000),
    extractedTextLength: text.length,
    chapters,
    requiresOcr,
    processingStatus: text.length < 80 ? 'needs_ocr' : 'pending',
    processingError: text.length < 80 ? 'No extractable text — scanned PDF may need OCR.' : '',
    uploadedBy: String(uploadedBy || '').trim(),
    uploadedByRole: String(uploadedByRole || 'super-admin').trim(),
  });

  if (text.length >= 80) {
    await indexBook(book._id);
  }

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
    const fullText = book.extractedText || '';
    if (!fullText || fullText.length < 80) {
      book.processingStatus = 'needs_ocr';
      book.processingError = 'Insufficient text for indexing.';
      await book.save();
      throw new Error(book.processingError);
    }

    await BookChunk.deleteMany({ bookId: book._id });

    const chapterSegments = splitIntoChapters(fullText);
    const allChunkDocs = [];
    let globalIndex = 0;

    for (const chapter of chapterSegments) {
      const chapterChunks = chunkChapterText(chapter.text || fullText.slice(chapter.startOffset, chapter.endOffset), chapter);
      for (const chunk of chapterChunks) {
        const { embedding, embeddingModel } = await generateEmbedding(chunk.content);
        allChunkDocs.push({
          bookId: book._id,
          chunkIndex: globalIndex,
          chapter: chunk.chapter || chapter.title,
          topic: chunk.topic || chapter.topic,
          subtopic: chunk.subtopic || chapter.subtopic,
          content: chunk.content,
          wordCount: chunk.wordCount,
          tokenCount: chunk.tokenCount,
          embedding,
          embeddingModel,
          board: book.board,
          class: book.class,
          subject: book.subject,
        });
        globalIndex += 1;
      }
    }

    if (allChunkDocs.length) {
      await BookChunk.insertMany(allChunkDocs, { ordered: false });
    }

    book.chunkCount = allChunkDocs.length;
    book.embeddingsCreated = allChunkDocs.length > 0;
    book.processingStatus = 'indexed';
    book.chapters = chapterSegments.map(({ text: _t, ...ch }) => ch);
    book.lastIndexedAt = new Date();
    await book.save();

    return { bookId: book._id, chunkCount: allChunkDocs.length };
  } catch (error) {
    book.processingStatus = 'failed';
    book.processingError = error.message || 'Indexing failed';
    await book.save();
    throw error;
  }
}

export async function deleteBook(bookId) {
  await BookChunk.deleteMany({ bookId });
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
  const localPath = path.join(CONTENT_UPLOAD_DIR, relative);
  return fs.readFile(localPath);
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
    ? await Subject.find({ _id: { $in: subjectIds } }).select('name classNumber board').lean()
    : [];
  const subjectById = new Map(subjects.map((s) => [String(s._id), s]));

  const contentIds = rows.map((r) => r._id);
  const linkedBooks = await Book.find({ contentId: { $in: contentIds } })
    .select('_id contentId processingStatus chunkCount title')
    .lean();
  const bookByContentId = new Map(linkedBooks.map((b) => [String(b.contentId), b]));

  const items = rows
    .map((row) => {
      const fileUrl = resolveContentPrimaryFileUrl(row);
      if (!fileUrl) return null;

      const subjectDoc = row.subject ? subjectById.get(String(row.subject)) : null;
      const subjectName = subjectDoc?.name ? subjectDisplayName(subjectDoc.name) : 'General';
      const classLabel =
        (row.classNumber && String(row.classNumber).trim()) ||
        (subjectDoc?.classNumber && String(subjectDoc.classNumber).trim()) ||
        classNumberFromSubjectName(subjectDoc?.name || '') ||
        '';

      const linked = bookByContentId.get(String(row._id));
      return {
        contentId: row._id,
        title: row.title,
        type: row.type,
        board: row.board,
        classNumber: classLabel,
        subjectName,
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

/** Create a Book from an existing learning-path Content row (reuses file, no re-upload). */
export async function createBookFromContent({ contentId, uploadedBy, uploadedByRole }) {
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

  const subjectDoc = content.subject ? await Subject.findById(content.subject).lean() : null;
  const subjectName = subjectDoc?.name ? subjectDisplayName(subjectDoc.name) : 'General';
  const classLabel =
    (content.classNumber && String(content.classNumber).trim()) ||
    (subjectDoc?.classNumber && String(subjectDoc.classNumber).trim()) ||
    classNumberFromSubjectName(subjectDoc?.name || '') ||
    'General';

  const buffer = await readContentFileBuffer(fileUrl);
  const mimeType = mimeFromFileUrl(fileUrl);
  const originalName = path.basename(fileUrl);
  const { text, requiresOcr } = await extractTextFromUpload(buffer, mimeType, originalName);
  const chapters = splitIntoChapters(text).map(({ text: _t, ...ch }) => ch);

  const book = await Book.create({
    title: String(content.title || 'Untitled').trim(),
    board: content.board || subjectDoc?.board || 'CBSE',
    class: classLabel,
    subject: subjectName,
    topic: String(content.topic || content.chapter || '').trim(),
    subtopic: String(content.module || '').trim(),
    source: mapContentTypeToBookSource(content.type),
    contentId: content._id,
    fileUrl,
    storageProvider: 'local',
    storageKey: '',
    originalFileName: originalName,
    mimeType,
    fileSize: buffer.length,
    extractedText: text.slice(0, 500000),
    extractedTextLength: text.length,
    chapters,
    requiresOcr,
    processingStatus: text.length < 80 ? 'needs_ocr' : 'pending',
    processingError: text.length < 80 ? 'No extractable text — scanned PDF may need OCR.' : '',
    uploadedBy: String(uploadedBy || '').trim(),
    uploadedByRole: String(uploadedByRole || 'super-admin').trim(),
  });

  if (text.length >= 80) {
    await indexBook(book._id);
    const refreshed = await Book.findById(book._id);
    return { book: refreshed || book, alreadyImported: false };
  }

  return { book, alreadyImported: false };
}
