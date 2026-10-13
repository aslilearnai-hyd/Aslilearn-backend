import mongoose from 'mongoose';

/**
 * Full extracted source text split across documents to stay safely below
 * MongoDB's per-document size limit. Book.extractedText remains a preview.
 */
const bookSourcePartSchema = new mongoose.Schema(
  {
    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: true,
      index: true,
    },
    partIndex: { type: Number, required: true },
    content: { type: String, required: true },
    charCount: { type: Number, required: true },
  },
  { timestamps: true },
);

bookSourcePartSchema.index({ bookId: 1, partIndex: 1 }, { unique: true });

export default mongoose.models.BookSourcePart ||
  mongoose.model('BookSourcePart', bookSourcePartSchema);

