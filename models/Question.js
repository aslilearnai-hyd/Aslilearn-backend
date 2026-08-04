import mongoose from 'mongoose';
import { VALID_SCHOOL_BOARDS } from '../constants/boards.js';

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
    // assertion_reason / match_following grade like single MCQ (options + correctAnswer)
    enum: ['mcq', 'multiple', 'integer', 'assertion_reason', 'match_following'],
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
  /**
   * Shared matter shown above every linked question in a group
   * (Case passage, AR directions, Match directions/columns intro).
   */
  sharedMatterId: {
    type: String,
    trim: true,
    default: '',
  },
  sharedMatterText: {
    type: String,
    trim: true,
    default: '',
  },
  sharedMatterKind: {
    type: String,
    enum: ['', 'case', 'assertion_reason', 'match_following'],
    default: '',
  },
  /** Per-question Assertion (A) for assertion_reason type */
  assertionText: {
    type: String,
    trim: true,
    default: '',
  },
  /** Per-question Reason (R) for assertion_reason type */
  reasonText: {
    type: String,
    trim: true,
    default: '',
  },
  /** Column I entries for match_following (e.g. [{ key: 'A', text: 'Density' }]) */
  matchColumnI: [{
    key: { type: String, trim: true, default: '' },
    text: { type: String, trim: true, default: '' },
  }],
  /** Column II entries for match_following */
  matchColumnII: [{
    key: { type: String, trim: true, default: '' },
    text: { type: String, trim: true, default: '' },
  }],
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
    enum: [
      'maths',
      'physics',
      'chemistry',
      'biology',
      'science',
      'english',
      'hindi',
      'social_science',
    ],
    required: true,
    default: 'maths'
  },
  /**
   * Paper display order (1-based preferred). Lower values appear first for students.
   * Falls back to createdAt when missing on legacy rows.
   */
  displayOrder: {
    type: Number,
    default: 0,
    min: 0,
  },
  /**
   * Optional section title shown above this question block
   * (e.g. "Maths", "Physics", "Section A – Algebra").
   * Empty → UI falls back to subject label.
   */
  sectionHeading: {
    type: String,
    trim: true,
    default: '',
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
  // Set when a question was imported with an uncertain answer (e.g. the PDF's
  // printed key was unusable). Stays on the saved question so the warning
  // survives upload, and clears only when a human edits the content.
  needsReview: {
    type: Boolean,
    default: false
  },
  reviewNote: {
    type: String,
    trim: true,
    default: ''
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
    enum: VALID_SCHOOL_BOARDS,
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
questionSchema.index({ exam: 1, displayOrder: 1, _id: 1 });

export default mongoose.model('Question', questionSchema);
