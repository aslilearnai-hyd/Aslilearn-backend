import mongoose from 'mongoose';

const aiContentEngineSourceSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    storageProvider: { type: String, default: 'local' },
    storageKey: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: 'application/pdf' },
    board: { type: String, default: '', trim: true, index: true },
    subject: { type: String, required: true, trim: true },
    classLabel: { type: String, required: true, trim: true },
    chapter: { type: String, required: true, trim: true },
    topic: { type: String, default: '', trim: true },
    subTopic: { type: String, default: '', trim: true },
    toolType: { type: String, default: '', trim: true },
    contentType: { type: String, default: '', trim: true },
    structuredContent: { type: mongoose.Schema.Types.Mixed, default: {} },
    renderContent: { type: mongoose.Schema.Types.Mixed, default: {} },
    geminiDetected: {
      classLabel: { type: String, default: '', trim: true },
      subject: { type: String, default: '', trim: true },
      topic: { type: String, default: '', trim: true },
      subTopic: { type: String, default: '', trim: true },
      bestMatchingToolLabel: { type: String, default: '', trim: true },
      contentType: { type: String, default: '', trim: true },
    },
    analysisStatus: {
      type: String,
      enum: ['pending', 'analyzed', 'failed'],
      default: 'pending',
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    reviewComment: { type: String, default: '', trim: true },
    validation: {
      toolMatched: { type: Boolean, default: false },
      mismatchReason: { type: String, default: '', trim: true },
      subjectTopicMatched: { type: Boolean, default: false },
      subjectTopicReason: { type: String, default: '', trim: true },
      subjectTopicConfidence: { type: Number, default: 0 },
    },
    uploadedBy: { type: String, required: true, trim: true },
    uploadedByRole: { type: String, enum: ['teacher', 'admin', 'super-admin'], required: true },
    uploadDate: { type: Date, default: Date.now },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'processed', 'failed'],
      default: 'pending',
    },
    extractedTextLength: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    lastProcessedAt: { type: Date, default: null },
    processingError: { type: String, default: '' },
    archived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedReason: { type: String, default: '' },
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiContentEngineSource', default: null },
  },
  { timestamps: true }
);

aiContentEngineSourceSchema.index({ classLabel: 1, subject: 1, chapter: 1 });
aiContentEngineSourceSchema.index({ classLabel: 1, subject: 1, topic: 1, subTopic: 1, toolType: 1 });
aiContentEngineSourceSchema.index({ uploadedBy: 1, uploadDate: -1 });
aiContentEngineSourceSchema.index({ processingStatus: 1, updatedAt: -1 });

export default mongoose.model('AiContentEngineSource', aiContentEngineSourceSchema);

