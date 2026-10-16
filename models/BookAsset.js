import mongoose from 'mongoose';

const bookAssetSchema = new mongoose.Schema(
  {
    assetId: { type: String, required: true, unique: true, index: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
    page: { type: Number, default: null },
    type: {
      type: String,
      enum: ['equation', 'chemical_equation', 'figure', 'graph', 'table', 'chemical_structure'],
      required: true,
      index: true,
    },
    caption: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    semanticText: { type: String, default: '', trim: true },
    canonicalData: { type: mongoose.Schema.Types.Mixed, default: {} },
    labels: { type: [String], default: [] },
    sourceBBox: { type: [Number], default: [] },
    assetPath: { type: String, default: '' },
    /** Public URL of the cropped textbook figure (PNG), when one was cut out. */
    imageUrl: { type: String, default: '' },
    board: { type: String, default: '', trim: true },
    class: { type: String, default: '', trim: true },
    subject: { type: String, default: '', trim: true },
    chapter: { type: String, default: '', trim: true },
    subtopic: { type: String, default: '', trim: true },
    approvalStatus: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected', 'archived'],
      default: 'pending_review',
      index: true,
    },
    /** Same curriculum IDs as the text chunk/section on this asset's page. */
    aiTopicKey: { type: String, default: '', trim: true },
    aiTopicName: { type: String, default: '', trim: true },
    aiSubtopicId: { type: String, default: '', trim: true },
    aiSubtopicName: { type: String, default: '', trim: true },
    sectionKey: { type: String, default: '', trim: true },
    mappingStatus: { type: String, default: '', trim: true },
    mappingConfidence: { type: Number, default: 0 },
    mappingMethod: { type: String, default: '', trim: true },
    extractionModel: { type: String, default: '' },
    extractionVersion: { type: Number, default: 1 },
  },
  { timestamps: true },
);

bookAssetSchema.index({ bookId: 1, page: 1, type: 1 });
bookAssetSchema.index({ bookId: 1, approvalStatus: 1, chapter: 1, subtopic: 1 });
bookAssetSchema.index({ bookId: 1, approvalStatus: 1, aiSubtopicId: 1 });

export default mongoose.models.BookAsset || mongoose.model('BookAsset', bookAssetSchema);

