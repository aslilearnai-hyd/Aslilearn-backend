/**
 * CSRF mitigation for cookie-authenticated mutating requests.
 * Bearer (mobile) skips Origin check; cookie sessions must come from allowlisted Origin.
 */
export function createCsrfOriginGuard(allowedOrigins) {
  const allow = new Set(Array.isArray(allowedOrigins) ? allowedOrigins : []);

  return function csrfOriginGuard(req, res, next) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const header = req.headers?.authorization || req.header?.('Authorization') || '';
    if (typeof header === 'string' && header.startsWith('Bearer ') && header.length > 10) {
      return next();
    }

    const origin = req.headers?.origin;
    if (!origin) {
      // Same-origin navigations / server-to-server without Origin — allow health tooling;
      // browsers always send Origin on cross-site credentialed POSTs.
      return next();
    }
    if (allow.has(origin)) return next();

    return res.status(403).json({
      success: false,
      message: 'Request origin is not allowed',
    });
  };
}
