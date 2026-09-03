/**
 * Live Asli Learn app facts for teacher Vidya — classes, roster, homework, attendance, OMR, exams.
 */
import mongoose from 'mongoose';
import Teacher from '../../models/Teacher.js';
import User from '../../models/User.js';
import ClassModel from '../../models/Class.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import Assessment from '../../models/Assessment.js';
import HomeworkSubmission from '../../models/HomeworkSubmission.js';
import Content from '../../models/Content.js';
import UserSession from '../../models/UserSession.js';
import StudentRemark from '../../models/StudentRemark.js';
import OmrResultRow from '../../models/OmrResultRow.js';
import OmrResultBatch from '../../models/OmrResultBatch.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import { istYmd } from '../vidya-ai-control/ist-time.js';
import { isTeacherExamDataQuestion } from './teacher-query-routing.js';

const LIST_CAP = 200; // high ceiling — “no artificial tiny limits”

function oid(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
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

const MONTH_NAME_TO_NUM = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

function istYearMonth(d = new Date()) {
  const [year, month] = istYmd(d).split('-').map(Number);
  return { year, month };
}

function previousIstMonth(d = new Date()) {
  const { year, month } = istYearMonth(d);
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function monthLabel({ year, month }) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (month) return `${names[month - 1]} ${year}`;
  return String(year);
}

function parseExamTimeFilter(question, now = new Date()) {
  const q = String(question || '').toLowerCase();
  if (/\b(last|previous|past)\s+month\b/.test(q)) return previousIstMonth(now);
  if (/\b(this|current)\s+month\b/.test(q)) return istYearMonth(now);
  if (/\blast\s+year\b/.test(q)) return { year: istYearMonth(now).year - 1, month: null };
  const named = q.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(\d{4}))?/,
  );
  if (named) {
    return {
      year: named[2] ? Number(named[2]) : istYearMonth(now).year,
      month: MONTH_NAME_TO_NUM[named[1]],
    };
  }
  const iso = q.match(/\b(20\d{2})-(\d{1,2})\b/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
  const dmy = q.match(/\b(\d{1,2})[/-](20\d{2})\b/);
  if (dmy) return { year: Number(dmy[2]), month: Number(dmy[1]) };
  const yearOnly = q.match(/\bin\s+(20\d{2})\b/);
  if (yearOnly) return { year: Number(yearOnly[1]), month: null };
  return null;
}

function examYearMonth(exam) {
  const raw = exam?.startIso || exam?.startDate || exam?.completedAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return istYearMonth(parsed);
}

