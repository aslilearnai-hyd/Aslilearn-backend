import mongoose from 'mongoose';
import ExamResult from '../models/ExamResult.js';
import Exam from '../models/Exam.js';
import UserProgress from '../models/UserProgress.js';
import LearningPath from '../models/LearningPath.js';
import User from '../models/User.js';
import ChatSession from '../models/ChatSession.js';
import VidyaCallLog from '../models/VidyaCallLog.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import AiContentEngineSource from '../models/AiContentEngineSource.js';
import AiContentEngineChunk from '../models/AiContentEngineChunk.js';

const safeObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch (_) {
    return null;
  }
};

const formatDate = (d) => {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch (_) {
    return '';
  }
};

const summariseLastExam = async (userObjectId) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await ExamResult.findOne({
    userId: userObjectId,
    completedAt: { $gte: sevenDaysAgo },
  })
    .sort({ completedAt: -1 })
    .lean()
    .catch(() => null);
  if (!result) return null;

  const weakTopics = new Set();
  const missedQuestions = [];
  if (Array.isArray(result.questionAnalytics)) {
    for (const q of result.questionAnalytics) {
      if (q?.status === 'wrong' || q?.status === 'not_answered') {
        if (q.chapter) weakTopics.add(q.chapter);
        missedQuestions.push({
          subject: q.subject || '',
          chapter: q.chapter || '',
          difficulty: q.difficulty || '',
        });
      }
    }
  }

  const subjects = [];
  if (result.subjectWiseScore && typeof result.subjectWiseScore === 'object') {
    for (const [name, value] of Object.entries(result.subjectWiseScore)) {
      const correct = Number(value?.correct || 0);
      const total = Number(value?.total || 0);
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
      subjects.push({ name, correct, total, pct });
    }
  }

  return {
    examId: String(result.examId || ''),
    title: result.examTitle || '',
    subject: subjects.find((s) => s.pct < 60)?.name || '',
    scorePct: typeof result.percentage === 'number' ? Math.round(result.percentage) : null,
    dateLabel: formatDate(result.completedAt),
    weakTopics: Array.from(weakTopics).slice(0, 6),
    missedQuestions: missedQuestions.slice(0, 8),
    subjects,
  };
};

const summariseRecentProgress = async (userObjectId) => {
  const rows = await UserProgress.find({ userId: userObjectId })
    .sort({ lastAccessed: -1, updatedAt: -1 })
    .limit(5)
    .populate('contentId', 'title subject topic')
    .lean()
    .catch(() => []);
  return rows
    .map((r) => {
      const c = r.contentId || {};
      return {
        subject: c.subject || '',
        topic: c.topic || c.title || '',
        progressPercent: typeof r.progress === 'number' ? r.progress : 0,
        completed: Boolean(r.completed),
        lastAccessed: formatDate(r.lastAccessed),
      };
    })
    .filter((r) => r.subject || r.topic);
};

const summariseActiveLearningPath = async (userObjectId) => {
  const lp = await LearningPath.findOne({ enrolledUsers: userObjectId, isPublished: true })
    .sort({ updatedAt: -1 })
    .lean()
    .catch(() => null);
  if (!lp) return '';
  return lp.title || '';
};

export const buildRecentActivity = async (userId) => {
  if (!userId) return null;
  const objectId = safeObjectId(userId);
  if (!objectId) return null;
  try {
    const [lastExam, recentProgress, activeLearningPath] = await Promise.all([
      summariseLastExam(objectId),
      summariseRecentProgress(objectId),
      summariseActiveLearningPath(objectId),
    ]);
    if (!lastExam && !recentProgress.length && !activeLearningPath) {
      return null;
    }
    return { lastExam, recentProgress, activeLearningPath };
  } catch (err) {
    console.warn('buildRecentActivity failed:', err.message);
    return null;
  }
};

export const buildUserProfileSnapshot = async (userId) => {
  if (!userId) return null;
  const objectId = safeObjectId(userId);
  if (!objectId) return null;
  try {
    const u = await User.findById(objectId)
      .select('fullName role classNumber assignedClass assignedSubjects board schoolName')
      .lean();
    if (!u) return null;
    return {
      studentName: u.fullName || '',
      role: u.role || 'student',
      classLevel: u.classNumber && u.classNumber !== 'Unassigned' ? u.classNumber : '',
      board: u.board || '',
      schoolName: u.schoolName || '',
    };
  } catch (err) {
    console.warn('buildUserProfileSnapshot failed:', err.message);
    return null;
  }
};

