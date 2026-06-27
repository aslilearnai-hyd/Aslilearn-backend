import mongoose from 'mongoose';
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
import {
  BOOK_BASED_TOOL_SLUGS,
  isBookBasedToolSlug,
  BOOK_GENERATOR_DEFAULT_BATCH_SIZE,
  BOOK_GENERATOR_MAX_INR,
  BOOK_GENERATOR_UNIQUENESS_TARGET,
} from '../config/bookBasedTools.js';
import { boardMongoMatch } from '../utils/board-label.js';
import { bookGroundedMongoFilter, isBookGroundedRecord } from '../utils/book-grounded-record.js';
import {
  GENERATOR_LIST_SELECT,
  groupAiGeneratorRecords,
  slimGeneratorRecordForList,
} from './aiGeneratorController.js';

function ensureSuperAdmin(req, res) {
  if (req.user?.role !== 'super-admin') {
    res.status(403).json({ success: false, message: 'Super admin access required.' });
    return false;
  }
  return true;
}

export async function listBookBasedTools(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  res.json({
    success: true,
    data: BOOK_BASED_TOOL_SLUGS,
    batchConfig: {
      batchSize: BOOK_GENERATOR_DEFAULT_BATCH_SIZE,
      maxInr: BOOK_GENERATOR_MAX_INR,
      uniquenessTarget: BOOK_GENERATOR_UNIQUENESS_TARGET,
    },
  });
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

    {
      const { validateAiToolSubjectForTool } = await import('../utils/ai-tool-subject-rules.js');
      const subjectError = validateAiToolSubjectForTool(slug, subjectName);
      if (subjectError) {
        return res.status(400).json({ success: false, message: subjectError });
      }
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
        return generateBookBatchAndSave(params, { reqUser: req.user, onProgress });
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

function mapBookGeneratorRecord(item) {
  if (!item) return null;
  return {
    ...item,
    className: item.classLabel,
    subjectName: item.subject,
    topicName: item.topic,
    subtopicName: item.subtopic,
    toolSlug: item.toolName,
    generatedContent: item.generatedContent || item.content || '',
  };
}

function buildBookRecordsListQuery(req) {
  const { toolSlug, bookId, board, className, subjectName, topicName, subtopicName } = req.query;
  const extra = {};
  if (toolSlug) extra.toolName = toolSlug;
  if (bookId) extra['metadata.bookId'] = String(bookId);
  if (board) extra.board = boardMongoMatch(board) || board;
  if (className) extra.classLabel = className;
  if (subjectName) extra.subject = subjectName;
  if (topicName) extra.topic = topicName;
  if (subtopicName) extra.subtopic = subtopicName;
  return bookGroundedMongoFilter(extra);
}

export async function getBookGeneratorRecord(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid record id.' });
    }
    const doc = await AiToolGeneration.findOne({ _id: id, ...bookGroundedMongoFilter({}) }).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Record not found.' });
    return res.json({ success: true, data: mapBookGeneratorRecord(doc) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch record.' });
  }
}

export async function updateBookGeneratorRecord(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid record id.' });
    }
    const generatedContent = String(req.body.generatedContent || '').trim();
    if (!generatedContent) {
      return res.status(400).json({ success: false, message: 'generatedContent is required.' });
    }
    const update = { generatedContent, content: generatedContent };
    const doc = await AiToolGeneration.findOneAndUpdate(
      { _id: id, ...bookGroundedMongoFilter({}) },
      { $set: update },
      { new: true },
    ).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Record not found.' });
    return res.json({
      success: true,
      data: mapBookGeneratorRecord(doc),
      message: 'Record updated successfully.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to update record.' });
  }
}

export async function bulkDeleteBookGeneratorRecords(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'ids array is required.' });
    }
    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const docs = await AiToolGeneration.find({
      _id: { $in: validIds },
      ...bookGroundedMongoFilter({}),
    })
      .select('_id')
      .lean();
    const deletable = docs.map((d) => d._id);
    if (!deletable.length) {
      return res.status(404).json({ success: false, message: 'No matching book-grounded records found.' });
    }
    const result = await AiToolGeneration.deleteMany({ _id: { $in: deletable } });
    return res.json({
      success: true,
      data: {
        deletedCount: result.deletedCount || 0,
        failedCount: Math.max(0, validIds.length - (result.deletedCount || 0)),
      },
      message: `Deleted ${result.deletedCount || 0} record(s).`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Bulk delete failed.' });
  }
}

export async function deleteAllBookGeneratorRecords(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const query = buildBookRecordsListQuery(req);
    const result = await AiToolGeneration.deleteMany(query);
    return res.json({
      success: true,
      data: { deletedCount: result.deletedCount || 0 },
      message: `Deleted ${result.deletedCount || 0} book-grounded record(s).`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Delete all failed.' });
  }
}

export async function listBookGeneratorRecords(req, res) {
  if (!ensureSuperAdmin(req, res)) return;
  try {
    const query = buildBookRecordsListQuery(req);
    const limitRaw = Number(req.query.limit);
    const envCap = Number(process.env.BOOK_GENERATOR_RECORDS_LIST_LIMIT || 0);
    const listLimit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 10000)
        : Number.isFinite(envCap) && envCap > 0
          ? Math.min(envCap, 10000)
          : 0;

    let finder = AiToolGeneration.find(query)
      .select(`${GENERATOR_LIST_SELECT} content`)
      .sort({ createdAt: -1 });
    if (listLimit > 0) finder = finder.limit(listLimit);

    const [total, records] = await Promise.all([AiToolGeneration.countDocuments(query), finder.lean()]);
    const slim = records.map(slimGeneratorRecordForList).filter(Boolean);
    const grouped = groupAiGeneratorRecords(slim);
    res.json({
      success: true,
      data: {
        grouped,
        total,
        loadedCount: slim.length,
        truncated: listLimit > 0 && total > slim.length,
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
    const doc = await AiToolGeneration.findById(req.params.id).lean();
    if (!doc || !isBookGroundedRecord(doc)) {
      return res.status(404).json({ success: false, message: 'Record not found.' });
    }
    await AiToolGeneration.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Delete failed.' });
  }
}
