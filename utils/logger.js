/**
 * Structured logger — zero dependencies, deliberately.
 *
 * The backend had 1,719 bare console.log calls: no levels, no timestamps, no
 * request correlation, and no way to quiet debug chatter in production. This
 * gives levelled, machine-parseable output without adding a dependency to a
 * tree that just had 16 vulnerabilities cleared.
 *
 * Output shape:
 *   production  -> one JSON object per line, for log aggregators
 *   development -> aligned, coloured, human-readable
 *
 * Control with LOG_LEVEL=error|warn|info|debug (default: info in production,
 * debug otherwise).
 *
 * The 1,719 existing console.log calls keep working untouched — this is
 * additive. Migrate them opportunistically; new code should use this.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const isProd = (process.env.NODE_ENV || 'production') === 'production';
const configured = String(process.env.LOG_LEVEL || (isProd ? 'info' : 'debug')).toLowerCase();
const threshold = LEVELS[configured] ?? LEVELS.info;

/** Keys whose values must never reach a log line. */
const SECRET_KEYS = /^(password|pass|pwd|token|accessToken|refreshToken|authorization|auth|secret|jwt|apiKey|api_key|mongo_uri|mongoUri|cookie|sessionId)$/i;

/**
 * Redact secrets and truncate bulk fields before serialising.
 * Depth-limited so a circular or very deep object cannot hang the logger.
 */
function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[depth-limit]';
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…[+${value.length - 2000}]` : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

const COLOURS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';

function emit(level, msg, meta) {
  if (LEVELS[level] > threshold) return;
  const clean = meta && Object.keys(meta).length ? sanitize(meta) : undefined;

  if (isProd) {
    const line = { ts: new Date().toISOString(), level, msg: String(msg), ...(clean ? { meta: clean } : {}) };
    // process.stdout.write avoids console's extra formatting pass.
    process.stdout.write(`${JSON.stringify(line)}\n`);
    return;
  }

  const t = new Date().toISOString().slice(11, 23);
  const tag = `${COLOURS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const extra = clean ? ` ${JSON.stringify(clean)}` : '';
  process.stdout.write(`${t} ${tag} ${msg}${extra}\n`);
}

export const logger = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),

  /**
   * Request-scoped logger. Every line carries the same requestId, so a single
   * request can be followed across files — impossible with the bare
   * console.log calls this replaces.
   */
  child(bindings = {}) {
    return {
      error: (msg, meta) => emit('error', msg, { ...bindings, ...meta }),
      warn: (msg, meta) => emit('warn', msg, { ...bindings, ...meta }),
      info: (msg, meta) => emit('info', msg, { ...bindings, ...meta }),
      debug: (msg, meta) => emit('debug', msg, { ...bindings, ...meta }),
    };
  },
};

export default logger;
