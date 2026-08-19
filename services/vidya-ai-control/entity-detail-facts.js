/**
 * Named person + class/group fact builders for Control Vidya (admin / super-admin).
 * Multi-collection joins after name/class resolve — same pattern as school_detail.
 */
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import ClassModel from '../../models/Class.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import StudentRemark from '../../models/StudentRemark.js';
import UserSession from '../../models/UserSession.js';
import HomeworkSubmission from '../../models/HomeworkSubmission.js';
import UserProgress from '../../models/UserProgress.js';
import School from '../../models/School.js';
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

function avg(nums) {
  const list = (nums || []).map(Number).filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10;
}

/** Strip titles / punctuation from a spoken name fragment */
function cleanPersonName(raw) {
  return String(raw || '')
    .replace(/["']/g, '')
    .replace(/\b(mr|mrs|ms|miss|dr|sir|madam|student|teacher|admin)\b\.?/gi, ' ')
    .replace(/\b(the|a|an)\b/gi, ' ')
    .replace(/[?.!,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Metric / catalog vocabulary that must never be treated as a person name. */
const PERSON_NAME_STOPWORDS =
  /^(all|every|each|any|this|that|my|our|his|her|their|class|school|students?|teachers?|exams?|results?|how|what|who|which|where|when|why|number|count|total|videos?|assessments?|quizzes?|quiz|published|library|eduott|attendance|homework|subjects?|classes|records?|generations?|analytics|orders?|users?|members?)$/i;

function isLikelyPersonName(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2) return false;
  if (PERSON_NAME_STOPWORDS.test(n)) return false;
  if (/^\d+$/.test(n) || /^class\s*\d+/i.test(n)) return false;
  // Reject multi-word phrases that are clearly metrics ("published videos")
  if (/\b(video|videos|assessment|assessments|quiz|quizzes|count|total|number)\b/i.test(n)) {
    return false;
  }
  return true;
}

/**
 * Extract a person name from control prompts.
 * Returns { name, roleHint: 'student'|'teacher'|'admin'|'' }
 */
export function extractPersonNameQuery(message) {
  const raw = String(message || '').trim();
  if (!raw) return { name: '', roleHint: '' };

  const lower = raw.toLowerCase();
  // Never treat catalog/count prompts as named-person lookups
  if (
    /((how|who)\s*many|number\s+of|count|total)\b/.test(lower) &&
    /\b(videos?|assessments?|quizzes?|students?|teachers?|exams?|schools?)\b/.test(lower)
  ) {
    return { name: '', roleHint: '' };
  }

  let roleHint = '';
  if (/\b(teacher|faculty|staff|sir|madam|mrs|ms|mr)\b/i.test(lower)) roleHint = 'teacher';
  else if (/\b(admin|school\s*admin|principal)\b/i.test(lower)) roleHint = 'admin';
  else if (/\b(student|learner|pupil|kid)\b/i.test(lower)) roleHint = 'student';

  const patterns = [
    /\b(?:how\s+is|how's)\s+([A-Za-z][A-Za-z.'\-\s]{1,60}?)\s+(?:doing|performing|progressing)\b/i,
    /\b(?:tell\s+me\s+about|about|details?\s+(?:about|on|for)|info(?:rmation)?\s+(?:about|on|for)|look\s*up|find)\s+(?:the\s+)?(?:student|teacher|admin|learner)\s+["']?([A-Za-z][A-Za-z.'\-\s]{1,60}?)["']?(?:\s|$|\?|,)/i,
    /\b(?:tell\s+me\s+about|about|details?\s+(?:about|on|for)|info(?:rmation)?\s+(?:about|on|for)|look\s*up)\s+["']?([A-Za-z][A-Za-z.'\-\s]{1,60}?)["']?(?:\s|$|\?|,)/i,
    /\b([A-Za-z][A-Za-z.'\-]{1,40}(?:\s+[A-Za-z][A-Za-z.'\-]{1,40}){0,2})(?:'s|’s)\s+(?:exam|score|result|progress|performance|marks?|attendance|class|homework|status)\b/i,
    /\b(?:student|teacher|admin|learner)\s+(?:named|called)\s+["']?([A-Za-z][A-Za-z.'\-\s]{1,60}?)["']?/i,
    // Only "for/of <Name>" when a role word is present — avoids "number of videos"
    /\b(?:for|of)\s+(?:student|teacher|admin|learner)\s+["']?([A-Za-z][A-Za-z.'\-\s]{1,40}(?:\s+[A-Za-z][A-Za-z.'\-]{1,40})?)["']?\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    const name = cleanPersonName(match[1]);
    if (!isLikelyPersonName(name)) continue;
    return { name, roleHint };
  }
  return { name: '', roleHint };
}

export function isPersonDetailQuery(message) {
  const { name } = extractPersonNameQuery(message);
  if (!name) return false;
  const lower = String(message || '').toLowerCase();
  // Pure counts / catalog metrics must stay on database / catalog paths
  if (
    /((how|who)\s*many|number\s+of|count|total)\b/.test(lower) &&
    !/'s|’s|about|named|called|how is|how's/.test(lower)
  ) {
    return false;
  }
  // Require person-detail language — never treat "any extracted token" as a person
  return /how\s+is|how's|about|details?|info|look\s*up|find|named|called|'s|’s|progress|performance|doing|scores?|marks?|results?|status|\bstudent\b|\bteacher\b/.test(
    lower,
  );
}

/**
 * Parse "Class 7A", "class 7 section B", "7th A"
 */
export function extractClassGroupQuery(message) {
  const raw = String(message || '').trim();
  if (!raw) return { classNumber: '', section: '' };

  const patterns = [
    /\bclass\s*(?:number\s*)?(\d{1,2})\s*(?:[-–]?\s*)(?:section\s*)?([A-Za-z])\b/i,
    /\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:class)?\s*(?:section\s*)?([A-Za-z])\b/i,
    /\bclass\s*(?:number\s*)?(\d{1,2})\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    return {
      classNumber: String(match[1]).trim(),
      section: match[2] ? String(match[2]).toUpperCase() : '',
    };
  }
  return { classNumber: '', section: '' };
}

export function isClassGroupQuery(message) {
  const { classNumber } = extractClassGroupQuery(message);
  if (!classNumber) return false;
  const lower = String(message || '').toLowerCase();
  // Prefer class_detail for performance/overview style, not bare "how many students in class 7"
  if (/^(how|who)\s+many\b/.test(lower) && !/performance|progress|overview|status|doing|results?/.test(lower)) {
    return false;
  }
  return /performance|progress|overview|status|doing|results?|scores?|group|section|class\s*\d/.test(lower);
}

function adminScopeStudentFilter(viewerRole, viewerUserId) {
  if (String(viewerRole || '').toLowerCase() === 'admin') {
    const adminOid = oid(viewerUserId);
    if (!adminOid) return null;
    return { role: 'student', assignedAdmin: adminOid };
  }
  return { role: 'student' };
}

function adminScopeTeacherFilter(viewerRole, viewerUserId) {
  if (String(viewerRole || '').toLowerCase() === 'admin') {
    const adminOid = oid(viewerUserId);
    if (!adminOid) return null;
    return { adminId: adminOid };
  }
  return {};
}

async function teacherStudentScopeFilter(viewerUserId) {
  const teacherOid = oid(viewerUserId);
  if (!teacherOid) return null;
  const teacher = await Teacher.findById(teacherOid)
    .select('adminId assignedClassIds classNumber')
    .lean()
    .catch(() => null);
  if (!teacher) return null;

  const classIds = (Array.isArray(teacher.assignedClassIds) ? teacher.assignedClassIds : [])
    .map((id) => oid(id))
    .filter(Boolean);
  let classNumbers = [];
  if (classIds.length) {
    const classes = await ClassModel.find({ _id: { $in: classIds } })
      .select('classNumber')
      .lean()
      .catch(() => []);
    classNumbers = [...new Set(classes.map((c) => String(c.classNumber || '').trim()).filter(Boolean))];
  }
  if (!classNumbers.length && teacher.classNumber) {
    classNumbers = [String(teacher.classNumber).trim()];
  }
  if (!classNumbers.length && !classIds.length) return { role: 'student', _id: { $in: [] } };

  const adminOid = teacher.adminId ? oid(teacher.adminId) : null;
  return {
    role: 'student',
    ...(adminOid ? { assignedAdmin: adminOid } : {}),
    $or: [
      ...(classIds.length ? [{ assignedClass: { $in: classIds } }] : []),
      ...(classNumbers.length ? [{ classNumber: { $in: classNumbers } }] : []),
    ],
  };
}

async function buildStudentPersonFacts(student) {
  const studentOid = student._id;
  const ymd = istYmd(new Date());
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [results, remarks, sessions30d, sessionsToday, homework, progressRows, classDoc] =
    await Promise.all([
      ExamResult.find({ userId: studentOid }).sort({ completedAt: -1 }).limit(12).lean(),
      StudentRemark.find({ studentId: studentOid }).sort({ createdAt: -1 }).limit(5).lean(),
      UserSession.countDocuments({
        userId: studentOid,
        date: { $gte: istYmd(thirtyDaysAgo) },
      }).catch(() => 0),
      UserSession.countDocuments({ userId: studentOid, date: ymd }).catch(() => 0),
      HomeworkSubmission.find({ studentId: studentOid }).sort({ submittedAt: -1 }).limit(8).lean(),
      UserProgress.find({ userId: studentOid }).sort({ updatedAt: -1 }).limit(40).lean(),
      student.assignedClass
        ? ClassModel.findById(student.assignedClass).select('classNumber section name').lean()
        : null,
    ]);

  const percentages = results
    .map((r) => Number(r.percentage))
    .filter((n) => Number.isFinite(n));
  const latest = results[0] || null;
  const previous = results[1] || null;
  let trendDirection = 'unknown';
  let deltaVsPrevious = null;
  if (latest && previous && Number.isFinite(Number(latest.percentage)) && Number.isFinite(Number(previous.percentage))) {
    deltaVsPrevious = Math.round((Number(latest.percentage) - Number(previous.percentage)) * 10) / 10;
    if (deltaVsPrevious > 1) trendDirection = 'improving';
    else if (deltaVsPrevious < -1) trendDirection = 'declining';
    else trendDirection = 'flat';
  }

  const videosTracked = progressRows.filter((r) => r.videoId).length;
  const videosCompleted = progressRows.filter(
    (r) => r.videoId && (r.completed || Number(r.progress) >= 95),
  ).length;

  return {
    operation: 'overview',
    scope: 'person_student',
    personType: 'student',
    personLabel: student.fullName || 'Student',
    profile: {
      fullName: student.fullName || '',
      classNumber: classDoc?.classNumber || student.classNumber || '',
      section: classDoc?.section || '',
      className: classDoc?.name || '',
      board: student.board || '',
      schoolName: student.schoolName || '',
      isActive: student.isActive !== false,
      email: student.email || '',
      lastLogin: student.lastLogin || null,
    },
    overview: {
      examsTaken: results.length,
      averagePercentage: avg(percentages),
      latestPercentage: latest?.percentage ?? null,
      latestExamTitle: latest?.examTitle || '',
      previousPercentage: previous?.percentage ?? null,
      deltaVsPrevious,
      trendDirection,
      loginDaysLast30: sessions30d,
      loggedInToday: sessionsToday > 0 ? 1 : 0,
      homeworkSubmitted: homework.length,
      homeworkGraded: homework.filter((h) => h.grade != null && h.grade !== '').length,
      videosTracked,
      videosCompleted,
      remarksCount: remarks.length,
    },
    recentExams: results.slice(0, 6).map((r) => ({
      examTitle: r.examTitle || 'Exam',
      percentage: r.percentage ?? null,
      obtainedMarks: r.obtainedMarks ?? null,
      totalMarks: r.totalMarks ?? null,
      completedAt: r.completedAt || null,
    })),
    recentRemarks: remarks.slice(0, 3).map((r) => ({
      remark: String(r.remark || r.text || '').slice(0, 160),
      createdAt: r.createdAt || null,
    })),
  };
}

async function buildTeacherPersonFacts(teacher) {
  const classIds = Array.isArray(teacher.assignedClassIds) ? teacher.assignedClassIds : [];
  const classes = classIds.length
    ? await ClassModel.find({ _id: { $in: classIds } })
        .select('classNumber section name')
        .lean()
        .catch(() => [])
    : [];

  let studentsInClasses = 0;
  if (classIds.length) {
    studentsInClasses = await User.countDocuments({
      role: 'student',
      assignedClass: { $in: classIds },
    }).catch(() => 0);
  }

  const assignments = Array.isArray(teacher.assignments) ? teacher.assignments : [];

  return {
    operation: 'overview',
    scope: 'person_teacher',
    personType: 'teacher',
    personLabel: teacher.fullName || 'Teacher',
    profile: {
      fullName: teacher.fullName || '',
      email: teacher.email || '',
      phone: teacher.phone || '',
      isActive: teacher.isActive !== false,
      subjects: assignments
        .map((a) => a.subjectName || a.subject || '')
        .filter(Boolean)
        .slice(0, 12),
    },
    overview: {
      assignedClasses: classes.length,
      studentsInAssignedClasses: studentsInClasses,
      subjectAssignments: assignments.length,
    },
    classes: classes.map((c) => ({
      classNumber: c.classNumber || '',
      section: c.section || '',
      name: c.name || '',
    })),
  };
}

async function buildAdminPersonFacts(adminUser) {
  const school = await School.findOne({ adminUserId: adminUser._id })
    .select('name place board phone contactPerson licensedStudents licensedTeachers isActive')
    .lean()
    .catch(() => null);

  const studentCount = await User.countDocuments({
    role: 'student',
    assignedAdmin: adminUser._id,
  }).catch(() => 0);
  const teacherCount = await Teacher.countDocuments({
    adminId: adminUser._id,
    isActive: true,
  }).catch(() => 0);

  return {
    operation: 'overview',
    scope: 'person_admin',
    personType: 'admin',
    personLabel: adminUser.fullName || adminUser.schoolName || 'School admin',
    profile: {
      fullName: adminUser.fullName || '',
      schoolName: school?.name || adminUser.schoolName || '',
      place: school?.place || adminUser.place || '',
      board: school?.board || adminUser.board || '',
      email: adminUser.email || '',
      phone: school?.phone || adminUser.phone || '',
      isActive: adminUser.isActive !== false,
    },
    overview: {
      students: studentCount,
      teachers: teacherCount,
      licensedStudents: school?.licensedStudents ?? null,
      licensedTeachers: school?.licensedTeachers ?? null,
    },
  };
}

/**
 * Resolve a named person within viewer scope and return multi-collection facts.
 */
export async function buildNamedPersonDetailFacts({
  personNameQuery,
  roleHint = '',
  viewerRole,
  viewerUserId,
}) {
  const q = String(personNameQuery || '').trim();
  if (!q) {
    return {
      operation: 'overview',
      scope: 'person_lookup',
      personLabel: '',
      overview: {},
      error: 'No person name was detected in the question.',
      searchQuery: '',
    };
  }

  const regex = new RegExp(escapeRegex(q), 'i');
  const role = String(viewerRole || '').toLowerCase();
  const prefer = String(roleHint || '').toLowerCase();

  let studentBase = adminScopeStudentFilter(role, viewerUserId);
  if (role === 'teacher') {
    studentBase = await teacherStudentScopeFilter(viewerUserId);
  }
  const teacherBase = role === 'teacher' ? { _id: { $in: [] } } : adminScopeTeacherFilter(role, viewerUserId);
  if (studentBase === null || teacherBase === null) {
    return {
      operation: 'overview',
      scope: 'person_lookup',
      personLabel: q,
      overview: {},
      error: 'Could not resolve your school scope for this lookup.',
      searchQuery: q,
    };
  }

  const searchOrder =
    prefer === 'teacher'
      ? ['teacher', 'student', 'admin']
      : prefer === 'admin'
        ? ['admin', 'student', 'teacher']
        : ['student', 'teacher', 'admin'];

  /** @type {Array<{kind:string, doc:any}>} */
  const candidates = [];

  for (const kind of searchOrder) {
    if (kind === 'student') {
      const rows = await User.find({ ...studentBase, fullName: regex })
        .select(
          'fullName email classNumber assignedClass board schoolName assignedAdmin isActive lastLogin',
        )
        .limit(8)
        .lean()
        .catch(() => []);
      rows.forEach((doc) => candidates.push({ kind: 'student', doc }));
    } else if (kind === 'teacher') {
      const rows = await Teacher.find({ ...teacherBase, fullName: regex })
        .select('fullName email phone isActive assignedClassIds assignments adminId')
        .limit(8)
        .lean()
        .catch(() => []);
      rows.forEach((doc) => candidates.push({ kind: 'teacher', doc }));
    } else if (kind === 'admin' && role === 'super-admin') {
      const rows = await User.find({ role: 'admin', fullName: regex })
        .select('fullName email schoolName place phone board isActive')
        .limit(8)
        .lean()
        .catch(() => []);
      rows.forEach((doc) => candidates.push({ kind: 'admin', doc }));
    }
  }

  if (!candidates.length) {
    return {
      operation: 'overview',
      scope: 'person_lookup',
      personLabel: q,
      overview: {},
      error: `No matching person found for "${q}" in your accessible scope.`,
      searchQuery: q,
      candidates: [],
    };
  }

  if (candidates.length > 1) {
    return {
      operation: 'overview',
      scope: 'person_lookup',
      personLabel: q,
      overview: {},
      error: `Found ${candidates.length} matching people. Please specify the full name or role (student/teacher).`,
      searchQuery: q,
      candidates: candidates.slice(0, 8).map((c) => ({
        kind: c.kind,
        name: c.doc.fullName || '',
        schoolName: c.doc.schoolName || '',
        classNumber: c.doc.classNumber || '',
      })),
    };
  }

  const hit = candidates[0];
  if (hit.kind === 'student') return buildStudentPersonFacts(hit.doc);
  if (hit.kind === 'teacher') return buildTeacherPersonFacts(hit.doc);
  return buildAdminPersonFacts(hit.doc);
}

/**
 * Class / section group performance within viewer scope.
 */
export async function buildClassGroupFacts({
  classNumber,
  section = '',
  viewerRole,
  viewerUserId,
}) {
  const cn = String(classNumber || '').trim();
  if (!cn) {
    return {
      operation: 'overview',
      scope: 'class_group',
      classLabel: '',
      overview: {},
      error: 'No class number was detected in the question.',
    };
  }

  const role = String(viewerRole || '').toLowerCase();
  const adminOid = role === 'admin' ? oid(viewerUserId) : null;
  if (role === 'admin' && !adminOid) {
    return {
      operation: 'overview',
      scope: 'class_group',
      classLabel: `Class ${cn}`,
      overview: {},
      error: 'Could not resolve your school scope for this class lookup.',
    };
  }

  let teacherClassIds = [];
  let teacherAdminOid = null;
  if (role === 'teacher') {
    const teacherOid = oid(viewerUserId);
    const teacher = teacherOid
      ? await Teacher.findById(teacherOid).select('adminId assignedClassIds classNumber').lean()
      : null;
    teacherClassIds = (Array.isArray(teacher?.assignedClassIds) ? teacher.assignedClassIds : [])
      .map((id) => oid(id))
      .filter(Boolean);
    teacherAdminOid = teacher?.adminId ? oid(teacher.adminId) : null;
    if (!teacherClassIds.length) {
      return {
        operation: 'overview',
        scope: 'class_group',
        classLabel: section ? `Class ${cn}${section}` : `Class ${cn}`,
        overview: {},
        error: 'No classes are assigned to you, so class group metrics are unavailable.',
      };
    }
  }

  const classFilter = {
    classNumber: cn,
    ...(section ? { section: new RegExp(`^${escapeRegex(section)}$`, 'i') } : {}),
    ...(adminOid ? { assignedAdmin: adminOid } : {}),
    ...(teacherAdminOid ? { assignedAdmin: teacherAdminOid } : {}),
    ...(teacherClassIds.length ? { _id: { $in: teacherClassIds } } : {}),
  };

  const classDocs = await ClassModel.find(classFilter)
    .select('classNumber section name assignedAdmin')
    .limit(10)
    .lean()
    .catch(() => []);

  const studentFilter = {
    role: 'student',
    ...(adminOid ? { assignedAdmin: adminOid } : {}),
    ...(teacherAdminOid ? { assignedAdmin: teacherAdminOid } : {}),
    $or: [
      { classNumber: cn },
      ...(classDocs.length ? [{ assignedClass: { $in: classDocs.map((c) => c._id) } }] : []),
    ],
  };
  if (section) {
    // Prefer students linked to matching class docs when section known
    if (classDocs.length) {
      studentFilter.assignedClass = { $in: classDocs.map((c) => c._id) };
      delete studentFilter.$or;
    }
  }

  const students = await User.find(studentFilter)
    .select('_id fullName classNumber isActive lastLogin')
    .limit(500)
    .lean()
    .catch(() => []);

  const studentIds = students.map((s) => s._id);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ymd = istYmd(new Date());

  const [results, sessionsToday, activeExams] = await Promise.all([
    studentIds.length
      ? ExamResult.find({ userId: { $in: studentIds }, completedAt: { $gte: thirtyDaysAgo } })
          .select('userId percentage examTitle completedAt')
          .lean()
      : [],
    studentIds.length
      ? UserSession.countDocuments({ userId: { $in: studentIds }, date: ymd }).catch(() => 0)
      : 0,
    Exam.countDocuments({
      classNumber: cn,
      isActive: true,
      ...(adminOid
        ? { $or: [{ adminId: adminOid }, { schoolId: adminOid }, { targetSchools: adminOid }] }
        : {}),
    }).catch(() => 0),
  ]);

  const pcts = results.map((r) => Number(r.percentage)).filter((n) => Number.isFinite(n));
  const byStudent = new Map();
  for (const r of results) {
    const id = String(r.userId);
    if (!byStudent.has(id)) byStudent.set(id, []);
    byStudent.get(id).push(Number(r.percentage));
  }
  const studentAvgs = [...byStudent.values()]
    .map((arr) => avg(arr))
    .filter((n) => n != null);
  const topStudents = students
    .map((s) => {
      const scores = byStudent.get(String(s._id)) || [];
      return { name: s.fullName || 'Student', averagePercentage: avg(scores), attempts: scores.length };
    })
    .filter((s) => s.attempts > 0)
    .sort((a, b) => (b.averagePercentage || 0) - (a.averagePercentage || 0))
    .slice(0, 5);

  const label = section ? `Class ${cn}${section}` : `Class ${cn}`;

  return {
    operation: 'overview',
    scope: 'class_group',
    classLabel: label,
    profile: {
      classNumber: cn,
      section: section || (classDocs[0]?.section || ''),
      classRooms: classDocs.length,
      classNames: classDocs.map((c) => c.name).filter(Boolean),
    },
    overview: {
      students: students.length,
      activeStudents: students.filter((s) => s.isActive !== false).length,
      examResultsLast30Days: results.length,
      averagePercentage: avg(pcts),
      studentsWithResults: studentAvgs.length,
      loginSessionsToday: sessionsToday,
      activeExams,
    },
    topStudents,
  };
}