function collectDeskExams(desk) {
  const rows = [
    ...(Array.isArray(desk?.exams?.recent) ? desk.exams.recent : []),
    ...(Array.isArray(desk?.exams?.open) ? desk.exams.open : []),
    ...(Array.isArray(desk?.exams?.upcoming) ? desk.exams.upcoming : []),
  ];
  const seen = new Set();
  return rows.filter((exam) => {
    const key = `${exam.title || ''}|${exam.startIso || exam.startLabel || ''}|${exam.classNumber || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatExamListLine(exam, index) {
  return `${index + 1}. **${exam.title || 'Exam'}**${exam.subject ? ` — ${exam.subject}` : ''}${
    exam.classNumber ? ` · Class ${exam.classNumber}` : ''
  }${exam.startLabel ? ` · ${exam.startLabel}` : ''}`;
}

function listSchoolExams(question, desk, now = new Date()) {
  const exams = collectDeskExams(desk);
  const filter = parseExamTimeFilter(question, now);
  const matched = filter
    ? exams.filter((exam) => {
        const ym = examYearMonth(exam);
        if (!ym) return false;
        if (ym.year !== filter.year) return false;
        if (filter.month && ym.month !== filter.month) return false;
        return true;
      })
    : exams;
  if (!matched.length) {
    if (filter) return `No school exams are scheduled for **${monthLabel(filter)}**.`;
    return 'No regular exams are available for your school right now.';
  }
  const heading = filter ? `**School exams in ${monthLabel(filter)}:**` : '**Latest school exams:**';
  return `${heading}\n\n${matched.map(formatExamListLine).join('\n')}`;
}

export async function buildTeacherAppDeskFacts(teacherUserId) {
  const teacherOid = oid(teacherUserId);
  if (!teacherOid) {
    return emptyDesk();
  }

  const teacher = await Teacher.findById(teacherOid)
    .select('fullName adminId assignedClassIds subjects isActive')
    .lean();
  if (!teacher) return emptyDesk();

  const adminId = teacher.adminId ? oid(teacher.adminId) : null;
  const classIds = (teacher.assignedClassIds || [])
    .map((id) => oid(id))
    .filter(Boolean);

  const classes = classIds.length
    ? await ClassModel.find({ _id: { $in: classIds } })
        .select('classNumber section assignedSubjects')
        .lean()
    : [];

  const studentFilter = {
    role: 'student',
    isActive: { $ne: false },
    ...(adminId ? { assignedAdmin: adminId } : {}),
  };
  if (classIds.length) {
    studentFilter.$or = [
      { assignedClass: { $in: classIds } },
      { assignedClassIds: { $in: classIds.map(String) } },
      { assignedTeacher: teacherOid },
    ];
  } else {
    studentFilter.assignedTeacher = teacherOid;
  }

  const ymd = istYmd(new Date());
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const students = await User.find(studentFilter)
    .select('fullName email classNumber section assignedClass lastLogin')
    .sort({ fullName: 1 })
    .limit(LIST_CAP)
    .lean();
  const studentIds = students.map((s) => s._id);

  const [
    sessionsToday,
    active7d,
    examResults30d,
    homeworkSubs,
    remarks,
    quizzes,
    diaryRows,
    omrBatches,
    omrRows,
    openExams,
    recentExams,
  ] = await Promise.all([
    studentIds.length
      ? UserSession.countDocuments({ userId: { $in: studentIds }, date: ymd })
      : 0,
    User.countDocuments({ ...studentFilter, lastLogin: { $gte: sevenDaysAgo } }),
    studentIds.length
      ? ExamResult.find({
          userId: { $in: studentIds },
          completedAt: { $gte: thirtyDaysAgo },
        })
          .select('userId percentage examTitle completedAt')
          .sort({ completedAt: -1 })
          .limit(LIST_CAP)
          .lean()
      : [],
    studentIds.length
      ? HomeworkSubmission.find({ studentId: { $in: studentIds } })
          .sort({ submittedAt: -1 })
          .limit(LIST_CAP)
          .populate('homeworkId', 'title deadline')
          .lean()
      : [],
    studentIds.length
      ? StudentRemark.find({ studentId: { $in: studentIds } })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean()
      : [],
    Assessment.find({
      createdBy: teacherOid,
      isPublished: true,
    })
      .select('title difficulty assignedClasses createdAt attempts')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    TeacherWorkDiary.find({ teacherId: teacherOid })
      .sort({ forDate: -1 })
      .limit(30)
      .lean()
      .catch(() => []),
    adminId
      ? OmrResultBatch.find({ adminId }).sort({ createdAt: -1 }).limit(40).lean()
      : [],
    studentIds.length
      ? OmrResultRow.find({ userId: { $in: studentIds } })
          .sort({ createdAt: -1 })
          .limit(LIST_CAP)
          .lean()
      : [],
    Exam.find({
      isActive: true,
      ...(adminId
        ? {
            $or: [
              { adminId },
              { schoolId: adminId },
              { targetSchools: adminId },
              { createdByRole: 'super-admin' },
            ],
          }
        : { createdByRole: 'super-admin' }),
    })
      .select('title startDate endDate subject assignedClasses classNumber')
      .sort({ startDate: 1 })
      .limit(80)
      .lean(),
    Exam.find({
      ...(adminId
        ? { $or: [{ adminId }, { schoolId: adminId }, { targetSchools: adminId }, { createdByRole: 'super-admin' }] }
        : { createdByRole: 'super-admin' }),
      title: { $not: /\bmock\s+test\b/i },
    })
      .select('title startDate endDate subject assignedClasses classNumber')
      .sort({ startDate: -1, createdAt: -1 })
      .limit(40)
      .lean(),
  ]);

  const now = Date.now();
  const upcomingExams = [];
  const liveExams = [];
  for (const exam of openExams || []) {
    const start = exam.startDate ? new Date(exam.startDate).getTime() : NaN;
    const end = exam.endDate ? new Date(exam.endDate).getTime() : NaN;
    const row = {
      title: exam.title || 'Exam',
      subject: exam.subject || '',
      classNumber: exam.classNumber || '',
      startIso: exam.startDate ? new Date(exam.startDate).toISOString() : '',
      startLabel: formatShortDate(exam.startDate),
      endLabel: formatShortDate(exam.endDate),
    };
    if (Number.isFinite(start) && now < start) upcomingExams.push(row);
    else if (
      (!Number.isFinite(start) || now >= start) &&
      (!Number.isFinite(end) || now <= end)
    ) {
      liveExams.push(row);
    }
  }

  const pendingHomeworkReview = (homeworkSubs || []).filter(
    (h) => h.grade == null || h.grade === '',
  );

  const classSummaries = classes.map((c) => {
    const roster = students.filter(
      (s) => String(s.assignedClass) === String(c._id),
    );
    return {
      id: String(c._id),
      label: `Class ${c.classNumber || '?'}${c.section ? `-${c.section}` : ''}`,
      classNumber: c.classNumber || '',
      section: c.section || '',
      studentCount: roster.length,
    };
  });

  const avgPct =
    examResults30d.length > 0
      ? Math.round(
          (examResults30d.reduce((s, r) => s + (Number(r.percentage) || 0), 0) /
            examResults30d.length) *
            10,
        ) / 10
      : null;

  return {
    profile: {
      name: teacher.fullName || 'Teacher',
      classCount: classes.length,
      studentCount: students.length,
    },
    classes: classSummaries,
    students: students.map((s) => ({
      id: String(s._id),
      name: s.fullName || 'Student',
      classNumber: s.classNumber || '',
      section: s.section || '',
      email: s.email || '',
      lastLogin: s.lastLogin || null,
    })),
    attendance: {
      loggedInToday: sessionsToday,
      activeStudents7d: active7d,
      todayKey: ymd,
    },
    exams: {
      upcoming: upcomingExams.slice(0, 40),
      open: liveExams.slice(0, 40),
      recentResults: examResults30d.slice(0, 80).map((r) => ({
        studentId: String(r.userId),
        examTitle: r.examTitle || 'Exam',
        percentage: r.percentage,
        completedAt: r.completedAt,
      })),
      averagePct30d: avgPct,
      resultsCount30d: examResults30d.length,
      recent: (recentExams || []).map((exam) => ({
        title: exam.title || 'Exam',
        subject: exam.subject || '',
        classNumber: exam.classNumber || '',
        startIso: exam.startDate ? new Date(exam.startDate).toISOString() : '',
        startLabel: formatShortDate(exam.startDate),
        endLabel: formatShortDate(exam.endDate),
      })),
    },
    homework: {
      submissions: (homeworkSubs || []).slice(0, 80).map((h) => ({
        studentId: String(h.studentId),
        title: h.homeworkId?.title || 'Homework',
        deadline: h.homeworkId?.deadline || null,
        grade: h.grade ?? null,
        submittedAt: h.submittedAt,
      })),
      pendingReview: pendingHomeworkReview.length,
      submittedCount: (homeworkSubs || []).length,
    },
    quizzes: (quizzes || []).map((q) => ({
      title: q.title || 'Quiz',
      difficulty: q.difficulty || '',
      attempts: Array.isArray(q.attempts) ? q.attempts.length : 0,
    })),
    remarksCount: (remarks || []).length,
    omr: {
      batches: (omrBatches || []).length,
      assignedRows: (omrRows || []).length,
      latestBatch: omrBatches?.[0]
        ? {
            title: omrBatches[0].testTitle || 'OMR',
            testNo: omrBatches[0].testNo || '',
            rowCount: omrBatches[0].rowCount || 0,
          }
        : null,
    },
    workDiary: (diaryRows || []).slice(0, 10).map((d) => ({
      date: d.forDate || d.createdAt,
      title: d.title || d.topic || 'Diary entry',
    })),
    totals: {
      classes: classSummaries.length,
      students: students.length,
      loggedInToday: sessionsToday,
      active7d,
      homeworkPendingReview: pendingHomeworkReview.length,
      quizzes: (quizzes || []).length,
      upcomingExams: upcomingExams.length,
      openExams: liveExams.length,
      omrBatches: (omrBatches || []).length,
    },
  };
}

function emptyDesk() {
  return {
    profile: { name: 'Teacher', classCount: 0, studentCount: 0 },
    classes: [],
    students: [],
    attendance: { loggedInToday: 0, activeStudents7d: 0, todayKey: '' },
    exams: { upcoming: [], open: [], recent: [], recentResults: [], averagePct30d: null, resultsCount30d: 0 },
    homework: { submissions: [], pendingReview: 0, submittedCount: 0 },
    quizzes: [],
    remarksCount: 0,
    omr: { batches: 0, assignedRows: 0, latestBatch: null },
    workDiary: [],
    totals: {},
  };
}

export function teacherAppOnlyReply(question, desk, entityFallbackMessage = '', now = new Date()) {
  const q = String(question || '').toLowerCase();
  const name = desk?.profile?.name || 'Teacher';
  const totals = desk?.totals || {};
  const classes = Array.isArray(desk?.classes) ? desk.classes : [];
  const students = Array.isArray(desk?.students) ? desk.students : [];
  const wantCount =
    /\bhow many\b|\bcount\b|\bnumber of\b|\btotal\b/.test(q) &&
    !/\bhow much (time|longer)\b/.test(q);
  const wantList = /\b(all|list|every|each|show all|roster|names)\b/.test(q);

  if (
    /what should i do|today'?s?\s+(plan|focus|task)|daily\s+plan|for today|do today/.test(q)
  ) {
    let reply = `**Today's teaching plan — ${name}:**\n\n`;
    const steps = [];
    if (totals.homeworkPendingReview > 0) {
      steps.push(`Review **${totals.homeworkPendingReview}** homework submission(s)`);
    }
    if (totals.openExams > 0) {
      steps.push(`Monitor **${totals.openExams}** open exam(s)`);
    }
    if (totals.upcomingExams > 0 && desk.exams.upcoming[0]) {
      steps.push(
        `Prep class for upcoming exam **${desk.exams.upcoming[0].title}** (${desk.exams.upcoming[0].startLabel || 'soon'})`,
      );
    }
    if (totals.loggedInToday != null) {
      steps.push(
        `**${totals.loggedInToday}** student login(s) today — follow up with inactive students`,
      );
    }
    if (desk.omr?.latestBatch) {
      steps.push(`Check OMR batch **${desk.omr.latestBatch.title}** assignments`);
    }
    if (!steps.length) {
      steps.push('Review class progress', 'Assign practice / homework', 'Add a work-diary note');
    }
    steps.forEach((s, i) => {
      reply += `${i + 1}. ${s}\n`;
    });
    return reply.trim();
  }

  if (/my classes|how many classes|list (my )?classes|which classes/.test(q)) {
    if (!classes.length) {
      return 'No classes are assigned to you yet. Ask your school admin to assign class sections.';
    }
    if (wantCount && !wantList) {
      return `You have **${classes.length}** class(es). Ask **"list my classes"** for names and student counts.`;
    }
    let reply = `You have **${classes.length}** class(es):\n\n`;
    classes.forEach((c, i) => {
      reply += `${i + 1}. **${c.label}** — ${c.studentCount} student(s)\n`;
    });
    return reply.trim();
  }

  if (
    /how many students|my students|list\s+(?:out\s+)?(?:(?:all|every)\s+)?(?:my\s+)?students?|student\s+names?|roster|who is in (my )?class/.test(q)
  ) {
    if (!students.length) {
      return 'No students found in your assigned classes yet.';
    }
    if (wantCount && !wantList) {
      return `You have **${students.length}** student(s) across your classes. Ask **"list my students"** for the roster.`;
    }
    let reply = `**Your students (${students.length}):**\n\n`;
    students.slice(0, LIST_CAP).forEach((s, i) => {
      reply += `${i + 1}. ${s.name}`;
      if (s.classNumber) reply += ` · Class ${s.classNumber}${s.section ? `-${s.section}` : ''}`;
      reply += `\n`;
    });
    if (students.length > LIST_CAP) reply += `\n…and ${students.length - LIST_CAP} more.`;
    return reply.trim();
  }

  if (/attendance|logged in today|who (is|are) (active|online|present)/.test(q)) {
    if (wantCount) {
      return (
        `**${totals.loggedInToday || 0}** student login(s) today · ` +
        `**${totals.active7d || 0}** active in last 7 days (of **${totals.students || 0}**).`
      );
    }
    let reply = `**Attendance / login activity (IST ${desk.attendance?.todayKey || 'today'}):**\n`;
    reply += `• Student logins today: **${totals.loggedInToday || 0}**\n`;
    reply += `• Active in last 7 days: **${totals.active7d || 0}** of **${totals.students || 0}**\n`;
    reply += `\nThis uses platform login sessions. Period-wise biometric attendance, if your school uses it, is on the Attendance screen.`;
    return reply.trim();
  }

  if (/homework|assignment|submission/.test(q)) {
    if (wantCount) {
      return (
        `Homework: **${desk.homework?.submittedCount || 0}** submission(s) tracked · ` +
        `**${desk.homework?.pendingReview || 0}** pending your review.`
      );
    }
    let reply = `**Homework queue:**\n`;
    reply += `• Submissions tracked: **${desk.homework?.submittedCount || 0}**\n`;
    reply += `• Pending your review/grade: **${desk.homework?.pendingReview || 0}**\n`;
    const recent = (desk.homework?.submissions || []).slice(0, 12);
    if (recent.length) {
      reply += `\n**Recent submissions:**\n`;
      recent.forEach((h, i) => {
        const student = students.find((s) => s.id === h.studentId);
        reply += `${i + 1}. ${h.title} — ${student?.name || 'Student'}${
          h.grade != null ? ` · grade ${h.grade}` : ' · ungraded'
        }\n`;
      });
    }
    return reply.trim();
  }

  if (isTeacherExamDataQuestion(question)) {
    if (wantCount && !/last month|this month|previous month/.test(q)) {
      return (
        `Open exams: **${desk.exams?.open?.length || 0}** · ` +
        `Upcoming: **${desk.exams?.upcoming?.length || 0}**` +
        (desk.exams?.resultsCount30d
          ? ` · attempts (30d): **${desk.exams.resultsCount30d}**`
          : '') +
        '.'
      );
    }
    if (/upcoming exam|open exam|exam schedule/.test(q) && !/latest|recent|last month|this month|list|show/.test(q)) {
      // keep the open/upcoming breakdown below
    } else {
      return listSchoolExams(question, desk, now);
    }
  }

  if (/upcoming exam|open exam|exam schedule|what exams/.test(q) || (/exam/.test(q) && /upcoming|open|schedule|how many/.test(q))) {
    if (wantCount) {
      return (
        `Open exams: **${desk.exams?.open?.length || 0}** · ` +
        `Upcoming: **${desk.exams?.upcoming?.length || 0}**` +
        (desk.exams?.resultsCount30d
          ? ` · attempts (30d): **${desk.exams.resultsCount30d}**`
          : '') +
        '.'
      );
    }
    let reply = `**Exams for your school/classes:**\n\n`;
    if (desk.exams?.open?.length) {
      reply += `**Open now:**\n`;
      desk.exams.open.forEach((e, i) => {
        reply += `${i + 1}. **${e.title}**${e.endLabel ? ` · closes ${e.endLabel}` : ''}\n`;
      });
      reply += `\n`;
    }
    if (desk.exams?.upcoming?.length) {
      reply += `**Upcoming:**\n`;
      desk.exams.upcoming.forEach((e, i) => {
        reply += `${i + 1}. **${e.title}**${e.startLabel ? ` · ${e.startLabel}` : ''}\n`;
      });
    }
    if (!desk.exams?.open?.length && !desk.exams?.upcoming?.length) {
      reply += 'No open or upcoming exams matched right now.\n';
    }
    if (desk.exams?.resultsCount30d) {
      reply += `\nClass exam attempts (30d): **${desk.exams.resultsCount30d}**`;
      if (desk.exams.averagePct30d != null) {
        reply += ` · avg **${desk.exams.averagePct30d}%**`;
      }
    }
    return reply.trim();
  }

  if (/quiz|assessment/.test(q)) {
    const quizzes = desk.quizzes || [];
    if (wantCount) {
      return `You have **${quizzes.length}** published quiz${quizzes.length === 1 ? '' : 'zes'}.`;
    }
    if (!quizzes.length) {
      return 'You have no published quizzes yet. Create one from the Teacher Quizzes screen.';
    }
    let reply = `**Your quizzes (${quizzes.length}):**\n`;
    quizzes.forEach((qz, i) => {
      reply += `${i + 1}. **${qz.title}**${qz.difficulty ? ` · ${qz.difficulty}` : ''} · ${qz.attempts} attempt(s)\n`;
    });
    return reply.trim();
  }

  if (/\bomr\b|optical\s*mark/.test(q)) {
    if (wantCount) {
      return (
        `OMR: **${desk.omr?.batches || 0}** batch(es) · ` +
        `**${desk.omr?.assignedRows || 0}** row(s) linked to your students.`
      );
    }
    let reply = `**OMR for your school:**\n`;
    reply += `• Batches: **${desk.omr?.batches || 0}**\n`;
    reply += `• Rows linked to your students: **${desk.omr?.assignedRows || 0}**\n`;
    if (desk.omr?.latestBatch) {
      reply += `• Latest: **${desk.omr.latestBatch.title}** (${desk.omr.latestBatch.rowCount} rows)\n`;
    }
    reply += `\nOpen **Offline Results** in the teacher portal for full sheets.`;
    return reply.trim();
  }

  if (/work diary|diary/.test(q)) {
    const rows = desk.workDiary || [];
    if (wantCount) return `You have **${rows.length}** recent work-diary entr${rows.length === 1 ? 'y' : 'ies'}.`;
    if (!rows.length) return 'No work-diary entries yet. Add one from Work Diary.';
    let reply = `**Recent work diary:**\n`;
    rows.forEach((d, i) => {
      reply += `${i + 1}. ${d.title}${d.date ? ` · ${formatShortDate(d.date)}` : ''}\n`;
    });
    return reply.trim();
  }

  if (/overview|summary|how is (my )?class|dashboard/.test(q)) {
    let reply = `**Teacher overview — ${name}:**\n`;
    reply += `• Classes: **${totals.classes || 0}**\n`;
    reply += `• Students: **${totals.students || 0}**\n`;
    reply += `• Logins today: **${totals.loggedInToday || 0}**\n`;
    reply += `• Active (7d): **${totals.active7d || 0}**\n`;
    reply += `• Homework pending review: **${totals.homeworkPendingReview || 0}**\n`;
    reply += `• Quizzes: **${totals.quizzes || 0}**\n`;
    reply += `• Open exams: **${totals.openExams || 0}** · upcoming: **${totals.upcomingExams || 0}**\n`;
    if (desk.exams?.averagePct30d != null) {
      reply += `• Class exam avg (30d): **${desk.exams.averagePct30d}%**\n`;
    }
    reply += `\nAsk about a student by name, or **"homework"**, **"attendance"**, **"upcoming exams"**, **"OMR"**.`;
    return reply.trim();
  }

  if (entityFallbackMessage) return entityFallbackMessage;

  // Default snapshot
  let reply = `Hi ${name} — here's your teaching desk:\n\n`;
  reply += `• **${totals.classes || 0}** classes · **${totals.students || 0}** students\n`;
  reply += `• Logins today **${totals.loggedInToday || 0}** · homework to review **${totals.homeworkPendingReview || 0}**\n`;
  reply += `• Open exams **${totals.openExams || 0}** · upcoming **${totals.upcomingExams || 0}**\n`;
  reply += `\nAsk: **"what should I do today"**, **"my students"**, **"homework"**, **"attendance"**, or a student by name.`;
  return reply.trim();
}
