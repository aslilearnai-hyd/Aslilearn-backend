/**
 * HTTP audit trail for mutating API calls.
 * Writes durable AuditLog rows (who / what / when / status).
 * Controllers can enrich via req.setAudit({ action, summary, target, meta }).
 */

import {
  attachAuditHelpers,
  actorFromReq,
  defaultActionFromRequest,
  writeAudit,
} from '../utils/audit-log.js';

const SKIP =
  /^\/api\/(health|ready|vidya\/.*\/stream|student\/content-preview|uploads)/i;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function auditTrail(req, res, next) {
  attachAuditHelpers(req);

  const method = String(req.method || '').toUpperCase();
  if (!MUTATING.has(method)) return next();

  const path = String(req.originalUrl || req.url || '');
  if (SKIP.test(path.split('?')[0])) return next();

  const startedAt = Date.now();
  res.on('finish', () => {
    // Avoid flooding on auth noise without actor when not useful — still log register/login attempts.
    const actor = actorFromReq(req);
    const isAuthRoute = /\/api\/auth\/(login|register|super-admin\/login)/i.test(path)
      || /\/api\/super-admin\/login/i.test(path);

    if (!actor.id && !actor.email && !isAuthRoute && res.statusCode >= 400) {
      // Unauthenticated failed mutations — still useful for abuse; keep a short row.
    }

    const bodyKeys =
      req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
        ? Object.keys(req.body).slice(0, 40)
        : [];

    void writeAudit({
      action: req.auditAction || defaultActionFromRequest(req),
      summary:
        req.auditSummary ||
        `${method} ${path.split('?')[0]} → ${res.statusCode}`,
      method,
      path: path.split('?')[0],
      statusCode: res.statusCode,
      requestId: req.id || '',
      ip: req.ip || req.headers['x-forwarded-for'] || '',
      userAgent: req.headers['user-agent'] || '',
      actor,
      target: req.auditTarget || null,
      meta: {
        durationMs: Date.now() - startedAt,
        query: req.query || {},
        bodyKeys,
        params: req.params || {},
        ...(req.auditMeta || {}),
      },
      source: req.auditAction ? 'handler' : 'http',
    });
  });

  next();
}

export default auditTrail;
