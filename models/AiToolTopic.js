import mongoose from 'mongoose';

const aiToolTopicSchema = new mongoose.Schema(
  {
    board: { type: String, required: true, trim: true, index: true },
    classLabel: { type: String, required: true, trim: true, index: true },
    subject: { type: String, required: true, trim: true, index: true },
    label: { type: String, default: '', trim: true, index: true },
    topicName: { type: String, required: true, trim: true, index: true },
    subTopic: { type: String, required: true, trim: true, index: true },
    /** Seed / admin order for dropdowns (lower = earlier). Omit for legacy rows. */
    sortOrder: { type: Number, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    collection: 'ai_tool_topics',
  },
);

aiToolTopicSchema.index(
  { board: 1, classLabel: 1, subject: 1, topicName: 1, subTopic: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

const AiToolTopic =
  mongoose.models.AiToolTopic || mongoose.model('AiToolTopic', aiToolTopicSchema);

export default AiToolTopic;
