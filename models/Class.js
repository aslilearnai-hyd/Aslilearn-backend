import mongoose from 'mongoose';
import { VALID_SCHOOL_BOARDS } from '../constants/boards.js';

const classSchema = new mongoose.Schema({
  classNumber: {
    type: String,
    required: true,
    trim: true
  },
  section: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 3,
    validate: {
      validator: (v) => typeof v === 'string' && /^[A-Z0-9]{1,3}$/.test(v),
      message: 'Section must be 1–3 letters or numbers (e.g. A, D, E1)',
    },
  },
  name: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  school: {
    type: String,
    default: ''
  },
  // Admin who created/manages this class
  assignedAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Subjects assigned to this class
  assignedSubjects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject'
  }],
  // Board for this class
  board: {
    type: String,
    enum: VALID_SCHOOL_BOARDS,
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Pre-save hook to handle null board values (enum doesn't accept null)
classSchema.pre('save', function(next) {
  // Convert null/undefined/empty string to undefined so enum validation is skipped
  if (this.board === null || this.board === '' || this.board === undefined) {
    this.board = undefined;
  }
  next();
});

// Compound index to ensure unique class number + section per admin
classSchema.index({ classNumber: 1, section: 1, assignedAdmin: 1 }, { unique: true });
classSchema.index({ assignedAdmin: 1 });
classSchema.index({ assignedSubjects: 1 });

const Class = mongoose.model('Class', classSchema);

export default Class;

