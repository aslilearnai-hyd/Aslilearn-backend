import mongoose from 'mongoose';

/** How many times a student may reopen/resume an in-progress exam. */
export const MAX_EXAM_RESUMES = 5;

/**
 * In-progress student exam attempt — autosaved so power loss / browser close
 * can resume with the same answers and remaining timer (timer freezes at last save).
 */
const examAttemptDraftSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    answers: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
    flaggedQuestions: {
      type: [Number],
      default: [],
    },
    questionTimings: {
      type: Map,
      of: Number,
      default: {},
    },
    currentQuestionIndex: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Seconds still left on the exam clock at last autosave (frozen while offline). */
    remainingSeconds: {
      type: Number,
      required: true,
      min: 0,
    },
    durationSeconds: {
      type: Number,
      required: true,
      min: 1,
    },
    /** Times the student has reopened this draft (resume). Caps at MAX_EXAM_RESUMES. */
    resumeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastResumedAt: {
      type: Date,
      default: null,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    lastSavedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['in_progress', 'submitted'],
      default: 'in_progress',
      index: true,
    },
  },
  { timestamps: true },
);

examAttemptDraftSchema.index({ examId: 1, userId: 1 }, { unique: true });

const ExamAttemptDraft =
  mongoose.models.ExamAttemptDraft ||
  mongoose.model('ExamAttemptDraft', examAttemptDraftSchema);

export default ExamAttemptDraft;
