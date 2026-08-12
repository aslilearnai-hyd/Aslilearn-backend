/**
 * Audience + schedule visibility for the Quiz module (IQRankQuiz).
 */

import { isTrialQuizAudience } from './individualAccount.js';

function toIdString(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function normalizeClassNumber(raw) {
  if (raw == null) return '';
  return String(raw).replace(/^Class\s+/i, '').trim();
}

function audienceRolesOf(quiz) {
  const roles = Array.isArray(quiz?.audienceRoles) ? quiz.audienceRoles.map(String) : [];
  if (roles.length === 0) return ['student'];
  return roles;
}

function resolveAudienceType(quiz) {
  if (quiz?.audienceType) return String(quiz.audienceType);
  if (quiz?.trialOnly) return 'trial';
  return 'all_schools';
}

/** Whether schedule allows showing this quiz today (once = always). */
export function quizMatchesSchedule(quiz, now = new Date()) {
  const schedule = String(quiz?.scheduleType || 'once').toLowerCase();
  if (schedule === 'once' || schedule === 'daily') return true;
  if (schedule !== 'weekly') return true;
  const days = Array.isArray(quiz?.scheduleDays) ? quiz.scheduleDays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
  if (days.length === 0) return true;
  return days.includes(now.getDay());
}

/**
 * @param {object} quiz
 * @param {{
 *   role: 'student'|'teacher',
 *   userId: string,
 *   schoolAdminId?: string|null,
 *   classNumber?: string|null,
 *   user?: object,
 * }} viewer
 */
export function quizVisibleToViewer(quiz, viewer) {
  if (!quiz || quiz.isActive === false) return false;
  if (!quizMatchesSchedule(quiz)) return false;

  const role = viewer?.role === 'teacher' ? 'teacher' : 'student';
  if (!audienceRolesOf(quiz).includes(role)) return false;

  const audience = resolveAudienceType(quiz);
  const userId = toIdString(viewer?.userId);
  const schoolId = toIdString(viewer?.schoolAdminId);
  const classNumber = normalizeClassNumber(viewer?.classNumber);
  const quizClass = normalizeClassNumber(quiz.classNumber);
  const classOk =
    !quizClass ||
    quizClass.toLowerCase() === 'all' ||
    quizClass === '*' ||
    (classNumber && classNumber === quizClass);

  if (audience === 'trial' || quiz.trialOnly === true) {
    if (role !== 'student') return false;
    if (!viewer?.user || !isTrialQuizAudience(viewer.user)) return false;
    return true;
  }

  if (audience === 'specific_members') {
    const ids = Array.isArray(quiz.targetUserIds)
      ? quiz.targetUserIds.map(toIdString).filter(Boolean)
      : [];
    return Boolean(userId && ids.includes(userId));
  }

  if (audience === 'all_members') {
    return classOk;
  }

  if (audience === 'schools') {
    const targets = Array.isArray(quiz.targetSchools)
      ? quiz.targetSchools.map(toIdString).filter(Boolean)
      : [];
    if (!schoolId || targets.length === 0 || !targets.includes(schoolId)) return false;
    return classOk;
  }

  // all_schools (legacy): class match for school users; hide pure trial quizzes
  if (quiz.trialOnly === true) return false;
  return classOk;
}

export function buildQuizViewerFromStudent(student) {
  let classNumber = null;
  if (student?.assignedClass?.classNumber) {
    classNumber = String(student.assignedClass.classNumber);
  } else if (student?.classNumber) {
    classNumber = normalizeClassNumber(student.classNumber);
  }
  const schoolAdminId =
    student?.assignedAdmin ||
    student?.adminId ||
    student?.schoolAdminId ||
    (typeof student?.assignedClass === 'object' ? student.assignedClass?.assignedAdmin : null);

  return {
    role: 'student',
    userId: toIdString(student?._id),
    schoolAdminId: toIdString(schoolAdminId),
    classNumber,
    user: student,
  };
}

export function buildQuizViewerFromTeacher(teacher) {
  const schoolAdminId = teacher?.adminId || teacher?.assignedAdmin || teacher?.schoolAdminId;
  return {
    role: 'teacher',
    userId: toIdString(teacher?._id || teacher?.userId),
    schoolAdminId: toIdString(schoolAdminId),
    classNumber: normalizeClassNumber(teacher?.classNumber) || 'all',
    user: teacher,
  };
}

export function normalizeQuizAudienceFields(body = {}) {
  const audienceTypeRaw = String(body.audienceType || '').trim();
  let audienceType = [
    'all_schools',
    'schools',
    'trial',
    'all_members',
    'specific_members',
  ].includes(audienceTypeRaw)
    ? audienceTypeRaw
    : body.trialOnly
      ? 'trial'
      : 'all_schools';

  const scheduleTypeRaw = String(body.scheduleType || body.type || '').trim().toLowerCase();
  let scheduleType = ['once', 'daily', 'weekly'].includes(scheduleTypeRaw)
    ? scheduleTypeRaw
    : scheduleTypeRaw === 'daily-quiz'
      ? 'daily'
      : scheduleTypeRaw === 'weekly-quiz'
        ? 'weekly'
        : 'once';

  // Map legacy activity types used as schedule hints
  if (body.type === 'daily') scheduleType = 'daily';
  if (body.type === 'weekly') scheduleType = 'weekly';

  // Quizzes are for students / trial members only — never teachers.
  const audienceRoles = ['student'];

  const targetSchools = Array.isArray(body.targetSchools)
    ? body.targetSchools.filter(Boolean)
    : [];
  const targetUserIds = Array.isArray(body.targetUserIds)
    ? body.targetUserIds.filter(Boolean)
    : [];

  const scheduleDays = Array.isArray(body.scheduleDays)
    ? body.scheduleDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    : [];

  const trialOnly = audienceType === 'trial' || Boolean(body.trialOnly);

  return {
    audienceType,
    scheduleType,
    scheduleDays,
    audienceRoles: audienceRoles.length ? audienceRoles : ['student'],
    targetSchools,
    targetUserIds,
    trialOnly,
    promptOnLogin: trialOnly ? Boolean(body.promptOnLogin) : false,
  };
}
