import crypto from 'crypto';
import AiGenerationLock from '../models/AiGenerationLock.js';
import { normalizeScope } from './ai-generator-fingerprint-service.js';

function getLockTtlMs() {
  const minutes = Number(process.env.AI_GENERATOR_LOCK_TTL_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return 30 * 60 * 1000;
}

export function getBookLockTtlMs() {
  const minutes = Number(process.env.BOOK_GENERATOR_LOCK_TTL_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return 25 * 60 * 1000;
}

function lockAgeMs(lock) {
  const t = lock?.updatedAt || lock?.createdAt;
  if (!t) return 0;
  return Date.now() - new Date(t).getTime();
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
 * Acquire exclusive generation lock for a curriculum slot.
 * @param {object} scope
 * @param {string} lockedBy
 * @param {{ ttlMs?: number, staleAfterMs?: number, forceSteal?: boolean, sameUserStealMs?: number }} [options]
 * @returns {{ acquired: boolean, lockToken?: string, message?: string, existingLock?: object }}
 */
export async function acquireGenerationLock(scope, lockedBy = 'unknown', options = {}) {
  await cleanupExpiredGenerationLocks();
  const s = normalizeScope(scope);
  const now = new Date();
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : getLockTtlMs();
  const staleAfterMs =
    Number(options.staleAfterMs) > 0 ? Number(options.staleAfterMs) : Math.max(ttlMs - 2 * 60 * 1000, 5 * 60 * 1000);
  const sameUserStealMs =
    Number(options.sameUserStealMs) > 0 ? Number(options.sameUserStealMs) : 3 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ttlMs);
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
    const age = lockAgeMs(existing);
    const sameUser = String(existing.lockedBy || '') === String(lockedBy || '');
    const canSteal =
      options.forceSteal === true ||
      age >= staleAfterMs ||
      (sameUser && age >= sameUserStealMs);

    if (canSteal) {
      await releaseGenerationLock(scope);
    } else {
      const minutesLeft = Math.max(1, Math.ceil((new Date(existing.expiresAt).getTime() - now.getTime()) / 60000));
      return {
        acquired: false,
        message: `Generation already in progress. Wait about ${minutesLeft} min or clear the lock if the previous batch failed.`,
        existingLock: existing,
        scopeKey: scopeKey(s),
      };
    }
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

export { scopeKey, getLockTtlMs, getBookLockTtlMs };
