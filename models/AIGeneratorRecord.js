import mongoose from 'mongoose';

const aiGeneratorRecordSchema = new mongoose.Schema(
  {
    toolName: { type: String, required: true, trim: true, index: true },
    toolSlug: { type: String, required: true, trim: true, index: true },
    className: { type: String, required: true, trim: true, index: true },
    subjectName: { type: String, required: true, trim: true, index: true },
    topicName: { type: String, default: '', trim: true, index: true },
    subtopicName: { type: String, required: true, trim: true, index: true },
    /** Matches curriculum board (e.g. CBSC); legacy rows may have been created before this field existed. */
    board: { type: String, default: '', trim: true, index: true },
    generatedContent: { type: String, required: true, trim: true },
    pdfUrl: { type: String, default: '', trim: true },
    createdByRole: { type: String, default: 'super-admin', trim: true, index: true },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    createdByName: { type: String, default: '', trim: true },
  },
  {
    timestamps: true,
    collection: 'ai_generators',
  },
);

aiGeneratorRecordSchema.index({
  toolSlug: 1,
  className: 1,
  subjectName: 1,
  topicName: 1,
  subtopicName: 1,
  createdAt: -1,
});

const AIGeneratorRecord =
  mongoose.models.AIGeneratorRecord ||
  mongoose.model('AIGeneratorRecord', aiGeneratorRecordSchema);

export default AIGeneratorRecord;
