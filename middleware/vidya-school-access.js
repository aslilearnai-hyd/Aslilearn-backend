import {
  computeVidyaEnabledForRole,
  resolveSchoolAdminForUser,
} from '../utils/vidyaSchoolAccess.js';

/** Block student/teacher Vidya endpoints when super admin disabled access for the school. */
export async function requireVidyaSchoolAccess(req, res, next) {
  const role = req.user?.role;
  if (!role || !['student', 'teacher'].includes(role)) {
    return next();
  }

  try {
    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const admin = await resolveSchoolAdminForUser(userId, role);
    if (!computeVidyaEnabledForRole(admin, role)) {
      return res.status(403).json({
        success: false,
        message: 'Vidya AI is not enabled for your school. Contact your school administrator.',
      });
    }

    return next();
  } catch (err) {
    console.error('Vidya school access check failed:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify Vidya access' });
  }
}
