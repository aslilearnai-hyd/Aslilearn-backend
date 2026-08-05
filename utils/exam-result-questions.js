/**
 * Freeze the question paper onto each ExamResult at submit time.
 * Review / AI analysis must use that snapshot so deleting the live exam
 * never blanks the student's correct/wrong question breakdown.
 */
import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import { QUESTION_LIST_SORT } from './exam-question-order.js';
import { resolveExamQuestionSubjectKey } from './resolveSubjectContentIds.js';

function optionToPlain(opt) {
  if (opt == null) return opt;
  if (typeof opt === 'string' || typeof opt === 'number') return String(opt);
  if (typeof opt === 'object') {
    return {
      text: String(opt.text ?? opt.label ?? ''),
      ...(opt.image ? { image: String(opt.image) } : {}),
      ...(opt._id ? { _id: String(opt._id) } : {}),
    };
  }
  return String(opt);
}

/**
 * Compact, review-ready copy of a question (no teacher-only junk).
 */
export function snapshotExamQuestion(q, examDoc, index = 0) {
  if (!q || typeof q !== 'object') return null;
  const id = q._id != null ? String(q._id) : `snap-${index}`;
  const options = Array.isArray(q.options) ? q.options.map(optionToPlain) : [];
  return {
    _id: id,
    questionText: String(q.questionText || ''),
    questionImage: q.questionImage ? String(q.questionImage) : undefined,
    questionType: String(q.questionType || 'mcq').toLowerCase(),
    options,
    option1: q.option1 != null ? String(q.option1) : undefined,
    option2: q.option2 != null ? String(q.option2) : undefined,
    option3: q.option3 != null ? String(q.option3) : undefined,
    option4: q.option4 != null ? String(q.option4) : undefined,
    correctAnswer: q.correctAnswer,
    marks: Number(q.marks) || 1,
    negativeMarks: Number(q.negativeMarks) || 0,
    explanation: q.explanation != null ? String(q.explanation) : undefined,
    subject: resolveExamQuestionSubjectKey(q, examDoc),
    chapter: String(q.chapter || q.topic || q.chapterName || '').trim(),
    difficulty: q.difficulty != null ? String(q.difficulty) : undefined,
    assertionText: q.assertionText != null ? String(q.assertionText) : undefined,
    reasonText: q.reasonText != null ? String(q.reasonText) : undefined,
    matchColumnI: Array.isArray(q.matchColumnI) ? q.matchColumnI : undefined,
    matchColumnII: Array.isArray(q.matchColumnII) ? q.matchColumnII : undefined,
    sharedMatterText: q.sharedMatterText != null ? String(q.sharedMatterText) : undefined,
    sharedMatterKind: q.sharedMatterKind != null ? String(q.sharedMatterKind) : undefined,
    passageText: q.passageText != null ? String(q.passageText) : undefined,
    displayOrder: Number.isFinite(Number(q.displayOrder)) ? Number(q.displayOrder) : index,
    exam: examDoc?._id != null ? String(examDoc._id) : undefined,
  };
}

export function buildExamQuestionSnapshot(questions, examDoc) {
  if (!Array.isArray(questions) || !questions.length) return [];
  return questions
    .map((q, i) => snapshotExamQuestion(q, examDoc, i))
    .filter(Boolean);
}

function normalizeSnapshotRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows
    .map((q, index) => ({
      ...q,
      _id: q?._id != null ? String(q._id) : `snap-${index}`,
      questionText: String(q?.questionText || ''),
      questionType: String(q?.questionType || 'mcq').toLowerCase(),
      options: Array.isArray(q?.options) ? q.options : [],
      marks: Number(q?.marks) || 1,
      negativeMarks: Number(q?.negativeMarks) || 0,
      subject: String(q?.subject || 'maths').toLowerCase(),
      chapter: String(q?.chapter || '').trim(),
    }))
    .filter((q) => q.questionText || q.questionImage || q.options?.length);
}

/**
 * Live question bank (includes soft-deleted questions as fallback).
 */
