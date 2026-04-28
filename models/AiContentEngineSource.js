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
    subject: { type: String, required: true, trim: true },
    classLabel: { type: String, required: true, trim: true },
    chapter: { type: String, required: true, trim: true },
    topic: { type: String, default: '', trim: true },
    subTopic: { type: String, default: '', trim: true },
    toolType: { type: String, default: '', trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
  },
  { timestamps: true }
);

aiContentEngineSourceSchema.index({ classLabel: 1, subject: 1, chapter: 1 });
aiContentEngineSourceSchema.index({ classLabel: 1, subject: 1, topic: 1, subTopic: 1, toolType: 1 });
aiContentEngineSourceSchema.index({ uploadedBy: 1, uploadDate: -1 });
aiContentEngineSourceSchema.index({ processingStatus: 1, updatedAt: -1 });

export default mongoose.model('AiContentEngineSource', aiContentEngineSourceSchema);

