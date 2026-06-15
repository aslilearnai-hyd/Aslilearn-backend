import User from '../models/User.js';
import Teacher from '../models/Teacher.js';

/** Default true when unset — existing schools keep Vidya enabled. */
export function isVidyaEnabledForTeachers(admin) {
  if (!admin) return true;
  return admin.vidyaEnabledForTeachers !== false;
}

export function isVidyaEnabledForStudents(admin) {
  if (!admin) return true;
  return admin.vidyaEnabledForStudents !== false;
}

export function computeVidyaEnabledForRole(admin, role) {
  if (role === 'student') return isVidyaEnabledForStudents(admin);
  if (role === 'teacher') return isVidyaEnabledForTeachers(admin);
  return true;
}

export async function resolveSchoolAdminForUser(userId, role) {
  if (role === 'student') {
    const user = await User.findById(userId)
      .select('assignedAdmin')
      .populate(
        'assignedAdmin',
        'vidyaEnabledForTeachers vidyaEnabledForStudents schoolName board curriculumBoard isAsliPrepExclusive'
      )
      .lean();
    return user?.assignedAdmin || null;
  }

  if (role === 'teacher') {
    const teacher = await Teacher.findById(userId).select('adminId').lean();
    if (!teacher?.adminId) return null;
    return User.findById(teacher.adminId)
      .select('vidyaEnabledForTeachers vidyaEnabledForStudents schoolName board curriculumBoard isAsliPrepExclusive')
      .lean();
  }

  return null;
}
