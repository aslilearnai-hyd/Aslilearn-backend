import mongoose from 'mongoose';
import { VALID_SCHOOL_BOARDS } from '../constants/boards.js';

const teacherSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    default: ''
  },
  department: {
    type: String,
    default: ''
  },
  school: {
    type: String,
    default: ''
  },
  board: {
    type: String,
    enum: VALID_SCHOOL_BOARDS,
    uppercase: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  qualifications: {
    type: String,
    default: ''
  },
  subjects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject'
  }],
  assignedClassIds: [String],
  role: {
    type: String,
    default: 'teacher'
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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
}, {
  timestamps: true
});

// Pre-save hook to handle null board values (enum doesn't accept null)
teacherSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  // Convert null/undefined/empty string to undefined so enum validation is skipped
  if (this.board === null || this.board === '' || this.board === undefined) {
    this.board = undefined;
  }
  next();
});

// Create indexes for better performance
teacherSchema.index({ email: 1 });
teacherSchema.index({ adminId: 1 });
teacherSchema.index({ isActive: 1 });
teacherSchema.index({ adminId: 1, isActive: 1 }); // Compound for admin's active teachers

const Teacher = mongoose.model('Teacher', teacherSchema);

export default Teacher;