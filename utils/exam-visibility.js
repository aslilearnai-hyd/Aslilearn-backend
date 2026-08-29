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

/** Enforce exam start/end window on the server (not only in the UI).
 * @param {{ purpose?: 'start' | 'submit' }} [opts]
 *  - start: must be inside [startDate, endDate]
 *  - submit: allow a grace after endDate so students who started near the
 *    deadline can still save (duration minutes, minimum 30).
 */
export function getExamWindowStatus(exam, opts = {}) {
  if (!exam) return { ok: false, message: 'Exam not found' };
  const purpose = opts.purpose === 'submit' ? 'submit' : 'start';
  const now = Date.now();
  const start = exam.startDate ? new Date(exam.startDate).getTime() : NaN;
  const end = exam.endDate ? new Date(exam.endDate).getTime() : NaN;
  if (Number.isFinite(start) && now < start) {
    return { ok: false, message: 'Exam has not started yet.' };
  }
  if (Number.isFinite(end) && now > end) {
    if (purpose === 'submit') {
      const durationMin = Math.max(0, Number(exam.duration) || 0);
      const graceMs = Math.max(30, durationMin) * 60 * 1000;
      if (now <= end + graceMs) {
        return { ok: true, grace: true };
      }
    }
    return { ok: false, message: 'Exam window has ended.' };
  }
  return { ok: true };
}

/**
 * B2C / individual students are not enrolled in a school, so they only see
 * public (non-targeted) papers — especially practice exams — that match their
 * class and IIT / Board scope.
 */
export function examVisibleToIndividualStudent(exam, student) {
  if (!exam || !student) return false;
  if (
    exam.createdByRole === 'student' &&
    toIdString(exam.practiceOwnerUserId) === toIdString(student._id || student.id)
  ) {
    return true;
  }
  // Once Super Admin explicitly configures this student's exam access, show
  // only the allotted Super Admin exams. Student-owned generated exams remain
  // available through the early return above.
  if (student.trialExamAccessConfigured === true) {
    const allotted = Array.isArray(student.trialAssignedExams)
      ? student.trialAssignedExams.map(toIdString).filter(Boolean)
      : [];
    return allotted.includes(toIdString(exam._id || exam.id));
  }
  // Once a Super Admin exam has ended, reuse the paper in the B2C practice
  // library. School targeting only controls the live sitting; the archived
  // paper is still matched to the individual student's Board/IIT scope below.
  const pastPractice = isPastExamPracticeForIndividual(exam, student);
  if (pastPractice) return true;
  if (exam.isSchoolSpecific === true) return false;
  const { examSchoolIdStr, targetSchoolIds } = schoolTargetIds(exam);
  if (examSchoolIdStr || targetSchoolIds.length > 0) return false;

  if (exam.isAllBoards === true) return true;

  const hasIitTracks =
    Array.isArray(student.iitCategories) &&
    student.iitCategories.some((c) => String(c || '').trim());
  const interested = Array.isArray(student.interestedCourses)
    ? student.interestedCourses.map((c) => String(c).toUpperCase())
    : [];
  const wantsIit =
    hasIitTracks ||
    Boolean(student.isAsliPrepExclusive) ||
    interested.some((c) => c.includes('IIT') || c.includes('NEET') || c.includes('JEE'));

  const scope = boardsForSchoolContentScope({
    board: student.board,
    curriculumBoard: student.curriculumBoard,
    isAsliPrepExclusive: Boolean(student.isAsliPrepExclusive) || hasIitTracks,
    iitCategories: student.iitCategories,
  }).map(normalizeBoardKey);

  const examBoard = normalizeBoardKey(exam.board);
  if (!examBoard) return exam.examType === 'practice';
  if (scope.includes(examBoard)) return true;

  const compact = examBoard.replace(/_/g, '');
  if (wantsIit && (compact.includes('IIT') || compact.includes('NEET') || compact.includes('JEE'))) {
    return true;
  }
  if (scope.includes('ASLI_EXCLUSIVE_SCHOOLS') && compact.includes('ASLI')) return true;
  // Untagged practice papers on a Board class still count as B2C practice.
  if (exam.examType === 'practice' && scope.length && !compact.includes('IIT')) {
    return scope.some((b) => b === examBoard || b.includes(compact) || compact.includes(b));
  }
  return false;
}

/** An ended Super Admin paper that can be reused by a matching B2C student. */
export function isPastExamPracticeForIndividual(exam, student) {
  if (!exam || !student?.isIndividualAccount) return false;
  if (exam.createdByRole !== 'super-admin' || exam.isActive === false) return false;
  const end = exam.endDate ? new Date(exam.endDate).getTime() : NaN;
  if (!Number.isFinite(end) || Date.now() <= end) return false;
  if (exam.isAllBoards === true) return true;

  const hasIitTracks =
    Array.isArray(student.iitCategories) &&
    student.iitCategories.some((c) => String(c || '').trim());
  const interested = Array.isArray(student.interestedCourses)
    ? student.interestedCourses.map((c) => String(c).toUpperCase())
    : [];
  const wantsIit =
    hasIitTracks ||
    Boolean(student.isAsliPrepExclusive) ||
    interested.some((c) => c.includes('IIT') || c.includes('NEET') || c.includes('JEE'));
  const scope = boardsForSchoolContentScope({
    board: student.board,
    curriculumBoard: student.curriculumBoard,
    isAsliPrepExclusive: Boolean(student.isAsliPrepExclusive) || hasIitTracks,
    iitCategories: student.iitCategories,
  }).map(normalizeBoardKey);
  const examBoard = normalizeBoardKey(exam.board);
  if (!examBoard) return true;
  if (scope.includes(examBoard)) return true;
  const compact = examBoard.replace(/_/g, '');
  if (wantsIit && (compact.includes('IIT') || compact.includes('NEET') || compact.includes('JEE'))) {
    return true;
  }
  return scope.includes('ASLI_EXCLUSIVE_SCHOOLS') && compact.includes('ASLI');
}

export function isOwnedGeneratedPracticeExam(exam, userId) {
  return Boolean(
    exam &&
      exam.createdByRole === 'student' &&
      toIdString(exam.practiceOwnerUserId) === toIdString(userId),
  );
}
