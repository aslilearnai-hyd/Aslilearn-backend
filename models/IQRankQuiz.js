import mongoose from 'mongoose';

const iqRankQuizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    default: function() {
      return `IQ Quiz - ${new Date().toLocaleDateString()}`;
    }
  },
  description: {
    type: String,
    trim: true
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
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'expert'],
    required: true
  },
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IQRankQuestion'
  }],
  totalQuestions: {
    type: Number,
    required: true,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  /** Super-admin UI activity type (maps to frontend IQ activity kinds) */
  activityType: {
    type: String,
    enum: ['iq-test', 'rank-boost', 'challenge', 'quiz'],
    default: 'quiz'
  },
  points: {
    type: Number,
    default: 100
  },
  durationMinutes: {
    type: Number,
    default: 30
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
iqRankQuizSchema.index({ classNumber: 1 });
iqRankQuizSchema.index({ subject: 1 });
iqRankQuizSchema.index({ isActive: 1 });
iqRankQuizSchema.index({ createdAt: -1 });
iqRankQuizSchema.index({ classNumber: 1, subject: 1, isActive: 1 });

export default mongoose.model('IQRankQuiz', iqRankQuizSchema);



