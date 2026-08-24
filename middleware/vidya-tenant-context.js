import { resolveTenantAdminId } from '../utils/secure-tenant.js';
import {
  computeVidyaEnabledForRole,
  resolveSchoolAdminForUser,
} from '../utils/vidyaSchoolAccess.js';
import { loadSchoolVidyaPolicyForAdmin } from '../utils/trialUsageLimits.js';

/** Attach tenant context for all Vidya routes (school boundary + policy). */
export async function attachVidyaTenant(req, res, next) {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const userId = String(req.userId || req.user?.userId || req.user?.id || '');
    const adminId = resolveTenantAdminId(req);

    let schoolAdmin = null;
    let vidyaEnabled = true;

    if (userId && ['student', 'teacher'].includes(role)) {
      schoolAdmin = await resolveSchoolAdminForUser(userId, role);
      vidyaEnabled = computeVidyaEnabledForRole(schoolAdmin, role);
    }

    let schoolPolicy = null;
    if (adminId && ['admin', 'school-admin'].includes(role)) {
      try {
        schoolPolicy = await loadSchoolVidyaPolicyForAdmin(adminId);
      } catch {
        schoolPolicy = null;
      }
    }

    req.vidyaTenant = {
      userId,
      role,
      adminId,
      schoolAdminId: schoolAdmin?._id ? String(schoolAdmin._id) : adminId,
      schoolName: schoolAdmin?.schoolName || schoolAdmin?.fullName || '',
      vidyaEnabled,
      schoolPolicy,
      isSuperAdmin: role === 'super-admin',
    };

    return next();
  } catch (err) {
    console.error('Vidya tenant context failed:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Failed to resolve tenant context.' });
  }
}

/** Block school-scoped admin control when Vidya is disabled for their school. */
export async function requireVidyaControlTenant(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'super-admin') return next();
  if (role !== 'admin' && role !== 'school-admin') {
    return res.status(403).json({ success: false, message: 'Vidya AI Control requires admin privileges.' });
  }

  return next();
}
