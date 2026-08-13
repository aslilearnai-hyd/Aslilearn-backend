import mongoose from 'mongoose';

/**
 * Per-user daily quiz assignment + completion for the class daily bank.
 * dateKey is local calendar day YYYY-MM-DD (Asia/Kolkata recommended at write time).
 */
const dailyQuizLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    dateKey: {
      type: String,
      required: true,
      trim: true,
    },
    classNumber: {
      type: String,
      required: true,
      trim: true,
    },
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IQRankQuiz',
      default: null,
    },
    questionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IQRankQuestion',
      },
    ],
    sourceIds: {
      type: [String],
      default: [],
    },
    answers: {
      type: Map,
      of: String,
      default: {},
    },
    correctCount: {
      type: Number,
      default: 0,
    },
    score: {
      type: Number,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

dailyQuizLogSchema.index({ userId: 1, dateKey: 1 }, { unique: true });
dailyQuizLogSchema.index({ userId: 1, completedAt: -1 });
dailyQuizLogSchema.index({ classNumber: 1, dateKey: 1 });

export default mongoose.model('DailyQuizLog', dailyQuizLogSchema);
