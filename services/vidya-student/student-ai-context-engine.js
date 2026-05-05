import mongoose from 'mongoose';
import User from '../../models/User.js';
import ClassModel from '../../models/Class.js';
import Subject from '../../models/Subject.js';
import ExamResult from '../../models/ExamResult.js';
import UserProgress from '../../models/UserProgress.js';
import UserSession from '../../models/UserSession.js';
import LearningPath from '../../models/LearningPath.js';
import HomeworkSubmission from '../../models/HomeworkSubmission.js';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import ChatSession from '../../models/ChatSession.js';
import VidyaStudentMemory from '../../models/VidyaStudentMemory.js';
import Teacher from '../../models/Teacher.js';

const safeOid = (id) => {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
};

const ymd = (d) =>
  new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

function roleScopeClause({ viewerRole, viewerUserId, studentUser }) {
  if (viewerRole === 'super-admin') return { ok: true };
  if (viewerRole === 'student') {
    if (String(studentUser._id) !== String(viewerUserId)) {
      return { ok: false, reason: 'Students can only access their own data.' };
    }
    return { ok: true };
  }
  if (viewerRole === 'admin' || viewerRole === 'school-admin') {
    if (String(studentUser.assignedAdmin || '') !== String(viewerUserId)) {
      return { ok: false, reason: 'This student is outside your school scope.' };
    }
    return { ok: true };
  }
  return { ok: true };
}

async function teacherCanAccessStudent(viewerUserId, studentUser) {
  const viewerOid = safeOid(viewerUserId);
  if (!viewerOid) return false;
  // Direct assignment
  if (String(studentUser.assignedTeacher || '') === String(viewerOid)) return true;
  // Teacher-class assignment fallback
  const t = await Teacher.findById(viewerOid).select('assignedClassIds').lean().catch(() => null);
  if (!t) return false;
  const classId = String(studentUser.assignedClass || '');
  return Boolean(classId && Array.isArray(t.assignedClassIds) && t.assignedClassIds.includes(classId));
}

export async function resolveStudentForViewer({
  viewerRole,
  viewerUserId,
  explicitStudentId,
}) {
  const role = String(viewerRole || '').toLowerCase();
  const studentId = explicitStudentId || viewerUserId;
  const studentOid = safeOid(studentId);
  if (!studentOid) return { ok: false, reason: 'Invalid student id.' };

  const studentUser = await User.findById(studentOid)
    .select(
      'fullName role classNumber assignedClass assignedSubjects board schoolName assignedAdmin assignedTeacher studyStreak lastLogin'
    )
    .lean();
  if (!studentUser || studentUser.role !== 'student') {
    return { ok: false, reason: 'Student profile not found.' };
  }

  if (role === 'teacher') {
    const allowed = await teacherCanAccessStudent(viewerUserId, studentUser);
    if (!allowed) return { ok: false, reason: 'This student is outside your class scope.' };
  } else {
    const scoped = roleScopeClause({ viewerRole: role, viewerUserId, studentUser });
    if (!scoped.ok) return scoped;
  }

  return { ok: true, studentUser, studentOid };
}

export async function buildStudentAiContext({
  viewerRole,
  viewerUserId,
  studentId,
}) {
  const resolved = await resolveStudentForViewer({ viewerRole, viewerUserId, explicitStudentId: studentId });
  if (!resolved.ok) return resolved;
  const { studentUser, studentOid } = resolved;

  const today = ymd(new Date());
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [classDoc, subjects, recentResults, progressRows, sessions30d, learningPaths, risk, recentChats, memory, homeworkRows] =
    await Promise.all([
      studentUser.assignedClass ? ClassModel.findById(studentUser.assignedClass).select('classNumber section').lean() : null,
      Array.isArray(studentUser.assignedSubjects) && studentUser.assignedSubjects.length
        ? Subject.find({ _id: { $in: studentUser.assignedSubjects } }).select('name classNumber').lean()
        : [],
      ExamResult.find({ userId: studentOid }).sort({ completedAt: -1 }).limit(20).lean(),
      UserProgress.find({ userId: studentOid }).sort({ updatedAt: -1 }).limit(80).lean(),
      UserSession.find({ userId: studentOid, date: { $gte: ymd(monthAgo), $lte: today } }).lean(),
      LearningPath.find({ enrolledUsers: studentOid, isPublished: true }).select('title subjectIds').lean(),
      RiskAnalysisReport.findOne({ studentId: studentOid }).sort({ sentAt: -1 }).lean(),
      ChatSession.find({ userId: String(studentOid), role: 'student', archived: false })
        .sort({ updatedAt: -1 })
        .limit(3)
        .select('title updatedAt messageCount')
        .lean(),
      VidyaStudentMemory.findOne({ studentId: studentOid }).lean(),
      HomeworkSubmission.find({ studentId: studentOid }).sort({ submittedAt: -1 }).limit(10).lean(),
    ]);

  return {
    ok: true,
    studentId: String(studentOid),
    profile: {
      fullName: studentUser.fullName || 'Student',
      classNumber: classDoc?.classNumber || studentUser.classNumber || '',
      section: classDoc?.section || '',
      board: studentUser.board || '',
      schoolName: studentUser.schoolName || '',
      subjects: subjects.map((s) => s.name).filter(Boolean),
      studyStreak: studentUser.studyStreak || { current: 0, longest: 0, lastActiveDate: '' },
      lastLogin: studentUser.lastLogin || null,
    },
    exams: {
      recentResults,
      testsCompletedCount: recentResults.length,
    },
    academics: {
      progressRows,
      learningPaths,
      homeworkRows,
    },
    attendance: {
      sessions30d,
    },
    risk: risk?.analysisData || null,
    chats: recentChats,
    memory: memory || null,
  };
}

