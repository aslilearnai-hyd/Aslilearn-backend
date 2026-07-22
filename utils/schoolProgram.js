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

/** Normalize board codes so IIT / IIT/NEET / IIT-NEET all match. */
export function normalizeContentBoardKey(raw) {
  const s = String(raw || '')
    .toUpperCase()
    .trim()
    .replace(/[\s/\\-]+/g, '');
  if (!s) return '';
  if (s === 'CBSE' || s === 'CBSC') return 'CBSE';
  if (s.includes('IIT') || s.includes('NEET') || s.includes('JEE')) return 'IIT';
  if (s === 'ASLIEXCLUSIVESCHOOLS' || s === 'ASLIEXCLUSIVE') return 'ASLI_EXCLUSIVE_SCHOOLS';
  return String(raw || '')
    .toUpperCase()
    .trim();
}

/**
 * Asli Prep students: keep content whose board matches curriculum + ASLI hub + IIT (when tracks assigned).
 */
export function filterContentsByBoardForAsliPrep(contents, curriculumBoard, iitCategories = []) {
  if (!Array.isArray(contents)) return [];
  const curriculum = normalizeContentBoardKey(curriculumBoard || 'CBSE');
  const allowed = new Set([curriculum, 'ASLI_EXCLUSIVE_SCHOOLS'].filter(Boolean));
  const hasIitTracks =
    Array.isArray(iitCategories) &&
    iitCategories.some((c) => String(c || '').trim());
  if (hasIitTracks) allowed.add('IIT');
  return contents.filter((row) => {
    const board = normalizeContentBoardKey(
      row?.board || row?.subject?.board || ''
    );
    if (!board) return true;
    return allowed.has(board);
  });
}

/** Video tied to IIT board or an IIT product track (Alpha/Beta/Gamma). */
export function isIitTrackVideo(row) {
  if (String(row?.type || '').trim() !== 'Video') return false;
  const board = normalizeContentBoardKey(row?.board || row?.subject?.board || '');
  if (board === 'IIT') return true;
  const cat = String(row?.productCategory || row?.subject?.productCategory || '')
    .toUpperCase()
    .trim();
  return Boolean(cat);
}

/** EduOTT: only IIT-track videos. */
export function filterVideosForEduOtt(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => isIitTrackVideo(row));
}

/** Learning Paths: drop IIT-track videos; keep board videos + all non-video. */
export function filterVideosForLearningPath(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (String(row?.type || '').trim() !== 'Video') return true;
    return !isIitTrackVideo(row);
  });
}

export function applySurfaceContentFilters(rows, surface) {
  const s = String(surface || '')
    .toLowerCase()
    .trim();
  if (s === 'eduott' || s === 'edu-ott') {
    return filterVideosForEduOtt(rows);
  }
  if (s === 'learning-path' || s === 'learningpath' || s === 'lp') {
    return filterVideosForLearningPath(rows);
  }
  return rows;
}

export function applySchoolProgramContentFilters(
  contents,
  { isAsliPrepExclusive, curriculumBoard, iitCategories, trialAllowedContentTypes, surface }
) {
  let rows = filterContentsBySchoolProgram(contents, isAsliPrepExclusive);
  if (isAsliPrepExclusive) {
    rows = filterContentsByBoardForAsliPrep(rows, curriculumBoard, iitCategories);
  }
  rows = filterByProductCategory(rows, iitCategories);
  rows = filterByTrialContentTypes(rows, trialAllowedContentTypes);
  rows = applySurfaceContentFilters(rows, surface);
  return rows;
}

/** Super Admin trial restriction: if list is non-empty, only those types are visible. */
export function filterByTrialContentTypes(rows, trialAllowedContentTypes) {
  if (!Array.isArray(rows)) return [];
  if (!Array.isArray(trialAllowedContentTypes) || trialAllowedContentTypes.length === 0) {
    return rows;
  }
  const allowed = new Set(trialAllowedContentTypes.map((t) => String(t || '').trim()));
  return rows.filter((row) => allowed.has(String(row?.type || '').trim()));
}

/**
 * School sees general catalog (empty productCategory) plus assigned IIT tracks.
 */
