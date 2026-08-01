/**
 * Shared exam visibility for school admins / students.
 * targetSchools + schoolId store school-admin User ids (from Super Admin school picker).
 */

function toIdString(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function normalizeBoardKey(board) {
  return String(board || '')
    .toUpperCase()
    .trim()
    .replace(/[\s/\\-]+/g, '_');
}

/**
 * Whether an exam should appear for a given school-admin User id.
 * Matches Super Admin calendar targeting.
 */
export function examVisibleToSchool(exam, schoolAdminId) {
  if (!exam) return false;
  const sid = toIdString(schoolAdminId);
  if (!sid) {
    // No school context: only non-targeted exams
    return exam.isSchoolSpecific !== true;
  }

  const examSchoolIdStr = toIdString(exam.schoolId);
  const targetSchoolIds = Array.isArray(exam.targetSchools)
    ? exam.targetSchools.map((id) => toIdString(id)).filter(Boolean)
    : [];

  // Explicit school list / primary school wins.
  if (examSchoolIdStr && examSchoolIdStr === sid) return true;
  if (targetSchoolIds.includes(sid)) return true;

  // Marked school-specific but this school is not on the list.
  if (exam.isSchoolSpecific === true) return false;

  // Legacy: has targetSchools populated without the flag — still restrict to the list.
  if (targetSchoolIds.length > 0) return false;

  // Available to all schools (optionally still filtered by board elsewhere).
  return true;
}

/** Board gate for school admins (isAllBoards bypasses). */
export function examMatchesAdminBoard(exam, adminBoard) {
  if (!exam) return false;
  if (exam.isAllBoards === true) return true;
  const examBoard = normalizeBoardKey(exam.board);
  const adminKey = normalizeBoardKey(adminBoard);
  // Missing either side → do not allow (prevents CSV all-board leaks)
  if (!examBoard || !adminKey) return false;
  return examBoard === adminKey;
}

/** Student access: school targeting + board of their assigned school admin. */
export function examVisibleToStudent(exam, studentAdminId, studentBoard) {
  if (!examVisibleToSchool(exam, studentAdminId)) return false;
  if (studentBoard) return examMatchesAdminBoard(exam, studentBoard);
  // No board on student/admin → still allow school-targeted exams only
  return exam.isAllBoards !== true;
}

/** Full check for school-admin dashboards. */
export function examVisibleToSchoolAdmin(exam, admin) {
  if (!exam || !admin) return false;
  const adminId = admin._id || admin.id;
  if (!examVisibleToSchool(exam, adminId)) return false;
  return examMatchesAdminBoard(exam, admin.board);
}
