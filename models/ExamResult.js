import mongoose from 'mongoose';

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
    enum: ['ASLI_EXCLUSIVE_SCHOOLS'],
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
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
  completedAt: {
    type: Date,
    default: Date.now
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

const ExamResult = mongoose.model('ExamResult', examResultSchema);

export default ExamResult;




