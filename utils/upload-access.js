/**
 * Capability signing for /uploads. Non-super-admin roles require resource ACLs.
 */
import crypto from 'crypto';

const PUBLIC_PATH_RE =
  /^\/(logos?|brand|favicon|public)(\/|$)|^\/schools\/logos?(\/|$)/i;

function normalizeUploadPath(reqPath) {
  let p = String(reqPath || '');
  if (!p.startsWith('/')) p = `/${p}`;
  // Strip query already handled by express path
  return p.split('?')[0].toLowerCase();
}

export function isPublicUploadPath(reqPath) {
  const p = normalizeUploadPath(reqPath);
  return PUBLIC_PATH_RE.test(p);
}

/**
 * @param {string} reqPath express req.path under /uploads mount (e.g. /content/x.pdf)
 * @param {{ role?: string }} user
 */
export function roleMayAccessUpload(reqPath, user) {
  const role = String(user?.role || '').toLowerCase();

  return role === 'super-admin';
}

function signingSecret() {
  const s = process.env.UPLOAD_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!s || String(s).length < 16) {
    throw new Error('UPLOAD_SIGNING_SECRET or JWT_SECRET required for signed uploads');
  }
  return String(s);
}

/** Create exp+sig query for a path under /uploads (path like /uploads/content/a.pdf). */
export function signUploadPath(absoluteUploadPath, ttlSeconds = 3600) {
  const pathOnly = String(absoluteUploadPath || '').split('?')[0];
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || 3600);
  const payload = `${pathOnly}:${exp}`;
  const sig = crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
  return { exp, sig, path: pathOnly };
}

export function verifyUploadSignature(absoluteUploadPath, exp, sig) {
  if (!exp || !sig) return false;
  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN < Math.floor(Date.now() / 1000)) return false;
  const pathOnly = String(absoluteUploadPath || '').split('?')[0];
  const payload = `${pathOnly}:${expN}`;
  const expected = crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(String(sig), 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Canonical /uploads path for DB storage (no host, no ?exp=&sig=).
 * Prevents stale signatures from being persisted and skipped on next sign.
 */
export function normalizeUploadUrlForStorage(fileUrl) {
  const raw = String(fileUrl || '').trim();
  if (!raw) return '';
  try {
    if (raw.startsWith('/uploads/')) return raw.split('?')[0];
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (u.pathname.startsWith('/uploads/')) return u.pathname;
    }
    if (raw.includes('/uploads/')) {
      const idx = raw.indexOf('/uploads/');
      return raw.slice(idx).split('?')[0];
    }
  } catch {
    /* fall through */
  }
  return raw.split('?')[0];
}

/**
 * Append fresh ?exp=&sig= to an /uploads path (or absolute URL on our API) so clients
 * can load figures without cookie/Bearer (web cross-subdomain + mobile Image).
 * Always re-signs — never reuse an embedded signature from the DB (those expire).
 * Non-upload URLs are returned unchanged. Failures fall back to the original URL.
 */
export function withSignedUploadUrl(fileUrl, ttlSeconds = 28800) {
  const raw = String(fileUrl || '').trim();
  if (!raw) return raw;

  let pathOnly = '';
  try {
    if (raw.startsWith('/uploads/')) {
      pathOnly = raw.split('?')[0];
    } else if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (u.pathname.startsWith('/uploads/')) {
        pathOnly = u.pathname;
        // Drop foreign/localhost origins so clients always hit the live API host.
      }
    } else if (raw.includes('/uploads/')) {
      const idx = raw.indexOf('/uploads/');
      pathOnly = raw.slice(idx).split('?')[0];
    }
  } catch {
    return normalizeUploadUrlForStorage(raw) || raw;
  }

  if (!pathOnly.startsWith('/uploads/')) return raw;

  try {
    const { exp, sig, path } = signUploadPath(pathOnly, ttlSeconds);
    return `${path}?exp=${exp}&sig=${sig}`;
  } catch {
    return pathOnly;
  }
}

/** Sign questionImage (+ option.image) fields on a question-like object. */
export function signQuestionMediaFields(question, ttlSeconds = 28800) {
  if (!question || typeof question !== 'object') return question;
  const next = { ...question };
  if (next.questionImage) {
    next.questionImage = withSignedUploadUrl(next.questionImage, ttlSeconds);
  }
  if (Array.isArray(next.options)) {
    next.options = next.options.map((opt) => {
      if (!opt || typeof opt !== 'object' || !opt.image) return opt;
      return { ...opt, image: withSignedUploadUrl(opt.image, ttlSeconds) };
    });
  }
  return next;
}

/** Sign all locally hosted media fields on a content-like object. */
export function signContentMediaFields(content, ttlSeconds = 28800) {
  if (!content || typeof content !== 'object') return content;
  const next = { ...content };
  if (next.fileUrl) next.fileUrl = withSignedUploadUrl(next.fileUrl, ttlSeconds);
  if (Array.isArray(next.fileUrls)) {
    next.fileUrls = next.fileUrls.map((url) => withSignedUploadUrl(url, ttlSeconds));
  }
  if (next.thumbnailUrl) next.thumbnailUrl = withSignedUploadUrl(next.thumbnailUrl, ttlSeconds);
  return next;
}
