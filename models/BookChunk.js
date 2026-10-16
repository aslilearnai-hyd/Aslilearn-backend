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
    /*
     * AI Tools curriculum mapping (authoritative). aiSubtopicId is the
     * AiToolTopic row _id; aiTopicKey groups rows of one topic. The legacy
     * chapter/topic/subtopic strings above stay as book-native provenance.
     */
    aiTopicKey: { type: String, default: '', trim: true },
    aiTopicName: { type: String, default: '', trim: true },
    aiSubtopicId: { type: String, default: '', trim: true },
    aiSubtopicName: { type: String, default: '', trim: true },
    bookChapterNumber: { type: String, default: '', trim: true },
    bookChapterTitle: { type: String, default: '', trim: true },
    bookSubtopicNumber: { type: String, default: '', trim: true },
    bookSubtopicTitle: { type: String, default: '', trim: true },
    sectionKey: { type: String, default: '', trim: true },
    /** All book sections merged into this chunk's group (all share one mapping). */
    sectionKeys: { type: [String], default: [] },
    sourcePageStart: { type: Number, default: null },
    sourcePageEnd: { type: Number, default: null },
    mappingStatus: { type: String, default: '', trim: true },
    mappingConfidence: { type: Number, default: 0 },
    mappingMethod: { type: String, default: '', trim: true },
    mappingVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

bookChunkSchema.index({ bookId: 1, chunkIndex: 1 }, { unique: true });
bookChunkSchema.index({ bookId: 1, chapter: 1 });
bookChunkSchema.index({ subject: 1, class: 1, board: 1 });
bookChunkSchema.index({ corpusId: 1, approvalStatus: 1, sourcePriority: 1 });
bookChunkSchema.index({ aiSubtopicId: 1, mappingStatus: 1, bookId: 1 });
bookChunkSchema.index({ aiTopicKey: 1, mappingStatus: 1, bookId: 1 });
bookChunkSchema.index({ bookId: 1, sectionKey: 1 });

export default mongoose.model('BookChunk', bookChunkSchema);
