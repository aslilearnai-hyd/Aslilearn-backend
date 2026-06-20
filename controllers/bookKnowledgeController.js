import Book from '../models/Book.js';
import BookChunk from '../models/BookChunk.js';
import {
  createBookFromUpload,
  createBookFromContent,
  enrichBookCurriculumFields,
  listImportableLearningContent,
  indexBook,
  deleteBook,
  getBookStats,
} from '../services/book-ingestion-service.js';

function ensureSuperAdmin(req, res) {
  if (req.user?.role !== 'super-admin') {
    res.status(403).json({ success: false, message: 'Super admin access required.' });
    return false;
  }
  return true;
}

export async function listBooks(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const { board, class: classLabel, subject, status } = req.query;
    const filter = {};
    if (board) filter.board = board;
    if (classLabel) filter.class = classLabel;
    if (subject) filter.subject = subject;
    if (status) filter.processingStatus = status;

    const books = await Book.find(filter)
      .select(
        'title board class subject topic subtopic chunkCount processingStatus embeddingsCreated source generationStats updatedAt createdAt',
      )
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    res.json({ success: true, data: books.map((book) => enrichBookCurriculumFields(book)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list books.' });
  }
}

export async function getBook(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const book = await Book.findById(req.params.id).lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    const stats = await getBookStats(book._id);
    res.json({ success: true, data: { ...book, stats } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to get book.' });
  }
}

function resolveAuthenticatedUserId(req) {
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
}

export async function uploadBook(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    if (!req.file?.buffer && !req.file?.path) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    const fs = await import('fs/promises');
    const buffer = req.file.buffer || (await fs.readFile(req.file.path));

    const book = await createBookFromUpload({
      buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      title: req.body.title,
      board: req.body.board,
      class: req.body.class || req.body.className,
      subject: req.body.subject,
      topic: req.body.topic,
      subtopic: req.body.subtopic || req.body.subTopic,
      source: req.body.source,
      uploadedBy: resolveAuthenticatedUserId(req),
      uploadedByRole: req.user?.role || 'super-admin',
    });

    res.status(201).json({ success: true, data: book, message: 'Book uploaded and indexing started.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Upload failed.' });
  }
}

export async function reindexBook(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const result = await indexBook(req.params.id);
    res.json({ success: true, data: result, message: 'Book reindexed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Reindex failed.' });
  }
}

export async function removeBook(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    await deleteBook(req.params.id);
    res.json({ success: true, message: 'Book deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Delete failed.' });
  }
}

export async function getBookChapters(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const book = await Book.findById(req.params.id).select('chapters title processingStatus').lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    res.json({ success: true, data: book.chapters || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load chapters.' });
  }
}

export async function getBookExtractedText(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const book = await Book.findById(req.params.id).select('extractedText extractedTextLength title').lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    const preview = String(book.extractedText || '').slice(0, 50000);
    res.json({
      success: true,
      data: {
        title: book.title,
        length: book.extractedTextLength,
        preview,
        truncated: (book.extractedTextLength || 0) > preview.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load text.' });
  }
}

export async function getBookGenerationStats(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const stats = await getBookStats(req.params.id);
    if (!stats) return res.status(404).json({ success: false, message: 'Book not found.' });
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load stats.' });
  }
}

export async function listBookChunks(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const chunks = await BookChunk.find({ bookId: req.params.id })
      .select('chunkIndex chapter topic subtopic wordCount content')
      .sort({ chunkIndex: 1 })
      .limit(100)
      .lean();
    res.json({
      success: true,
      data: chunks.map((c) => ({
        ...c,
        contentPreview: String(c.content || '').slice(0, 400),
        content: undefined,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list chunks.' });
  }
}

export async function listImportableContent(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const { board, type, imported } = req.query;
    const data = await listImportableLearningContent({ board, type, imported });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list importable content.' });
  }
}

export async function importBookFromContent(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const contentId = req.body?.contentId || req.params.contentId;
    if (!contentId) {
      return res.status(400).json({ success: false, message: 'contentId is required.' });
    }

    const result = await createBookFromContent({
      contentId,
      uploadedBy: resolveAuthenticatedUserId(req),
      uploadedByRole: req.user?.role || 'super-admin',
    });

    res.status(result.alreadyImported ? 200 : 201).json({
      success: true,
      data: result.book,
      alreadyImported: result.alreadyImported,
      message: result.alreadyImported
        ? 'This learning-path item is already linked to the book knowledge base.'
        : 'Imported from learning path and indexing started.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Import failed.' });
  }
}

export async function importBooksFromContentBulk(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const contentIds = Array.isArray(req.body?.contentIds) ? req.body.contentIds : [];
    if (!contentIds.length) {
      return res.status(400).json({ success: false, message: 'contentIds array is required.' });
    }

    const results = [];
    for (const contentId of contentIds) {
      try {
        const result = await createBookFromContent({
          contentId,
          uploadedBy: resolveAuthenticatedUserId(req),
          uploadedByRole: req.user?.role || 'super-admin',
        });
        results.push({
          contentId,
          success: true,
          alreadyImported: result.alreadyImported,
          bookId: result.book?._id,
          title: result.book?.title,
          processingStatus: result.book?.processingStatus,
        });
      } catch (err) {
        results.push({ contentId, success: false, message: err.message || 'Import failed.' });
      }
    }

    const imported = results.filter((r) => r.success && !r.alreadyImported).length;
    const skipped = results.filter((r) => r.success && r.alreadyImported).length;
    const failed = results.filter((r) => !r.success).length;

    res.json({
      success: true,
      data: results,
      summary: { imported, skipped, failed, total: results.length },
      message: `Imported ${imported}, skipped ${skipped} already linked, ${failed} failed.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Bulk import failed.' });
  }
}
