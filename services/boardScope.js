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

/** Resolve which comparison board an exam result belongs to (matches student bucketing). */
export function resolveResultEffectiveBoard(result, studentBoardByUserId, adminById) {
  const userId = result?.userId?._id?.toString?.() || result?.userId?.toString?.() || '';
  if (userId && studentBoardByUserId?.has(userId)) {
    return studentBoardByUserId.get(userId);
  }

  const adminKey = result?.adminId?._id?.toString?.() || result?.adminId?.toString?.() || '';
  if (adminKey && adminById?.has(adminKey)) {
    return resolveAdminEffectiveBoard(adminById.get(adminKey));
  }

  const stored = String(result?.board || '').toUpperCase().trim();
  if (isValidCurriculumBoard(stored)) {
    return stored;
  }

  return null;
}

function formatParticipationRate(uniqueAttempters, students) {
  return students > 0
    ? ((uniqueAttempters / students) * 100).toFixed(1)
    : '0.0';
}

function summarizeResultBucket(results, attempterIds, students) {
  const averageScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) / results.length
      : 0;

  return {
    totalAttempts: results.length,
    averageScore: averageScore.toFixed(2),
    participationRate: formatParticipationRate(attempterIds.size, students),
    uniqueAttempters: attempterIds.size,
  };
}

/**
 * Bucket every exam attempt by the student's curriculum board (same rules as student counts).
 * Avoids mismatches when ExamResult.board is ASLI_EXCLUSIVE_SCHOOLS but the school is CBSE, etc.
 */
export async function bucketExamResultsByEffectiveBoard(ExamResult, adminById) {
  const [allResults, students] = await Promise.all([
    ExamResult.find({}).select('percentage userId adminId board').lean(),
    User.find({ role: 'student' }).select('_id assignedAdmin board').lean(),
  ]);

  const studentBoardByUserId = new Map(
    students.map((s) => [s._id.toString(), resolveStudentEffectiveBoard(s, adminById)])
  );

  const buckets = Object.fromEntries(
    COMPARISON_BOARDS.map((code) => [code, { results: [], attempterIds: new Set() }])
  );

  for (const result of allResults) {
    const board = resolveResultEffectiveBoard(result, studentBoardByUserId, adminById);
    if (!board || buckets[board] === undefined) continue;

    buckets[board].results.push(result);
    const userId = result.userId?.toString();
    if (userId) buckets[board].attempterIds.add(userId);
  }

  return buckets;
}

/** Per-board metrics for comparison charts and dashboards */
export async function computeBoardMetrics(boardCode, { User, Teacher, Exam, ExamResult }) {
  const code = String(boardCode).toUpperCase().trim();
  const adminIds = await getAdminIdsForBoard(boardCode);
  const { counts, adminById } = await buildStudentCountsByBoard();
  const students = counts[code] ?? 0;

  const teacherQuery = buildTeacherBoardQuery(code, adminIds);
  const examQuery = buildExamBoardQuery(code);

  const [teachers, exams, buckets] = await Promise.all([
    Teacher.countDocuments(teacherQuery),
    Exam.countDocuments(examQuery),
    bucketExamResultsByEffectiveBoard(ExamResult, adminById),
  ]);

  const bucket = buckets[code] || { results: [], attempterIds: new Set() };
  const { totalAttempts, averageScore, participationRate } = summarizeResultBucket(
    bucket.results,
    bucket.attempterIds,
    students
  );

  return {
    board: code,
    boardName: BOARD_DISPLAY_NAMES[code] || code,
    students,
    teachers,
    exams,
    totalAttempts,
    averageScore,
    participationRate,
    adminIds,
  };
}

/** All boards in one pass — used by comparison endpoint */
export async function computeAllBoardsMetrics({ Teacher, Exam, ExamResult }) {
  const { counts, adminById } = await buildStudentCountsByBoard();
  const [adminIdsByBoard, buckets] = await Promise.all([
    Promise.all(
      COMPARISON_BOARDS.map(async (code) => ({
        code,
        adminIds: await getAdminIdsForBoard(code),
      }))
    ),
    bucketExamResultsByEffectiveBoard(ExamResult, adminById),
  ]);

  const adminIdMap = Object.fromEntries(adminIdsByBoard.map((r) => [r.code, r.adminIds]));

  return Promise.all(
    COMPARISON_BOARDS.map(async (code) => {
      const adminIds = adminIdMap[code] || [];
      const students = counts[code] ?? 0;
      const examQuery = buildExamBoardQuery(code);
      const teacherQuery = buildTeacherBoardQuery(code, adminIds);

      const [teachers, exams] = await Promise.all([
        Teacher.countDocuments(teacherQuery),
        Exam.countDocuments(examQuery),
      ]);

      const bucket = buckets[code] || { results: [], attempterIds: new Set() };
      const { totalAttempts, averageScore, participationRate } = summarizeResultBucket(
        bucket.results,
        bucket.attempterIds,
        students
      );

      return {
        board: code,
        boardName: BOARD_DISPLAY_NAMES[code] || code,
        students,
        teachers,
        exams,
        totalAttempts,
        averageScore,
        participationRate,
      };
    })
  );
}
