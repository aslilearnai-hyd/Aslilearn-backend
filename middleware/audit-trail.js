/**
 * HTTP audit trail for API calls.
 * Logs every request under /api (all methods) with who / what / when / status.
 * Controllers can enrich via req.setAudit({ action, summary, target, actor, meta }).
 */

import {
  attachAuditHelpers,
  actorFromReq,
  defaultActionFromRequest,
  writeAudit,
} from '../utils/audit-log.js';

/** Paths that would flood storage or are not useful as audit events. */
const SKIP =
  /^\/api\/(health|ready|vidya\/.*\/stream|.*\/stream|student\/content-preview|uploads)(\/|$)/i;

const SKIP_METHODS = new Set(['OPTIONS', 'HEAD']);

export function auditTrail(req, res, next) {
  attachAuditHelpers(req);

  const method = String(req.method || '').toUpperCase();
  if (SKIP_METHODS.has(method)) return next();

  const path = String(req.originalUrl || req.url || '');
  const pathOnly = path.split('?')[0];
  if (SKIP.test(pathOnly)) return next();

  const startedAt = Date.now();
  res.on('finish', () => {
    const actor = actorFromReq(req);

    const bodyKeys =
      req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
        ? Object.keys(req.body).slice(0, 40)
        : [];

    void writeAudit({
      action: req.auditAction || defaultActionFromRequest(req),
      summary:
        req.auditSummary ||
        `${method} ${pathOnly} → ${res.statusCode}`,
      method,
      path: pathOnly,
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
