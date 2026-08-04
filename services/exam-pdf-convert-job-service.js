import crypto from 'crypto';

const jobs = new Map();
const JOB_TTL_MS = Number(process.env.EXAM_PDF_CONVERT_JOB_TTL_MS) || 2 * 60 * 60 * 1000;

function pruneExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - (job.updatedAt || job.createdAt) > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function createExamPdfConvertJob(meta = {}) {
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

export function getExamPdfConvertJob(jobId) {
  pruneExpiredJobs();
  return jobs.get(String(jobId || '')) || null;
}

export function updateExamPdfConvertJob(jobId, patch = {}) {
  const job = jobs.get(String(jobId || ''));
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

export async function runExamPdfConvertJob(jobId, runner) {
  updateExamPdfConvertJob(jobId, { status: 'running', progress: 'Starting extraction…' });
  try {
    const result = await runner((progress) => {
      updateExamPdfConvertJob(jobId, { progress: String(progress || '') });
    });
    updateExamPdfConvertJob(jobId, {
      status: 'completed',
      progress: result?.message || 'Extraction finished.',
      result,
      error: null,
    });
  } catch (err) {
    updateExamPdfConvertJob(jobId, {
      status: 'failed',
      progress: 'Extraction failed.',
      error: err?.message || String(err),
    });
  }
}
