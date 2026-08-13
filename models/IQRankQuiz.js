import mongoose from 'mongoose';
import { VALID_SCHOOL_BOARDS } from '../constants/boards.js';

/**
 * Platform Quiz module (formerly IQ/Rank Boost).
 * Super-admin creates quizzes with schedule + audience targeting for students and/or teachers.
 */
const iqRankQuizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    default: function () {
      return `Quiz - ${new Date().toLocaleDateString()}`;
    },
  },
  description: {
    type: String,
    trim: true,
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true,
  },
  classNumber: {
    type: String,
    required: true,
    trim: true,
    default: 'all',
  },
  board: {
    type: String,
    enum: VALID_SCHOOL_BOARDS,
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS',
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'expert'],
    required: true,
  },
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IQRankQuestion',
  }],
  totalQuestions: {
    type: Number,
    required: true,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  /** Legacy activity kind — new quizzes default to `quiz`. */
  activityType: {
    type: String,
    enum: ['iq-test', 'rank-boost', 'challenge', 'quiz', 'daily', 'weekly'],
    default: 'quiz',
  },
  /** once = evergreen, daily/weekly = cadence label for listing + filters */
  scheduleType: {
    type: String,
    enum: ['once', 'daily', 'weekly'],
    default: 'once',
  },
  /** For weekly: 0=Sun … 6=Sat (optional; empty = every day of week when weekly) */
  scheduleDays: {
    type: [Number],
    default: [],
  },
  /**
   * Who can see this quiz:
   * - all_schools: every school student/teacher matching class (legacy default)
   * - schools: only targetSchools
   * - trial: individual trial members only (also sets trialOnly)
   * - all_members: all platform members for allowed roles (ignores school)
   * - specific_members: only targetUserIds
   */
  audienceType: {
    type: String,
    enum: ['all_schools', 'schools', 'trial', 'all_members', 'specific_members'],
    default: 'all_schools',
  },
  /** School-admin User ids (same pattern as Exam.targetSchools) */
  targetSchools: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  /** Specific student/teacher user ids */
  targetUserIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  /** Roles that may take this quiz */
  audienceRoles: [{
    type: String,
    enum: ['student', 'teacher'],
  }],
  /** When true, only individual trial (non-paid) accounts can see this quiz. */
  trialOnly: {
    type: Boolean,
    default: false,
  },
  /** When true with trialOnly, surface after trial user login until completed. */
  promptOnLogin: {
    type: Boolean,
    default: false,
  },
  points: {
    type: Number,
    default: 100,
  },
  durationMinutes: {
    type: Number,
    default: 30,
  },
  /** When set, questions are picked dynamically from this bank (not quiz.questions). */
  questionBankSource: {
    type: String,
    trim: true,
    default: '',
  },
  dailyPickCount: {
    type: Number,
    default: 5,
  },
  generatedBy: {
    type: String,
    enum: ['super-admin', 'admin'],
    default: 'super-admin',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

iqRankQuizSchema.pre('validate', function (next) {
  if (!Array.isArray(this.audienceRoles) || this.audienceRoles.length === 0) {
    this.audienceRoles = ['student'];
  }
  next();
});

iqRankQuizSchema.index({ classNumber: 1 });
iqRankQuizSchema.index({ subject: 1 });
iqRankQuizSchema.index({ isActive: 1 });
iqRankQuizSchema.index({ createdAt: -1 });
iqRankQuizSchema.index({ classNumber: 1, subject: 1, isActive: 1 });
iqRankQuizSchema.index({ audienceType: 1, isActive: 1 });
iqRankQuizSchema.index({ scheduleType: 1, isActive: 1 });
iqRankQuizSchema.index({ targetSchools: 1 });
iqRankQuizSchema.index({ targetUserIds: 1 });
iqRankQuizSchema.index({ trialOnly: 1, promptOnLogin: 1 });

export default mongoose.model('IQRankQuiz', iqRankQuizSchema);
