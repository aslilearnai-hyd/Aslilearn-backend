import mongoose from 'mongoose';

/** Audit trail for Vidya AI Control Panel (database-backed admin assistant). */
const vidyaControlQueryLogSchema = new mongoose.Schema(
  {
    /**
     * JWTs in this app may carry non-ObjectId identifiers (e.g. "super-admin-001").
     * Keep audit identity as string so control logging never fails on cast.
     */
    adminUserId: { type: String, required: true, index: true },
    adminRole: { type: String, default: '', index: true },
    prompt: { type: String, default: '' },
    promptPreview: { type: String, default: '' },
    /** Structured intent returned by Gemini (validated). */
    intentJson: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Human-readable audit line (SELECT-style); MongoDB is executed server-side, not this string. */
    auditQuery: { type: String, default: '' },
    /** Compact snapshot of DB result for compliance review. */
    dataSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    responseText: { type: String, default: '' },
    responsePreview: { type: String, default: '' },
    latencyMs: { type: Number, default: 0 },
    success: { type: Boolean, default: true, index: true },
    error: { type: String, default: '' },
    requestIp: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

vidyaControlQueryLogSchema.index({ createdAt: -1 });
vidyaControlQueryLogSchema.index({ adminUserId: 1, createdAt: -1 });

const VidyaControlQueryLog =
  mongoose.models.VidyaControlQueryLog ||
  mongoose.model('VidyaControlQueryLog', vidyaControlQueryLogSchema);

export default VidyaControlQueryLog;
