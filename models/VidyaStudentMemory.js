import mongoose from 'mongoose';

const vidyaStudentMemorySchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, unique: true },
    lastFocusAction: { type: String, default: '' },
    weakTopics: { type: [String], default: [] },
    strongTopics: { type: [String], default: [] },
    recentRecommendations: { type: [String], default: [] },
    streakDays: { type: Number, default: 0 },
    lastExamSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    memoryVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

vidyaStudentMemorySchema.index({ updatedAt: -1 });

const VidyaStudentMemory =
  mongoose.models.VidyaStudentMemory ||
  mongoose.model('VidyaStudentMemory', vidyaStudentMemorySchema);

export default VidyaStudentMemory;
