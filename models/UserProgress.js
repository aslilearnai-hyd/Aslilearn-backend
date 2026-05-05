import mongoose from 'mongoose';

const userProgressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video'
  },
  assessmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assessment'
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content'
  },
  learningPathId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LearningPath'
  },
  completed: {
    type: Boolean,
    default: false
  },
  score: {
    type: Number,
    min: 0,
    max: 100
  },
  timeSpent: {
    type: Number, // in seconds
    default: 0
  },
  progress: {
    type: Number, // percentage
    min: 0,
    max: 100,
    default: 0
  },
  lastAccessed: {
    type: Date,
    default: Date.now
  },
  // AI practice question tracking (Phase 2.2)
  attempts: {
    type: Number,
    default: 0
  },
  correctCount: {
    type: Number,
    default: 0
  },
  subject: {
    type: String,
    default: '',
    trim: true
  },
  topic: {
    type: String,
    default: '',
    trim: true
  },
  subTopic: {
    type: String,
    default: '',
    trim: true
  },
  toolType: {
    type: String,
    default: '',
    trim: true
  },
  classNumber: {
    type: String,
    default: '',
    trim: true
  },
  lastQuestionId: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Compound indexes for better performance
userProgressSchema.index({ userId: 1, videoId: 1 });
userProgressSchema.index({ userId: 1, assessmentId: 1 });
userProgressSchema.index({ userId: 1, contentId: 1 });
userProgressSchema.index({ userId: 1, learningPathId: 1 });
userProgressSchema.index({ userId: 1, completed: 1 });
userProgressSchema.index({ userId: 1, contentId: 1, completed: 1 }); // For learning progress queries
userProgressSchema.index({ userId: 1, subject: 1, topic: 1 }); // For AI practice progress lookups
userProgressSchema.index({ userId: 1, lastAccessed: -1 });

export default mongoose.model('UserProgress', userProgressSchema);

