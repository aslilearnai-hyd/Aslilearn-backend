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
  classNumber: {
    type: String,
    required: true,
    trim: true
  },
  assignedClasses: [{
    type: String,
    trim: true
  }],
  subject: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  subjects: [{
    type: String,
    enum: ['maths', 'physics', 'chemistry', 'biology'],
    trim: true,
    lowercase: true
  }],
  maxAttempts: {
    type: Number,
    required: true,
    min: 1,
    default: 1
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
    enum: ['ASLI_EXCLUSIVE_SCHOOLS', 'CBSE', 'STATE'],
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question'
  }],
  // Primary school association (calendar, filtering); mirrors first target school when set
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
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
examSchema.index({ assignedClasses: 1 });
examSchema.index({ isActive: 1 });
examSchema.index({ createdAt: -1 });
examSchema.index({ board: 1, isActive: 1 }); // Compound index for board + active queries
examSchema.index({ schoolId: 1 });
examSchema.index({ startDate: 1, endDate: 1 });

export default mongoose.model('Exam', examSchema);
