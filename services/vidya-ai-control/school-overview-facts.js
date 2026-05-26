import mongoose from 'mongoose';
import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import ClassModel from '../../models/Class.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import StudentRemark from '../../models/StudentRemark.js';
import UserSession from '../../models/UserSession.js';
import { istYmd } from './ist-time.js';

function oid(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

/**
 * Dashboard-style metrics for "reports overview" / school summary questions.
 */
export async function buildControlOverviewFacts({ viewerRole, viewerUserId }) {
  const role = String(viewerRole || '').toLowerCase();
  const viewerOid = oid(viewerUserId);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const ymd = istYmd(new Date());

  if (role === 'super-admin') {
    const [
      students,
      teachers,
      admins,
      classes,
      exams,
      examResults30d,
      remarks,
      sessionsToday,
    ] = await Promise.all([
      User.countDocuments({ role: 'student' }).catch(() => 0),
      Teacher.countDocuments({ isActive: true }).catch(() => 0),
      User.countDocuments({ role: 'admin' }).catch(() => 0),
      ClassModel.estimatedDocumentCount().catch(() => 0),
      Exam.countDocuments({ isActive: true }).catch(() => 0),
      ExamResult.countDocuments({ completedAt: { $gte: thirtyDaysAgo } }).catch(() => 0),
      StudentRemark.estimatedDocumentCount().catch(() => 0),
      UserSession.countDocuments({ date: ymd }).catch(() => 0),
    ]);

    return {
      operation: 'overview',
      scope: 'platform',
      schoolLabel: 'All schools (platform)',
      overview: {
        students,
        teachers,
        schoolAdmins: admins,
        classes,
        activeExams: exams,
        examResultsLast30Days: examResults30d,
        teacherRemarks: remarks,
        loginSessionsToday: sessionsToday,
      },
    };
  }

  if (role === 'admin') {
    if (!viewerOid) {
      return {
        operation: 'overview',
        scope: 'school',
        schoolLabel: 'Your school',
        overview: {},
        error: 'Could not resolve school scope for this admin account.',
      };
    }

    const studentFilter = { role: 'student', assignedAdmin: viewerOid };
    const adminProfile = await User.findById(viewerOid).select('schoolName place').lean().catch(() => null);
    const studentIds = await User.find(studentFilter).distinct('_id').catch(() => []);

    const [
      students,
      activeStudents7d,
      teachers,
      classes,
      exams,
      examResults30d,
      remarks,
      sessionsToday,
    ] = await Promise.all([
      User.countDocuments(studentFilter).catch(() => 0),
      User.countDocuments({ ...studentFilter, lastLogin: { $gte: sevenDaysAgo } }).catch(() => 0),
      Teacher.countDocuments({ adminId: viewerOid, isActive: true }).catch(() => 0),
      ClassModel.countDocuments({ assignedAdmin: viewerOid }).catch(() => 0),
      Exam.countDocuments({
        $or: [{ adminId: viewerOid }, { schoolId: viewerOid }],
        isActive: true,
      }).catch(() => 0),
      studentIds.length
        ? ExamResult.countDocuments({
            userId: { $in: studentIds },
            completedAt: { $gte: thirtyDaysAgo },
          }).catch(() => 0)
        : Promise.resolve(0),
      studentIds.length
        ? StudentRemark.countDocuments({ studentId: { $in: studentIds } }).catch(() => 0)
        : Promise.resolve(0),
      studentIds.length
        ? UserSession.countDocuments({ userId: { $in: studentIds }, date: ymd }).catch(() => 0)
        : Promise.resolve(0),
    ]);

    return {
      operation: 'overview',
      scope: 'school',
      schoolLabel: adminProfile?.schoolName || adminProfile?.place || 'Your school',
      overview: {
        students,
        studentsActiveLast7Days: activeStudents7d,
        teachers,
        classes,
        activeExams: exams,
        examResultsLast30Days: examResults30d,
        teacherRemarks: remarks,
        loginSessionsToday: sessionsToday,
      },
    };
  }

  return {
    operation: 'overview',
    scope: 'unknown',
    schoolLabel: '',
    overview: {},
    error: 'Overview is available for school admins and super admins only.',
  };
}

export function isReportsOverviewQuery(message) {
  const lower = String(message || '').toLowerCase();
  return /(reports?\s+overview|overview\s+(of\s+)?(the\s+)?reports?|show\s+(me\s+)?(the\s+)?reports?\s+overview|dashboard\s+overview|school\s+(reports?\s+)?overview|reports?\s+summary|attendance\s+(and\s+)?performance\s+overview)/i.test(
    lower
  );
}
