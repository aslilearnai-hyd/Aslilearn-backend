import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const jsonHandler = (message) => (req, res) =>
  res.status(429).json({
    success: false,
    message,
  });

export const aiChatGlobalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.VIDYA_GLOBAL_RPM || 300),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Vidya is getting many requests right now. Please try again in a moment.'),
});

export const aiChatPerUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.VIDYA_USER_RPM || 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.userId || ipKeyGenerator(req) || 'anonymous'),
  handler: jsonHandler('You are chatting with Vidya very fast. Please wait a few seconds and try again.'),
});

/*
 * Brute-force protection for credential endpoints.
 *
 * Rate limiting existed only on the Vidya AI chat routes, so every login
 * endpoint — super admin, admin, teacher, student — accepted unlimited password
 * attempts. Keyed by IP + submitted email so one attacker cannot lock out a
 * whole NAT'd school, and so spraying many emails from one IP still counts.
 *
 * skipSuccessfulRequests means a legitimate user who logs in correctly never
 * burns quota; only failures count toward the limit.
 */
export const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000),
  limit: Number(process.env.LOGIN_MAX_ATTEMPTS || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || req.body?.username || '').toLowerCase().trim();
    return `${ipKeyGenerator(req)}:${email}`;
  },
  handler: jsonHandler('Too many sign-in attempts. Please wait a few minutes and try again.'),
});

export const aiHeavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Generate/batch only — raised slightly so Super Admin can retry a failed batch
  // without waiting a full minute. Reads/polls are not attached to this limiter.
  limit: Number(process.env.VIDYA_HEAVY_RPM || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.userId || ipKeyGenerator(req) || 'anonymous'),
  handler: jsonHandler(
    'Generation is temporarily rate-limited. Please wait a few seconds and try again (listing records is not limited).',
  ),
});

