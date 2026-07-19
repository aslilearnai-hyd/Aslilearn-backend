import mongoose from 'mongoose';

const aiToolTopicSchema = new mongoose.Schema(
  {
    board: { type: String, required: true, trim: true, index: true },
    /** IIT product track (ALPHA / BETA / …). Empty = General (all schools). */
    productCategory: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
      index: true,
    },
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
  { board: 1, productCategory: 1, classLabel: 1, subject: 1, topicName: 1, subTopic: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

aiToolTopicSchema.index({
  isActive: 1,
  board: 1,
  productCategory: 1,
  classLabel: 1,
  subject: 1,
  sortOrder: 1,
});

const AiToolTopic =
  mongoose.models.AiToolTopic || mongoose.model('AiToolTopic', aiToolTopicSchema);

/** Drop legacy unique index (without productCategory) once so category tracks can coexist. */
export async function ensureAiToolTopicIndexes() {
  try {
    const coll = mongoose.connection.collection('ai_tool_topics');
    const indexes = await coll.indexes();
    const legacy = indexes.find(
      (idx) =>
        idx.unique &&
        idx.key &&
        idx.key.board === 1 &&
        idx.key.classLabel === 1 &&
        idx.key.subject === 1 &&
        idx.key.topicName === 1 &&
        idx.key.subTopic === 1 &&
        idx.key.productCategory === undefined,
    );
    if (legacy?.name) {
      await coll.dropIndex(legacy.name);
      console.log(`Dropped legacy ai_tool_topics index: ${legacy.name}`);
    }
    await AiToolTopic.syncIndexes();
  } catch (err) {
    console.warn('ensureAiToolTopicIndexes:', err?.message || err);
  }
}

export default AiToolTopic;
