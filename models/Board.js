import mongoose from 'mongoose';

export const BOARD_KINDS = ['curriculum', 'state', 'iit'];

const boardSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    /** Optional linked product line (e.g. IIT). Its categories become available on this board. */
    product: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    /** curriculum | state | iit — drives school dropdowns and content scope */
    kind: {
      type: String,
      enum: BOARD_KINDS,
      default: 'curriculum',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

boardSchema.index({ code: 1 });
boardSchema.index({ isActive: 1 });
boardSchema.index({ kind: 1 });
boardSchema.index({ product: 1 });

export default mongoose.model('Board', boardSchema);
