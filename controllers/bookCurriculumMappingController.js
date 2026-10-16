/**
 * Super-admin endpoints for book → AI Tools curriculum mapping:
 * health, section review/override, test retrieval and remap.
 */
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import BookChunk from '../models/BookChunk.js';
import BookAsset from '../models/BookAsset.js';
import { scheduleIndexBook } from '../services/book-ingestion-service.js';
import { loadCurriculumTreeForBook } from '../ai/rag/books/book-curriculum-service.js';
import {
  computeMappingHealth,
  MAPPING_STATUS,
  RETRIEVABLE_MAPPING_STATUSES,
} from '../ai/rag/books/book-curriculum-mapper.js';
import {
  buildBookRetrievalQuery,
  resolveCurriculumRetrievalRoute,
  searchRelevantChunks,
} from '../ai/rag/books/book-rag-service.js';
import { findScopeMismatches } from '../ai/rag/books/book-curriculum-mapper.js';

function ensureSuperAdmin(req, res) {
  if (req.user?.role !== 'super-admin') {
    res.status(403).json({ success: false, message: 'Super admin access required.' });
    return false;
  }
  return true;
}

function validBookId(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid book id.' });
    return false;
  }
  return true;
}

function serializeTree(tree) {
  return tree.topics.map((topic) => ({
    aiTopicKey: topic.topicKey,
    topicName: topic.topicName,
    topicNumber: topic.topicNumber,
    subtopics: topic.subtopics.map((s) => ({ aiSubtopicId: s.id, name: s.name, number: s.number })),
  }));
}

