import mongoose from 'mongoose';

const contentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['TextBook', 'Workbook', 'Material', 'Video', 'Audio', 'Homework'],
    required: true
  },
  board: {
    type: String,
    required: true,
    enum: ['CBSE_AP', 'CBSE_TS', 'STATE_AP', 'STATE_TS'],
    uppercase: true
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },
  classNumber: {
    type: String,
    trim: true
  },
  topic: {
    type: String,
    trim: true
  },
  date: {
    type: Date,
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  thumbnailUrl: {
    type: String
  },
  duration: {
    type: Number, // in minutes (for videos)
    default: 0
  },
  size: {
    type: Number, // file size in bytes
    default: 0
  },
  isExclusive: {
    type: Boolean,
    default: true // All Asli Prep content is exclusive
  },
  createdBy: {
    type: String,
    enum: ['super-admin', 'teacher'],
    default: 'super-admin'
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: function() {
      return this.createdBy === 'teacher';
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  views: {
    type: Number,
    default: 0
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  deadline: {
    type: Date, // Deadline for homework submissions
    required: false
  }
}, {
  timestamps: true
});

// Indexes for better performance
contentSchema.index({ board: 1 });
contentSchema.index({ subject: 1 });
contentSchema.index({ classNumber: 1 });
contentSchema.index({ type: 1 });
contentSchema.index({ board: 1, subject: 1 });
contentSchema.index({ board: 1, classNumber: 1 });
contentSchema.index({ isActive: 1 });
contentSchema.index({ isExclusive: 1 });
contentSchema.index({ teacherId: 1 });
contentSchema.index({ createdBy: 1 });

export default mongoose.model('Content', contentSchema);



