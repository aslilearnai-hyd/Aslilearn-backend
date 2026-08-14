import mongoose from 'mongoose';

/**
 * Lets one product category reuse another category's AI Tool topics + content.
 * Example: IIT/NEET · Class 6 · Biology · BETA reads ALPHA's topics and generations.
 */
const aiToolCategoryShareSchema = new mongoose.Schema(
  {
    board: { type: String, required: true, trim: true, index: true },
    classLabel: { type: String, required: true, trim: true, index: true },
    /** Empty = every subject in that class. */
    subject: { type: String, default: '', trim: true, index: true },
    /** Category that borrows content (e.g. BETA). */
    targetCategory: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    /** Category that owns the content (e.g. ALPHA). Empty = General. */
    sourceCategory: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: 'ai_tool_category_shares',
  },
);

aiToolCategoryShareSchema.index(
  { board: 1, classLabel: 1, subject: 1, targetCategory: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

const AiToolCategoryShare =
  mongoose.models.AiToolCategoryShare ||
  mongoose.model('AiToolCategoryShare', aiToolCategoryShareSchema);

export default AiToolCategoryShare;
