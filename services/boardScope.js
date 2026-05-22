import User from '../models/User.js';
import {
  VALID_SCHOOL_BOARDS,
  CURRICULUM_BOARDS,
  isStoredCurriculumBoard,
  isValidCurriculumBoard,
  normalizeSchoolBoard,
} from '../constants/boards.js';

/** Boards shown in performance comparison (curriculum only — not Asli Exclusive hub). */
export const COMPARISON_BOARDS = [...CURRICULUM_BOARDS];

/** Human-readable labels for comparison UI */
export const BOARD_DISPLAY_NAMES = {
  ASLI_EXCLUSIVE_SCHOOLS: 'ASLI EXCLUSIVE SCHOOLS',
  CBSE: 'CBSE',
  STATE: 'State Board',
  SSC: 'SSC',
  ICSE: 'ICSE',
  IB: 'IB',
  CAMBRIDGE: 'Cambridge',
};

/**
 * Analytics board for comparison charts: always the school's curriculum (CBSE, STATE, …).
 * Asli Prep schools are bucketed by curriculumBoard, not the ASLI_EXCLUSIVE_SCHOOLS hub code.
 */
export function resolveAdminEffectiveBoard(admin) {
  if (!admin) return 'CBSE';
  const curriculum =
    admin.curriculumBoard ||
    (isStoredCurriculumBoard(admin.board) ? String(admin.board).toUpperCase().trim() : '');
  if (isValidCurriculumBoard(curriculum)) {
    return String(curriculum).toUpperCase().trim();
  }
  return 'CBSE';
}

/** Analytics board for a student */
export function resolveStudentEffectiveBoard(student, adminById) {
  if (!student) return 'ASLI_EXCLUSIVE_SCHOOLS';
  const adminKey = student.assignedAdmin?._id?.toString() || student.assignedAdmin?.toString();
  if (adminKey && adminById?.has(adminKey)) {
    return resolveAdminEffectiveBoard(adminById.get(adminKey));
  }
  return normalizeSchoolBoard(student.board);
}

/** Mongo filter: admins in exactly one analytics board bucket */
export function buildAdminBoardQuery(boardCode) {
  const code = String(boardCode).toUpperCase().trim();
  if (code === 'ASLI_EXCLUSIVE_SCHOOLS') {
    return { role: 'admin', isAsliPrepExclusive: true };
  }
  return {
    role: 'admin',
    $or: [
      { curriculumBoard: code },
      { board: code, isAsliPrepExclusive: { $ne: true } },
    ],
  };
}

/** Mongo filter: teachers scoped to a board */
export function buildTeacherBoardQuery(boardCode, adminIds = []) {
  const code = String(boardCode).toUpperCase().trim();
  const or = [{ board: code }];
  if (adminIds.length > 0) {
    or.push({ adminId: { $in: adminIds } });
  }
  return { $or: or };
}

/** Mongo filter: active exams for a board */
export function buildExamBoardQuery(boardCode) {
  const code = String(boardCode).toUpperCase().trim();
  return {
    isActive: true,
    $or: [{ board: code }, ...(code === 'ASLI_EXCLUSIVE_SCHOOLS' ? [{ isAllBoards: true }] : [])],
  };
}

export async function getAdminIdsForBoard(boardCode) {
  const admins = await User.find(buildAdminBoardQuery(boardCode)).select('_id').lean();
  return admins.map((a) => a._id);
}

/** True when board code is the unified super-admin hub (all schools / all students). */
export function isUnifiedPlatformBoard(boardCode) {
  return String(boardCode).toUpperCase().trim() === 'ASLI_EXCLUSIVE_SCHOOLS';
}

/** All schools on the platform (for unified dashboard). */
export function buildPlatformAdminQuery() {
  return { role: 'admin' };
}

/** Load admins once and bucket students by effective board (no double-counting). */
export async function buildStudentCountsByBoard() {
  const [students, admins] = await Promise.all([
    User.find({ role: 'student' }).select('assignedAdmin board').lean(),
    User.find({ role: 'admin' }).select('board curriculumBoard isAsliPrepExclusive').lean(),
  ]);

  const adminById = new Map(admins.map((a) => [a._id.toString(), a]));
  const counts = Object.fromEntries(COMPARISON_BOARDS.map((b) => [b, 0]));

  for (const student of students) {
    const board = resolveStudentEffectiveBoard(student, adminById);
    if (counts[board] !== undefined) {
      counts[board] += 1;
    } else {
      counts.CBSE += 1;
    }
  }

  return { counts, adminById };
}

/** Per-board metrics for comparison charts and dashboards */
export async function computeBoardMetrics(boardCode, { User, Teacher, Exam, ExamResult }) {
  const code = String(boardCode).toUpperCase().trim();
  const adminIds = await getAdminIdsForBoard(boardCode);
  const { counts } = await buildStudentCountsByBoard();
  const students = counts[code] ?? 0;

  const teacherQuery = buildTeacherBoardQuery(code, adminIds);
  const examQuery = buildExamBoardQuery(code);

  const [teachers, exams, results] = await Promise.all([
    Teacher.countDocuments(teacherQuery),
    Exam.countDocuments(examQuery),
    ExamResult.find({ board: code }).select('percentage userId').lean(),
  ]);

  const uniqueAttempters = new Set(
    results.map((r) => String(r.userId || '')).filter(Boolean)
  ).size;

  const averageScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) / results.length
      : 0;

  const participationRate =
    students > 0 && exams > 0
      ? ((uniqueAttempters / students) * 100).toFixed(1)
      : '0.0';

  return {
    board: code,
    boardName: BOARD_DISPLAY_NAMES[code] || code,
    students,
    teachers,
    exams,
    totalAttempts: results.length,
    averageScore: averageScore.toFixed(2),
    participationRate,
    adminIds,
  };
}

/** All boards in one pass — used by comparison endpoint */
export async function computeAllBoardsMetrics({ Teacher, Exam, ExamResult }) {
  const [{ counts }, adminIdsByBoard] = await Promise.all([
    buildStudentCountsByBoard(),
    Promise.all(
      COMPARISON_BOARDS.map(async (code) => ({
        code,
        adminIds: await getAdminIdsForBoard(code),
      }))
    ),
  ]);

  const adminIdMap = Object.fromEntries(adminIdsByBoard.map((r) => [r.code, r.adminIds]));

  return Promise.all(
    COMPARISON_BOARDS.map(async (code) => {
      const adminIds = adminIdMap[code] || [];
      const students = counts[code] ?? 0;
      const examQuery = buildExamBoardQuery(code);
      const teacherQuery = buildTeacherBoardQuery(code, adminIds);

      const [teachers, exams, results] = await Promise.all([
        Teacher.countDocuments(teacherQuery),
        Exam.countDocuments(examQuery),
        ExamResult.find({ board: code }).select('percentage userId').lean(),
      ]);

      const uniqueAttempters = new Set(
        results.map((r) => String(r.userId || '')).filter(Boolean)
      ).size;
      const averageScore =
        results.length > 0
          ? results.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) / results.length
          : 0;
      const participationRate =
        students > 0 && exams > 0
          ? ((uniqueAttempters / students) * 100).toFixed(1)
          : '0.0';

      return {
        board: code,
        boardName: BOARD_DISPLAY_NAMES[code] || code,
        students,
        teachers,
        exams,
        totalAttempts: results.length,
        averageScore: averageScore.toFixed(2),
        participationRate,
      };
    })
  );
}
