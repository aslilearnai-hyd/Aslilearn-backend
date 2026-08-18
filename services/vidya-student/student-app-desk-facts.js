/**
 * Live Asli Learn app facts for student Vidya (subjects, videos, homework, upcoming exams).
 */
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Exam from '../../models/Exam.js';
import Content from '../../models/Content.js';
import ClassModel from '../../models/Class.js';
import Subject from '../../models/Subject.js';
import {
  resolveStudentSubjectIdsForLibrary,
  loadStudentLibraryContents,
} from '../../utils/studentLibraryContents.js';
import {
  resolveStudentClassNumber,
  examMatchesStudentAssignedClass,
} from '../../utils/studentClassContent.js';
import { examVisibleToStudent, examVisibleToIndividualStudent } from '../../utils/exam-visibility.js';
import { enrichSubjectsWithMedia } from '../student-subject-media.js';
import { filterToActiveCatalogSubjectIds } from '../../utils/activeCatalog.js';
import Assessment from '../../models/Assessment.js';
import Event from '../../models/Event.js';
import ExamResult from '../../models/ExamResult.js';

const LIST_CAP = 200;

function istDayBounds(d = new Date()) {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  // Approximate IST day in UTC for deadline comparisons
  const start = new Date(`${key}T00:00:00+05:30`);
  const end = new Date(`${key}T23:59:59.999+05:30`);
  return { key, start, end };
}

function formatShortDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function sameIstDay(a, b) {
  if (!a || !b) return false;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(new Date(a)) === fmt.format(new Date(b));
  } catch {
    return false;
  }
}

/**
 * @param {string|mongoose.Types.ObjectId} studentOid
 * @param {{ progressRows?: any[], homeworkRows?: any[] }} [extras]
 */
