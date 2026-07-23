import mongoose from 'mongoose';
import { PRODUCT_CATEGORY_NONE } from '../constants/products.js';

const subjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    trim: true
  },
  board: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    default: 'ASLI_EXCLUSIVE_SCHOOLS'
  },
  /** Indian state name when board is STATE; empty for CBSE / ASLI. */
  stateName: {
    type: String,
    trim: true,
    default: ''
  },
  /** Product track code (ALPHA/BETA/GAMMA or custom); empty = general. */
  productCategory: {
    type: String,
    uppercase: true,
    default: PRODUCT_CATEGORY_NONE,
    trim: true,
  },
  classNumber: {
    type: String,
    trim: true
  },
  /** School admin: classes this subject is taught in (many-to-many). */
  classIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class'
  }],
  /** Primary teacher for this subject (school admin). */
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    default: null
  },
  description: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: String,
    enum: ['super-admin'],
    default: 'super-admin'
  }
}, {
  timestamps: true
});

// Unique subject per board + state + IIT product category
subjectSchema.index({ name: 1, board: 1, stateName: 1, productCategory: 1 }, { unique: true });
subjectSchema.index({ board: 1 });
subjectSchema.index({ productCategory: 1 });
subjectSchema.index({ classNumber: 1 });
subjectSchema.index({ board: 1, classNumber: 1 });
subjectSchema.index({ classIds: 1 });
subjectSchema.index({ teacherId: 1 });
subjectSchema.index({ isActive: 1 });
// Sparse unique index on code - only unique for non-null values
subjectSchema.index({ code: 1 }, { unique: true, sparse: true });

const Subject = mongoose.models.Subject || mongoose.model('Subject', subjectSchema);

/**
 * Drop legacy unique indexes that omit productCategory so the same subject
 * name can exist once per IIT track (Alpha / Beta / Gamma).
 */
export async function ensureSubjectIndexes() {
  try {
    const coll = mongoose.connection.collection('subjects');
    const indexes = await coll.indexes();
    for (const idx of indexes) {
      if (!idx?.unique || !idx.key) continue;
      const keys = Object.keys(idx.key);
      const hasNameBoard = idx.key.name === 1 && idx.key.board === 1;
      const hasProductCategory = idx.key.productCategory !== undefined;
      // Old: name+board or name+board+stateName (no productCategory)
      if (
        hasNameBoard &&
        !hasProductCategory &&
        keys.every((k) => ['name', 'board', 'stateName'].includes(k))
      ) {
        await coll.dropIndex(idx.name);
        console.log(`Dropped legacy subjects unique index: ${idx.name}`);
      }
    }
    await Subject.syncIndexes();
  } catch (err) {
    console.warn('ensureSubjectIndexes:', err?.message || err);
  }
}

export default Subject;
