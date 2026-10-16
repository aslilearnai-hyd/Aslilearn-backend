import Book from '../models/Book.js';
import BookChunk from '../models/BookChunk.js';
import BookAsset from '../models/BookAsset.js';
import BookSourcePart from '../models/BookSourcePart.js';
import AssessmentAsset from '../models/AssessmentAsset.js';
import { joinPages, removeRepeatedPageBoilerplate, splitPdfPages } from '../ai/rag/books/book-curriculum-mapper.js';
import {
  createBookFromUpload,
  createBookFromContent,
  enrichBookCurriculumFields,
  listImportableLearningContent,
  scheduleReextractAndIndexBook,
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
    // A process restart during background indexing previously left books showing
    // "Processing / 0 chunks" forever. Mark interrupted jobs as retryable failures.
    const staleBefore = new Date(Date.now() - 20 * 60 * 1000);
    await Book.updateMany(
      {
        processingStatus: { $in: ['pending', 'processing'] },
        chunkCount: { $in: [0, null] },
        updatedAt: { $lt: staleBefore },
      },
      {
        $set: {
          processingStatus: 'failed',
          processingError: 'Indexing was interrupted or timed out. Click Re-index to retry.',
        },
      },
    );
    const { board, class: classLabel, subject, status, productCategory } = req.query;
    const filter = {};
    if (board) filter.board = board;
    if (classLabel) filter.class = classLabel;
    if (subject) filter.subject = subject;
    if (status) filter.processingStatus = status;
    if (productCategory !== undefined && productCategory !== null && String(productCategory).trim() !== '') {
      const { normalizeIitCategoryLoose } = await import('../constants/products.js');
      filter.productCategory = normalizeIitCategoryLoose(productCategory);
    }

    const books = await Book.find(filter)
      .select(
        'title board class subject productCategory topic subtopic corpusId sourcePriority difficultyBand edition approvalStatus chunkCount processingStatus processingError embeddingsCreated source generationStats updatedAt createdAt contentId chapters extractedTextLength curriculumMapping',
      )
      .sort({ updatedAt: -1 })
      .lean();
    const bookIds = books.map((book) => book._id);
    const actualCounts = bookIds.length
      ? await BookChunk.aggregate([
          { $match: { bookId: { $in: bookIds } } },
          { $group: { _id: '$bookId', count: { $sum: 1 } } },
        ])
      : [];
    const countByBookId = new Map(actualCounts.map((row) => [String(row._id), Number(row.count) || 0]));
    res.json({
      success: true,
      data: books.map((book) =>
        enrichBookCurriculumFields({
          ...book,
          chunkCount: countByBookId.get(String(book._id)) || 0,
        }),
      ),
    });
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
      productCategory: req.body.productCategory,
      relativePath: req.body.relativePath || req.body.webkitRelativePath || req.file.originalname,
      corpusId: req.body.corpusId,
      sourcePriority: req.body.sourcePriority,
      difficultyBand: req.body.difficultyBand,
      edition: req.body.edition,
      approvalStatus: req.body.approvalStatus,
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
    let book = await Book.findById(req.params.id);
    // A book imported from Subjects & Content can be replaced while the list is
    // open. Recover the current Book by its stable contentId instead of making
    // the user refresh and guess which card is now current.
    if (!book && req.body?.contentId) {
      book = await Book.findOne({ contentId: req.body.contentId });
    }
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });

    book.processingStatus = 'pending';
    book.processingError = '';
    await book.save();
    scheduleReextractAndIndexBook(book._id);

    res.json({
      success: true,
      data: { bookId: book._id, processingStatus: 'pending' },
      message: 'Book source re-extraction and reindexing started.',
    });
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
    let chapters = Array.isArray(book.chapters) ? book.chapters : [];
    if (!chapters.length) {
      const rows = await BookChunk.aggregate([
        { $match: { bookId: book._id } },
        {
          $group: {
            _id: { $ifNull: ['$chapter', 'Introduction'] },
            wordCount: { $sum: { $ifNull: ['$wordCount', 0] } },
            firstChunk: { $min: '$chunkIndex' },
          },
        },
        { $sort: { firstChunk: 1 } },
      ]);
      chapters = rows.map((row) => ({
        title: String(row._id || 'Introduction'),
        topic: String(row._id || 'Introduction'),
        subtopic: '',
        wordCount: Number(row.wordCount) || 0,
      }));
    }
    res.json({ success: true, data: chapters });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load chapters.' });
  }
}

