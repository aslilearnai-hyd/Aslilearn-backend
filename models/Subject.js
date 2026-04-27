import mongoose from 'mongoose';

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
    enum: ['ASLI_EXCLUSIVE_SCHOOLS', 'CBSE', 'STATE'],
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
subjectSchema.index({ isActive: 1 });
// Sparse unique index on code - only unique for non-null values
subjectSchema.index({ code: 1 }, { unique: true, sparse: true });

export default mongoose.model('Subject', subjectSchema);
