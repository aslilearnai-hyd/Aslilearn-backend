import crypto from 'crypto';

const jobs = new Map();
const JOB_TTL_MS = Number(process.env.BOOK_GENERATOR_JOB_TTL_MS) || 2 * 60 * 60 * 1000;

function pruneExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createBookGeneratorJob(meta = {}) {
  pruneExpiredJobs();
  const id = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const job = {
    id,
    status: 'queued',
    progress: 'Queued…',
    createdAt: now,
    updatedAt: now,
    meta,
    result: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

export function getBookGeneratorJob(jobId) {
  pruneExpiredJobs();
  return jobs.get(String(jobId || '')) || null;
}

export function updateBookGeneratorJob(jobId, patch = {}) {
  const job = jobs.get(String(jobId || ''));
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

export async function runBookGeneratorJob(jobId, runner) {
  updateBookGeneratorJob(jobId, { status: 'running', progress: 'Starting batch…' });
  try {
    const result = await runner((progress) => {
      updateBookGeneratorJob(jobId, { progress: String(progress || '') });
    });
    if (result?.locked) {
      updateBookGeneratorJob(jobId, {
        status: 'locked',
        progress: 'Blocked by an active generation lock.',
        result,
        error: result.message || 'Generation already in progress.',
      });
      return;
    }
    updateBookGeneratorJob(jobId, {
      status: result?.success ? 'completed' : 'failed',
      progress: result?.message || 'Batch finished.',
      result,
    });
  } catch (err) {
    updateBookGeneratorJob(jobId, {
      status: 'failed',
      progress: 'Batch failed.',
      error: err?.message || String(err),
    });
  }
}
