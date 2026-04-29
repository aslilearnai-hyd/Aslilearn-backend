import mongoose from 'mongoose';

const aiToolGenerationSchema = new mongoose.Schema(
  {
    toolName: { type: String, required: true, index: true },
    toolDisplayName: { type: String, default: '' },
    /** Single source of truth: how this row was created */
    sourceType: {
      type: String,
      enum: ['ai_generator', 'ai_pdf', 'legacy'],
      default: 'legacy',
      index: true,
    },
    classLabel: { type: String, required: true, index: true },
    subject: { type: String, required: true, index: true },
    topic: { type: String, default: '' },
    subtopic: { type: String, default: '' },
    section: { type: String, default: '', index: true },
    content: { type: String, default: '' },
    generatedContent: { type: String, default: '' },
    pdfFileUrl: { type: String, default: '' },
    pdfFileName: { type: String, default: '' },
    /** User id (ObjectId) or legacy string id (e.g. super-admin) */
    generatedBy: { type: mongoose.Schema.Types.Mixed, default: null, index: true },
    status: { type: String, default: 'active', index: true },
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
aiToolGenerationSchema.index({ sourceType: 1, toolName: 1, createdAt: -1 });
aiToolGenerationSchema.index({ 'metadata.contentEngineSourceId': 1 });

const AiToolGeneration =
  mongoose.models.AiToolGeneration ||
  mongoose.model('AiToolGeneration', aiToolGenerationSchema);

export default AiToolGeneration;
