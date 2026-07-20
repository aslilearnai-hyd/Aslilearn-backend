import mongoose from 'mongoose';

/**
 * Stored weekly digests for teachers / students (in-app + optional email).
 */
const weeklyDigestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['teacher', 'student'], required: true, index: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    weekStart: { type: Date, required: true, index: true },
    weekEnd: { type: Date, required: true },
    title: { type: String, default: 'Your weekly AsliLearn report' },
    summary: { type: String, default: '' },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    highlights: { type: [String], default: [] },
    emailStatus: {
      type: String,
      enum: ['pending', 'sent', 'skipped', 'failed'],
      default: 'pending',
    },
    emailError: { type: String, default: '' },
    emailedAt: { type: Date },
    readAt: { type: Date },
  },
  { timestamps: true },
);

weeklyDigestSchema.index({ userId: 1, weekStart: -1 }, { unique: true });
weeklyDigestSchema.index({ role: 1, weekStart: -1 });

export default mongoose.models.WeeklyDigest || mongoose.model('WeeklyDigest', weeklyDigestSchema);
