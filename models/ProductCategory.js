import mongoose from 'mongoose';

const productCategorySchema = new mongoose.Schema(
  {
    /** Stable code stored on Subject/Content/Book/School (e.g. ALPHA, DELTA, MY_TRACK). */
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
    },
    /** Display name in Super Admin UI. */
    label: {
      type: String,
      required: true,
      trim: true,
    },
    /** Parent product line (currently IIT). */
    product: {
      type: String,
      default: 'IIT',
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** Seeded Alpha/Beta/Gamma — cannot delete, can rename label. */
    isBuiltIn: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 100,
    },
  },
  { timestamps: true }
);

productCategorySchema.index({ product: 1, isActive: 1, sortOrder: 1 });

export default mongoose.model('ProductCategory', productCategorySchema);
