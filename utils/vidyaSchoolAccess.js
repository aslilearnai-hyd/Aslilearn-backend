import User from '../models/User.js';
import Teacher from '../models/Teacher.js';

/** Default true when unset — existing schools keep Vidya enabled. */
export function isVidyaEnabledForAdmins(admin) {
  if (!admin) return true;
  return admin.vidyaEnabledForAdmins !== false;
}

export function isVidyaEnabledForTeachers(admin) {
  if (!admin) return true;
  return admin.vidyaEnabledForTeachers !== false;
}

export function isVidyaEnabledForStudents(admin) {
  if (!admin) return true;
  return admin.vidyaEnabledForStudents !== false;
}

export function computeVidyaEnabledForRole(admin, role) {
  const r = String(role || '').toLowerCase();
  if (r === 'student') return isVidyaEnabledForStudents(admin);
  if (r === 'teacher') return isVidyaEnabledForTeachers(admin);
  if (r === 'admin') return isVidyaEnabledForAdmins(admin);
  return true;
}

const ADMIN_VIDYA_SELECT =
  'vidyaEnabledForAdmins vidyaEnabledForTeachers vidyaEnabledForStudents schoolName board curriculumBoard isAsliPrepExclusive teacherPermissions studentPermissions permissions vidyaRolePolicies vidyaUsageMode vidyaLimitChatbot vidyaLimitTools vidyaChatPerDay vidyaGenerationsPerDay';

export async function resolveSchoolAdminForUser(userId, role) {
  if (role === 'student') {
    const user = await User.findById(userId)
      .select('assignedAdmin')
      .populate('assignedAdmin', ADMIN_VIDYA_SELECT)
      .lean();
    return user?.assignedAdmin || null;
  }

  if (role === 'teacher') {
    const teacher = await Teacher.findById(userId).select('adminId').lean();
    if (!teacher?.adminId) return null;
    return User.findById(teacher.adminId).select(ADMIN_VIDYA_SELECT).lean();
  }

  if (role === 'admin') {
    return User.findById(userId).select(ADMIN_VIDYA_SELECT).lean();
  }

  return null;
}
