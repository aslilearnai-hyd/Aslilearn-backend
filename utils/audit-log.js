import AuditLog from '../models/AuditLog.js';
import { logger } from './logger.js';
import jwt from 'jsonwebtoken';
import { extractAuthToken } from './auth-cookie.js';

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
  req.auditActor = null;
  req.setAudit = (partial = {}) => {
    if (partial.action) req.auditAction = partial.action;
    if (partial.summary) req.auditSummary = partial.summary;
    if (partial.target) req.auditTarget = partial.target;
    if (partial.actor) req.auditActor = { ...(req.auditActor || {}), ...partial.actor };
    if (partial.meta) req.auditMeta = { ...(req.auditMeta || {}), ...partial.meta };
  };
}

export function actorFromReq(req) {
  if (req.auditActor && (req.auditActor.id || req.auditActor.email || req.auditActor.name)) {
    return {
      id: req.auditActor.id != null ? String(req.auditActor.id) : null,
      role: req.auditActor.role || null,
      email: req.auditActor.email || null,
      name: req.auditActor.name || null,
    };
  }

  const u = req.user || {};
  const fromJwt = {
    id: req.userId || u.userId || u.id || null,
    role: u.role || null,
    email: u.email || null,
    name: u.fullName || u.name || null,
  };
  if (fromJwt.id || fromJwt.email) return fromJwt;

  // Many routes set req.user late; decode Bearer/cookie so GET/read events still show WHO.
  try {
    const token = extractAuthToken(req);
    if (token && process.env.JWT_SECRET) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      const fromToken = {
        id: decoded.userId || decoded.id || null,
        role: decoded.role || null,
        email: decoded.email || null,
        name: decoded.fullName || decoded.name || null,
      };
      if (fromToken.id || fromToken.email) return fromToken;
    }
  } catch {
    // expired / invalid token — fall through
  }

  // Login/register happen before JWT exists — attribute by attempted email (never password).
  const path = String(req.originalUrl || req.url || '');
  const isAuthRoute =
    /\/api\/auth\/(login|register|logout)/i.test(path) || /\/api\/super-admin\/login/i.test(path);
  if (isAuthRoute && req.body && typeof req.body === 'object') {
    const email = String(req.body.email || '').trim().toLowerCase() || null;
    if (email) {
      return {
        id: null,
        role: null,
        email,
        name: null,
      };
    }
  }

  return fromJwt;
}

export function defaultActionFromRequest(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0];

  if (/\/api\/auth\/login$/i.test(path) || /\/api\/super-admin\/login$/i.test(path)) {
    return 'auth.login';
  }
  if (/\/api\/auth\/logout$/i.test(path)) {
    return 'auth.logout';
  }
  if (/\/api\/auth\/register$/i.test(path)) {
    return 'auth.register';
  }
  if (/\/api\/auth\/me$/i.test(path)) {
    return 'auth.session';
  }
  if (/\/change-password$/i.test(path)) {
    return 'auth.change-password';
  }

  const segs = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const resource = segs[0] || 'api';
  const verb =
    method === 'POST'
      ? 'create'
      : method === 'PUT' || method === 'PATCH'
        ? 'update'
        : method === 'DELETE'
          ? 'delete'
          : method === 'GET'
            ? 'read'
            : method.toLowerCase();
  return `${resource}.${verb}`;
}

export { sanitize };
