/**
 * httpOnly session cookie helpers (P1.9).
 * Bearer Authorization remains supported for mobile / legacy clients.
 * Uses Express built-in res.cookie (no cookie-parser dependency).
 */

export const AUTH_COOKIE_NAME = 'aslilearn_token';

function cookieBaseOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd || process.env.AUTH_COOKIE_SECURE === '1',
    // Cross-site SPA (Vercel) → API needs None; same-site localhost can use Lax.
    sameSite: isProd || process.env.AUTH_COOKIE_SAMESITE === 'none' ? 'none' : 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  };
}

/** Lightweight Cookie header parser (sets req.cookies). */
export function attachCookies(req, _res, next) {
  if (req.cookies && typeof req.cookies === 'object') return next();
  req.cookies = {};
  const raw = req.headers?.cookie;
  if (!raw) return next();
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      req.cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      req.cookies[key] = part.slice(idx + 1).trim();
    }
  }
  return next();
}

/** Attach JWT as httpOnly cookie on login responses. */
export function setAuthCookie(res, token) {
  if (!token || typeof res?.cookie !== 'function') return;
  res.cookie(AUTH_COOKIE_NAME, token, cookieBaseOptions());
}

/** Clear session cookie on logout. */
export function clearAuthCookie(res) {
  if (typeof res?.clearCookie !== 'function') return;
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: cookieBaseOptions().secure,
    sameSite: cookieBaseOptions().sameSite,
    path: '/',
  });
}

/** Resolve JWT from Authorization header or httpOnly cookie. */
export function extractAuthToken(req) {
  const header = req.header?.('Authorization') || req.headers?.authorization || '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  if (!req.cookies) {
    // Allow callers that skip attachCookies middleware
    attachCookies(req, null, () => {});
  }
  const fromCookie = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.trim()) return fromCookie.trim();
  return null;
}
