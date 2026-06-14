import crypto from 'crypto';

/** In-memory batch jobs — avoids nginx/browser timeouts on long generate-batch runs. */
const jobs = new Map();
const JOB_TTL_MS = 2 * 60 * 60 * 1000;

function pruneExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createBookBatchJob(meta = {}) {
  pruneExpiredJobs();
  const jobId = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  jobs.set(jobId, {
    jobId,
    status: 'queued',
    message: 'Batch queued…',
    progress: { savedCount: 0, failedCount: 0, batchSize: meta.batchSize || 25 },
    result: null,
    error: null,
    meta,
    createdAt: now,
    updatedAt: now,
  });
  return jobId;
}

export function updateBookBatchJob(jobId, patch = {}) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  if (patch.progress) job.progress = { ...job.progress, ...patch.progress };
  return job;
}

export function getBookBatchJob(jobId) {
  pruneExpiredJobs();
  return jobs.get(jobId) || null;
}

export function completeBookBatchJob(jobId, result) {
  const locked = result?.locked === true;
  const success = result?.success === true;
  return updateBookBatchJob(jobId, {
    status: locked ? 'locked' : success ? 'completed' : 'failed',
    message: result?.message || (locked ? 'Generation already in progress.' : success ? 'Batch complete.' : 'Batch failed.'),
    progress: {
      savedCount: Number(result?.savedCount) || 0,
      failedCount: Number(result?.failedCount) || 0,
      batchSize: Number(result?.batchSize) || 25,
    },
    result,
  });
}

export function failBookBatchJob(jobId, message) {
  return updateBookBatchJob(jobId, {
    status: 'failed',
    message: message || 'Batch failed.',
    error: message || 'Batch failed.',
  });
}
