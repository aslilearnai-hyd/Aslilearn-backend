import mongoose from 'mongoose';

const aiGenerationLockSchema = new mongoose.Schema(
  {
    toolSlug: { type: String, required: true, index: true },
    board: { type: String, default: '', index: true },
    className: { type: String, required: true, index: true },
    subject: { type: String, required: true, index: true },
    topic: { type: String, default: '', index: true },
    subtopic: { type: String, default: '', index: true },
    status: {
      type: String,
      enum: ['active', 'released', 'expired'],
      default: 'active',
      index: true,
    },
    lockedBy: { type: String, default: 'unknown' },
    lockToken: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

aiGenerationLockSchema.index(
  { toolSlug: 1, board: 1, className: 1, subject: 1, topic: 1, subtopic: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

const AiGenerationLock =
  mongoose.models.AiGenerationLock ||
  mongoose.model('AiGenerationLock', aiGenerationLockSchema);

export default AiGenerationLock;
