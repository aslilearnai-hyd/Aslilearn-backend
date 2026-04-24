import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processPdfSource } from '../services/pdf-rag-service.js';
import PdfProcessingFailure from '../models/PdfProcessingFailure.js';

const QUEUE_NAME = 'pdf-processing';
const redisUrl = process.env.REDIS_URL || '';

let queue = null;
let worker = null;
let queueEnabled = false;

function buildConnection() {
  if (!redisUrl) return null;
  return new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export function initPdfProcessingQueue() {
  const connection = buildConnection();
  if (!connection) {
    console.warn('PDF queue disabled: REDIS_URL not configured (will use sync processing)');
    queueEnabled = false;
    return { queueEnabled: false };
  }

  queue = new Queue(QUEUE_NAME, { connection });
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { sourcePdfId } = job.data || {};
      if (!sourcePdfId) throw new Error('Missing sourcePdfId in queue job');
      return processPdfSource(sourcePdfId);
    },
    { connection, concurrency: Number(process.env.PDF_QUEUE_CONCURRENCY || 2) }
  );

  worker.on('completed', (job) => {
    console.log(`PDF queue completed job=${job.id}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`PDF queue failed job=${job?.id}:`, err?.message);
    if (job?.data?.sourcePdfId) {
      PdfProcessingFailure.create({
        sourcePdfId: job.data.sourcePdfId,
        jobId: String(job.id || ''),
        attemptsMade: job.attemptsMade || 0,
        errorMessage: err?.message || 'Unknown queue error',
        stack: err?.stack || '',
      }).catch((logErr) => console.error('Failed to save dead-letter log:', logErr.message));
    }
  });
  queueEnabled = true;
  return { queueEnabled: true };
}

export async function enqueuePdfProcessing(sourcePdfId) {
  if (!queueEnabled || !queue) {
    return { enqueued: false, reason: 'queue-disabled' };
  }
  const job = await queue.add(
    'process-pdf',
    { sourcePdfId },
    {
      attempts: Number(process.env.PDF_QUEUE_ATTEMPTS || 4),
      backoff: {
        type: 'exponential',
        delay: Number(process.env.PDF_QUEUE_BACKOFF_MS || 3000),
      },
      removeOnComplete: 100,
      removeOnFail: false,
    }
  );
  return { enqueued: true, jobId: job.id };
}

export function isPdfQueueEnabled() {
  return queueEnabled;
}

