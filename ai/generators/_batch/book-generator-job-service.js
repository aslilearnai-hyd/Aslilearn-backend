import crypto from 'crypto';

const jobs = new Map();
const activeJobsByKey = new Map();
const JOB_TTL_MS = Number(process.env.BOOK_GENERATOR_JOB_TTL_MS) || 2 * 60 * 60 * 1000;

function jobScopeKey(meta = {}) {
  return [
    String(meta.toolSlug || '').trim(),
    String(meta.bookId || '').trim(),
    String(meta.topicName || '').trim(),
    String(meta.subtopicName || '').trim(),
  ].join('|');
}

function pruneExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
      for (const [key, jobId] of activeJobsByKey.entries()) {
        if (jobId === id) activeJobsByKey.delete(key);
      }
    }
  }
}

export function findActiveBookGeneratorJob(meta = {}) {
  pruneExpiredJobs();
  const key = jobScopeKey(meta);
  const jobId = activeJobsByKey.get(key);
  if (!jobId) return null;
  const job = jobs.get(jobId);
  if (!job || ['completed', 'failed', 'locked', 'cancelled'].includes(job.status)) {
    activeJobsByKey.delete(key);
    return null;
  }
  return job;
}

export function cancelBookGeneratorJobsForScope(meta = {}) {
  const key = jobScopeKey(meta);
  const jobId = activeJobsByKey.get(key);
  if (!jobId) return 0;
  const job = jobs.get(jobId);
  if (job && !['completed', 'failed', 'locked', 'cancelled'].includes(job.status)) {
    updateBookGeneratorJob(jobId, {
      status: 'cancelled',
      progress: 'Cancelled by admin.',
      error: 'Cancelled to clear stuck generation.',
    });
  }
  activeJobsByKey.delete(key);
  return job ? 1 : 0;
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
  activeJobsByKey.set(jobScopeKey(meta), id);
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
  if (['completed', 'failed', 'locked', 'cancelled'].includes(job.status)) {
    activeJobsByKey.delete(jobScopeKey(job.meta));
  }
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
