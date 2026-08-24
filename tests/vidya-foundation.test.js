import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSessionsResponse, chatSessionResponse, vidyaErrorResponse } from '../utils/vidya-api-contracts.js';
import { RedisRateLimitStore } from '../utils/redis-rate-limit-store.js';
import { PLANES } from '../services/vidya-orchestrator.js';

test('chatSessionsResponse wraps sessions array', () => {
  const sessions = [{ id: '1', title: 'Math help' }];
  assert.deepEqual(chatSessionsResponse(sessions), { success: true, sessions });
  assert.deepEqual(chatSessionsResponse(null), { success: true, sessions: [] });
});

test('chatSessionResponse wraps single session', () => {
  const session = { id: 'abc', messages: [] };
  assert.deepEqual(chatSessionResponse(session), { success: true, session });
  assert.deepEqual(chatSessionResponse(null), { success: true, session: null });
});

test('vidyaErrorResponse includes message and statusCode', () => {
  assert.deepEqual(vidyaErrorResponse('Denied', 403), {
    success: false,
    message: 'Denied',
    statusCode: 403,
  });
});

test('RedisRateLimitStore falls back to in-memory when Redis unavailable', async () => {
  const store = new RedisRateLimitStore({ prefix: 'test', windowMs: 60_000 });
  const first = await store.increment('user-1');
  const second = await store.increment('user-1');
  assert.equal(first.totalHits, 1);
  assert.equal(second.totalHits, 2);
  assert.ok(second.resetTime instanceof Date);
});

test('PLANES exposes all Vidya chat planes', () => {
  assert.equal(PLANES.RAG, 'rag');
  assert.equal(PLANES.MENTOR_STUDENT, 'mentor-student');
  assert.equal(PLANES.CONTROL, 'control');
});
