import mongoose from 'mongoose';

const examSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  examType: {
    type: String,
    enum: ['weekend', 'mains', 'advanced', 'practice'],
    default: 'weekend'
  },
  duration: {
    type: Number, // in minutes
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  totalMarks: {
    type: Number,
    required: true
  },
  instructions: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdByRole: {
    type: String,
    enum: ['admin', 'super-admin'],
    default: 'admin'
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Not required for super-admin created exams
  },
  board: {
    type: String,
    required: true,
    enum: ['CBSE_AP', 'CBSE_TS', 'STATE_AP', 'STATE_TS'],
    uppercase: true
  },
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question'
  }],
  // School-specific targeting
  targetSchools: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isSchoolSpecific: {
    type: Boolean,
    default: false
  },
  isBoardSpecific: {
    type: Boolean,
    default: false
  },
  isAllBoards: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
examSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for better performance
examSchema.index({ adminId: 1 }); // Multi-tenant index
examSchema.index({ board: 1 }); // Board-based index
examSchema.index({ createdByRole: 1 }); // Role-based index
examSchema.index({ examType: 1 });
examSchema.index({ isActive: 1 });
examSchema.index({ createdAt: -1 });
examSchema.index({ board: 1, isActive: 1 }); // Compound index for board + active queries

export default mongoose.model('Exam', examSchema);
