/**
 * httpOnly session cookie helpers.
 * Bearer Authorization remains supported for mobile clients.
 * Access + refresh tokens live in httpOnly cookies for web (XSS-resistant).
 */

export const AUTH_COOKIE_NAME = 'aslilearn_token';
export const REFRESH_COOKIE_NAME = 'aslilearn_refresh';

function accessTokenMaxAgeMs() {
  const raw = process.env.JWT_ACCESS_EXPIRES_IN || '2h';
  const m = String(raw).match(/^(\d+)([smhd])$/i);
  if (!m) return 2 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 's') return n * 1000;
  if (u === 'm') return n * 60 * 1000;
  if (u === 'h') return n * 60 * 60 * 1000;
  if (u === 'd') return n * 24 * 60 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
}

function refreshTokenMaxAgeMs() {
  const days = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function cookieBaseOptions(maxAge) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd || process.env.AUTH_COOKIE_SECURE === '1',
    sameSite: isProd || process.env.AUTH_COOKIE_SAMESITE === 'none' ? 'none' : 'lax',
    path: '/',
    maxAge,
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
  res.cookie(AUTH_COOKIE_NAME, token, cookieBaseOptions(accessTokenMaxAgeMs()));
}

/** Opaque refresh token httpOnly cookie (web). Mobile still receives body refreshToken. */
export function setRefreshCookie(res, refreshToken) {
  if (!refreshToken || typeof res?.cookie !== 'function') return;
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, cookieBaseOptions(refreshTokenMaxAgeMs()));
}

/** Clear session cookies on logout. */
export function clearAuthCookie(res) {
  if (typeof res?.clearCookie !== 'function') return;
  const opts = cookieBaseOptions(accessTokenMaxAgeMs());
  const base = {
    httpOnly: true,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: '/',
  };
  res.clearCookie(AUTH_COOKIE_NAME, base);
  res.clearCookie(REFRESH_COOKIE_NAME, base);
}

/** Resolve JWT from Authorization header or httpOnly cookie. */
export function extractAuthToken(req) {
  const header = req.header?.('Authorization') || req.headers?.authorization || '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    // Ignore broken client headers like "Bearer null" so httpOnly cookies still work.
    if (bearer && bearer !== 'null' && bearer !== 'undefined') {
      return bearer;
    }
  }
  if (!req.cookies) {
    attachCookies(req, null, () => {});
  }
  const fromCookie = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.trim()) return fromCookie.trim();

  return null;
}

/** Resolve opaque refresh from body or httpOnly cookie. */
export function extractRefreshToken(req) {
  const body = req.body?.refreshToken || req.body?.refresh_token;
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (!req.cookies) {
    attachCookies(req, null, () => {});
  }
  const fromCookie = req.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof fromCookie === 'string' && fromCookie.trim()) return fromCookie.trim();
  return null;
}
