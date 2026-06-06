import mongoose from 'mongoose';

const pdfGenerationSchema = new mongoose.Schema(
  {
    pdfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiContentEngineSource',
      required: true,
      index: true,
    },
    pdfCode: { type: String, required: true, trim: true, index: true },
    toolType: { type: String, required: true, trim: true, index: true },
    generationNumber: { type: Number, required: true, index: true },
    generationTitle: { type: String, default: '', trim: true },
    markerType: { type: String, default: 'generation', trim: true },
    markerLabel: { type: String, default: 'Generation', trim: true },
    board: { type: String, default: '', trim: true, index: true },
    classLabel: { type: String, required: true, trim: true, index: true },
    subject: { type: String, required: true, trim: true, index: true },
    topic: { type: String, default: '', trim: true },
    subTopic: { type: String, default: '', trim: true },
    contentType: { type: String, default: 'Generated Content', trim: true },
    structuredContent: { type: mongoose.Schema.Types.Mixed, default: {} },
    renderContent: { type: mongoose.Schema.Types.Mixed, default: {} },
    content: { type: String, default: '' },
    generatedContent: { type: String, default: '' },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    uploadedBy: { type: String, required: true, trim: true },
    uploadedByRole: { type: String, enum: ['teacher', 'admin', 'super-admin'], required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

pdfGenerationSchema.index({ pdfId: 1, generationNumber: 1 }, { unique: true });
pdfGenerationSchema.index({ classLabel: 1, subject: 1, topic: 1, subTopic: 1, toolType: 1 });
pdfGenerationSchema.index({ createdAt: -1 });

const PdfGeneration =
  mongoose.models.PdfGeneration || mongoose.model('PdfGeneration', pdfGenerationSchema);

export default PdfGeneration;
