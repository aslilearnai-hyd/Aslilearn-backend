import mongoose from 'mongoose';

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
