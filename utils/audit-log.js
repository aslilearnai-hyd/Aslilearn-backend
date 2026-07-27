import AuditLog from '../models/AuditLog.js';
import { logger } from './logger.js';

const SECRET_KEYS =
  /^(password|pass|pwd|token|accessToken|refreshToken|authorization|auth|secret|jwt|apiKey|api_key|mongo_uri|mongoUri|cookie|sessionId|privateKey)$/i;

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[depth-limit]';
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

/**
 * Persist one audit row. Never throws to callers (fire-and-forget safe).
 */
export async function writeAudit(entry = {}) {
  try {
    const doc = {
      at: entry.at || new Date(),
      action: String(entry.action || 'unknown').slice(0, 120),
      summary: String(entry.summary || '').slice(0, 500),
      method: entry.method || '',
      path: entry.path || '',
      statusCode: entry.statusCode ?? null,
      requestId: entry.requestId || '',
      ip: entry.ip || '',
      userAgent: String(entry.userAgent || '').slice(0, 300),
      actor: {
        id: entry.actor?.id != null ? String(entry.actor.id) : null,
        role: entry.actor?.role || null,
        email: entry.actor?.email || null,
        name: entry.actor?.name || null,
      },
      target: {
        type: entry.target?.type || null,
        id: entry.target?.id != null ? String(entry.target.id) : null,
        label: entry.target?.label || null,
        email: entry.target?.email || null,
      },
      meta: sanitize(entry.meta || {}),
      source: entry.source || 'http',
    };
    await AuditLog.create(doc);
  } catch (err) {
    logger.warn('audit write failed', { message: err?.message });
  }
}

/** Attach enrichment helpers used by controllers before res.json. */
export function attachAuditHelpers(req) {
  if (req.auditAction !== undefined) return;
  req.auditAction = null;
  req.auditSummary = null;
  req.auditTarget = null;
  req.auditMeta = null;
  req.setAudit = (partial = {}) => {
    if (partial.action) req.auditAction = partial.action;
    if (partial.summary) req.auditSummary = partial.summary;
    if (partial.target) req.auditTarget = partial.target;
    if (partial.meta) req.auditMeta = { ...(req.auditMeta || {}), ...partial.meta };
  };
}

export function actorFromReq(req) {
  const u = req.user || {};
  return {
    id: req.userId || u.userId || u.id || null,
    role: u.role || null,
    email: u.email || null,
    name: u.fullName || u.name || null,
  };
}

export function defaultActionFromRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const segs = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const resource = segs[0] || 'api';
  const verb =
    method === 'POST'
      ? 'create'
      : method === 'PUT' || method === 'PATCH'
        ? 'update'
        : method === 'DELETE'
          ? 'delete'
          : method.toLowerCase();
  return `${resource}.${verb}`;
}

export { sanitize };
