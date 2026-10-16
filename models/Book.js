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

const curriculumSectionSchema = new mongoose.Schema(
  {
    sectionKey: { type: String, default: '' },
    parentSectionKey: { type: String, default: '' },
    level: { type: Number, default: 0 },
    /** '' for numbered sections; 'exercise' / 'synopsis' for chapter-level blocks. */
    kind: { type: String, default: '' },
    number: { type: String, default: '' },
    title: { type: String, default: '' },
    chapterNumber: { type: String, default: '' },
    chapterTitle: { type: String, default: '' },
    pageStart: { type: Number, default: null },
    pageEnd: { type: Number, default: null },
    wordCount: { type: Number, default: 0 },
    preview: { type: String, default: '' },
    aiTopicKey: { type: String, default: '' },
    aiTopicName: { type: String, default: '' },
    aiSubtopicId: { type: String, default: '' },
    aiSubtopicName: { type: String, default: '' },
    mappingStatus: { type: String, default: '' },
    mappingConfidence: { type: Number, default: 0 },
    mappingMethod: { type: String, default: '' },
    mappingEvidence: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const curriculumOverrideSchema = new mongoose.Schema(
  {
    sectionKey: { type: String, required: true },
    aiTopicKey: { type: String, default: '' },
    aiSubtopicId: { type: String, default: '' },
    reject: { type: Boolean, default: false },
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
  },
  { _id: false },
);

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    board: { type: String, default: 'CBSE', trim: true },
    class: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    /** IIT track (ALPHA/BETA/GAMMA); empty = general curriculum book. */
    productCategory: { type: String, default: '', trim: true, uppercase: true },
    topic: { type: String, default: '', trim: true },
    subtopic: { type: String, default: '', trim: true },
    source: {
      type: String,
      enum: ['textbook', 'coaching', 'notes', 'question_bank', 'proprietary', 'other'],
      default: 'textbook',
    },
    /** Multiple approved sources can coexist inside the same curriculum corpus. */
    corpusId: { type: String, default: '', trim: true, index: true },
    sourcePriority: { type: Number, default: 100, min: 1 },
    difficultyBand: {
      type: String,
      enum: ['', 'foundation', 'board', 'jee_main', 'jee_advanced', 'neet'],
      default: '',
    },
    edition: { type: String, default: '', trim: true },
    approvalStatus: {
      type: String,
      enum: ['approved', 'pending_review', 'rejected', 'archived'],
      default: 'approved',
      index: true,
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
    duplicateChunkCount: { type: Number, default: 0 },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'indexed', 'failed', 'needs_ocr'],
      default: 'pending',
    },
    processingError: { type: String, default: '' },
    requiresOcr: { type: Boolean, default: false },
    lastIndexedAt: { type: Date, default: null },
    /** Linked learning-path Content row when imported. Omit when not linked (do not store null). */
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Content',
      required: false,
    },
    /** JWTs may use symbolic ids (e.g. super-admin-001) — store as string. */
    uploadedBy: { type: String, default: '', trim: true },
    uploadedByRole: { type: String, default: 'super-admin' },
    /** Book section → AI Tools curriculum mapping (rebuilt on every index). */
    curriculumSections: { type: [curriculumSectionSchema], default: [] },
    /** Admin decisions keyed by sectionKey; re-applied on every reindex. */
    curriculumOverrides: { type: [curriculumOverrideSchema], default: [] },
    curriculumMapping: {
      status: {
        type: String,
        enum: ['not_mapped', 'ready', 'needs_review', 'unmapped', 'no_curriculum'],
        default: 'not_mapped',
      },
      version: { type: Number, default: 0 },
      coverage: { type: Number, default: 0 },
      mappedTopics: { type: Number, default: 0 },
      totalTopics: { type: Number, default: 0 },
      mappedSubtopics: { type: Number, default: 0 },
      totalSubtopics: { type: Number, default: 0 },
      sectionCount: { type: Number, default: 0 },
      unmappedSections: { type: Number, default: 0 },
      needsReviewSections: { type: Number, default: 0 },
      unmappedHighValueSections: { type: Number, default: 0 },
      chunkCount: { type: Number, default: 0 },
      chunksWithoutSubtopic: { type: Number, default: 0 },
      confidenceBands: { type: mongoose.Schema.Types.Mixed, default: {} },
      boilerplateLinesRemoved: { type: Number, default: 0 },
      geminiCallsUsed: { type: Number, default: 0 },
      mappedAt: { type: Date, default: null },
    },
    generationStats: {
      totalGenerations: { type: Number, default: 0 },
      lastGeneratedAt: { type: Date, default: null },
      toolBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  { timestamps: true },
);

bookSchema.index({ board: 1, class: 1, subject: 1 });
bookSchema.index({ corpusId: 1, approvalStatus: 1, sourcePriority: 1 });
bookSchema.index({ productCategory: 1 });
bookSchema.index({ processingStatus: 1, updatedAt: -1 });
bookSchema.index({ title: 'text', subject: 'text' });
/** Unique only when a real Content link exists — multiple PDF uploads may omit contentId. */
bookSchema.index(
  { contentId: 1 },
  {
    unique: true,
    name: 'contentId_1_partial',
    partialFilterExpression: { contentId: { $exists: true, $type: 'objectId' } },
  }
);

export default mongoose.model('Book', bookSchema);
