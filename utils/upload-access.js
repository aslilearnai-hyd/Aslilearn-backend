/**
 * Role-scoped access rules for /uploads static files.
 * Signed query (?exp=&sig=) grants path-limited access without elevating role.
 */
import crypto from 'crypto';

const PUBLIC_PATH_RE =
  /\/(logos?|brand|favicon|public)\b|\/schools\/logos?\b/i;

/** Paths any authenticated school user may read */
const SCHOOL_SHARED_PREFIXES = [
  '/content/',
  '/content/thumbnails/',
  '/events/',
  '/questions/',
  '/ai-diagrams/',
  '/pdfs/',
  '/extracted/',
];

/** Admin / super-admin / teacher only */
const STAFF_PREFIXES = [
  '/reports/',
  '/book-knowledge/',
  '/pdf-knowledge/',
  '/orders/',
];

function normalizeUploadPath(reqPath) {
  let p = String(reqPath || '');
  if (!p.startsWith('/')) p = `/${p}`;
  // Strip query already handled by express path
  return p.split('?')[0].toLowerCase();
}

export function isPublicUploadPath(reqPath) {
  const p = normalizeUploadPath(reqPath);
  return PUBLIC_PATH_RE.test(p) || (p.endsWith('.svg') && p.includes('logo'));
}

function pathStartsWith(p, prefixes) {
  return prefixes.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre) || p.includes(pre));
}

/**
 * @param {string} reqPath express req.path under /uploads mount (e.g. /content/x.pdf)
 * @param {{ role?: string }} user
 */
export function roleMayAccessUpload(reqPath, user) {
  const p = normalizeUploadPath(reqPath);
  const role = String(user?.role || '').toLowerCase();

  if (role === 'super-admin' || role === 'admin') return true;

  if (pathStartsWith(p, STAFF_PREFIXES)) {
    return role === 'teacher';
  }

  if (pathStartsWith(p, SCHOOL_SHARED_PREFIXES)) {
    return role === 'teacher' || role === 'student';
  }

  // Unknown folders: staff only (fail closed for students)
  return role === 'teacher';
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
