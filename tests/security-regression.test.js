/**
 * Security regression tests (no DB required).
 * Run: node --test tests/security-regression.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAssessmentAttempt } from '../utils/grade-assessment.js';
import { hostnameMatchesAllowlist, assertAllowedFetchUrl } from '../utils/url-allowlist.js';
import { pickAllowedFields, SAFE_VIDEO_UPDATE_FIELDS } from '../utils/safe-update-fields.js';
import { hashOpaqueToken, generateOpaqueToken } from '../models/AuthSession.js';
import {
  isPublicUploadPath,
  roleMayAccessUpload,
  signUploadPath,
  verifyUploadSignature,
} from '../utils/upload-access.js';
import { createCsrfOriginGuard } from '../middleware/csrf-origin.js';
import {
  collectAttendanceEntries,
  normalizeAttendanceStatus,
  summarizeAttendanceCounts,
} from '../utils/attendance-helpers.js';

describe('gradeAssessmentAttempt', () => {
  it('computes score server-side and ignores client score concept', () => {
    const quiz = {
      questions: [
        { question: '2+2?', correctAnswer: '4', points: 2 },
        { question: 'Capital?', correctAnswer: 'Delhi', points: 1 },
      ],
    };
    const result = gradeAssessmentAttempt(quiz, ['4', 'Mumbai']);
    assert.equal(result.graded, true);
    assert.equal(result.score, 2);
    assert.equal(result.totalPoints, 3);
  });
});

describe('url-allowlist', () => {
  it('rejects lookalike hosts', () => {
    assert.equal(hostnameMatchesAllowlist('ncert.nic.in.evil.com'), false);
    assert.equal(hostnameMatchesAllowlist('ncert.nic.in'), true);
    assert.equal(hostnameMatchesAllowlist('pdf.ncert.nic.in'), true);
  });

  it('blocks private hosts', () => {
    assert.throws(() => assertAllowedFetchUrl('http://127.0.0.1/secret'), /not allowed|Invalid|Only/i);
  });
});

describe('safe update fields', () => {
  it('strips privilege fields from video updates', () => {
    const picked = pickAllowedFields(
      { title: 'Ok', adminId: 'evil', role: 'super-admin', videoUrl: 'https://x' },
      SAFE_VIDEO_UPDATE_FIELDS,
    );
    assert.equal(picked.title, 'Ok');
    assert.equal(picked.videoUrl, 'https://x');
    assert.equal(picked.adminId, undefined);
    assert.equal(picked.role, undefined);
  });
});

describe('opaque tokens', () => {
  it('hashes refresh tokens', () => {
    const raw = generateOpaqueToken();
    const a = hashOpaqueToken(raw);
    const b = hashOpaqueToken(raw);
    assert.equal(a, b);
    assert.notEqual(a, raw);
  });
});

describe('upload access ACL', () => {
  it('treats school logos as public', () => {
    assert.equal(isPublicUploadPath('/schools/logos/x.png'), true);
    assert.equal(isPublicUploadPath('/content/secret.pdf'), false);
  });

  it('blocks students from pdf-knowledge and orders', () => {
    assert.equal(roleMayAccessUpload('/pdf-knowledge/a.pdf', { role: 'student' }), false);
    assert.equal(roleMayAccessUpload('/orders/documents/a.pdf', { role: 'student' }), false);
    assert.equal(roleMayAccessUpload('/content/a.pdf', { role: 'student' }), true);
  });

  it('allows admin all paths', () => {
    assert.equal(roleMayAccessUpload('/orders/documents/a.pdf', { role: 'admin' }), true);
  });

  it('round-trips signed upload URLs', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
    const { exp, sig, path } = signUploadPath('/uploads/content/demo.pdf', 600);
    assert.equal(verifyUploadSignature(path, exp, sig), true);
    assert.equal(verifyUploadSignature(path, exp, 'deadbeef'), false);
  });
});

describe('csrf origin guard', () => {
  it('allows Bearer mutating requests without Origin', () => {
    const guard = createCsrfOriginGuard(['https://aslilearn.ai']);
    let nextCalled = false;
    guard(
      { method: 'POST', headers: { authorization: 'Bearer abc.def.ghi' } },
      { status: () => ({ json: () => {} }) },
      () => {
        nextCalled = true;
      },
    );
    assert.equal(nextCalled, true);
  });

  it('blocks disallowed Origin on cookie POSTs', () => {
    const guard = createCsrfOriginGuard(['https://aslilearn.ai']);
    let statusCode = 0;
    guard(
      { method: 'POST', headers: { origin: 'https://evil.example' } },
      {
        status(code) {
          statusCode = code;
          return { json: () => {} };
        },
      },
      () => {
        throw new Error('should not next');
      },
    );
    assert.equal(statusCode, 403);
  });
});

describe('attendance helpers', () => {
  it('normalizes both mobile POST shapes', () => {
    const entries = collectAttendanceEntries({
      students: [{ _id: 'a', status: 'late' }],
      records: [{ studentId: 'b', status: 'Absent' }],
    });
    assert.equal(entries.length, 2);
    assert.equal(normalizeAttendanceStatus('Present'), 'present');
    const counts = summarizeAttendanceCounts([
      { status: 'present' },
      { status: 'absent' },
      { status: 'late' },
    ]);
    assert.deepEqual(counts, { presentCount: 1, absentCount: 1, lateCount: 1 });
  });
});
