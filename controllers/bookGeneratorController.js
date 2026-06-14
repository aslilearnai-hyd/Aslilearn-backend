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

export async function listBookBasedTools(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  res.json({ success: true, data: BOOK_BASED_TOOL_SLUGS });
}

export async function generateBookBatch(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
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
    const query = { sourceType: 'book_rag' };
    if (toolSlug) query.toolName = toolSlug;
    if (bookId) query['metadata.bookId'] = String(bookId);
    if (board) query.board = boardMongoMatch(board) || board;
    if (className) query.classLabel = className;
    if (subjectName) query.subject = subjectName;
    if (topicName) query.topic = topicName;
    if (subtopicName) query.subtopic = subtopicName;

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
    await AiToolGeneration.findOneAndDelete({ _id: req.params.id, sourceType: 'book_rag' });
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Delete failed.' });
  }
}
