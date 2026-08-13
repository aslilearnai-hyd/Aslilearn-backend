import mongoose from 'mongoose';
import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import ClassModel from '../../models/Class.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import StudentRemark from '../../models/StudentRemark.js';
import UserSession from '../../models/UserSession.js';
import School from '../../models/School.js';
import OmrResultBatch from '../../models/OmrResultBatch.js';
import OmrResultRow from '../../models/OmrResultRow.js';
import Assessment from '../../models/Assessment.js';
import HomeworkSubmission from '../../models/HomeworkSubmission.js';
import Video from '../../models/Video.js';
import Content from '../../models/Content.js';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import { istYmd } from './ist-time.js';

function oid(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pull a school name from prompts like:
 * "details about test school", "school named X", "find school X"
 */
export function extractSchoolNameQuery(message) {
  const raw = String(message || '').trim();
  if (!raw) return '';

  const patterns = [
    /(?:details?|info(?:rmation)?|overview)\s+(?:about|on|for)\s+(?:the\s+)?(.+?)\s+school\b/i,
    /\b(?:about|for)\s+(?:the\s+)?(.+?)\s+school\b/i,
    /\bschool\s+(?:named|called)\s+["']?([^"'?\n.]+)["']?/i,
    /\b(?:find|search|look\s*up|show|get)\s+(?:me\s+)?(?:the\s+)?school\s+["']?([^"'?\n.]+)["']?/i,
    /\bi\s+need\s+(?:details?|info(?:rmation)?)\s+(?:about|on|for)\s+(.+?)(?:\s+school)?\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    let name = String(match[1])
      .replace(/["']/g, '')
      .replace(/\b(the|a|an)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    name = name.replace(/\bschool\b$/i, '').trim();
    if (!name || /^(all|every|each|any|this|that|my|our)$/i.test(name)) continue;
    if (name.length < 2) continue;
    return name.slice(0, 80);
  }
  return '';
}

export function isSchoolDetailQuery(message) {
  const lower = String(message || '').toLowerCase();
  if (!/(school|schools)/i.test(lower)) return false;
  if (/(how many|count|total|number of|are there)/i.test(lower)) return false;
  return Boolean(extractSchoolNameQuery(message));
}

async function metricsForAdminOid(adminOid, schoolLabel) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ymd = istYmd(new Date());
  const studentFilter = { role: 'student', assignedAdmin: adminOid };
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
    omrBatches,
    omrRows,
    assessments,
    homeworkSubs,
    videos,
    homeworkAssigned,
    riskReports,
  ] = await Promise.all([
    User.countDocuments(studentFilter).catch(() => 0),
    User.countDocuments({ ...studentFilter, lastLogin: { $gte: sevenDaysAgo } }).catch(() => 0),
    Teacher.countDocuments({ adminId: adminOid, isActive: true }).catch(() => 0),
    ClassModel.countDocuments({ assignedAdmin: adminOid }).catch(() => 0),
    Exam.countDocuments({
      $or: [{ adminId: adminOid }, { schoolId: adminOid }, { targetSchools: adminOid }],
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
    OmrResultBatch.countDocuments({ adminId: adminOid }).catch(() => 0),
    OmrResultRow.countDocuments({ adminId: adminOid }).catch(() => 0),
    Assessment.countDocuments({
      $or: [{ adminId: adminOid }, { createdBy: adminOid }],
      isPublished: true,
    }).catch(() => 0),
    studentIds.length
      ? HomeworkSubmission.countDocuments({ studentId: { $in: studentIds } }).catch(() => 0)
      : Promise.resolve(0),
    Video.countDocuments({ adminId: adminOid, isPublished: true, isActive: true }).catch(() => 0),
    Content.countDocuments({
      type: 'Homework',
      isActive: true,
      $or: [{ createdBy: adminOid }, { teacherId: { $exists: true } }],
    }).catch(() => 0),
    RiskAnalysisReport.countDocuments({
      $or: [{ adminId: adminOid }, { studentId: { $in: studentIds } }],
    }).catch(() => 0),
  ]);

  return {
    schoolLabel,
    overview: {
      students,
      studentsActiveLast7Days: activeStudents7d,
      teachers,
      classes,
      activeExams: exams,
      examResultsLast30Days: examResults30d,
      teacherRemarks: remarks,
      loginSessionsToday: sessionsToday,
      omrBatches,
      omrResultRows: omrRows,
      publishedAssessments: assessments,
      homeworkSubmissions: homeworkSubs,
      publishedVideos: videos,
      homeworkContentApprox: homeworkAssigned,
      riskReports,
    },
  };
}

/**
 * Lookup a school by name and return profile + live scoped metrics.
 * School admins only see schools they administer.
 */
export async function buildNamedSchoolDetailFacts(schoolNameQuery, viewer = {}) {
  const q = String(schoolNameQuery || '').trim();
  const viewerRole = String(viewer?.viewerRole || '').toLowerCase();
  const viewerOid = oid(viewer?.viewerUserId);
  if (!q) {
    return {
      operation: 'overview',
      scope: 'school_lookup',
      schoolLabel: '',
      overview: {},
      error: 'No school name was detected in the question.',
      searchQuery: '',
    };
  }

  const regex = new RegExp(escapeRegex(q), 'i');
  let matches = await School.find({ name: regex })
    .select(
      'name place phone contactPerson board curriculumBoard isAsliPrepExclusive licensedStudents licensedTeachers isActive adminUserId schoolDetails',
    )
    .limit(8)
    .lean()
    .catch(() => []);

  if (!matches.length) {
    const adminMatches = await User.find({
      role: 'admin',
      schoolName: regex,
    })
      .select('_id schoolName place phone contactPerson board email isActive')
      .limit(8)
      .lean()
      .catch(() => []);

    matches = adminMatches.map((a) => ({
      _id: a._id,
      name: a.schoolName || a.email,
      place: a.place || '',
      phone: a.phone || '',
      contactPerson: a.contactPerson || '',
      board: a.board || '',
      curriculumBoard: '',
      isAsliPrepExclusive: false,
      licensedStudents: null,
      licensedTeachers: null,
      isActive: a.isActive !== false,
      adminUserId: a._id,
      _fromAdminFallback: true,
    }));
  }

  if (viewerRole === 'admin' && viewerOid) {
    matches = matches.filter((s) => String(s.adminUserId || '') === String(viewerOid));
  }

  if (!matches.length) {
    return {
      operation: 'overview',
      scope: 'school_lookup',
      schoolLabel: q,
      overview: {},
      searchQuery: q,
      candidates: [],
      error:
        viewerRole === 'admin'
          ? `No school matched "${q}" in your school scope.`
          : `No school matched "${q}". Try a shorter or partial name.`,
    };
  }

  if (matches.length > 1) {
    return {
      operation: 'overview',
      scope: 'school_lookup',
      schoolLabel: q,
      searchQuery: q,
      candidates: matches.map((s) => ({
        id: String(s._id),
        name: s.name,
        place: s.place || '',
        board: s.board || s.curriculumBoard || '',
        isActive: s.isActive !== false,
      })),
      overview: {},
      error: `Found ${matches.length} schools matching "${q}". Ask again with a more specific name.`,
    };
  }

  const school = matches[0];
  const adminOid = oid(school.adminUserId) || (school._fromAdminFallback ? oid(school._id) : null);
  const profile = {
    name: school.name,
    place: school.place || '',
    phone: school.phone || '',
    contactPerson: school.contactPerson || '',
    board: school.board || '',
    curriculumBoard: school.curriculumBoard || '',
    isAsliPrepExclusive: Boolean(school.isAsliPrepExclusive),
    licensedStudents: school.licensedStudents,
    licensedTeachers: school.licensedTeachers,
    isActive: school.isActive !== false,
    classesFrom: school.schoolDetails?.classesFrom || '',
    classesTo: school.schoolDetails?.classesTo || '',
    schoolType: school.schoolDetails?.schoolType || '',
  };

  if (!adminOid) {
    return {
      operation: 'overview',
      scope: 'school_lookup',
      schoolLabel: school.name,
      searchQuery: q,
      profile,
      overview: {},
      error: 'School profile found, but no linked school admin account was available for live metrics.',
    };
  }

  const metrics = await metricsForAdminOid(adminOid, school.name);
  return {
    operation: 'overview',
    scope: 'school_lookup',
    schoolLabel: school.name,
    searchQuery: q,
    profile,
    overview: metrics.overview,
  };
}

/**
 * Dashboard-style metrics for "reports overview" / school summary questions.
 */
export async function buildControlOverviewFacts({ viewerRole, viewerUserId }) {
  const role = String(viewerRole || '').toLowerCase();
  const viewerOid = oid(viewerUserId);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ymd = istYmd(new Date());

  if (role === 'super-admin') {
    const [
      students,
      teachers,
      admins,
      schools,
      classes,
      exams,
      examResults30d,
      remarks,
      sessionsToday,
      trialMembers,
      omrBatches,
      assessments,
      videos,
      homeworkSubs,
      riskReports,
    ] = await Promise.all([
      User.countDocuments({ role: 'student' }).catch(() => 0),
      Teacher.countDocuments({ isActive: true }).catch(() => 0),
      User.countDocuments({ role: 'admin' }).catch(() => 0),
      School.estimatedDocumentCount().catch(() => 0),
      ClassModel.estimatedDocumentCount().catch(() => 0),
      Exam.countDocuments({ isActive: true }).catch(() => 0),
      ExamResult.countDocuments({ completedAt: { $gte: thirtyDaysAgo } }).catch(() => 0),
      StudentRemark.estimatedDocumentCount().catch(() => 0),
      UserSession.countDocuments({ date: ymd }).catch(() => 0),
      User.countDocuments({ isIndividualAccount: true }).catch(() => 0),
      OmrResultBatch.estimatedDocumentCount().catch(() => 0),
      Assessment.countDocuments({ isPublished: true }).catch(() => 0),
      Video.countDocuments({ isPublished: true, isActive: true }).catch(() => 0),
      HomeworkSubmission.estimatedDocumentCount().catch(() => 0),
      RiskAnalysisReport.estimatedDocumentCount().catch(() => 0),
    ]);

    return {
      operation: 'overview',
      scope: 'platform',
      schoolLabel: 'All schools (platform)',
      overview: {
        schools,
        students,
        teachers,
        schoolAdmins: admins,
        classes,
        activeExams: exams,
        examResultsLast30Days: examResults30d,
        teacherRemarks: remarks,
        loginSessionsToday: sessionsToday,
        trialMembers,
        omrBatches,
        publishedAssessments: assessments,
        publishedVideos: videos,
        homeworkSubmissions: homeworkSubs,
        riskReports,
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

    const adminProfile = await User.findById(viewerOid)
      .select('schoolName place')
      .lean()
      .catch(() => null);
    const metrics = await metricsForAdminOid(
      viewerOid,
      adminProfile?.schoolName || adminProfile?.place || 'Your school',
    );
    return {
      operation: 'overview',
      scope: 'school',
      schoolLabel: metrics.schoolLabel,
      overview: metrics.overview,
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

/** "How many students and teachers are active?" needs both metrics, not one module. */
export function isHeadcountOverviewQuery(message) {
  const lower = String(message || '').toLowerCase();
  if (/class\s*\d+/i.test(lower)) return false;
  const students = /\bstudents?\b/.test(lower);
  const teachers = /\bteachers?\b/.test(lower);
  const countish = /((how|who)\s*many|count|total|number of|are there|\bactive\b)/i.test(lower);
  return students && teachers && countish;
}
