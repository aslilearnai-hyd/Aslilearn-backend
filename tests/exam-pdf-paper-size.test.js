/**
 * Exam PDF extract paper-size (80 vs 120).
 * Run: node --test tests/exam-pdf-paper-size.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferExamPaperQuestionCeiling,
  pdfExtractRangeChunks,
  sequentialExpectedNumbers,
  subjectQuestionRanges,
} from '../utils/exam-pdf-paper-size.js';

describe('inferExamPaperQuestionCeiling', () => {
  it('keeps classic 80-question papers at 80', () => {
    assert.equal(
      inferExamPaperQuestionCeiling({ printedNumbers: [1, 80], subjectSectionCount: 4 }),
      80,
    );
    assert.equal(inferExamPaperQuestionCeiling({ plannedTotal: 80 }), 80);
  });

  it('covers 120-question papers instead of stopping at 80', () => {
    assert.equal(inferExamPaperQuestionCeiling({ plannedTotal: 120 }), 120);
    assert.equal(inferExamPaperQuestionCeiling({ printedNumbers: [1, 120] }), 120);
    assert.equal(inferExamPaperQuestionCeiling({ answerKeyNumbers: [120] }), 120);
    assert.equal(
      inferExamPaperQuestionCeiling({ plannedTotal: 80, printedNumbers: [1, 120] }),
      120,
    );
  });

  it('defaults unknown 4-subject papers to 120 so Q81–120 are not skipped', () => {
    assert.equal(inferExamPaperQuestionCeiling({ subjectSectionCount: 4 }), 120);
  });
});

describe('subjectQuestionRanges', () => {
  it('uses 20 questions per subject for 80-Q papers', () => {
    assert.deepEqual(subjectQuestionRanges(4, 80), [
      { from: 1, to: 20 },
      { from: 21, to: 40 },
      { from: 41, to: 60 },
      { from: 61, to: 80 },
    ]);
  });

  it('uses 30 questions per subject for 120-Q papers', () => {
    assert.deepEqual(subjectQuestionRanges(4, 120), [
      { from: 1, to: 30 },
      { from: 31, to: 60 },
      { from: 61, to: 90 },
      { from: 91, to: 120 },
    ]);
  });
});

describe('pdfExtractRangeChunks', () => {
  it('includes 81–120 in fast mode for 120-Q papers', () => {
    assert.deepEqual(pdfExtractRangeChunks(120, { fastMode: true }), [
      [1, 40],
      [41, 80],
      [81, 120],
    ]);
  });

  it('fast mode 80-Q still only needs two 40-Q chunks', () => {
    assert.deepEqual(pdfExtractRangeChunks(80, { fastMode: true }), [
      [1, 40],
      [41, 80],
    ]);
  });
});

describe('sequentialExpectedNumbers', () => {
  it('lists 1 through 120', () => {
    const nums = sequentialExpectedNumbers(120);
    assert.equal(nums.length, 120);
    assert.equal(nums[0], 1);
    assert.equal(nums[119], 120);
  });
});
