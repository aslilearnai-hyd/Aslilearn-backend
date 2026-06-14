import AiToolGeneration from '../models/AiToolGeneration.js';
import Book from '../models/Book.js';
import { generateBookBatchAndSave } from '../services/book-generator-batch-orchestrator.js';
import { forceReleaseBookGeneratorLocks } from '../services/ai-generator-lock-service.js';
import {
  cancelBookGeneratorJobsForScope,
  createBookGeneratorJob,
  findActiveBookGeneratorJob,
  getBookGeneratorJob,
  runBookGeneratorJob,
} from '../services/book-generator-job-service.js';
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
      forceUnlock,
      async: asyncMode,
    } = req.body || {};

    const slug = String(toolSlug || toolName || '').trim();
    if (!isBookBasedToolSlug(slug)) {
      return res.status(400).json({ success: false, message: `Unsupported book-based tool: ${slug}` });
    }

    const params = {
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
      forceUnlock: forceUnlock === true,
    };

    const useAsync = asyncMode !== false;
    if (useAsync) {
      const jobMeta = {
        toolSlug: slug,
        bookId,
        topicName,
        subtopicName,
      };

      if (forceUnlock === true) {
        await forceReleaseBookGeneratorLocks(jobMeta);
        cancelBookGeneratorJobsForScope(jobMeta);
      } else {
        const activeJob = findActiveBookGeneratorJob(jobMeta);
        if (activeJob) {
          return res.status(409).json({
            success: false,
            locked: true,
            message: 'Generation already in progress for this book and sub-topic.',
            data: { locked: true, jobId: activeJob.id, status: activeJob.status },
          });
        }
      }

      const job = createBookGeneratorJob(jobMeta);
      void runBookGeneratorJob(job.id, async (onProgress) => {
        onProgress('Retrieving textbook chunks…');
        return generateBookBatchAndSave(params, { reqUser: req.user });
      });

      return res.status(202).json({
        success: true,
        async: true,
        jobId: job.id,
        message: 'Book generation started. Poll job status until complete.',
        data: { jobId: job.id, status: 'queued' },
      });
    }

    const result = await generateBookBatchAndSave(params, { reqUser: req.user });

    if (result.locked) {
      return res.status(409).json({
        success: false,
        locked: true,
        message: result.message || 'Generation already in progress.',
        data: { locked: true },
      });
    }

    const status = result.success ? 200 : 502;
    res.status(status).json({ success: result.success, data: result, message: result.message });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message || 'Book generation failed.' });
  }
}

export async function getBookGeneratorJobStatus(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  const job = getBookGeneratorJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Generation job not found or expired.' });
  }

  const terminal = ['completed', 'failed', 'locked'].includes(job.status);
  return res.json({
    success: true,
    data: {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      done: terminal,
      locked: job.status === 'locked',
      result: job.result,
      error: job.error,
    },
  });
}

export async function releaseBookGeneratorLock(req, res) {
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
    } = req.body || {};

    const slug = String(toolSlug || toolName || '').trim();
    if (!slug || !bookId) {
      return res.status(400).json({
        success: false,
        message: 'toolSlug and bookId are required.',
      });
    }

    cancelBookGeneratorJobsForScope({
      toolSlug: slug,
      bookId,
      topicName,
      subtopicName,
    });

    const released = await forceReleaseBookGeneratorLocks({
      toolSlug: slug,
      bookId,
      subtopicName,
    });

    return res.json({
      success: true,
      message:
        released > 0
          ? `Cleared ${released} stuck lock${released === 1 ? '' : 's'}. You can generate again.`
          : 'No active lock found. You can try generating again.',
      data: { released },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to release lock.' });
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
