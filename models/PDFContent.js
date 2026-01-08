// PDF Content Model - Stores metadata about uploaded and extracted PDFs
import mongoose from 'mongoose';

const PDFContentSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true
  },
  originalFileName: {
    type: String,
    required: true
  },
  pdfPath: {
    type: String,
    required: true
  },
  classNumber: {
    type: String,
    required: true,
    index: true
  },
  subject: {
    type: String,
    required: true,
    index: true
  },
  topic: {
    type: String,
    required: true,
    index: true
  },
  csvPath: {
    type: String,
    required: false
  },
  metadataPath: {
    type: String
  },
  questionsCount: {
    type: Number,
    default: 0
  },
  extractionStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  extractionError: {
    type: String
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  extractedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Compound index for fast lookups
PDFContentSchema.index({ classNumber: 1, subject: 1, topic: 1 });
PDFContentSchema.index({ teacherId: 1, classNumber: 1, subject: 1 });

const PDFContent = mongoose.models.PDFContent || mongoose.model('PDFContent', PDFContentSchema);

export default PDFContent;

