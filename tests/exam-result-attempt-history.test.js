import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeExamResultRows } from '../utils/dedupe-exam-results.js';

test('preserves historical submissions and reconstructs attempt numbers', () => {
  const rows = [
    {
      _id: 'second',
      userId: 'student-1',
      examId: 'exam-1',
      attemptNumber: 1,
      obtainedMarks: 16,
      totalMarks: 20,
      correctAnswers: 8,
      wrongAnswers: 2,
      unattempted: 0,
      timeTaken: 500,
      completedAt: '2026-10-11T10:00:00.000Z',
    },
    {
      _id: 'first',
      userId: 'student-1',
      examId: 'exam-1',
      attemptNumber: 1,
      obtainedMarks: 12,
      totalMarks: 20,
      correctAnswers: 6,
      wrongAnswers: 4,
      unattempted: 0,
      timeTaken: 600,
      completedAt: '2026-10-10T10:00:00.000Z',
    },
  ];

  const result = dedupeExamResultRows(rows);
  assert.equal(result.length, 2);
  assert.equal(result.find((row) => row._id === 'first').attemptNumber, 1);
  assert.equal(result.find((row) => row._id === 'second').attemptNumber, 2);
});

test('still collapses a near-identical double submit', () => {
  const base = {
    userId: 'student-1',
    examId: 'exam-1',
    attemptNumber: 1,
    obtainedMarks: 12,
    totalMarks: 20,
    correctAnswers: 6,
    wrongAnswers: 4,
    unattempted: 0,
    timeTaken: 600,
  };
  const result = dedupeExamResultRows([
    { ...base, _id: 'a', completedAt: '2026-10-10T10:00:00.000Z' },
    { ...base, _id: 'b', completedAt: '2026-10-10T10:00:20.000Z' },
  ]);
  assert.equal(result.length, 1);
});
