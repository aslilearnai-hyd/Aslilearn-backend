import mongoose from 'mongoose';

const vidyaCallLogSchema = new mongoose.Schema(
  {
    userId: { type: String, default: '', index: true },
    role: { type: String, default: 'unknown', index: true },
    sessionId: { type: String, default: '' },
    route: {
      type: String,
      enum: ['chat', 'chat-stream', 'vision', 'rag', 'tool', 'debrief', 'analysis', 'other'],
      default: 'chat',
      index: true,
    },
    prompt: { type: String, default: '' },
    promptPreview: { type: String, default: '' },
    response: { type: String, default: '' },
    responsePreview: { type: String, default: '' },
    model: { type: String, default: '' },
    provider: {
      type: String,
      enum: ['gemini', 'anthropic', 'openai', 'local', 'cache', 'rag', 'fallback', 'unknown'],
      default: 'gemini',
      index: true,
    },
    fallbackChain: { type: [String], default: [] },
    latencyMs: { type: Number, default: 0 },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    estimatedCostUsd: { type: Number, default: 0 },
    retrieverUsed: { type: Boolean, default: false },
    chunkIds: { type: [String], default: [] },
    chunkScores: { type: [Number], default: [] },
    priorityTier: {
      type: Number,
      enum: [1, 2, 3, 0],
      default: 0,
    },
    subject: { type: String, default: '' },
    classLabel: { type: String, default: '' },
    topic: { type: String, default: '' },
    success: { type: Boolean, default: true, index: true },
    error: { type: String, default: '' },
    safetyBlocked: { type: Boolean, default: false, index: true },
    safetyDetails: { type: mongoose.Schema.Types.Mixed, default: null },
    requestIp: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'ts', updatedAt: false } }
);

vidyaCallLogSchema.index({ ts: -1 });
vidyaCallLogSchema.index({ userId: 1, ts: -1 });
vidyaCallLogSchema.index({ provider: 1, ts: -1 });
vidyaCallLogSchema.index({ priorityTier: 1, ts: -1 });

const RETENTION_DAYS = Number(process.env.VIDYA_CALL_LOG_TTL_DAYS || 90);
vidyaCallLogSchema.index(
  { ts: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 }
);

export default mongoose.model('VidyaCallLog', vidyaCallLogSchema);