export async function buildStudentAppDeskFacts(studentOid, extras = {}) {
  const oid =
    studentOid instanceof mongoose.Types.ObjectId
      ? studentOid
      : mongoose.Types.ObjectId.isValid(String(studentOid))
        ? new mongoose.Types.ObjectId(String(studentOid))
        : null;
  if (!oid) {
    return {
      subjects: [],
      upcomingExams: [],
      openExams: [],
      homework: { today: [], upcoming: [], overdue: [], pending: [], submittedCount: 0 },
      totals: { subjects: 0, videos: 0, videosCompleted: 0 },
    };
  }

  const student = await User.findById(oid)
    .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories schoolName')
    .populate('assignedClass', 'classNumber section assignedSubjects')
    .select(
      'fullName role classNumber assignedClass assignedSubjects board schoolName assignedAdmin',
    )
    .lean();

  if (!student || student.role !== 'student') {
    return {
      subjects: [],
      upcomingExams: [],
      openExams: [],
      homework: { today: [], upcoming: [], overdue: [], pending: [], submittedCount: 0 },
      totals: { subjects: 0, videos: 0, videosCompleted: 0 },
    };
  }

  const studentClassDoc =
    student.assignedClass && typeof student.assignedClass === 'object'
      ? student.assignedClass
      : student.assignedClass
        ? await ClassModel.findById(student.assignedClass).select('classNumber section assignedSubjects').lean()
        : null;

  const studentClassNumber = resolveStudentClassNumber(student, studentClassDoc);
  const studentAdminId = student.assignedAdmin?._id || student.assignedAdmin;
  const studentBoardOrAdmin =
    student.assignedAdmin && typeof student.assignedAdmin === 'object'
      ? student.assignedAdmin
      : student.board || '';

  let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(student, studentClassDoc);
  librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

  const subjectDocs = librarySubjectIds.length
    ? await Subject.find({
        _id: { $in: librarySubjectIds },
        isActive: true,
        name: { $not: /__deleted__/ },
      })
        .select('name code board')
        .sort({ name: 1 })
        .lean()
    : [];

  const subjectRows = subjectDocs.map((s) => ({
    _id: s._id,
    id: String(s._id),
    name: s.name || 'Subject',
    code: s.code || '',
  }));

  const progressRows = Array.isArray(extras.progressRows) ? extras.progressRows : [];
  const completedVideoIds = new Set(
    progressRows
      .filter((r) => r?.videoId && (r.completed || Number(r.progress) >= 95))
      .map((r) => String(r.videoId)),
  );
  const inProgressVideoIds = new Set(
    progressRows
      .filter(
        (r) =>
          r?.videoId &&
          !r.completed &&
          Number(r.progress) > 0 &&
          Number(r.progress) < 95,
      )
      .map((r) => String(r.videoId)),
  );

  const [enrichedSubjects, examDocs, libraryBundle, quizzes, calendarEvents, rankingRows] =
    await Promise.all([
    enrichSubjectsWithMedia(student, subjectRows),
    Exam.find({ createdByRole: 'super-admin', isActive: true })
      .select(
        'title subject subjects startDate endDate duration assignedClasses classNumber board isAllBoards isSchoolSpecific schoolId targetSchools totalQuestions totalMarks examType',
      )
      .sort({ startDate: 1 })
      .limit(LIST_CAP)
      .lean(),
    loadStudentLibraryContents(String(oid), student, studentClassDoc, student.assignedAdmin?.board),
    student.assignedClass
      ? Assessment.find({
          assignedClasses: student.assignedClass._id || student.assignedClass,
          isPublished: true,
        })
          .select('title difficulty duration totalPoints attempts createdAt')
          .sort({ createdAt: -1 })
          .limit(100)
          .lean()
      : Promise.resolve([]),
    studentAdminId
      ? Event.find({
          $or: [{ createdBy: studentAdminId }, { adminId: studentAdminId }],
          isActive: { $ne: false },
        })
          .select('title date startDate endDate type eventType classNumber')
          .sort({ date: 1, startDate: 1 })
          .limit(80)
          .lean()
          .catch(() => [])
      : Promise.resolve([]),
    ExamResult.find({ userId: oid })
      .select('percentage examTitle completedAt rank classRank')
      .sort({ completedAt: -1 })
      .limit(50)
      .lean()
      .catch(() => []),
  ]);

  const subjects = (enrichedSubjects || []).map((row) => {
    const videos = Array.isArray(row.videos) ? row.videos : [];
    const videoIds = videos.map((v) => String(v._id));
    const completed = videoIds.filter((id) => completedVideoIds.has(id)).length;
    const inProgress = videoIds.filter((id) => inProgressVideoIds.has(id)).length;
    return {
      id: String(row._id || row.id),
      name: row.name || 'Subject',
      videoCount: videos.length,
      videosCompleted: completed,
      videosInProgress: inProgress,
      videosRemaining: Math.max(0, videos.length - completed),
      assessmentCount: Array.isArray(row.assessments) ? row.assessments.length : 0,
    };
  });

  const now = Date.now();
  const accessibleExams = (examDocs || []).filter((exam) => {
    const visible = student.isIndividualAccount
      ? examVisibleToIndividualStudent(exam, student)
      : examVisibleToStudent(exam, studentAdminId, studentBoardOrAdmin);
    if (!visible) return false;
    if (!examMatchesStudentAssignedClass(exam, studentClassNumber)) return false;
    return true;
  });

  const mapExam = (exam) => {
    const start = exam.startDate ? new Date(exam.startDate).getTime() : NaN;
    const end = exam.endDate ? new Date(exam.endDate).getTime() : NaN;
    let status = 'scheduled';
    if (Number.isFinite(start) && now < start) status = 'upcoming';
    else if (Number.isFinite(end) && now > end) status = 'ended';
    else if (Number.isFinite(start) || Number.isFinite(end)) status = 'open';
    return {
      title: exam.title || 'Exam',
      subject: (Array.isArray(exam.subjects) && exam.subjects[0]) || exam.subject || '',
      startDate: exam.startDate || null,
      endDate: exam.endDate || null,
      startLabel: formatShortDate(exam.startDate),
      endLabel: formatShortDate(exam.endDate),
      status,
      totalQuestions: exam.totalQuestions || 0,
      totalMarks: exam.totalMarks || 0,
    };
  };

  const mappedExams = accessibleExams.map(mapExam);
  const upcomingExams = mappedExams
    .filter((e) => e.status === 'upcoming')
    .sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0))
    .slice(0, 60);
  const openExams = mappedExams.filter((e) => e.status === 'open').slice(0, 60);

  const quizFacts = (quizzes || []).map((qz) => {
    const attempt = (qz.attempts || []).find(
      (a) => a.user && String(a.user) === String(oid),
    );
    return {
      title: qz.title || 'Quiz',
      difficulty: qz.difficulty || '',
      attempted: Boolean(attempt),
      score: attempt?.score ?? null,
      completed: Boolean(attempt?.completed),
    };
  });

  const calendarUpcoming = (calendarEvents || [])
    .filter((ev) => {
      const start = ev.startDate || ev.date || ev.start;
      const t = start ? new Date(start).getTime() : NaN;
      return !Number.isFinite(t) || t >= now - 12 * 60 * 60 * 1000;
    })
    .slice(0, 40)
    .map((ev) => ({
      title: ev.title || 'Event',
      startLabel: formatShortDate(ev.startDate || ev.date || ev.start),
      type: ev.type || ev.eventType || '',
      classNumber: ev.classNumber || '',
    }));

  const bestRank = (rankingRows || [])
    .map((r) => r.classRank ?? r.rank)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .sort((a, b) => Number(a) - Number(b))[0];

  const contents = Array.isArray(libraryBundle?.contents) ? libraryBundle.contents : [];
  const homeworkContents = contents.filter(
    (c) => String(c.type || '').toLowerCase() === 'homework',
  );

  const submissionRows = Array.isArray(extras.homeworkRows) ? extras.homeworkRows : [];
  const submittedHomeworkIds = new Set(
    submissionRows.map((h) => String(h.homeworkId?._id || h.homeworkId || '')).filter(Boolean),
  );

  const { start: todayStart, end: todayEnd } = istDayBounds();

  const mapHw = (c) => {
    const deadline = c.deadline || c.date || null;
    const subjectName =
      (typeof c.subject === 'object' && c.subject?.name) ||
      subjects.find((s) => String(s.id) === String(c.subject?._id || c.subject))?.name ||
      '';
    return {
      id: String(c._id),
      title: c.title || 'Homework',
      subject: subjectName,
      deadline,
      deadlineLabel: formatShortDate(deadline),
      submitted: submittedHomeworkIds.has(String(c._id)),
    };
  };

  const allHw = homeworkContents.map(mapHw);
  const pending = allHw.filter((h) => !h.submitted);
  const today = pending.filter((h) => {
    if (!h.deadline) return false;
    const t = new Date(h.deadline).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });
  const overdue = pending.filter((h) => {
    if (!h.deadline) return false;
    return new Date(h.deadline).getTime() < todayStart.getTime();
  });
  const upcomingHw = pending
    .filter((h) => h.deadline && new Date(h.deadline).getTime() > todayEnd.getTime())
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 8);

  // Also treat undated pending homework as "pending today" if nothing else
  const undatedPending = pending.filter((h) => !h.deadline).slice(0, 5);

  const totalVideos = subjects.reduce((s, x) => s + (x.videoCount || 0), 0);
  const totalCompleted = subjects.reduce((s, x) => s + (x.videosCompleted || 0), 0);

  return {
    profileName: student.fullName || 'Student',
    classNumber: studentClassNumber || student.classNumber || '',
    subjects,
    upcomingExams,
    openExams,
    quizzes: quizFacts,
    calendar: calendarUpcoming,
    ranking: {
      bestClassRank: bestRank ?? null,
      recentResultsWithRank: (rankingRows || []).slice(0, 20),
    },
    homework: {
      today: [...today, ...undatedPending].slice(0, 50),
      upcoming: upcomingHw.slice(0, 50),
      overdue: overdue.slice(0, 50),
      pending: pending.slice(0, LIST_CAP),
      submittedCount: submissionRows.length,
      assignedCount: allHw.length,
    },
    totals: {
      subjects: subjects.length,
      videos: totalVideos,
      videosCompleted: totalCompleted,
      videosRemaining: Math.max(0, totalVideos - totalCompleted),
      upcomingExams: upcomingExams.length,
      openExams: openExams.length,
      homeworkToday: today.length + undatedPending.length,
      homeworkOverdue: overdue.length,
      quizzes: quizFacts.length,
      quizzesAttempted: quizFacts.filter((q) => q.attempted).length,
      calendarEvents: calendarUpcoming.length,
    },
    todayKey: istDayBounds().key,
  };
}

export function matchSubjectFromQuestion(subjects, question) {
  const list = Array.isArray(subjects) ? subjects : [];
  const q = String(question || '').toLowerCase();
  if (!list.length || !q) return null;

  const sorted = [...list].sort((a, b) => String(b.name || '').length - String(a.name || '').length);
  for (const s of sorted) {
    const name = String(s.name || '')
      .toLowerCase()
      .trim();
    if (!name) continue;
    if (q.includes(name)) return s;
    // common shorthand
    const short = name.replace(/\s+/g, '');
    if (short.length >= 4 && q.includes(short)) return s;
  }

  // "in maths" / "for physics" patterns when name is Maths / Mathematics
  const aliases = [
    [/maths?|mathematics|math/, /math/i],
    [/physics|phy/, /phys/i],
    [/chemistry|chem/, /chem/i],
    [/biology|bio|science/, /bio|science/i],
    [/english/, /engl/i],
    [/hindi/, /hindi/i],
  ];
  for (const [qRe, nameRe] of aliases) {
    if (qRe.test(q)) {
      const hit = list.find((s) => nameRe.test(String(s.name || '')));
      if (hit) return hit;
    }
  }
  return null;
}

export { sameIstDay, formatShortDate };
