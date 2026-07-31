import crypto from 'crypto';

/** Generate a one-time provisional password (never a fixed default). */
export function generateProvisionalPassword(byteLength = 12) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/**
 * Resolve school-admin tenant id from JWT payload / req.
 * Super-admin returns null (global scope by design — callers must special-case).
 */
export function resolveTenantAdminId(req) {
  const role = req.user?.role || req.user?.userRole;
  if (role === 'super-admin') return null;
  const id =
    req.adminId ||
    req.userId ||
    req.user?.userId ||
    req.user?.id ||
    req.user?._id ||
    null;
  return id ? String(id) : null;
}

/** Allowlisted fields for admin student/user updates (mass-assignment protection). */
export const SAFE_USER_UPDATE_FIELDS = Object.freeze([
  'fullName',
  'name',
  'phone',
  'classNumber',
  'section',
  'isActive',
  'assignedClass',
  'classLabel',
]);
