import mongoose from 'mongoose';

/**
 * One timetable photo per class + section (e.g. "6A").
 * Replaces the structured period-grid timetable for schools that upload a scan/photo.
 */
const classTimetableImageSchema = new mongoose.Schema(
  {
    schoolAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
      index: true,
    },
    /** Denormalized for labels like "6A" without populate */
    classNumber: { type: String, trim: true, default: '' },
    sectionId: { type: String, trim: true, uppercase: true, default: '' },
    imageUrl: { type: String, required: true, trim: true },
    originalFileName: { type: String, trim: true, default: '' },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    uploadedByRole: {
      type: String,
      enum: ['admin', 'teacher', 'super-admin'],
      required: true,
    },
  },
  { timestamps: true }
);

classTimetableImageSchema.index(
  { schoolAdminId: 1, classId: 1 },
  { unique: true }
);

classTimetableImageSchema.virtual('label').get(function label() {
  const num = String(this.classNumber || '').trim();
  const sec = String(this.sectionId || '').trim().toUpperCase();
  if (num && sec) return `${num}${sec}`;
  if (num) return num;
  return 'Class timetable';
});

classTimetableImageSchema.set('toJSON', { virtuals: true });
classTimetableImageSchema.set('toObject', { virtuals: true });

export default mongoose.model('ClassTimetableImage', classTimetableImageSchema);