export function filterByProductCategory(rows, schoolIitCategories) {
  if (!Array.isArray(rows)) return [];
  const allowed = new Set(
    (Array.isArray(schoolIitCategories) ? schoolIitCategories : [])
      .map((c) => String(c || '').toUpperCase().trim())
      .filter(Boolean)
  );
  return rows.filter((row) => {
    const cat = String(
      row?.productCategory || row?.subject?.productCategory || ''
    )
      .toUpperCase()
      .trim();
    if (!cat) return true;
    return allowed.has(cat);
  });
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
    .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories')
    .select(
      'board curriculumBoard isAsliPrepExclusive iitCategories isIndividualAccount trialAllowedContentTypes trialAllowedAiTools assignedAdmin'
    )
    .lean();
  if (!student) {
    return {
      isAsliPrepExclusive: false,
      curriculumBoard: 'CBSE',
      adminBoard: '',
      iitCategories: [],
      trialAllowedContentTypes: [],
      trialAllowedAiTools: [],
    };
  }
  const isAsliPrepExclusive =
    resolveIsAsliPrepExclusive(student, student.assignedAdmin) ||
    Boolean(student.isIndividualAccount);
  const curriculumBoard = resolveUserDisplayBoard(student, student.assignedAdmin) || 'CBSE';
  const adminBoard = student.assignedAdmin?.board || student.board || '';
  const iitCategories =
    Array.isArray(student.iitCategories) && student.iitCategories.length
      ? student.iitCategories
      : Array.isArray(student.assignedAdmin?.iitCategories)
        ? student.assignedAdmin.iitCategories
        : [];
  return {
    isAsliPrepExclusive,
    curriculumBoard,
    adminBoard,
    iitCategories,
    trialAllowedContentTypes: Array.isArray(student.trialAllowedContentTypes)
      ? student.trialAllowedContentTypes
      : [],
    trialAllowedAiTools: Array.isArray(student.trialAllowedAiTools)
      ? student.trialAllowedAiTools
      : [],
  };
}

export async function getTeacherSchoolProgramContext(teacherId) {
  const teacher = await Teacher.findById(teacherId)
    .select(
      'adminId board isIndividualAccount iitCategories curriculumBoard isAsliPrepExclusive trialAllowedContentTypes trialAllowedAiTools'
    )
    .lean();
  let admin = null;
  if (teacher?.adminId) {
    admin = await User.findById(teacher.adminId)
      .select('board curriculumBoard isAsliPrepExclusive schoolName iitCategories')
      .lean();
  }
  const teacherCtx = teacher
    ? {
        board: teacher.board,
        isAsliPrepExclusive: Boolean(teacher.isAsliPrepExclusive || teacher.isIndividualAccount),
        iitCategories: teacher.iitCategories,
      }
    : null;
  const isAsliPrepExclusive = resolveIsAsliPrepExclusive(teacherCtx, admin);
  const curriculumBoard =
    teacher?.curriculumBoard ||
    admin?.curriculumBoard ||
    (admin?.board && admin.board !== 'ASLI_EXCLUSIVE_SCHOOLS' ? admin.board : '') ||
    (teacher?.board && teacher.board !== 'ASLI_EXCLUSIVE_SCHOOLS' ? teacher.board : '') ||
    'CBSE';
  const displayBoard =
    resolveUserDisplayBoard(teacherCtx, admin) ||
    resolveUserDisplayBoard(admin, null) ||
    curriculumBoard ||
    'CBSE';
  const iitCategories = Array.isArray(teacher?.iitCategories) && teacher.iitCategories.length
    ? teacher.iitCategories
    : Array.isArray(admin?.iitCategories)
      ? admin.iitCategories
      : [];
  return {
    isAsliPrepExclusive: isAsliPrepExclusive || Boolean(teacher?.isIndividualAccount),
    curriculumBoard: displayBoard,
    adminBoard: admin?.board || teacher?.board || '',
    iitCategories,
    trialAllowedContentTypes: Array.isArray(teacher?.trialAllowedContentTypes)
      ? teacher.trialAllowedContentTypes
      : [],
    trialAllowedAiTools: Array.isArray(teacher?.trialAllowedAiTools)
      ? teacher.trialAllowedAiTools
      : [],
  };
}

export async function getAdminSchoolProgramContext(adminId) {
  const admin = await User.findById(adminId)
    .select('board curriculumBoard isAsliPrepExclusive iitCategories')
    .lean();
  if (!admin) {
    return { isAsliPrepExclusive: false, curriculumBoard: 'CBSE', adminBoard: '', iitCategories: [] };
  }
  const isAsliPrepExclusive = resolveIsAsliPrepExclusive(admin, null);
  const curriculumBoard = resolveUserDisplayBoard(admin, null) || 'CBSE';
  return {
    isAsliPrepExclusive,
    curriculumBoard,
    adminBoard: admin.board || '',
    iitCategories: Array.isArray(admin.iitCategories) ? admin.iitCategories : [],
  };
}
