import mongoose from 'mongoose';

const aiToolGenerationSchema = new mongoose.Schema(
  {
    toolName: { type: String, required: true, index: true },
    toolDisplayName: { type: String, default: '' },
    classLabel: { type: String, required: true, index: true },
    subject: { type: String, required: true, index: true },
    topic: { type: String, default: '' },
    subtopic: { type: String, default: '' },
    section: { type: String, default: '', index: true },
    content: { type: String, required: true },
    generatedContent: { type: String, default: '' },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

aiToolGenerationSchema.index({
  toolName: 1,
  classLabel: 1,
  subject: 1,
  topic: 1,
  subtopic: 1,
});
aiToolGenerationSchema.index({
  classLabel: 1,
  subject: 1,
  topic: 1,
  subtopic: 1,
  createdAt: -1,
});

const AiToolGeneration =
  mongoose.models.AiToolGeneration ||
  mongoose.model('AiToolGeneration', aiToolGenerationSchema);

export default AiToolGeneration;
