import mongoose from 'mongoose';

const pdfChunkSchema = new mongoose.Schema(
  {
    sourcePdfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PdfKnowledgeSource',
      required: true,
      index: true,
    },
    chunkIndex: { type: Number, required: true },
    chunkText: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    embeddingModel: { type: String, default: 'local-hash-256' },
    tokenCount: { type: Number, default: 0 },
    subject: { type: String, required: true, trim: true },
    classLabel: { type: String, required: true, trim: true },
    chapter: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

pdfChunkSchema.index({ subject: 1, classLabel: 1, chapter: 1 });
pdfChunkSchema.index({ sourcePdfId: 1, chunkIndex: 1 }, { unique: true });

export default mongoose.model('PdfChunk', pdfChunkSchema);

