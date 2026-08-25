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
    const policyRole =
      role === 'school-admin' ? 'admin' : ['admin', 'teacher', 'student'].includes(role) ? role : 'student';

    let schoolAdmin = null;
    let vidyaEnabled = true;

    if (userId && ['student', 'teacher', 'admin', 'school-admin'].includes(role)) {
      schoolAdmin = await resolveSchoolAdminForUser(
        userId,
        role === 'school-admin' ? 'admin' : role
      );
      vidyaEnabled = computeVidyaEnabledForRole(schoolAdmin, policyRole);
    }

    let schoolPolicy = null;
    try {
      if (adminId) {
        schoolPolicy = await loadSchoolVidyaPolicyForAdmin(adminId, policyRole);
      } else if (schoolAdmin) {
        const { policyForRole } = await import('../utils/schoolVidyaLimits.js');
        schoolPolicy = policyForRole(schoolAdmin, policyRole);
      }
    } catch {
      schoolPolicy = null;
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
