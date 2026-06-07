import mongoose from 'mongoose';

const teacherToolUsageSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    toolType: { type: String, required: true, index: true },
    classLabel: { type: String, default: '' },
    subject: { type: String, default: '' },
    topic: { type: String, default: '' },
    subtopic: { type: String, default: '' },
  },
  { timestamps: true },
);

teacherToolUsageSchema.index({ teacherId: 1, createdAt: -1 });
teacherToolUsageSchema.index({ teacherId: 1, toolType: 1, createdAt: -1 });

const TeacherToolUsage =
  mongoose.models.TeacherToolUsage ||
  mongoose.model('TeacherToolUsage', teacherToolUsageSchema);

export default TeacherToolUsage;
