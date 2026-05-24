/**
 * Single round-trip payload for student dashboard initial load.
 * @module services/student-dashboard-bootstrap
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import Subject from '../models/Subject.js';
import Teacher from '../models/Teacher.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import Content from '../models/Content.js';
import { resolveUserDisplayBoard } from '../constants/boards.js';
import { filterToActiveCatalogSubjectIds } from '../utils/activeCatalog.js';
import { resolveSubjectContentIds, resolveSubjectContentIdsMany } from '../utils/resolveSubjectContentIds.js';
import {
  loadStudentLibraryContents,
  resolveStudentSubjectIdsForLibrary,
  resolveStudentContentBoard,
} from '../utils/studentLibraryContents.js';
import { resolveIsAsliPrepExclusive } from '../utils/schoolProgram.js';
import { resolveStudentClassNumber } from '../utils/studentClassContent.js';
import { enrichSubjectsWithMedia } from './student-subject-media.js';

async function resolveStudentClassDoc(student) {
  const Class = (await import('../models/Class.js')).default;
  if (student.assignedClass) {
    if (typeof student.assignedClass === 'object' && student.assignedClass._id) {
      if (student.assignedClass.assignedSubjects !== undefined) {
        return student.assignedClass;
      }
      return Class.findById(student.assignedClass._id).populate('assignedSubjects');
    }
    return Class.findById(student.assignedClass).populate('assignedSubjects');
  }
  const aid = student.assignedAdmin?._id || student.assignedAdmin;
  if (student.classNumber && student.classNumber !== 'Unassigned' && aid) {
    return Class.findOne({
      classNumber: student.classNumber,
      assignedAdmin: aid,
      isActive: true,
    }).populate('assignedSubjects');
  }
  return null;
}

function serializeStudentUser(user, displayBoard, isAsliPrepExclusive) {
  return {
    id: user._id,
    _id: user._id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    classNumber: user.classNumber,
    section:
      user.assignedClass?.section != null && String(user.assignedClass.section).trim() !== ''
        ? String(user.assignedClass.section).trim()
        : '',
    phone: user.phone || '',
    age: user.age ?? 18,
    educationStream: user.educationStream || '',
    board: displayBoard,
    overallProgress: user.overallProgress ?? null,
    studyStreak: user.studyStreak || { current: 0, longest: 0, lastActiveDate: '' },
    isAsliPrepExclusive,
    assignedAdmin: user.assignedAdmin
      ? {
          _id: user.assignedAdmin._id,
          board: user.assignedAdmin.board,
          schoolName: user.assignedAdmin.schoolName,
          isAsliPrepExclusive: user.assignedAdmin.isAsliPrepExclusive,
        }
      : null,
  };
}

function countContentByType(contents = []) {
  const counts = {
    TextBook: 0,
    Workbook: 0,
    Material: 0,
    Audio: 0,
    Homework: 0,
    Video: 0,
  };
  const keys = Object.keys(counts);
  for (const row of contents) {
    const t = String(row?.type || '').trim();
    if (!t) continue;
    const match = keys.find((k) => k.toLowerCase() === t.toLowerCase());
    if (match) counts[match] += 1;
  }
  return counts;
}

async function loadSubjectsSummary(student, studentClassDoc, adminBoard) {
  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(student, studentClassDoc);
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);
  if (!librarySubjectIds.length) return [];

  const subjects = await Subject.find({
    _id: { $in: librarySubjectIds },
    isActive: true,
    name: { $not: /__deleted__/ },
  })
    .sort({ name: 1 })
    .lean();

  const boardUpper = resolveStudentContentBoard(student, adminBoard);
  const adminId = student.assignedAdmin?._id || student.assignedAdmin;

  const teachers = adminId
    ? await Teacher.find({
        adminId,
        subjects: { $in: subjects.map((s) => s._id) },
        isActive: true,
      })
        .select('_id subjects fullName email phone department qualifications')
        .lean()
    : [];

  const subjectTeachersMap = new Map();
  for (const teacher of teachers) {
    for (const subjId of teacher.subjects || []) {
      const key = String(subjId);
      if (!subjectTeachersMap.has(key)) subjectTeachersMap.set(key, []);
      subjectTeachersMap.get(key).push({
        _id: teacher._id,
        name: teacher.fullName || 'Unknown Teacher',
        email: teacher.email || '',
        phone: teacher.phone || '',
        department: teacher.department || '',
        qualifications: teacher.qualifications || '',
      });
    }
  }

  const allContentIds = await Promise.all(
    subjects.map((s) => resolveSubjectContentIds(s._id, { board: boardUpper })),
  );
  const countPairs = await Promise.all(
    allContentIds.map((ids) =>
      ids.length
        ? Content.countDocuments({ subject: { $in: ids }, isActive: true })
        : Promise.resolve(0),
    ),
  );

  return subjects.map((subject, idx) => {
    const subjectIdStr = String(subject._id);
    const assignedTeachers = subjectTeachersMap.get(subjectIdStr) || [];
    return {
      _id: subject._id,
      id: subjectIdStr,
      name: subject.name,
      description: subject.description || '',
      board: subject.board,
      code: subject.code || '',
      teachers: assignedTeachers,
      teacherCount: assignedTeachers.length,
      contentCount: countPairs[idx] || 0,
    };
  });
}

async function loadStudentQuizzes(userId, student) {
  if (!student?.assignedClass?._id) return [];
  const classId = student.assignedClass._id || student.assignedClass;
  const quizzes = await Assessment.find({
    assignedClasses: classId,
    isPublished: true,
  })
    .populate('subjectIds', 'name')
    .select(
      'title description difficulty duration totalPoints questions attempts createdAt subjectIds',
    )
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return quizzes.map((quiz) => {
    const attempt = (quiz.attempts || []).find(
      (a) => a.user && String(a.user) === String(userId),
    );
    return {
      _id: quiz._id,
      title: quiz.title,
      description: quiz.description,
      subject: quiz.subjectIds?.[0]?.name || 'Unknown',
      difficulty: quiz.difficulty,
      duration: quiz.duration,
      totalPoints: quiz.totalPoints,
      questionCount: quiz.questions?.length || 0,
      createdAt: quiz.createdAt,
      attempted: Boolean(attempt),
      score: attempt?.score ?? null,
      completed: attempt?.completed ?? false,
    };
  });
}

/**
 * @param {string} userId
 */
