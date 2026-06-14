import mongoose from 'mongoose';
import AiToolGeneration from '../models/AiToolGeneration.js';
import Book from '../models/Book.js';
import { generateBookBatchAndSave } from '../services/book-generator-batch-orchestrator.js';
import { BOOK_BASED_TOOL_SLUGS, isBookBasedToolSlug } from '../config/bookBasedTools.js';
import { boardMongoMatch } from '../utils/board-label.js';
import { groupAiGeneratorRecords } from './aiGeneratorController.js';

function ensureSuperAdmin(req, res) {
  if (req.user?.role !== 'super-admin') {
    res.status(403).json({ success: false, message: 'Super admin access required.' });
    return false;
  }
  return true;
}

function buildBookGeneratorMongoQuery(query = {}) {
  const mongoQuery = { sourceType: 'book_rag' };
  if (query.toolSlug) mongoQuery.toolName = query.toolSlug;
  if (query.bookId) mongoQuery['metadata.bookId'] = String(query.bookId);
  if (query.board) mongoQuery.board = boardMongoMatch(query.board) || query.board;
  if (query.className) mongoQuery.classLabel = query.className;
  if (query.subjectName) mongoQuery.subject = query.subjectName;
  if (query.topicName) mongoQuery.topic = query.topicName;
  if (query.subtopicName) mongoQuery.subtopic = query.subtopicName;
  return mongoQuery;
}

export async function listBookBasedTools(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  res.json({ success: true, data: BOOK_BASED_TOOL_SLUGS });
}

export async function generateBookBatch(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  if (req.socket) req.socket.setTimeout(900000);
  if (typeof res.setTimeout === 'function') res.setTimeout(900000);
  try {
    const {
      toolSlug,
      toolName,
      bookId,
      board,
      className,
      subjectName,
      topicName,
      subtopicName,
      batchSize,
      useBookKnowledge,
      extraParams,
    } = req.body || {};

    const slug = String(toolSlug || toolName || '').trim();
    if (!isBookBasedToolSlug(slug)) {
      return res.status(400).json({ success: false, message: `Unsupported book-based tool: ${slug}` });
    }

    const result = await generateBookBatchAndSave(
      {
        toolSlug: slug,
        bookId,
        board,
        className,
        subjectName,
        topicName,
        subtopicName,
        batchSize,
        useBookKnowledge: useBookKnowledge !== false,
        extraParams,
      },
      { reqUser: req.user },
    );

    const status = result.locked ? 409 : result.success ? 200 : 502;
    res.status(status).json({ success: result.success, data: result, message: result.message });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message || 'Book generation failed.' });
  }
}

export async function listBookGeneratorRecords(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const { toolSlug, bookId, board, className, subjectName, topicName, subtopicName } = req.query;
    const query = buildBookGeneratorMongoQuery({
      toolSlug,
      bookId,
      board,
      className,
      subjectName,
      topicName,
      subtopicName,
    });

    const records = await AiToolGeneration.find(query).sort({ createdAt: -1 }).limit(2000).lean();
    const grouped = groupAiGeneratorRecords(records);
    res.json({
      success: true,
      data: {
        grouped,
        total: records.length,
        items: records,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list records.' });
  }
}

export async function listBooksForGenerator(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const { board, class: classLabel, subject } = req.query;
    const filter = { processingStatus: 'indexed', embeddingsCreated: true };
    if (board) filter.board = board;
    if (classLabel) filter.class = classLabel;
    if (subject) filter.subject = subject;

    const books = await Book.find(filter)
      .select('title board class subject source chunkCount generationStats processingStatus')
      .sort({ title: 1 })
      .lean();
    res.json({ success: true, data: books });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to list books.' });
  }
}

export async function deleteBookGeneratorRecord(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const deleted = await AiToolGeneration.findOneAndDelete({
      _id: req.params.id,
      sourceType: 'book_rag',
    }).lean();
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Delete failed.' });
  }
}

export async function deleteAllBookGeneratorRecords(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const { board, toolSlug, bookId } = req.query;
    const mongoQuery = buildBookGeneratorMongoQuery({ board, toolSlug, bookId });
    const result = await AiToolGeneration.deleteMany(mongoQuery);
    const deletedCount = Number(result?.deletedCount || 0);
    res.json({
      success: true,
      data: { deletedCount },
      message: `Deleted ${deletedCount} book-grounded record${deletedCount === 1 ? '' : 's'}.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to delete all records.' });
  }
}

export async function bulkDeleteBookGeneratorRecords(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(rawIds.map((x) => String(x || '').trim()).filter(Boolean))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid record ids provided.' });
    }

    const result = await AiToolGeneration.deleteMany({
      _id: { $in: ids },
      sourceType: 'book_rag',
    });
    const deletedCount = Number(result?.deletedCount || 0);

    res.json({
      success: deletedCount > 0,
      data: { deletedCount, failedCount: ids.length - deletedCount },
      message: `Deleted ${deletedCount} of ${ids.length} record(s).`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to bulk delete records.' });
  }
}
