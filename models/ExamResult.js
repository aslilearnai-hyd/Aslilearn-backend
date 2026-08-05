import mongoose from 'mongoose';
import { isValidSchoolBoard, normalizeSchoolBoard } from '../constants/boards.js';

const examResultSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Not required for super-admin created exams
  },
  board: {
    type: String,
    required: true,
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS',
    // Allow built-in + dynamic Board codes (e.g. TELANGANA). Static enum rejected those → HTTP 500 on submit.
    set: (v) => normalizeSchoolBoard(v),
    validate: {
      validator(value) {
        return isValidSchoolBoard(value);
      },
      message: (props) => `\`${props.value}\` is not a valid board code`,
    },
  },
  examTitle: {
    type: String,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  correctAnswers: {
    type: Number,
    required: true
  },
  wrongAnswers: {
    type: Number,
    required: true
  },
  unattempted: {
    type: Number,
    required: true
  },
  totalMarks: {
    type: Number,
    required: true
  },
  obtainedMarks: {
    type: Number,
    required: true
  },
  percentage: {
    type: Number,
    required: true
  },
  timeTaken: {
    type: Number, // in seconds
    required: true
  },
  subjectWiseScore: {
    type: Map,
    of: {
      correct: Number,
      total: Number,
      marks: Number
    },
    default: {}
  },
  answers: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  questionAnalytics: [{
    questionId: {
      type: String,
      required: false,
    },
    index: Number,
    subject: String,
    chapter: String,
    difficulty: String,
    questionType: String,
    conceptType: String,
    timeTaken: {
      type: Number,
      default: 0,
    },
    idealTime: Number,
    timeBucket: {
      type: String,
      enum: ['in_time', 'less_time', 'over_time'],
    },
    status: {
      type: String,
      enum: ['correct', 'wrong', 'not_answered'],
    },
    isCorrect: Boolean,
    isAnswered: Boolean,
  }],
  /**
   * Frozen copy of the paper at attempt time. Review / AI must use this so
   * soft/hard-deleting the live exam never blanks the student's Questions tab.
   */
  questionSnapshot: {
    type: [
      {
        _id: String,
        questionText: String,
        questionImage: String,
        questionType: String,
        options: [mongoose.Schema.Types.Mixed],
        option1: String,
        option2: String,
        option3: String,
        option4: String,
        correctAnswer: mongoose.Schema.Types.Mixed,
        marks: Number,
        negativeMarks: Number,
        explanation: String,
        subject: String,
        chapter: String,
        difficulty: String,
        assertionText: String,
        reasonText: String,
        matchColumnI: [mongoose.Schema.Types.Mixed],
        matchColumnII: [mongoose.Schema.Types.Mixed],
        sharedMatterText: String,
        sharedMatterKind: String,
        passageText: String,
        displayOrder: Number,
        exam: String,
      },
    ],
    default: [],
  },
  completedAt: {
    type: Date,
    default: Date.now
  },
  /** 1-based attempt index for this student + exam (multiple rows allowed when maxAttempts > 1). */
  attemptNumber: {
    type: Number,
    min: 1,
    default: 1
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for performance
examResultSchema.index({ examId: 1 });
examResultSchema.index({ userId: 1 });
examResultSchema.index({ adminId: 1 });
examResultSchema.index({ board: 1 });
examResultSchema.index({ completedAt: -1 });
examResultSchema.index({ adminId: 1, completedAt: -1 }); // For admin-specific analytics
examResultSchema.index({ board: 1, completedAt: -1 }); // For board-specific analytics
examResultSchema.index({ userId: 1, examId: 1, attemptNumber: 1 }, { unique: true });

const ExamResult = mongoose.model('ExamResult', examResultSchema);

export default ExamResult;




