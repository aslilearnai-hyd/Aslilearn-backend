import mongoose from 'mongoose';

const pdfKnowledgeSourceSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    storageProvider: { type: String, default: 'local' }, // local|s3|spaces
    storageKey: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: 'application/pdf' },
    subject: { type: String, required: true, trim: true },
    classLabel: { type: String, required: true, trim: true },
    chapter: { type: String, required: true, trim: true },
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

pdfKnowledgeSourceSchema.index({ classLabel: 1, subject: 1, chapter: 1 });
pdfKnowledgeSourceSchema.index({ uploadedBy: 1, uploadDate: -1 });
pdfKnowledgeSourceSchema.index({ processingStatus: 1, updatedAt: -1 });

export default mongoose.model('PdfKnowledgeSource', pdfKnowledgeSourceSchema);

