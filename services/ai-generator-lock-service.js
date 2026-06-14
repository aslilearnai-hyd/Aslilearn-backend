import crypto from 'crypto';
import AiGenerationLock from '../models/AiGenerationLock.js';
import { normalizeScope } from './ai-generator-fingerprint-service.js';

function getLockTtlMs() {
  const minutes = Number(process.env.AI_GENERATOR_LOCK_TTL_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return 30 * 60 * 1000;
}

function scopeKey(scope) {
  const s = normalizeScope(scope);
  return [s.toolSlug, s.board, s.className, s.subject, s.topic, s.subtopic].join('|');
}

/**
 * Remove expired active locks (timeout cleanup).
 */
export async function cleanupExpiredGenerationLocks() {
  const now = new Date();
  await AiGenerationLock.updateMany(
    { status: 'active', expiresAt: { $lte: now } },
    { $set: { status: 'expired', releasedAt: now } },
  );
}

/**
 * Release all active locks for a curriculum slot (super-admin recovery).
 */
export async function forceReleaseGenerationLock(scope) {
  const s = normalizeScope(scope);
  const now = new Date();
  const result = await AiGenerationLock.updateMany(
    {
      toolSlug: s.toolSlug,
      board: s.board,
      className: s.className,
      subject: s.subject,
      topic: s.topic,
      subtopic: s.subtopic,
      status: 'active',
    },
    { $set: { status: 'released', releasedAt: now } },
  );
  return result.modifiedCount || 0;
}

/**
 * Acquire exclusive generation lock for a curriculum slot.
 * @returns {{ acquired: boolean, lockToken?: string, message?: string, existingLock?: object }}
 */
export async function acquireGenerationLock(scope, lockedBy = 'unknown', opts = {}) {
  await cleanupExpiredGenerationLocks();
  if (opts.forceUnlock) {
    await forceReleaseGenerationLock(scope);
  }
  const s = normalizeScope(scope);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getLockTtlMs());
  const lockToken = crypto.randomBytes(16).toString('hex');

  const existing = await AiGenerationLock.findOne({
    toolSlug: s.toolSlug,
    board: s.board,
    className: s.className,
    subject: s.subject,
    topic: s.topic,
    subtopic: s.subtopic,
    status: 'active',
    expiresAt: { $gt: now },
  }).lean();

  if (existing) {
    return {
      acquired: false,
      message: 'Generation already in progress.',
      existingLock: existing,
      scopeKey: scopeKey(s),
    };
  }

  try {
    const lock = await AiGenerationLock.create({
      toolSlug: s.toolSlug,
      board: s.board,
      className: s.className,
      subject: s.subject,
      topic: s.topic,
      subtopic: s.subtopic,
      status: 'active',
      lockedBy: String(lockedBy || 'unknown'),
      lockToken,
      expiresAt,
    });
    return { acquired: true, lockToken: lock.lockToken, lockId: lock._id, scopeKey: scopeKey(s) };
  } catch (err) {
    if (err?.code === 11000) {
      return {
        acquired: false,
        message: 'Generation already in progress.',
        scopeKey: scopeKey(s),
      };
    }
    throw err;
  }
}

/**
 * Release lock after success or failure.
 */
export async function releaseGenerationLock(scope, lockToken) {
  const s = normalizeScope(scope);
  const now = new Date();
  const filter = {
    toolSlug: s.toolSlug,
    board: s.board,
    className: s.className,
    subject: s.subject,
    topic: s.topic,
    subtopic: s.subtopic,
    status: 'active',
  };
  if (lockToken) filter.lockToken = lockToken;

  await AiGenerationLock.updateMany(filter, {
    $set: { status: 'released', releasedAt: now },
  });
}

export { scopeKey, getLockTtlMs };
