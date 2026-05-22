import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';

/** All content types (Asli Prep exclusive schools). */
export const ALL_CONTENT_TYPES = ['Video', 'Audio', 'TextBook', 'Workbook', 'Material', 'Homework'];

/** Normal / curriculum schools (CBSE, STATE, etc.) — not used for super-admin uploads. */
export const NORMAL_SCHOOL_CONTENT_TYPES = ['Audio', 'TextBook', 'Homework'];

export function resolveIsAsliPrepExclusive(user, assignedAdmin) {
  const u = user && typeof user === 'object' ? user : null;
  const a = assignedAdmin && typeof assignedAdmin === 'object' ? assignedAdmin : null;
  if (u?.isAsliPrepExclusive === true) return true;
  if (a?.isAsliPrepExclusive === true) return true;
  if (u?.role === 'admin' && u?.board === 'ASLI_EXCLUSIVE_SCHOOLS') return true;
  if (a?.board === 'ASLI_EXCLUSIVE_SCHOOLS') return true;
  return false;
}

/** Allowed types for a school program (student / teacher / school admin views only). */
export function getAllowedContentTypes(isAsliPrepExclusive) {
  return isAsliPrepExclusive ? [...ALL_CONTENT_TYPES] : [...NORMAL_SCHOOL_CONTENT_TYPES];
}

export function isAllowedContentType(type, isAsliPrepExclusive) {
  const allowed = new Set(getAllowedContentTypes(isAsliPrepExclusive));
  return allowed.has(String(type || '').trim());
}

/** Drop disallowed content types for the school program (consumer APIs only). */
export function filterContentsBySchoolProgram(contents, isAsliPrepExclusive) {
  if (!Array.isArray(contents)) return [];
  if (isAsliPrepExclusive) return contents.filter((row) => isAllowedContentType(row?.type, true));
  return contents.filter((row) => isAllowedContentType(row?.type, false));
}

/**
 * Asli Prep students: keep content whose board matches curriculum + ASLI hub.
 */
export function filterContentsByBoardForAsliPrep(contents, curriculumBoard) {
  if (!Array.isArray(contents)) return [];
  const curriculum = String(curriculumBoard || 'CBSE').toUpperCase().trim();
  const allowed = new Set([curriculum, 'ASLI_EXCLUSIVE_SCHOOLS']);
  return contents.filter((row) => {
    const contentBoard = String(row?.board || '').toUpperCase().trim();
    const subjectBoard = String(row?.subject?.board || '').toUpperCase().trim();
    const board = contentBoard || subjectBoard;
    if (!board) return true;
    return allowed.has(board);
  });
}

export function applySchoolProgramContentFilters(contents, { isAsliPrepExclusive, curriculumBoard }) {
  let rows = filterContentsBySchoolProgram(contents, isAsliPrepExclusive);
  if (isAsliPrepExclusive) {
    rows = filterContentsByBoardForAsliPrep(rows, curriculumBoard);
  }
  return rows;
}

export function isIitAiToolRequest({ board, gradeLevel, classNumber } = {}) {
  const b = String(board || '').toUpperCase().trim();
  const gl = String(gradeLevel || '').trim();
  const cn = String(classNumber || '').trim();
  return (
    b === 'IIT' ||
    gl === 'IIT-6' ||
    gl === 'Class-6-IIT' ||
    cn === 'IIT-6'
  );
}

export function validateAiToolBoardAccess(isAsliPrepExclusive, params = {}) {
  const iit = isIitAiToolRequest(params);
  if (isAsliPrepExclusive && !iit) {
    return {
      ok: false,
      message: 'Asli Prep schools must use the IIT board for AI tools.',
    };
  }
  if (!isAsliPrepExclusive && iit) {
    return {
      ok: false,
      message: 'IIT board is only available for Asli Prep schools.',
    };
  }
  return { ok: true };
}

export async function getStudentSchoolProgramContext(userId) {
  const student = await User.findById(userId)
    .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive')
    .lean();
  if (!student) {
    return { isAsliPrepExclusive: false, curriculumBoard: 'CBSE', adminBoard: '' };
  }
  const isAsliPrepExclusive = resolveIsAsliPrepExclusive(student, student.assignedAdmin);
  const curriculumBoard = resolveUserDisplayBoard(student, student.assignedAdmin) || 'CBSE';
  const adminBoard = student.assignedAdmin?.board || student.board || '';
  return { isAsliPrepExclusive, curriculumBoard, adminBoard };
}

export async function getTeacherSchoolProgramContext(teacherId) {
  const teacher = await Teacher.findById(teacherId).select('adminId board').lean();
  let admin = null;
  if (teacher?.adminId) {
    admin = await User.findById(teacher.adminId)
      .select('board curriculumBoard isAsliPrepExclusive')
      .lean();
  }
  const isAsliPrepExclusive = resolveIsAsliPrepExclusive(admin, admin);
  const curriculumBoard =
    admin?.curriculumBoard ||
    (admin?.board && admin.board !== 'ASLI_EXCLUSIVE_SCHOOLS' ? admin.board : '') ||
    teacher?.board ||
    'CBSE';
  const displayBoard = resolveUserDisplayBoard(admin, null) || curriculumBoard || 'CBSE';
  return {
    isAsliPrepExclusive,
    curriculumBoard: displayBoard,
    adminBoard: admin?.board || teacher?.board || '',
  };
}

export async function getAdminSchoolProgramContext(adminId) {
  const admin = await User.findById(adminId)
    .select('board curriculumBoard isAsliPrepExclusive')
    .lean();
  if (!admin) {
    return { isAsliPrepExclusive: false, curriculumBoard: 'CBSE', adminBoard: '' };
  }
  const isAsliPrepExclusive = resolveIsAsliPrepExclusive(admin, null);
  const curriculumBoard = resolveUserDisplayBoard(admin, null) || 'CBSE';
  return {
    isAsliPrepExclusive,
    curriculumBoard,
    adminBoard: admin.board || '',
  };
}
