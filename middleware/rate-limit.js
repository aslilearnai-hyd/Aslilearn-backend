import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/** express-rate-limit can throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR even when `app.set('trust proxy')` ran; nginx always sends X-Forwarded-For. */
const forwardHeaderSafeValidate = {
  xForwardedForHeader: false,
};

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
  validate: forwardHeaderSafeValidate,
  handler: jsonHandler('Vidya is getting many requests right now. Please try again in a moment.'),
});

export const aiChatPerUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.VIDYA_USER_RPM || 30),
  standardHeaders: true,
  legacyHeaders: false,
  validate: forwardHeaderSafeValidate,
  keyGenerator: (req) => String(req.userId || ipKeyGenerator(req) || 'anonymous'),
  handler: jsonHandler('You are chatting with Vidya very fast. Please wait a few seconds and try again.'),
});

export const aiHeavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.VIDYA_HEAVY_RPM || 10),
  standardHeaders: true,
  legacyHeaders: false,
  validate: forwardHeaderSafeValidate,
  keyGenerator: (req) => String(req.userId || ipKeyGenerator(req) || 'anonymous'),
  handler: jsonHandler('That action is temporarily rate-limited. Please try again shortly.'),
});

