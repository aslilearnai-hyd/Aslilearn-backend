import mongoose from 'mongoose';

const iqRankQuizResultSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IQRankQuiz',
    required: false // Optional for backward compatibility
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },
  classNumber: {
    type: String,
    required: true,
    trim: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  correctAnswers: {
    type: Number,
    required: true
  },
  incorrectAnswers: {
    type: Number,
    required: true
  },
  unattempted: {
    type: Number,
    required: true
  },
  score: {
    type: Number, // Percentage score
    required: true
  },
  answers: {
    type: Map,
    of: String, // questionId -> selected answer
    default: {}
  },
  completedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better performance
iqRankQuizResultSchema.index({ userId: 1, subject: 1 });
iqRankQuizResultSchema.index({ userId: 1, completedAt: -1 });
iqRankQuizResultSchema.index({ subject: 1, classNumber: 1 });

// Ensure one result per user per subject (latest attempt)
iqRankQuizResultSchema.index({ userId: 1, subject: 1 }, { unique: false });

export default mongoose.model('IQRankQuizResult', iqRankQuizResultSchema);