export async function loadExamQuestionBankForResults(examId) {
  const id = examId ? String(examId) : '';
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return [];
  }
  const examDoc = await Exam.findById(id).lean();
  let questions = await Question.find({ exam: id, isActive: { $ne: false } })
    .sort(QUESTION_LIST_SORT)
    .lean();

  if (!questions.length) {
    // Soft-deleted exam sets isActive=false on questions — still needed for old results.
    questions = await Question.find({ exam: id }).sort(QUESTION_LIST_SORT).lean();
  }

  if (!questions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
    questions = await Question.find({
      _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
      isActive: { $ne: false },
    })
      .sort(QUESTION_LIST_SORT)
      .lean();
  }

  if (!questions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
    questions = await Question.find({
      _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
    })
      .sort(QUESTION_LIST_SORT)
      .lean();
  }

  if (!questions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
    questions = examDoc.questions
      .filter((q) => q && typeof q === 'object')
      .filter((q) => q.questionText || q.questionImage || q.questionType || q.options)
      .map((q, index) => ({
        _id: q._id || `embedded-${id}-${index}`,
        questionText: q.questionText || '',
        questionImage: q.questionImage || undefined,
        questionType: q.questionType || 'mcq',
        options: Array.isArray(q.options) ? q.options : [],
        correctAnswer: q.correctAnswer,
        marks: Number(q.marks) || 1,
        negativeMarks: Number(q.negativeMarks) || 0,
        explanation: q.explanation || undefined,
        subject: String(q.subject || 'maths').toLowerCase(),
        exam: id,
      }));
  }

  return questions;
}

/**
 * Prefer the frozen snapshot on the result; fall back to live bank.
 */
export async function resolveQuestionsForExamResult(examResult, examId) {
  const fromSnap = normalizeSnapshotRows(examResult?.questionSnapshot);
  if (fromSnap.length > 0) {
    return fromSnap;
  }
  const id =
    examId ||
    (examResult?.examId != null
      ? typeof examResult.examId === 'object' && examResult.examId._id != null
        ? String(examResult.examId._id)
        : String(examResult.examId)
      : '');
  return loadExamQuestionBankForResults(id);
}

export function mapLikeToPlainObject(value) {
  if (value == null) return value;
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value === 'object' && typeof value.get === 'function' && typeof value.set === 'function') {
    try {
      return Object.fromEntries(value);
    } catch (_e) {
      return { ...value };
    }
  }
  return value;
}

/** Ensure exam result JSON includes plain-object Map fields. */
export function toPlainExamResultForApi(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  out.answers = mapLikeToPlainObject(out.answers);
  out.subjectWiseScore = mapLikeToPlainObject(out.subjectWiseScore);
  out.questionTimings = mapLikeToPlainObject(out.questionTimings);
  // Don't send the full snapshot twice on list endpoints if huge — review uses `questions`.
  return out;
}

/**
 * Copy the live paper onto result rows that still lack questionSnapshot.
 * Call before soft/hard deleting questions so students keep review + AI alignment.
 */
export async function backfillExamResultQuestionSnapshots(examId, examDoc = null) {
  const ExamResult = (await import('../models/ExamResult.js')).default;
  const liveQuestions = await loadExamQuestionBankForResults(examId);
  if (!liveQuestions.length) return 0;
  let exam = examDoc;
  if (!exam) {
    exam = await Exam.findById(examId).lean();
  }
  const snapshot = buildExamQuestionSnapshot(
    liveQuestions,
    exam?.toObject?.() || exam || { _id: examId },
  );
  if (!snapshot.length) return 0;
  const pending = await ExamResult.find({
    examId,
    $or: [
      { questionSnapshot: { $exists: false } },
      { questionSnapshot: { $size: 0 } },
      { questionSnapshot: null },
    ],
  })
    .select('_id')
    .lean();
  if (!pending.length) return 0;
  await ExamResult.updateMany(
    { _id: { $in: pending.map((r) => r._id) } },
    { $set: { questionSnapshot: snapshot } },
  );
  return pending.length;
}
