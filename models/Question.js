import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  questionText: {
    type: String,
    required: function() {
      return !this.questionImage;
    },
    trim: true
  },
  questionImage: {
    type: String, // URL to uploaded image
    default: null
  },
  questionType: {
    type: String,
    enum: ['mcq', 'multiple', 'integer'],
    required: true
  },
  options: [{
    text: String,
    isCorrect: Boolean
  }],
  correctAnswer: {
    type: mongoose.Schema.Types.Mixed, // Can be string, number, or array
    required: true
  },
  marks: {
    type: Number,
    required: true,
    default: 1
  },
  negativeMarks: {
    type: Number,
    default: 0
  },
  explanation: {
    type: String,
    trim: true
  },
  subject: {
    type: String,
    enum: ['maths', 'physics', 'chemistry', 'biology'],
    required: true,
    default: 'maths'
  },
  chapter: {
    type: String,
    trim: true,
    default: 'General'
  },
  difficulty: {
    type: String,
    enum: ['easy', 'moderate', 'difficult', 'highly_difficult'],
    default: 'moderate'
  },
  questionCategory: {
    type: String,
    trim: true
  },
  conceptType: {
    type: String,
    enum: ['Concept', 'Application'],
    default: 'Concept'
  },
  exam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Not required for super-admin created questions
  },
  board: {
    type: String,
    required: true,
    enum: ['ASLI_EXCLUSIVE_SCHOOLS', 'CBSE', 'STATE'],
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  isActive: {
    type: Boolean,
    default: true
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

// Custom validation to ensure either questionText or questionImage is provided
questionSchema.pre('validate', function(next) {
  if (!this.questionText?.trim() && !this.questionImage) {
    return next(new Error('Either question text or image is required'));
  }
  next();
});

// Update the updatedAt field before saving
questionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for better performance
questionSchema.index({ adminId: 1 }); // Multi-tenant index
questionSchema.index({ exam: 1 });
questionSchema.index({ subject: 1 });
questionSchema.index({ isActive: 1 });
questionSchema.index({ createdAt: -1 });

export default mongoose.model('Question', questionSchema);
