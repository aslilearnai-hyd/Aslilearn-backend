import mongoose from 'mongoose';

const bookChunkSchema = new mongoose.Schema(
  {
    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: true,
      index: true,
    },
    chunkIndex: { type: Number, required: true },
    chapter: { type: String, default: '', trim: true },
    topic: { type: String, default: '', trim: true },
    subtopic: { type: String, default: '', trim: true },
    sourcePage: { type: Number, default: null },
    contentHash: { type: String, default: '', index: true },
    assetIds: { type: [String], default: [] },
    content: { type: String, required: true },
    wordCount: { type: Number, default: 0 },
    tokenCount: { type: Number, default: 0 },
    embedding: { type: [Number], default: [] },
    embeddingModel: { type: String, default: 'gemini' },
    board: { type: String, default: '', trim: true },
    class: { type: String, default: '', trim: true },
    subject: { type: String, default: '', trim: true },
    corpusId: { type: String, default: '', trim: true, index: true },
    sourcePriority: { type: Number, default: 100 },
    sourceType: { type: String, default: '', trim: true },
    difficultyBand: { type: String, default: '', trim: true },
    approvalStatus: { type: String, default: 'approved', index: true },
  },
  { timestamps: true },
);

bookChunkSchema.index({ bookId: 1, chunkIndex: 1 }, { unique: true });
bookChunkSchema.index({ bookId: 1, chapter: 1 });
bookChunkSchema.index({ subject: 1, class: 1, board: 1 });
bookChunkSchema.index({ corpusId: 1, approvalStatus: 1, sourcePriority: 1 });

export default mongoose.model('BookChunk', bookChunkSchema);
