import mongoose from 'mongoose';
import { VALID_SCHOOL_BOARDS } from '../constants/boards.js';

const subjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    trim: true
  },
  board: {
    type: String,
    required: true,
    enum: VALID_SCHOOL_BOARDS,
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  /** Indian state name when board is STATE; empty for CBSE / ASLI. */
  stateName: {
    type: String,
    trim: true,
    default: ''
  },
  classNumber: {
    type: String,
    trim: true
  },
  /** School admin: classes this subject is taught in (many-to-many). */
  classIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class'
  }],
  /** Primary teacher for this subject (school admin). */
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    default: null
  },
  description: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: String,
    enum: ['super-admin'],
    default: 'super-admin'
  }
}, {
  timestamps: true
});

// Unique subject per board + state (STATE syllabus differentiates by stateName)
subjectSchema.index({ name: 1, board: 1, stateName: 1 }, { unique: true });
subjectSchema.index({ board: 1 });
subjectSchema.index({ classNumber: 1 });
subjectSchema.index({ board: 1, classNumber: 1 });
subjectSchema.index({ classIds: 1 });
subjectSchema.index({ teacherId: 1 });
subjectSchema.index({ isActive: 1 });
// Sparse unique index on code - only unique for non-null values
subjectSchema.index({ code: 1 }, { unique: true, sparse: true });

export default mongoose.model('Subject', subjectSchema);
