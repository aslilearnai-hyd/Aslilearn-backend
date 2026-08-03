/**
 * Shared exam visibility for school admins / students.
 * targetSchools + schoolId store school-admin User ids (from Super Admin school picker).
 */

import { boardsForSchoolContentScope } from '../constants/boards.js';

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

function schoolTargetIds(exam) {
  const examSchoolIdStr = toIdString(exam?.schoolId);
  const targetSchoolIds = Array.isArray(exam?.targetSchools)
    ? exam.targetSchools.map((id) => toIdString(id)).filter(Boolean)
    : [];
  return { examSchoolIdStr, targetSchoolIds };
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

  const { examSchoolIdStr, targetSchoolIds } = schoolTargetIds(exam);

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

/**
 * Board gate for school admins (isAllBoards bypasses).
 * Accepts a board string OR a school-admin user object (uses content-scope boards
 * so Asli Prep / IIT schools see ASLI_EXCLUSIVE_SCHOOLS and IIT exams).
 */
export function examMatchesAdminBoard(exam, adminOrBoard) {
  if (!exam) return false;
  if (exam.isAllBoards === true) return true;
  const examBoard = normalizeBoardKey(exam.board);
  if (!examBoard) return false;

  let allowed = [];
  if (adminOrBoard && typeof adminOrBoard === 'object' && !Array.isArray(adminOrBoard)) {
    allowed = boardsForSchoolContentScope({
      board: adminOrBoard.board,
      curriculumBoard: adminOrBoard.curriculumBoard,
      isAsliPrepExclusive: adminOrBoard.isAsliPrepExclusive,
      iitCategories: adminOrBoard.iitCategories,
    })
      .map(normalizeBoardKey)
      .filter(Boolean);
  } else {
    const key = normalizeBoardKey(adminOrBoard);
    if (key) allowed = [key];
  }

  if (!allowed.length) return false;
  return allowed.includes(examBoard);
}

/** Student access: school targeting + board of their assigned school admin. */
export function examVisibleToStudent(exam, studentAdminId, studentBoardOrAdmin) {
  if (!examVisibleToSchool(exam, studentAdminId)) return false;

  const sid = toIdString(studentAdminId);
  const { examSchoolIdStr, targetSchoolIds } = schoolTargetIds(exam);
  // Explicit school assignment — same rule as school-admin dashboards.
  if (sid && ((examSchoolIdStr && examSchoolIdStr === sid) || targetSchoolIds.includes(sid))) {
    return true;
  }

  if (studentBoardOrAdmin) return examMatchesAdminBoard(exam, studentBoardOrAdmin);
  // No board on student/admin → still allow school-targeted exams only
  return exam.isAllBoards !== true;
}

/** Full check for school-admin dashboards. */
export function examVisibleToSchoolAdmin(exam, admin) {
  if (!exam || !admin) return false;
  const adminId = admin._id || admin.id;
  if (!examVisibleToSchool(exam, adminId)) return false;

  const sid = toIdString(adminId);
  const { examSchoolIdStr, targetSchoolIds } = schoolTargetIds(exam);
  // Super Admin explicitly assigned this school — always visible.
  if ((examSchoolIdStr && examSchoolIdStr === sid) || targetSchoolIds.includes(sid)) {
    return true;
  }

  return examMatchesAdminBoard(exam, admin);
}
