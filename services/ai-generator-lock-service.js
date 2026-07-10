import crypto from 'crypto';
import AiGenerationLock from '../models/AiGenerationLock.js';
import { normalizeScope } from './ai-generator-fingerprint-service.js';
import { lockBoardKey, normalizeClassLabelForLock } from '../utils/board-label.js';

function getLockTtlMs() {
  const minutes = Number(process.env.AI_GENERATOR_LOCK_TTL_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return 15 * 60 * 1000;
}

/** Locks older than this with no release are treated as crashed/interrupted. */
function getStaleLockMs() {
  const minutes = Number(process.env.AI_GENERATOR_STALE_LOCK_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return 8 * 60 * 1000;
}

function lockAgeMs(lock, now = new Date()) {
  const created = lock?.createdAt ? new Date(lock.createdAt).getTime() : 0;
  if (!created) return 0;
  return Math.max(0, now.getTime() - created);
}

async function releaseStaleGenerationLock(existing, scope, lockedBy = 'unknown') {
  if (!existing) return false;
  const now = new Date();
  const age = lockAgeMs(existing, now);
  const staleMs = getStaleLockMs();
  const sameUser = String(existing.lockedBy || '') === String(lockedBy || '');
  const sameUserStaleMs = Math.min(staleMs, 3 * 60 * 1000);
  const isStale = age >= staleMs || (sameUser && age >= sameUserStaleMs);
  if (!isStale) return false;
  const released = await forceReleaseGenerationLock(scope);
  if (released > 0) {
    console.warn(
      `[ai-generator-lock] Released stale lock (${Math.round(age / 1000)}s old) for ${scopeKey(scope)}`,
    );
  }
  return released > 0;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLockScope(scope) {
  const base = normalizeScope(scope);
  return {
    ...base,
    board: lockBoardKey(base.board),
    className: normalizeClassLabelForLock(base.className),
    topic: String(base.topic || '').trim().replace(/\s+/g, ' '),
    subtopic: String(base.subtopic || '').trim().replace(/\s+/g, ' '),
  };
}

function scopeKey(scope) {
  const s = normalizeLockScope(scope);
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
  const s = normalizeLockScope(scope);
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
 * Release book-generator locks by tool + book (+ optional sub-topic), ignoring board/class typos.
 */
export async function forceReleaseBookGeneratorLocks({ toolSlug, bookId, subtopicName }) {
  await cleanupExpiredGenerationLocks();
  const slug = String(toolSlug || '').trim();
  const id = String(bookId || '').trim();
  if (!slug || !id) return 0;

  const now = new Date();
  const subtopicPrefix = String(subtopicName || '').trim().replace(/\s+/g, ' ');
  const filter = {
    toolSlug: slug,
    status: 'active',
    subtopic: subtopicPrefix
      ? { $regex: new RegExp(`^${escapeRegex(subtopicPrefix)}::book:${escapeRegex(id)}$`, 'i') }
      : { $regex: new RegExp(`::book:${escapeRegex(id)}$`, 'i') },
  };

  const result = await AiGenerationLock.updateMany(filter, {
    $set: { status: 'released', releasedAt: now },
  });
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
  const s = normalizeLockScope(scope);
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
    const releasedStale = await releaseStaleGenerationLock(existing, s, lockedBy);
    if (releasedStale) {
      return acquireGenerationLock(scope, lockedBy, { ...opts, forceUnlock: false });
    }
    return {
      acquired: false,
      message:
        'Generation already in progress for this topic. Wait for it to finish, or use “Clear lock & retry” if a previous batch was interrupted.',
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
      const dup = await AiGenerationLock.findOne({
        toolSlug: s.toolSlug,
        board: s.board,
        className: s.className,
        subject: s.subject,
        topic: s.topic,
        subtopic: s.subtopic,
        status: 'active',
        expiresAt: { $gt: now },
      }).lean();
      if (dup && (await releaseStaleGenerationLock(dup, s, lockedBy))) {
        return acquireGenerationLock(scope, lockedBy, { ...opts, forceUnlock: false });
      }
      return {
        acquired: false,
        message:
          'Generation already in progress for this topic. Wait for it to finish, or use “Clear lock & retry” if a previous batch was interrupted.',
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
  const s = normalizeLockScope(scope);
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

  const result = await AiGenerationLock.updateMany(filter, {
    $set: { status: 'released', releasedAt: now },
  });

  if ((result.modifiedCount || 0) === 0) {
    await forceReleaseGenerationLock(scope);
  }
}

export { scopeKey, getLockTtlMs, normalizeLockScope };
