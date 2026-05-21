import mongoose from 'mongoose';
import { CURRICULUM_BOARDS } from '../constants/boards.js';

const schoolDetailsSchema = {
  doorNo: { type: String, trim: true, default: '' },
  street: { type: String, trim: true, default: '' },
  area: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  district: { type: String, trim: true, default: '' },
  state: { type: String, trim: true, default: '' },
  medium: { type: String, trim: true, default: '' },
  classesFrom: { type: String, trim: true, default: '' },
  classesTo: { type: String, trim: true, default: '' },
  totalStrength: { type: String, trim: true, default: '' },
  schoolType: { type: String, trim: true, default: '' },
  photos: { type: [String], default: [] },
};

const schoolSchema = new mongoose.Schema(
  {
    /** Display name of the school */
    name: {
      type: String,
      required: true,
      trim: true,
    },
    schoolLogo: { type: String, trim: true, default: '' },
    contactPerson: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    secondaryContactPerson: { type: String, trim: true, default: '' },
    secondaryContactPhone: { type: String, trim: true, default: '' },
    place: { type: String, trim: true, default: '' },
    pin: { type: String, trim: true, default: '' },
    schoolDetails: {
      type: schoolDetailsSchema,
      default: () => ({}),
    },
    /** Stored board code (ASLI_EXCLUSIVE_SCHOOLS or curriculum) */
    board: {
      type: String,
      uppercase: true,
      default: 'ASLI_EXCLUSIVE_SCHOOLS',
    },
    curriculumBoard: {
      type: String,
      enum: CURRICULUM_BOARDS,
      uppercase: true,
      default: 'CBSE',
    },
    isAsliPrepExclusive: {
      type: Boolean,
      default: false,
    },
    /** Login user (admin) for this school */
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

schoolSchema.index({ name: 1 });
schoolSchema.index({ adminUserId: 1 }, { unique: true, sparse: true });
schoolSchema.index({ isActive: 1 });
schoolSchema.index({ curriculumBoard: 1 });
schoolSchema.index({ 'schoolDetails.state': 1 });

export default mongoose.model('School', schoolSchema);
