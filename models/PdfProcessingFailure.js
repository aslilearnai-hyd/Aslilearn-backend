import mongoose from 'mongoose';

const pdfProcessingFailureSchema = new mongoose.Schema(
  {
    sourcePdfId: { type: mongoose.Schema.Types.ObjectId, ref: 'PdfKnowledgeSource', required: true },
    jobId: { type: String, default: '' },
    attemptsMade: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
    stack: { type: String, default: '' },
    failedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

pdfProcessingFailureSchema.index({ sourcePdfId: 1, failedAt: -1 });

export default mongoose.model('PdfProcessingFailure', pdfProcessingFailureSchema);

