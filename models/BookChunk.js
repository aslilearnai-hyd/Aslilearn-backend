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
    content: { type: String, required: true },
    wordCount: { type: Number, default: 0 },
    tokenCount: { type: Number, default: 0 },
    embedding: { type: [Number], default: [] },
    embeddingModel: { type: String, default: 'local-hash-256' },
    board: { type: String, default: '', trim: true },
    class: { type: String, default: '', trim: true },
    subject: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

bookChunkSchema.index({ bookId: 1, chunkIndex: 1 }, { unique: true });
bookChunkSchema.index({ bookId: 1, chapter: 1 });
bookChunkSchema.index({ subject: 1, class: 1, board: 1 });

export default mongoose.model('BookChunk', bookChunkSchema);
