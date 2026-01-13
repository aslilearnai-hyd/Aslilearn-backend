import mongoose from 'mongoose';

const riskAnalysisReportSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Not required for super-admin
  },
  analysisData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  pdfPath: {
    type: String,
    required: true
  },
  pdfFilename: {
    type: String,
    required: true
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better performance
riskAnalysisReportSchema.index({ studentId: 1, sentAt: -1 });
riskAnalysisReportSchema.index({ studentId: 1, isRead: 1 });

export default mongoose.model('RiskAnalysisReport', riskAnalysisReportSchema);



