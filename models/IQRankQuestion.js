import mongoose from 'mongoose';

const iqRankQuestionSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: true,
    trim: true
  },
  questionType: {
    type: String,
    enum: ['mcq', 'multiple-choice'],
    default: 'mcq',
    required: true
  },
  options: [{
    text: {
      type: String,
      required: true
    },
    isCorrect: {
      type: Boolean,
      default: false
    }
  }],
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed, // Can be string or index
    required: true
  },
  explanation: {
    type: String,
    trim: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'expert'],
    required: true
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
  board: {
    type: String,
    enum: ['ASLI_EXCLUSIVE_SCHOOLS', 'CBSE', 'STATE'],
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  points: {
    type: Number,
    default: 1
  },
  isActive: {
    type: Boolean,
    default: true
  },
  generatedBy: {
    type: String,
    enum: ['super-admin', 'admin'],
    default: 'super-admin'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better performance
iqRankQuestionSchema.index({ classNumber: 1 });
iqRankQuestionSchema.index({ subject: 1 });
iqRankQuestionSchema.index({ difficulty: 1 });
iqRankQuestionSchema.index({ classNumber: 1, subject: 1 });
iqRankQuestionSchema.index({ isActive: 1 });
iqRankQuestionSchema.index({ createdAt: -1 });

export default mongoose.model('IQRankQuestion', iqRankQuestionSchema);

