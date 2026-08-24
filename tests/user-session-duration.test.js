import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SESSION_DURATION_MINUTES,
  normalizeSessionDuration,
} from '../models/UserSession.js';

test('MAX_SESSION_DURATION_MINUTES is 12 hours', () => {
  assert.equal(MAX_SESSION_DURATION_MINUTES, 720);
});

test('normalizeSessionDuration keeps tracked minutes when endTime is late in day', () => {
  const minutes = normalizeSessionDuration({
    duration: 25,
    startTime: new Date('2026-08-24T00:00:00.000+05:30'),
    endTime: new Date('2026-08-24T18:00:00.000+05:30'),
  });
  assert.equal(minutes, 25);
});

test('normalizeSessionDuration does not use minutes-since-midnight', () => {
  const minutes = normalizeSessionDuration({
    duration: 8,
    startTime: new Date('2026-08-24T00:00:00.000+05:30'),
    endTime: new Date('2026-08-24T10:30:00.000+05:30'),
  });
  assert.notEqual(minutes, 630);
  assert.equal(minutes, 8);
});

test('normalizeSessionDuration caps above 12 hours', () => {
  assert.equal(normalizeSessionDuration({ duration: 5000 }), 720);
});

test('normalizeSessionDuration derives only when duration missing', () => {
  const minutes = normalizeSessionDuration({
    duration: null,
    startTime: new Date('2026-08-24T10:00:00.000Z'),
    endTime: new Date('2026-08-24T10:40:00.000Z'),
  });
  assert.equal(minutes, 40);
});
