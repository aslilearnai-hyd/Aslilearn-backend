/** Shared CORS headers — use on errors, 404s, and route-level preflight. */

const ASLILEARN_ORIGIN_RE = /^https?:\/\/([a-z0-9-]+\.)?aslilearn\.ai(:[0-9]+)?$/i;

export function isAllowedAslilearnOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  return ASLILEARN_ORIGIN_RE.test(origin.trim());
}

export function applyCorsHeaders(req, res) {
  const origin = req.headers?.origin;
  if (origin && (isAllowedAslilearnOrigin(origin) || process.env.NODE_ENV === 'production')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cookie, X-Requested-With, Accept, Origin',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie');
}

export function corsPreflightHandler(req, res) {
  applyCorsHeaders(req, res);
  res.setHeader('Access-Control-Max-Age', '86400');
  return res.sendStatus(204);
}

/** Long batch jobs (book/AI generator) can run 10+ minutes. */
export function longRunningRequest(req, res, next) {
  if (req.socket) req.socket.setTimeout(900000);
  if (typeof res.setTimeout === 'function') res.setTimeout(900000);
  next();
}
