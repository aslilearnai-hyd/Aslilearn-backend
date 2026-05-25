import mongoose from 'mongoose';

const studentVideoChapterProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    /** Map chapter number (string) -> Date.toDateString() when all modules were completed */
    chapterCompletedAt: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

studentVideoChapterProgressSchema.index({ userId: 1, subjectId: 1 }, { unique: true });

export default mongoose.model('StudentVideoChapterProgress', studentVideoChapterProgressSchema);