export async function buildStudentDashboardBootstrap(userId) {
  const student = await User.findById(userId)
    .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive schoolName')
    .populate('assignedClass', 'classNumber section assignedSubjects')
    .select('-password')
    .lean();

  if (!student || student.role !== 'student') {
    return { ok: false, status: 404, message: 'Student not found' };
  }

  const studentClassDoc = await resolveStudentClassDoc(student);
  const adminBoard =
    student.assignedAdmin?.board ||
    (student.assignedAdmin
      ? (await User.findById(student.assignedAdmin).select('board').lean())?.board
      : null) ||
    student.board;

  const displayBoard = resolveUserDisplayBoard(student, student.assignedAdmin);
  const isAsliPrepExclusive = resolveIsAsliPrepExclusive(student, student.assignedAdmin);
  const user = serializeStudentUser(student, displayBoard, isAsliPrepExclusive);

  const [libraryBundle, subjectRows, quizzes, examCount, examResultCount] = await Promise.all([
    loadStudentLibraryContents(userId, student, studentClassDoc, adminBoard),
    loadSubjectsSummary(student, studentClassDoc, adminBoard),
    loadStudentQuizzes(userId, student),
    Exam.countDocuments({ isPublished: true }).catch(() => 0),
    ExamResult.countDocuments({ student: userId }).catch(() => 0),
  ]);

  const subjects = await enrichSubjectsWithMedia(student, subjectRows);
  const previewVideos = subjects
    .flatMap((s) => (Array.isArray(s.videos) ? s.videos : []))
    .slice(0, 12);

  const contents = libraryBundle.contents || [];
  const contentTypeCounts = countContentByType(contents);
  const streak = user.studyStreak?.current || 0;

  return {
    ok: true,
    user,
    subjects,
    previewVideos,
    contents,
    contentTypeCounts,
    quizzes,
    stats: {
      examCount,
      examResultCount,
      totalContent: contents.length,
      subjectCount: subjects.length,
      quizCount: quizzes.length,
    },
    studyStreak:
      streak > 0
        ? {
            count: streak,
            message: `You're on a ${streak}-day streak!`,
          }
        : null,
    studentClassNumber: resolveStudentClassNumber(student, studentClassDoc) || '',
  };
}
