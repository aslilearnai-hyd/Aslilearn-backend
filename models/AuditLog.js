import mongoose from 'mongoose';

/**
 * Durable action audit trail — who did what, when, on which resource.
 * Written by audit middleware + explicit controller enrichment.
 */
const auditLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, index: true },
    action: { type: String, required: true, index: true },
    summary: { type: String, default: '' },
    method: { type: String, default: '' },
    path: { type: String, default: '', index: true },
    statusCode: { type: Number, default: null },
    requestId: { type: String, default: '', index: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    actor: {
      id: { type: String, default: null, index: true },
      role: { type: String, default: null, index: true },
      email: { type: String, default: null },
      name: { type: String, default: null },
    },
    target: {
      type: { type: String, default: null },
      id: { type: String, default: null, index: true },
      label: { type: String, default: null },
      email: { type: String, default: null },
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, enum: ['http', 'handler', 'system'], default: 'http' },
  },
  { timestamps: false, versionKey: false },
);

auditLogSchema.index({ at: -1, action: 1 });
auditLogSchema.index({ 'actor.id': 1, at: -1 });
auditLogSchema.index({ 'target.id': 1, at: -1 });

export default mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