/**
 * Read-only aggregates from MongoDB injected into Vidya’s system prompt for admins.
 * This is NOT “Gemini accessing all tables” — the backend runs fixed, safe count queries
 * and passes the numbers to the model so it does not invent platform stats.
 */
export const buildPlatformSnapshotForVidya = async ({ viewerRole, viewerUserId }) => {
  const role = String(viewerRole || '').toLowerCase();
  const viewerOid = safeObjectId(viewerUserId);
  if (!viewerOid) return null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    if (role === 'super-admin') {
      const [
        usersByRole,
        totalUsers,
        totalExams,
        examResults30d,
        learningPaths,
        chatSessions,
        vidyaCalls7d,
        aiGenerations,
        pdfSources,
        pdfChunks,
      ] = await Promise.all([
        User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]).catch(() => []),
        User.estimatedDocumentCount().catch(() => 0),
        Exam.estimatedDocumentCount().catch(() => 0),
        ExamResult.countDocuments({ completedAt: { $gte: thirtyDaysAgo } }).catch(() => 0),
        LearningPath.countDocuments({ isPublished: true }).catch(() => 0),
        ChatSession.estimatedDocumentCount().catch(() => 0),
        VidyaCallLog.countDocuments({ ts: { $gte: sevenDaysAgo } }).catch(() => 0),
        AiToolGeneration.estimatedDocumentCount().catch(() => 0),
        AiContentEngineSource.countDocuments({ archived: { $ne: true } }).catch(() => 0),
        AiContentEngineChunk.estimatedDocumentCount().catch(() => 0),
      ]);

      const roleMap = Object.fromEntries(
        (usersByRole || []).map((r) => [String(r._id || 'unknown'), r.count || 0])
      );

      return {
        scope: 'platform',
        generatedAt: new Date().toISOString(),
        users: {
          totalEstimated: totalUsers,
          byRole: {
            student: roleMap.student || 0,
            teacher: roleMap.teacher || 0,
            admin: roleMap.admin || 0,
            'super-admin': roleMap['super-admin'] || 0,
            other: Object.entries(roleMap).reduce((acc, [k, v]) => {
              if (!['student', 'teacher', 'admin', 'super-admin'].includes(k)) acc += v;
              return acc;
            }, 0),
          },
        },
        content: {
          examsTotalEstimated: totalExams,
          examResultsSubmittedLast30Days: examResults30d,
          publishedLearningPaths: learningPaths,
          aiToolGenerationRowsEstimated: aiGenerations,
          pdfSourcesActive: pdfSources,
          pdfChunksEstimated: pdfChunks,
        },
        vidya: {
          chatSessionsEstimated: chatSessions,
          apiCallsLast7Days: vidyaCalls7d,
        },
        note: 'Counts are database aggregates for internal ops. User total may differ slightly from sum-by-role if legacy rows exist. Do not expose individual PII.',
      };
    }

    if (role === 'admin' || role === 'school-admin') {
      const studentFilter = { role: 'student', assignedAdmin: viewerOid };
      const [studentCount, activeStudents7d, studentIds] = await Promise.all([
        User.countDocuments(studentFilter).catch(() => 0),
        User.countDocuments({ ...studentFilter, lastLogin: { $gte: sevenDaysAgo } }).catch(() => 0),
        User.find(studentFilter).distinct('_id').catch(() => []),
      ]);
      const examCount =
        Array.isArray(studentIds) && studentIds.length
          ? await ExamResult.countDocuments({
              userId: { $in: studentIds },
              completedAt: { $gte: thirtyDaysAgo },
            }).catch(() => 0)
          : 0;

      const adminProfile = await User.findById(viewerOid).select('schoolName place').lean().catch(() => null);

      return {
        scope: 'school',
        schoolLabel: adminProfile?.schoolName || adminProfile?.place || 'Your school',
        generatedAt: new Date().toISOString(),
        users: {
          studentsUnderThisAdmin: studentCount,
          studentsActiveLast7Days: activeStudents7d,
        },
        activity: {
          examResultsByYourStudentsLast30Days: examCount,
        },
        note: 'Scoped to students assigned to this school admin. Teacher counts need the admin dashboard. No individual student names here.',
      };
    }

    return null;
  } catch (err) {
    console.warn('buildPlatformSnapshotForVidya failed:', err.message);
    return null;
  }
};

export default { buildRecentActivity, buildUserProfileSnapshot, buildPlatformSnapshotForVidya };