/** GET /books/:id/curriculum-mapping?status=unmapped,needs_review */
export async function getBookCurriculumMapping(req, res) {
  if (!ensureSuperAdmin(req, res) || !validBookId(req, res)) return;
  try {
    const book = await Book.findById(req.params.id)
      .select('title board class subject productCategory processingStatus curriculumMapping curriculumSections curriculumOverrides chunkCount')
      .lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    const tree = await loadCurriculumTreeForBook(book);
    const wanted = String(req.query.status || '').split(',').map((s) => s.trim()).filter(Boolean);
    const sections = (book.curriculumSections || []).filter(
      (s) => !wanted.length || wanted.includes(s.mappingStatus),
    );

    // Per-subtopic chunk/asset counts, so admins see which subtopics are empty.
    const [chunkCounts, assetCounts, chunksWithoutSubtopic] = await Promise.all([
      BookChunk.aggregate([
        { $match: { bookId: book._id, mappingStatus: { $in: RETRIEVABLE_MAPPING_STATUSES } } },
        { $group: { _id: { t: '$aiTopicKey', s: '$aiSubtopicId' }, count: { $sum: 1 } } },
      ]),
      BookAsset.aggregate([
        { $match: { bookId: book._id, aiTopicKey: { $ne: '' } } },
        { $group: { _id: { s: '$aiSubtopicId', type: '$type' }, count: { $sum: 1 } } },
      ]),
      BookChunk.countDocuments({ bookId: book._id, aiSubtopicId: '' }),
    ]);
    const chunksBySubtopic = Object.fromEntries(chunkCounts.filter((r) => r._id.s).map((r) => [r._id.s, r.count]));
    const topicLevelChunks = Object.fromEntries(chunkCounts.filter((r) => !r._id.s).map((r) => [r._id.t, r.count]));
    const assetsBySubtopic = {};
    for (const row of assetCounts) {
      const key = row._id.s || '_topic_level';
      assetsBySubtopic[key] = { ...(assetsBySubtopic[key] || {}), [row._id.type]: row.count };
    }

    res.json({
      success: true,
      data: {
        bookId: book._id,
        title: book.title,
        processingStatus: book.processingStatus,
        mapping: { ...(book.curriculumMapping || {}), chunksWithoutSubtopic },
        curriculum: serializeTree(tree).map((topic) => ({
          ...topic,
          topicLevelChunks: topicLevelChunks[topic.aiTopicKey] || 0,
          subtopics: topic.subtopics.map((s) => ({
            ...s,
            chunkCount: chunksBySubtopic[s.aiSubtopicId] || 0,
            assets: assetsBySubtopic[s.aiSubtopicId] || {},
          })),
        })),
        sections,
        overrides: book.curriculumOverrides || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load curriculum mapping.' });
  }
}

/**
 * PATCH /books/:id/curriculum-mapping/sections/:sectionKey
 * body: { aiSubtopicId } | { aiTopicKey } | { reject: true } | { clear: true }
 *
 * Chunks that came from this section alone are relabelled in place (no
 * re-embedding). If the section was merged with neighbours into shared chunks,
 * the book is re-chunked so no chunk ends up spanning two subtopics.
 */
export async function reviewBookCurriculumSection(req, res) {
  if (!ensureSuperAdmin(req, res) || !validBookId(req, res)) return;
  try {
    const { sectionKey } = req.params;
    const body = req.body || {};
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    const sectionIndex = (book.curriculumSections || []).findIndex((s) => s.sectionKey === sectionKey);
    if (sectionIndex < 0) return res.status(404).json({ success: false, message: 'Section not found. Reindex the book first.' });

    const tree = await loadCurriculumTreeForBook(book);
    const reviewer = String(req.user?.id || req.userId || 'super-admin');
    const overrides = (book.curriculumOverrides || []).filter((o) => o.sectionKey !== sectionKey);
    let mapping = null;

    if (!body.clear) {
      if (body.reject) {
        mapping = { aiTopicKey: '', aiTopicName: '', aiSubtopicId: '', aiSubtopicName: '', mappingStatus: MAPPING_STATUS.REJECTED };
      } else if (body.aiSubtopicId) {
        const sub = tree.subtopicById.get(String(body.aiSubtopicId));
        // Only IDs that exist in this book's curriculum are allowed.
        if (!sub) return res.status(400).json({ success: false, message: 'aiSubtopicId is not in this book\'s curriculum.' });
        mapping = {
          aiTopicKey: sub.topicKey, aiTopicName: sub.topicName,
          aiSubtopicId: sub.id, aiSubtopicName: sub.name, mappingStatus: MAPPING_STATUS.REVIEWED,
        };
      } else if (body.aiTopicKey) {
        const topic = tree.topicByKey.get(String(body.aiTopicKey));
        if (!topic) return res.status(400).json({ success: false, message: 'aiTopicKey is not in this book\'s curriculum.' });
        mapping = {
          aiTopicKey: topic.topicKey, aiTopicName: topic.topicName,
          aiSubtopicId: '', aiSubtopicName: '', mappingStatus: MAPPING_STATUS.REVIEWED,
        };
      } else {
        return res.status(400).json({ success: false, message: 'Provide aiSubtopicId, aiTopicKey, reject or clear.' });
      }
      overrides.push({
        sectionKey,
        aiTopicKey: mapping.aiTopicKey,
        aiSubtopicId: mapping.aiSubtopicId,
        reject: mapping.mappingStatus === MAPPING_STATUS.REJECTED,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
      });
    }
    book.curriculumOverrides = overrides;

    if (body.clear) {
      // Removing an override needs the automatic mapper again.
      book.processingStatus = 'pending';
      await book.save();
      scheduleIndexBook(book._id);
      return res.json({ success: true, data: { reindexScheduled: true }, message: 'Override cleared; remapping started.' });
    }

    const section = book.curriculumSections[sectionIndex];
    Object.assign(section, mapping, { mappingConfidence: 1, mappingMethod: 'manual' });
    book.markModified('curriculumSections');

    const shared = await BookChunk.countDocuments({
      bookId: book._id,
      sectionKeys: sectionKey,
      'sectionKeys.1': { $exists: true },
    });
    let reindexScheduled = false;
    let updatedChunks = 0;
    if (shared > 0) {
      book.processingStatus = 'pending';
      reindexScheduled = true;
    } else {
      const result = await BookChunk.updateMany(
        { bookId: book._id, sectionKeys: sectionKey },
        {
          $set: {
            ...mapping,
            topic: mapping.aiTopicName,
            subtopic: mapping.aiSubtopicName,
            mappingConfidence: 1,
            mappingMethod: 'manual',
          },
        },
      );
      updatedChunks = result.modifiedCount || 0;
      await BookAsset.updateMany(
        { bookId: book._id, sectionKey },
        { $set: { ...mapping, mappingConfidence: 1, mappingMethod: 'manual' } },
      );
      const chunks = await BookChunk.find({ bookId: book._id }).select('aiSubtopicId').lean();
      book.curriculumMapping = {
        ...(book.curriculumMapping?.toObject?.() || book.curriculumMapping || {}),
        ...computeMappingHealth(book.curriculumSections.map((s) => s.toObject?.() || s), tree, { chunks }),
      };
    }
    await book.save();
    if (reindexScheduled) scheduleIndexBook(book._id);

    res.json({
      success: true,
      data: { section, updatedChunks, reindexScheduled, mapping: book.curriculumMapping },
      message: reindexScheduled
        ? 'Mapping saved; the book is being re-chunked because this section shared chunks with neighbours.'
        : 'Mapping saved.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to update section mapping.' });
  }
}

/**
 * POST /books/:id/curriculum-mapping/test-retrieval
 * body: { topicName, subtopicName?, subTopics? } — runs the ID-filtered search
 * (one embedding, no Gemini) and checks every chunk is inside the scope.
 */
export async function testBookCurriculumRetrieval(req, res) {
  if (!ensureSuperAdmin(req, res) || !validBookId(req, res)) return;
  try {
    const book = await Book.findById(req.params.id).select('title board class subject productCategory').lean();
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    const scope = {
      bookId: String(book._id),
      board: book.board,
      className: book.class,
      subjectName: book.subject,
      productCategory: book.productCategory || '',
      topicName: String(req.body?.topicName || '').trim(),
      subtopicName: String(req.body?.subtopicName || '').trim(),
      subTopics: Array.isArray(req.body?.subTopics) ? req.body.subTopics : undefined,
    };
    if (!scope.topicName) return res.status(400).json({ success: false, message: 'topicName is required.' });

    const route = await resolveCurriculumRetrievalRoute(scope);
    if (route.mode !== 'strict') {
      return res.json({ success: true, data: { route, chunks: [], passed: false } });
    }
    const chunks = await searchRelevantChunks({
      query: buildBookRetrievalQuery(scope),
      bookId: scope.bookId,
      topK: Math.min(20, Number(req.body?.topK) || 10),
      ...route.filter,
    });
    const mismatches = findScopeMismatches(chunks, route.invariant);
    res.json({
      success: true,
      data: {
        route: { mode: route.mode, invariant: route.invariant, curriculum: route.curriculum },
        passed: chunks.length > 0 && mismatches.length === 0,
        mismatchCount: mismatches.length,
        chunks: chunks.map((c) => ({
          chunkId: c._id,
          score: Number((c.score || 0).toFixed(4)),
          aiTopicName: c.aiTopicName,
          aiSubtopicId: c.aiSubtopicId,
          aiSubtopicName: c.aiSubtopicName,
          mappingStatus: c.mappingStatus,
          pages: [c.sourcePageStart, c.sourcePageEnd],
          preview: String(c.content || '').slice(0, 200),
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Test retrieval failed.' });
  }
}

/** POST /books/:id/curriculum-mapping/remap — re-run mapping + chunking from stored text. */
export async function remapBookCurriculum(req, res) {
  if (!ensureSuperAdmin(req, res) || !validBookId(req, res)) return;
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ success: false, message: 'Book not found.' });
    book.processingStatus = 'pending';
    book.processingError = '';
    await book.save();
    scheduleIndexBook(book._id);
    res.json({ success: true, data: { bookId: book._id, processingStatus: 'pending' }, message: 'Curriculum remapping started.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Remap failed.' });
  }
}
