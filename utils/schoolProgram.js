import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';
import { resolveClassLabelForAiToolStorage } from './board-label.js';

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

/**
 * Resolve class key for AI tool lookups (matches AiToolGeneration.classLabel rules).
 * Always numeric class (6, 7, …); legacy IIT-6 inputs normalize to 6.
 */
export function resolveAiToolClassNumberFromRequest({ board, gradeLevel, classNumber } = {}) {
  const raw = String(gradeLevel || classNumber || '').trim();
  if (!raw) return null;
  const stored = resolveClassLabelForAiToolStorage(raw, board);
  const digits = stored.match(/\d+/)?.[0] || raw.match(/\d+/)?.[0];
  if (digits) return parseInt(digits, 10);
  return null;
}

export function validateAiToolBoardAccess(isAsliPrepExclusive, params = {}) {
  const iit = isIitAiToolRequest(params);
  if (!isAsliPrepExclusive && iit) {
    return {
      ok: false,
      message: 'IIT board is only available for Asli Prep schools.',
    };
  }
  return { ok: true };
}

/** AI tool board dropdown: curriculum always; IIT when Asli Prep is on. */
export function getAiToolBoardOptions(isAsliPrepExclusive, curriculumBoard) {
  const curriculum = String(curriculumBoard || 'CBSE').trim() || 'CBSE';
  const options = [curriculum];
  if (isAsliPrepExclusive && !options.includes('IIT')) {
    options.push('IIT');
  }
  return options;
}

/** Default AI tool board is always the school's curriculum board. */
export function getDefaultAiToolBoard(_isAsliPrepExclusive, curriculumBoard) {
  return String(curriculumBoard || 'CBSE').trim() || 'CBSE';
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
      .select('board curriculumBoard isAsliPrepExclusive schoolName')
      .lean();
  }
  const teacherCtx = teacher ? { board: teacher.board, isAsliPrepExclusive: false } : null;
  const isAsliPrepExclusive = resolveIsAsliPrepExclusive(teacherCtx, admin);
  const curriculumBoard =
    admin?.curriculumBoard ||
    (admin?.board && admin.board !== 'ASLI_EXCLUSIVE_SCHOOLS' ? admin.board : '') ||
    (teacher?.board && teacher.board !== 'ASLI_EXCLUSIVE_SCHOOLS' ? teacher.board : '') ||
    'CBSE';
  const displayBoard =
    resolveUserDisplayBoard(teacherCtx, admin) ||
    resolveUserDisplayBoard(admin, null) ||
    curriculumBoard ||
    'CBSE';
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
