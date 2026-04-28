import mongoose from 'mongoose';

const aiContentEngineChunkSchema = new mongoose.Schema(
  {
    sourcePdfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiContentEngineSource',
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
    topic: { type: String, default: '', trim: true },
    subTopic: { type: String, default: '', trim: true },
    toolType: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

aiContentEngineChunkSchema.index({ subject: 1, classLabel: 1, chapter: 1 });
aiContentEngineChunkSchema.index({ classLabel: 1, subject: 1, topic: 1, subTopic: 1, toolType: 1 });
aiContentEngineChunkSchema.index({ sourcePdfId: 1, chunkIndex: 1 }, { unique: true });

export default mongoose.model('AiContentEngineChunk', aiContentEngineChunkSchema);

