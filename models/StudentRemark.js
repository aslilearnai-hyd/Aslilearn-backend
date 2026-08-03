import mongoose from 'mongoose';

const studentRemarkSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true
  },
  remark: {
    type: String,
    required: [true, 'Remark is required'],
    trim: true,
    validate: {
      validator: (v) => String(v ?? '').trim().length > 0,
      message: 'Remark cannot be empty',
    },
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    default: null // null means general remark, not subject-specific
  },
  isPositive: {
    type: Boolean,
    default: true // Helps categorize remarks
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
studentRemarkSchema.index({ studentId: 1, createdAt: -1 });
studentRemarkSchema.index({ teacherId: 1, createdAt: -1 });
studentRemarkSchema.index({ studentId: 1, teacherId: 1 });

const StudentRemark = mongoose.model('StudentRemark', studentRemarkSchema);

export default StudentRemark;