export async function getBookExtractedText(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const book = await Book.findById(req.params.id).select('extractedText extractedTextLength title').lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    let extractedText = String(book.extractedText || '');
    // Older/large books keep the full source in BookSourcePart and may have an
    // empty legacy preview even though their chunks were indexed successfully.
    if (!extractedText) {
      const parts = await BookSourcePart.find({ bookId: book._id })
        .select('content partIndex')
        .sort({ partIndex: 1 })
        .limit(2)
        .lean();
      extractedText = parts.map((part) => String(part.content || '')).join('');
    }
    // Show the same cleaned text chunks are built from: running headers,
    // footers and page markers removed (the raw text looked "noisy").
    const { pages } = removeRepeatedPageBoilerplate(splitPdfPages(extractedText));
    const cleaned = joinPages(pages).text || extractedText;
    const preview = cleaned.slice(0, 50000);
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
    const requestedLimit = Number(req.query.limit);
    const limit = Math.max(1, Math.min(2000, Number.isFinite(requestedLimit) ? requestedLimit : 1000));
    const [chunks, total] = await Promise.all([
      BookChunk.find({ bookId: req.params.id })
      .select('chunkIndex chapter topic subtopic wordCount content')
      .sort({ chunkIndex: 1 })
      .limit(limit)
      .lean(),
      BookChunk.countDocuments({ bookId: req.params.id }),
    ]);
    res.json({
      success: true,
      total,
      returned: chunks.length,
      hasMore: chunks.length < total,
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

export async function listBookAssets(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const book = await Book.findById(req.params.id).select('_id').lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    const filter = { bookId: book._id };
    const status = String(req.query.status || '').trim();
    if (status) filter.approvalStatus = status;
    const assets = await BookAsset.find(filter)
      .select('assetId page type caption description semanticText canonicalData labels sourceBBox assetPath chapter subtopic approvalStatus extractionModel extractionVersion createdAt updatedAt')
      .sort({ page: 1, createdAt: 1 })
      .lean();
    return res.json({ success: true, data: assets });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to list book assets.' });
  }
}

export async function reviewBookAsset(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const approvalStatus = String(req.body?.approvalStatus || '').trim().toLowerCase();
    if (!['pending_review', 'approved', 'rejected', 'archived'].includes(approvalStatus)) {
      return res.status(400).json({
        success: false,
        message: 'approvalStatus must be pending_review, approved, rejected, or archived.',
      });
    }
    const asset = await BookAsset.findOneAndUpdate(
      { bookId: req.params.id, assetId: req.params.assetId },
      { $set: { approvalStatus } },
      { new: true, runValidators: true },
    ).lean();
    if (!asset) return res.status(404).json({ success: false, message: 'Book asset not found.' });
    return res.json({ success: true, data: asset, message: `Asset marked ${approvalStatus}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to review book asset.' });
  }
}

export async function listAssessmentAssets(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const filter = {};
    const status = String(req.query.status || '').trim();
    if (status) filter.approvalStatus = status;
    const assets = await AssessmentAsset.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ success: true, data: assets });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to list assessment assets.' });
  }
}

export async function reviewAssessmentAsset(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const approvalStatus = String(req.body?.approvalStatus || '').trim().toLowerCase();
    if (!['pending_review', 'approved', 'rejected', 'archived'].includes(approvalStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid approvalStatus.' });
    }
    const asset = await AssessmentAsset.findOneAndUpdate(
      { assetId: req.params.assetId },
      {
        $set: {
          approvalStatus,
          reviewedBy: resolveAuthenticatedUserId(req),
          reviewedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!asset) return res.status(404).json({ success: false, message: 'Assessment asset not found.' });
    return res.json({ success: true, data: asset });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to review assessment asset.' });
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
        results.push({
          contentId,
          success: false,
          title: String(contentId || ''),
          message: err.message || 'Import failed.',
        });
      }
    }

    // Enrich failure titles from Content for clearer UI messages.
    const failedIds = results.filter((r) => !r.success).map((r) => r.contentId).filter(Boolean);
    if (failedIds.length) {
      const Content = (await import('../models/Content.js')).default;
      const docs = await Content.find({ _id: { $in: failedIds } }).select('_id title').lean();
      const titleById = new Map(docs.map((d) => [String(d._id), d.title]));
      for (const row of results) {
        if (!row.success && titleById.has(String(row.contentId))) {
          row.title = titleById.get(String(row.contentId));
        }
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
