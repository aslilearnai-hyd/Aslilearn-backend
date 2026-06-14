import mongoose from 'mongoose';

const bookChapterSchema = new mongoose.Schema(
  {
    title: { type: String, default: '', trim: true },
    topic: { type: String, default: '', trim: true },
    subtopic: { type: String, default: '', trim: true },
    startOffset: { type: Number, default: 0 },
    endOffset: { type: Number, default: 0 },
    wordCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    board: { type: String, default: 'CBSE', trim: true },
    class: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    topic: { type: String, default: '', trim: true },
    subtopic: { type: String, default: '', trim: true },
    source: {
      type: String,
      enum: ['textbook', 'coaching', 'notes', 'question_bank', 'proprietary', 'other'],
      default: 'textbook',
    },
    fileUrl: { type: String, default: '' },
    storageProvider: { type: String, default: 'local' },
    storageKey: { type: String, default: '' },
    originalFileName: { type: String, default: '' },
    mimeType: { type: String, default: 'application/pdf' },
    fileSize: { type: Number, default: 0 },
    extractedText: { type: String, default: '' },
    extractedTextLength: { type: Number, default: 0 },
    chapters: { type: [bookChapterSchema], default: [] },
    embeddingsCreated: { type: Boolean, default: false },
    chunkCount: { type: Number, default: 0 },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'indexed', 'failed', 'needs_ocr'],
      default: 'pending',
    },
    processingError: { type: String, default: '' },
    requiresOcr: { type: Boolean, default: false },
    lastIndexedAt: { type: Date, default: null },
    /** JWTs may use symbolic ids (e.g. super-admin-001) — store as string. */
    uploadedBy: { type: String, default: '', trim: true },
    uploadedByRole: { type: String, default: 'super-admin' },
    generationStats: {
      totalGenerations: { type: Number, default: 0 },
      lastGeneratedAt: { type: Date, default: null },
      toolBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  { timestamps: true },
);

bookSchema.index({ board: 1, class: 1, subject: 1 });
bookSchema.index({ processingStatus: 1, updatedAt: -1 });
bookSchema.index({ title: 'text', subject: 'text' });

export default mongoose.model('Book', bookSchema);
