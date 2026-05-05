import mongoose from 'mongoose';

const vidyaProactivePromptSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null, index: true },
    examResultId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamResult', default: null, index: true },
    promptText: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    delivered: { type: Boolean, default: false, index: true },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

vidyaProactivePromptSchema.index({ studentId: 1, createdAt: -1 });
vidyaProactivePromptSchema.index({ studentId: 1, examResultId: 1 }, { unique: true, sparse: true });

const VidyaProactivePrompt =
  mongoose.models.VidyaProactivePrompt ||
  mongoose.model('VidyaProactivePrompt', vidyaProactivePromptSchema);

export default VidyaProactivePrompt;
