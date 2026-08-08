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
import StudentVideoChapterProgress from '../../models/StudentVideoChapterProgress.js';
import Video from '../../models/Video.js';
import Content from '../../models/Content.js';
import OmrResultRow from '../../models/OmrResultRow.js';
import OmrResultBatch from '../../models/OmrResultBatch.js';
import { detectWeakAndStrongTopics } from './weak-topic-detection-engine.js';

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

  const [classDoc, subjects, recentResults, progressRows, sessions30d, learningPaths, risk, recentChats, memory, homeworkRows, videoChapterProgress, omrRows] =
    await Promise.all([
      studentUser.assignedClass ? ClassModel.findById(studentUser.assignedClass).select('classNumber section').lean() : null,
      Array.isArray(studentUser.assignedSubjects) && studentUser.assignedSubjects.length
        ? Subject.find({ _id: { $in: studentUser.assignedSubjects } }).select('name classNumber').lean()
        : [],
      ExamResult.find({ userId: studentOid })
        .select('-answers -questionAnalytics -responses')
        .sort({ completedAt: -1 })
        .limit(20)
        .lean(),
      UserProgress.find({ userId: studentOid })
        .select('userId videoId contentId progress completed lastAccessed updatedAt subjectId')
        .sort({ updatedAt: -1 })
        .limit(120)
        .lean(),
      UserSession.find({ userId: studentOid, date: { $gte: ymd(monthAgo), $lte: today } })
        .select('userId date durationMinutes activeMinutes loginCount')
        .lean(),
      LearningPath.find({ enrolledUsers: studentOid, isPublished: true })
        .select('title subjectIds videoIds difficulty estimatedHours')
        .lean(),
      RiskAnalysisReport.findOne({ studentId: studentOid })
        .select('studentId sentAt isRead pdfFilename')
        .sort({ sentAt: -1 })
        .lean(),
      ChatSession.find({ userId: String(studentOid), role: 'student', archived: false })
        .sort({ updatedAt: -1 })
        .limit(3)
        .select('title updatedAt messageCount')
        .lean(),
      VidyaStudentMemory.findOne({ studentId: studentOid }).lean(),
      HomeworkSubmission.find({ studentId: studentOid }).sort({ submittedAt: -1 }).limit(15).lean(),
      StudentVideoChapterProgress.find({ userId: studentOid })
        .select('userId subjectId chapterId chapterName completed progress updatedAt')
        .sort({ updatedAt: -1 })
        .limit(80)
        .lean(),
      OmrResultRow.find({ userId: studentOid }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

  const omrBatchIds = [...new Set((omrRows || []).map((r) => String(r.batchId)).filter(Boolean))];
  const omrBatches = omrBatchIds.length
    ? await OmrResultBatch.find({ _id: { $in: omrBatchIds } })
        .select('testNo testTitle testDate createdAt')
        .lean()
    : [];
  const omrBatchById = new Map(omrBatches.map((b) => [String(b._id), b]));
  const omrResults = (omrRows || []).map((r) => {
    const batch = omrBatchById.get(String(r.batchId));
    return {
      _id: String(r._id),
      testTitle: batch?.testTitle || 'OMR test',
      testNo: batch?.testNo || '',
      testDate: batch?.testDate || null,
      percentage: r.percentage,
      totalMarks: r.totalMarks,
      totalQuestions: r.totalQuestions,
      attempted: r.attempted,
      correct: r.correct,
      wrong: r.wrong,
      left: r.left,
      testRank: r.testRank,
      finalRank: r.finalRank,
      maths: r.maths || {},
      physics: r.physics || {},
      chemistry: r.chemistry || {},
      biology: r.biology || {},
    };
  });

  const videoIds = [
    ...new Set(
      progressRows
        .map((r) => (r?.videoId ? String(r.videoId) : ''))
        .filter(Boolean),
    ),
  ].slice(0, 80);
  const contentIds = [
    ...new Set(
      progressRows
        .map((r) => (r?.contentId && !r?.videoId ? String(r.contentId) : ''))
        .filter(Boolean),
    ),
  ].slice(0, 80);
  const chapterSubjectIds = [
    ...new Set(videoChapterProgress.map((r) => (r?.subjectId ? String(r.subjectId) : '')).filter(Boolean)),
  ];

  const [videos, contents, chapterSubjects] = await Promise.all([
    videoIds.length
      ? Video.find({ _id: { $in: videoIds } }).select('title subjectId').lean()
      : [],
    contentIds.length
      ? Content.find({ _id: { $in: contentIds } }).select('title').lean()
      : [],
    chapterSubjectIds.length
      ? Subject.find({ _id: { $in: chapterSubjectIds } }).select('name').lean()
      : [],
  ]);

  const videoTitleById = Object.fromEntries(
    (videos || []).map((v) => [String(v._id), String(v.title || '').trim() || 'Video']),
  );
  const contentTitleById = Object.fromEntries(
    (contents || []).map((c) => [String(c._id), String(c.title || '').trim() || 'Content']),
  );
  const subjectNameById = Object.fromEntries([
    ...(subjects || []).map((s) => [String(s._id), String(s.name || '').trim()]),
    ...(chapterSubjects || []).map((s) => [String(s._id), String(s.name || '').trim()]),
  ].filter(([, name]) => Boolean(name)));

  const weakTopics = detectWeakAndStrongTopics({
    exams: { recentResults },
  });

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
    omr: {
      recentResults: omrResults,
      count: omrResults.length,
    },
    academics: {
      progressRows,
      learningPaths,
      homeworkRows,
      videoChapterProgress,
      videoTitleById,
      contentTitleById,
      subjectNameById,
    },
    attendance: {
      sessions30d,
    },
    risk: risk?.analysisData || null,
    weakTopics,
    chats: recentChats,
    memory: memory || null,
  };
}

