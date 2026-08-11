/**
 * School / teacher / student impact metrics for weekly reports.
 * Uses existing signals: User.lastLogin, UserSession, TeacherToolUsage,
 * AiToolGeneration, VidyaCallLog, UserProgress, ExamResult.
 */
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import School from '../models/School.js';
import UserSession from '../models/UserSession.js';
import TeacherToolUsage from '../models/TeacherToolUsage.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import VidyaCallLog from '../models/VidyaCallLog.js';
import UserProgress from '../models/UserProgress.js';
import ExamResult from '../models/ExamResult.js';
import IQRankQuizResult from '../models/IQRankQuizResult.js';
import HomeworkSubmission from '../models/HomeworkSubmission.js';
import StudentVideoChapterProgress from '../models/StudentVideoChapterProgress.js';
import OmrResultRow from '../models/OmrResultRow.js';
import OmrResultBatch from '../models/OmrResultBatch.js';
import WeeklyImpactSnapshot from '../models/WeeklyImpactSnapshot.js';
import WeeklyDigest from '../models/WeeklyDigest.js';

/** Monday 00:00 UTC of the week containing `d` (ISO week Monday). */
export function startOfIsoWeek(d = new Date()) {
  const date = new Date(d);
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

export function endOfIsoWeek(weekStart) {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 7);
  end.setUTCMilliseconds(-1);
  return end;
}

export function startOfUtcDay(d = new Date()) {
  const date = new Date(d);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function endOfUtcDay(d = new Date()) {
  const date = new Date(d);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

/** YYYY-MM-DD in Asia/Kolkata (school timezone). */
export function calendarDayKey(d, timeZone = 'Asia/Kolkata') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(d));
  } catch {
    return dateKey(d);
  }
}

function ymdOnly(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function startOfIstDay(ymd) {
  return new Date(`${ymd}T00:00:00.000+05:30`);
}

function endOfIstDay(ymd) {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

/**
 * Resolve a reporting window.
 * - Custom: { from, to } (inclusive calendar days, interpreted in IST)
 * - Weekly: { weekStart } → ISO week Mon–Sun
 */
export function resolveImpactPeriod({ weekStart, from, to } = {}) {
  if (from || to) {
    const fromYmd = ymdOnly(from) || ymdOnly(to);
    const toYmd = ymdOnly(to) || ymdOnly(from);
    if (!fromYmd || !toYmd) {
      throw new Error('Invalid from/to date');
    }
    let start = startOfIstDay(fromYmd);
    let end = endOfIstDay(toYmd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Invalid from/to date');
    }
    if (start > end) {
      const tmpStart = start;
      start = startOfIstDay(toYmd);
      end = endOfIstDay(fromYmd);
    }
    // Cap range to 93 days to avoid runaway jobs
    const maxMs = 93 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxMs) {
      throw new Error('Date range cannot exceed 93 days');
    }
    return {
      weekStart: start,
      weekEnd: end,
      periodLabel: formatPeriodLabel(start, end),
      mode: 'custom',
    };
  }
  const ws = startOfIsoWeek(weekStart ? new Date(weekStart) : new Date());
  const we = endOfIsoWeek(ws);
  return {
    weekStart: ws,
    weekEnd: we,
    periodLabel: formatPeriodLabel(ws, we),
    mode: 'weekly',
  };
}

export function formatPeriodLabel(weekStart, weekEnd) {
  const opts = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' };
  return `${weekStart.toLocaleDateString('en-IN', opts)} – ${weekEnd.toLocaleDateString('en-IN', opts)}`;
}

function dateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Active = 3+ session-days in last 14d; Occasional = 1–2; Inactive = 0 */
export function teacherStatusFromActiveDays(activeDays14) {
  if (activeDays14 >= 3) return 'active';
  if (activeDays14 >= 1) return 'occasional';
  return 'inactive';
}

async function schoolAdminUser(adminId) {
  return User.findById(adminId).select('fullName email schoolName city state schoolId').lean();
}

async function schoolMeta(admin) {
  let location = '';
  let schoolName = admin?.schoolName || admin?.fullName || 'School';
  if (admin?.schoolId) {
    const school = await School.findById(admin.schoolId)
      .select('name place pin schoolDetails')
      .lean();
    if (school) {
      schoolName = school.name || schoolName;
      const city = school.schoolDetails?.city || school.place || '';
      const state = school.schoolDetails?.state || '';
      location = [city, state].filter(Boolean).join(', ');
    }
  }
  return { schoolName, location, schoolEmail: admin?.email || '' };
}

async function teacherUserIdsForAdmin(adminId) {
  const [userTeachers, teacherDocs] = await Promise.all([
    User.find({ role: 'teacher', assignedAdmin: adminId, isActive: { $ne: false } })
      .select('_id fullName email lastLogin createdAt')
      .lean(),
    Teacher.find({ adminId, isActive: { $ne: false } }).select('fullName email name').lean(),
  ]);

  const byId = new Map();
  for (const t of userTeachers) {
    byId.set(String(t._id), {
      teacherId: t._id,
      name: t.fullName || '',
      email: t.email || '',
      lastLogin: t.lastLogin,
      createdAt: t.createdAt,
    });
  }
  for (const doc of teacherDocs) {
    const email = String(doc.email || '').toLowerCase().trim();
    if (!email) continue;
    const already = [...byId.values()].some((t) => String(t.email || '').toLowerCase() === email);
    if (already) continue;
    const u = await User.findOne({ email, role: 'teacher' })
      .select('_id fullName email lastLogin createdAt')
      .lean();
    if (u) {
      byId.set(String(u._id), {
        teacherId: u._id,
        name: u.fullName || doc.fullName || doc.name || '',
        email: u.email || email,
        lastLogin: u.lastLogin,
        createdAt: u.createdAt,
      });
    }
  }
  return [...byId.values()];
}

async function studentUsersForAdmin(adminId) {
  return User.find({ role: 'student', assignedAdmin: adminId, isActive: { $ne: false } })
    .select('_id fullName email lastLogin createdAt classNumber studyStreak overallProgress assignedAdmin')
    .lean();
}

async function sessionStatsForUsers(userIds, weekStart, weekEnd) {
  if (!userIds.length) {
    return { totalSessions: 0, totalMinutes: 0, byUser: new Map(), distinctActive: 0 };
  }
  const oids = userIds.map((id) => (id._id ? id._id : id));
  // Match calendar `date` in IST (same as login keys), not UTC ISO slice.
  const fromKey = calendarDayKey(weekStart);
  const toKey = calendarDayKey(weekEnd);
  const rows = await UserSession.aggregate([
    {
      $match: {
        userId: { $in: oids },
        $or: [
          { date: { $gte: fromKey, $lte: toKey } },
          { startTime: { $gte: weekStart, $lte: weekEnd } },
        ],
      },
    },
    {
      $group: {
        _id: '$userId',
        sessions: { $sum: 1 },
        minutes: { $sum: { $ifNull: ['$duration', 0] } },
        days: { $addToSet: '$date' },
      },
    },
  ]);
  const byUser = new Map();
  let totalSessions = 0;
  let totalMinutes = 0;
  for (const r of rows) {
    byUser.set(String(r._id), {
      sessions: r.sessions,
      minutes: r.minutes,
      activeDays: (r.days || []).length,
    });
    totalSessions += r.sessions;
    totalMinutes += r.minutes;
  }
  return { totalSessions, totalMinutes, byUser, distinctActive: rows.length };
}

/** Distinct students who either had a session row or logged in during the period. */
function addLoginAccessIds(students, accessed, weekStart, weekEnd) {
  const fromKey = calendarDayKey(weekStart);
  const toKey = calendarDayKey(weekEnd);
  for (const s of students) {
    if (!s.lastLogin) continue;
    const loginKey = calendarDayKey(s.lastLogin);
    if (loginKey >= fromKey && loginKey <= toKey) {
      accessed.add(String(s._id));
    }
  }
}

function addIds(accessed, ids) {
  for (const id of ids || []) {
    if (id) accessed.add(String(id));
  }
}

/**
 * Union every meaningful student engagement signal in the period:
 * login, session time, video/content progress, exams, IQ quizzes, homework, Vidya, chapter completion.
 */
async function collectStudentEngagement(students, sessionsByUser, weekStart, weekEnd) {
  const accessed = new Set(sessionsByUser.keys());
  addLoginAccessIds(students, accessed, weekStart, weekEnd);

  const empty = {
    studentsAccessed: accessed.size,
    videosWatchedCount: 0,
    studentsWatchedVideos: 0,
    examAttemptsCount: 0,
    studentsTookExams: 0,
    homeworkSubmissions: 0,
    iqQuizAttempts: 0,
    contentProgressTouches: 0,
  };

  const oids = students.map((s) => s._id).filter(Boolean);
  if (!oids.length) return empty;

  const progressDate = {
    $or: [
      { lastAccessed: { $gte: weekStart, $lte: weekEnd } },
      { updatedAt: { $gte: weekStart, $lte: weekEnd } },
    ],
  };

  const [
    videoProgressIds,
    videoProgressCount,
    anyProgressIds,
    anyProgressCount,
    examUserIds,
    examAttemptsCount,
    iqUserIds,
    iqQuizAttempts,
    homeworkUserIds,
    homeworkSubmissions,
    chapterProgressIds,
    vidyaUserIds,
  ] = await Promise.all([
    UserProgress.distinct('userId', {
      userId: { $in: oids },
      videoId: { $ne: null },
      ...progressDate,
    }).catch(() => []),
    UserProgress.countDocuments({
      userId: { $in: oids },
      videoId: { $ne: null },
      ...progressDate,
    }).catch(() => 0),
    UserProgress.distinct('userId', {
      userId: { $in: oids },
      ...progressDate,
    }).catch(() => []),
    UserProgress.countDocuments({
      userId: { $in: oids },
      ...progressDate,
    }).catch(() => 0),
    ExamResult.distinct('userId', {
      userId: { $in: oids },
      $or: [
        { completedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => []),
    ExamResult.countDocuments({
      userId: { $in: oids },
      $or: [
        { completedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => 0),
    IQRankQuizResult.distinct('userId', {
      userId: { $in: oids },
      $or: [
        { completedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => []),
    IQRankQuizResult.countDocuments({
      userId: { $in: oids },
      $or: [
        { completedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => 0),
    HomeworkSubmission.distinct('studentId', {
      studentId: { $in: oids },
      $or: [
        { submittedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => []),
    HomeworkSubmission.countDocuments({
      studentId: { $in: oids },
      $or: [
        { submittedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => 0),
    StudentVideoChapterProgress.distinct('userId', {
      userId: { $in: oids },
      updatedAt: { $gte: weekStart, $lte: weekEnd },
    }).catch(() => []),
    VidyaCallLog.distinct('userId', {
      userId: { $in: oids.map(String) },
      ts: { $gte: weekStart, $lte: weekEnd },
      success: { $ne: false },
    }).catch(() => []),
  ]);

  addIds(accessed, videoProgressIds);
  addIds(accessed, anyProgressIds);
  addIds(accessed, examUserIds);
  addIds(accessed, iqUserIds);
  addIds(accessed, homeworkUserIds);
  addIds(accessed, chapterProgressIds);
  addIds(accessed, vidyaUserIds);

  return {
    studentsAccessed: accessed.size,
    videosWatchedCount: videoProgressCount,
    studentsWatchedVideos: videoProgressIds.length,
    examAttemptsCount,
    studentsTookExams: examUserIds.length,
    homeworkSubmissions,
    iqQuizAttempts,
    contentProgressTouches: anyProgressCount,
  };
}

async function activeDaysInWindow(userId, since, until) {
  const days = await UserSession.distinct('date', {
    userId,
    startTime: { $gte: since, $lte: until },
  });
  return days.length;
}

async function teacherGenerations(teacherId, weekStart, weekEnd) {
  const [usage, gens] = await Promise.all([
    TeacherToolUsage.countDocuments({
      teacherId,
      createdAt: { $gte: weekStart, $lte: weekEnd },
    }),
    AiToolGeneration.countDocuments({
      $or: [{ generatedBy: teacherId }, { teacherId }],
      createdAt: { $gte: weekStart, $lte: weekEnd },
    }),
  ]);
  return usage + gens;
}

async function vidyaStatsForUsers(userIds, weekStart, weekEnd) {
  if (!userIds.length) return { calls: 0, byUser: new Map(), bySubject: new Map() };
  const idStrs = userIds.map((id) => String(id._id || id));
  const rows = await VidyaCallLog.aggregate([
    {
      $match: {
        userId: { $in: idStrs },
        ts: { $gte: weekStart, $lte: weekEnd },
        success: { $ne: false },
      },
    },
    {
      $group: {
        _id: { userId: '$userId', subject: '$subject' },
        n: { $sum: 1 },
      },
    },
  ]);
  const byUser = new Map();
  const bySubject = new Map();
  let calls = 0;
  for (const r of rows) {
    const uid = String(r._id.userId || '');
    const sub = String(r._id.subject || '').trim() || 'General';
    calls += r.n;
    byUser.set(uid, (byUser.get(uid) || 0) + r.n);
    bySubject.set(sub, (bySubject.get(sub) || 0) + r.n);
  }
  return { calls, byUser, bySubject };
}

async function practiceStatsForUsers(userIds, weekStart, weekEnd) {
  if (!userIds.length) {
    return { attempts: 0, correct: 0, topicByUser: new Map(), repeatStudents: 0, bySubject: new Map() };
  }
  const oids = userIds.map((id) => (id._id ? id._id : id));
  const rows = await UserProgress.find({
    userId: { $in: oids },
    $and: [
      {
        $or: [
          { lastAccessed: { $gte: weekStart, $lte: weekEnd } },
          { updatedAt: { $gte: weekStart, $lte: weekEnd } },
        ],
      },
      {
        $or: [{ attempts: { $gt: 0 } }, { toolType: { $ne: '' } }, { topic: { $ne: '' } }, { videoId: { $ne: null } }],
      },
    ],
  })
    .select('userId attempts correctCount subject topic toolType videoId')
    .lean();

  let attempts = 0;
  let correct = 0;
  const topicByUser = new Map();
  const bySubject = new Map();
  for (const r of rows) {
    const a = Number(r.attempts) || 0;
    const c = Number(r.correctCount) || 0;
    attempts += a;
    correct += c;
    const uid = String(r.userId);
    const topic = String(r.topic || '').trim();
    if (topic) {
      if (!topicByUser.has(uid)) topicByUser.set(uid, new Map());
      const m = topicByUser.get(uid);
      m.set(topic, (m.get(topic) || 0) + Math.max(1, a));
    }
    const sub = String(r.subject || '').trim() || 'General';
    bySubject.set(sub, (bySubject.get(sub) || 0) + Math.max(1, a));
  }
  let repeatStudents = 0;
  for (const [, topics] of topicByUser) {
    let hasRepeat = false;
    for (const count of topics.values()) {
      if (count >= 2) {
        hasRepeat = true;
        break;
      }
    }
    if (hasRepeat) repeatStudents += 1;
  }
  return { attempts, correct, topicByUser, repeatStudents, bySubject };
}

function mergeSubjectMaps(...maps) {
  const out = new Map();
  for (const m of maps) {
    for (const [k, v] of m.entries()) {
      out.set(k, (out.get(k) || 0) + v);
    }
  }
  return out;
}

function topSubjectsFromMap(map, limit = 5) {
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([subject, sessions]) => ({
      subject,
      sessions,
      pct: Math.round((sessions / total) * 1000) / 10,
    }));
}

function buildKeyObservation(snap) {
  const parts = [];
  if (snap.studentsAccessed > 0) {
    parts.push(
      `${snap.studentsAccessed} student(s) used the platform (login, videos, exams, practice, or AI).`,
    );
  }
  if (snap.studentsWatchedVideos > 0 || snap.videosWatchedCount > 0) {
    parts.push(
      `${snap.studentsWatchedVideos || 0} watched videos (${snap.videosWatchedCount || 0} video progress update(s)).`,
    );
  }
  if (snap.studentsTookExams > 0 || snap.examAttemptsCount > 0) {
    parts.push(
      `${snap.studentsTookExams || 0} attempted exams (${snap.examAttemptsCount || 0} attempt(s)).`,
    );
  }
  if (snap.homeworkSubmissions > 0) {
    parts.push(`${snap.homeworkSubmissions} homework submission(s).`);
  }
  if (snap.iqQuizAttempts > 0) {
    parts.push(`${snap.iqQuizAttempts} IQ Rank quiz attempt(s).`);
  }
  if (snap.repeatPracticeStudentPct > 0) {
    parts.push(
      `${snap.repeatPracticeStudentPct}% of active students practised the same concept more than once — a retention signal.`,
    );
  }
  if (snap.teachersActive > 0) {
    parts.push(`${snap.teachersActive} teacher(s) were Active (3+ session days in the last 14 days).`);
  }
  if (!parts.length) {
    return 'Early period — encourage first logins for teachers and students to build momentum.';
  }
  return parts.join(' ');
}

/**
 * Compute + upsert school impact snapshot for one admin and period.
 * @param {string|ObjectId} adminId
 * @param {Date|string|{ weekStart?: Date|string, from?: Date|string, to?: Date|string }} periodInput
 */
export async function buildSchoolImpactSnapshot(adminId, periodInput = new Date(), source = 'api') {
  const periodOpts =
    periodInput && typeof periodInput === 'object' && !(periodInput instanceof Date)
      ? periodInput
      : { weekStart: periodInput };
  const { weekStart, weekEnd, periodLabel } = resolveImpactPeriod(periodOpts);
  const admin = await schoolAdminUser(adminId);
  if (!admin) throw new Error('School admin not found');

  const { schoolName, location, schoolEmail } = await schoolMeta(admin);
  const teachers = await teacherUserIdsForAdmin(adminId);
  const students = await studentUsersForAdmin(adminId);

  const fourteenAgo = new Date(weekEnd);
  fourteenAgo.setUTCDate(fourteenAgo.getUTCDate() - 14);

  const teacherRows = [];
  let teachersLoggedIn = 0;
  let teachersActive = 0;
  let teachersOccasional = 0;
  let teachersInactive = 0;

  for (const t of teachers) {
    const activeDays14 = await activeDaysInWindow(t.teacherId, fourteenAgo, weekEnd);
    const status = teacherStatusFromActiveDays(activeDays14);
    const gens = await teacherGenerations(t.teacherId, weekStart, weekEnd);
    const weekSessions = await sessionStatsForUsers([t.teacherId], weekStart, weekEnd);
    const loggedThisWeek =
      (t.lastLogin && t.lastLogin >= weekStart && t.lastLogin <= weekEnd) ||
      (weekSessions.byUser.get(String(t.teacherId))?.sessions || 0) > 0;
    if (loggedThisWeek) teachersLoggedIn += 1;
    if (status === 'active') teachersActive += 1;
    else if (status === 'occasional') teachersOccasional += 1;
    else teachersInactive += 1;

    teacherRows.push({
      teacherId: t.teacherId,
      name: t.name,
      email: t.email,
      status,
      totalLoginsApprox: weekSessions.byUser.get(String(t.teacherId))?.sessions || 0,
      activeDays: activeDays14,
      generationsCreated: gens,
      lastActiveAt: t.lastLogin || null,
    });
  }

  const studentIds = students.map((s) => s._id);
  const sessions = await sessionStatsForUsers(studentIds, weekStart, weekEnd);
  const vidya = await vidyaStatsForUsers(studentIds, weekStart, weekEnd);
  const practice = await practiceStatsForUsers(studentIds, weekStart, weekEnd);
  const engagement = await collectStudentEngagement(students, sessions.byUser, weekStart, weekEnd);

  const examAttempts = engagement.examAttemptsCount;
  const studentsAccessed = engagement.studentsAccessed;
  let studentsActive3Plus = 0;
  for (const stats of sessions.byUser.values()) {
    if (stats.sessions >= 3) studentsActive3Plus += 1;
  }

  // Learning activity volume: sessions + video/content touches + exam/IQ/homework events
  const activityVolume =
    sessions.totalSessions +
    engagement.contentProgressTouches +
    engagement.examAttemptsCount +
    engagement.iqQuizAttempts +
    engagement.homeworkSubmissions;
  const loginOrEngageOnly =
    studentsAccessed > sessions.distinctActive
      ? Math.max(0, studentsAccessed - sessions.distinctActive)
      : 0;
  const totalLearningSessions = Math.max(activityVolume, sessions.totalSessions + loginOrEngageOnly);

  const activeForRepeat = Math.max(1, studentsAccessed);
  const repeatPracticeStudentPct = Math.round((practice.repeatStudents / activeForRepeat) * 1000) / 10;

  const subjectMap = mergeSubjectMaps(vidya.bySubject, practice.bySubject);
  const topSubjects = topSubjectsFromMap(subjectMap);

  const practiceAttempts = practice.attempts + examAttempts + engagement.iqQuizAttempts;
  const practiceCorrectRate =
    practice.attempts > 0 ? Math.round((practice.correct / practice.attempts) * 1000) / 10 : 0;

  const avgSessionsPerActiveStudent =
    studentsAccessed > 0
      ? Math.round((totalLearningSessions / studentsAccessed) * 10) / 10
      : 0;

  const payload = {
    adminId,
    schoolName,
    schoolEmail,
    location,
    weekStart,
    weekEnd,
    periodLabel,
    freeTeacherLicenses: teachers.length,
    teachersIssued: teachers.length,
    teachersLoggedIn,
    teachersActive,
    teachersOccasional,
    teachersInactive,
    studentsIssued: students.length,
    studentsAccessed,
    studentsActive3Plus,
    totalLearningSessions,
    totalMinutesSpent: sessions.totalMinutes,
    avgSessionsPerActiveStudent,
    repeatPracticeStudentPct,
    aiExplanationsCount: vidya.calls,
    practiceAttempts,
    practiceCorrectRate,
    videosWatchedCount: engagement.videosWatchedCount,
    studentsWatchedVideos: engagement.studentsWatchedVideos,
    examAttemptsCount: engagement.examAttemptsCount,
    studentsTookExams: engagement.studentsTookExams,
    homeworkSubmissions: engagement.homeworkSubmissions,
    iqQuizAttempts: engagement.iqQuizAttempts,
    contentProgressTouches: engagement.contentProgressTouches,
    topSubjects,
    teachers: teacherRows,
    keyObservation: '',
    generatedAt: new Date(),
    source,
  };
  payload.keyObservation = buildKeyObservation(payload);

  const doc = await WeeklyImpactSnapshot.findOneAndUpdate(
    { adminId, weekStart },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return doc;
}

/**
 * Per-student activity for a school in the period — used by View + multi-page PDF.
 */
export async function buildStudentImpactReports(adminId, periodInput = new Date()) {
  const periodOpts =
    periodInput && typeof periodInput === 'object' && !(periodInput instanceof Date)
      ? periodInput
      : { weekStart: periodInput };
  const { weekStart, weekEnd, periodLabel, mode } = resolveImpactPeriod(periodOpts);
  const students = await studentUsersForAdmin(adminId);
  if (!students.length) {
    return {
      periodLabel,
      mode,
      weekStart,
      weekEnd,
      studentReports: [],
      dayBreakdown: [],
      activeStudentCount: 0,
    };
  }

  const studentIds = students.map((s) => s._id);
  const sessions = await sessionStatsForUsers(studentIds, weekStart, weekEnd);
  const practice = await practiceStatsForUsers(studentIds, weekStart, weekEnd);
  const vidya = await vidyaStatsForUsers(studentIds, weekStart, weekEnd);

  const progressDate = {
    $or: [
      { lastAccessed: { $gte: weekStart, $lte: weekEnd } },
      { updatedAt: { $gte: weekStart, $lte: weekEnd } },
    ],
  };
  const examDate = {
    $or: [
      { completedAt: { $gte: weekStart, $lte: weekEnd } },
      { createdAt: { $gte: weekStart, $lte: weekEnd } },
    ],
  };

  const [
    videoByUser,
    examByUser,
    homeworkByUser,
    iqByUser,
    chapterByUser,
    daySessions,
  ] = await Promise.all([
    UserProgress.aggregate([
      { $match: { userId: { $in: studentIds }, videoId: { $ne: null }, ...progressDate } },
      {
        $group: {
          _id: '$userId',
          videos: { $addToSet: '$videoId' },
          touches: { $sum: 1 },
        },
      },
    ]).catch(() => []),
    ExamResult.aggregate([
      { $match: { userId: { $in: studentIds }, ...examDate } },
      {
        $group: {
          _id: '$userId',
          attempts: { $sum: 1 },
          avgPct: { $avg: { $ifNull: ['$percentage', 0] } },
          titles: { $addToSet: '$examTitle' },
          bestPct: { $max: { $ifNull: ['$percentage', 0] } },
        },
      },
    ]).catch(() => []),
    HomeworkSubmission.aggregate([
      {
        $match: {
          studentId: { $in: studentIds },
          $or: [
            { submittedAt: { $gte: weekStart, $lte: weekEnd } },
            { createdAt: { $gte: weekStart, $lte: weekEnd } },
          ],
        },
      },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]).catch(() => []),
    IQRankQuizResult.aggregate([
      {
        $match: {
          userId: { $in: studentIds },
          $or: [
            { completedAt: { $gte: weekStart, $lte: weekEnd } },
            { createdAt: { $gte: weekStart, $lte: weekEnd } },
          ],
        },
      },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]).catch(() => []),
    StudentVideoChapterProgress.aggregate([
      {
        $match: {
          userId: { $in: studentIds },
          updatedAt: { $gte: weekStart, $lte: weekEnd },
        },
      },
      { $group: { _id: '$userId', chapters: { $sum: 1 } } },
    ]).catch(() => []),
    UserSession.aggregate([
      {
        $match: {
          userId: { $in: studentIds },
          $or: [
            {
              date: {
                $gte: calendarDayKey(weekStart),
                $lte: calendarDayKey(weekEnd),
              },
            },
            { startTime: { $gte: weekStart, $lte: weekEnd } },
          ],
        },
      },
      {
        $group: {
          _id: '$date',
          sessions: { $sum: 1 },
          minutes: { $sum: { $ifNull: ['$duration', 0] } },
          students: { $addToSet: '$userId' },
        },
      },
      { $sort: { _id: 1 } },
    ]).catch(() => []),
  ]);

  const videoMap = new Map(
    videoByUser.map((r) => [
      String(r._id),
      { videosWatched: (r.videos || []).length, videoTouches: r.touches || 0 },
    ]),
  );
  const examMap = new Map(
    examByUser.map((r) => [
      String(r._id),
      {
        examAttempts: r.attempts || 0,
        avgExamPct: Math.round((r.avgPct || 0) * 10) / 10,
        bestExamPct: Math.round((r.bestPct || 0) * 10) / 10,
        examTitles: (r.titles || []).filter(Boolean).slice(0, 8),
      },
    ]),
  );
  const hwMap = new Map(homeworkByUser.map((r) => [String(r._id), r.count || 0]));
  const iqMap = new Map(iqByUser.map((r) => [String(r._id), r.count || 0]));
  const chapterMap = new Map(chapterByUser.map((r) => [String(r._id), r.chapters || 0]));

  const periodDays =
    Math.ceil((weekEnd.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const includeDayActivity = periodDays <= 31;

  const studentReports = students.map((s) => {
    const id = String(s._id);
    const sess = sessions.byUser.get(id) || { sessions: 0, minutes: 0, activeDays: 0 };
    const vid = videoMap.get(id) || { videosWatched: 0, videoTouches: 0 };
    const ex = examMap.get(id) || {
      examAttempts: 0,
      avgExamPct: 0,
      bestExamPct: 0,
      examTitles: [],
    };
    const aiDoubts = vidya.byUser.get(id) || 0;
    const practiceAttempts = (() => {
      // Approximate from topic map attempts when present
      const topics = practice.topicByUser?.get(id);
      if (!topics) return 0;
      let n = 0;
      for (const c of topics.values()) n += c;
      return n;
    })();
    const homework = hwMap.get(id) || 0;
    const iqAttempts = iqMap.get(id) || 0;
    const chapters = chapterMap.get(id) || 0;
    const loggedIn =
      s.lastLogin &&
      calendarDayKey(s.lastLogin) >= calendarDayKey(weekStart) &&
      calendarDayKey(s.lastLogin) <= calendarDayKey(weekEnd);
    const accessed =
      sess.sessions > 0 ||
      loggedIn ||
      vid.videosWatched > 0 ||
      ex.examAttempts > 0 ||
      homework > 0 ||
      iqAttempts > 0 ||
      aiDoubts > 0 ||
      chapters > 0 ||
      practiceAttempts > 0;

    return {
      studentId: id,
      name: s.fullName || 'Student',
      email: s.email || '',
      classNumber: s.classNumber || '',
      accessed,
      sessions: sess.sessions || 0,
      minutes: sess.minutes || 0,
      daysActive: sess.activeDays || 0,
      videosWatched: vid.videosWatched,
      videoTouches: vid.videoTouches,
      examAttempts: ex.examAttempts,
      avgExamPct: ex.avgExamPct,
      bestExamPct: ex.bestExamPct,
      examTitles: ex.examTitles,
      homeworkSubmissions: homework,
      iqAttempts,
      chaptersCompleted: chapters,
      aiDoubts,
      practiceAttempts,
      lastLogin: s.lastLogin || null,
      summary: accessed
        ? [
            sess.sessions ? `${sess.sessions} session(s)` : null,
            vid.videosWatched ? `${vid.videosWatched} video(s)` : null,
            ex.examAttempts ? `${ex.examAttempts} exam(s)` : null,
            aiDoubts ? `${aiDoubts} AI doubt(s)` : null,
            homework ? `${homework} homework` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : 'No activity in this period',
    };
  });

  studentReports.sort((a, b) => {
    if (a.accessed !== b.accessed) return a.accessed ? -1 : 1;
    const score = (r) =>
      (r.sessions || 0) * 10 +
      (r.videosWatched || 0) * 5 +
      (r.examAttempts || 0) * 8 +
      (r.aiDoubts || 0) * 3;
    return score(b) - score(a) || String(a.name).localeCompare(String(b.name));
  });

  const dayBreakdown = (daySessions || []).map((d) => ({
    date: d._id,
    sessions: d.sessions || 0,
    minutes: d.minutes || 0,
    students: (d.students || []).length,
  }));

  return {
    periodLabel,
    mode,
    weekStart,
    weekEnd,
    includeDayActivity,
    studentReports,
    dayBreakdown,
    activeStudentCount: studentReports.filter((r) => r.accessed).length,
    totalStudents: studentReports.length,
  };
}

/** Snapshot + live student-wise detail for View / PDF. */
export async function getSchoolImpactDetail(adminId, periodInput = new Date()) {
  const periodOpts =
    periodInput && typeof periodInput === 'object' && !(periodInput instanceof Date)
      ? periodInput
      : { weekStart: periodInput };
  const snap = await getSchoolSnapshot(adminId, periodOpts);
  const detail = await buildStudentImpactReports(adminId, periodOpts);
  const plain = snap?.toObject ? snap.toObject() : snap;
  return {
    ...plain,
    ...detail,
    studentReports: detail.studentReports,
    dayBreakdown: detail.dayBreakdown,
  };
}

export async function buildAllSchoolImpactSnapshots(periodInput = new Date(), source = 'cron') {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
  const results = [];
  for (const a of admins) {
    try {
      const snap = await buildSchoolImpactSnapshot(a._id, periodInput, source);
      results.push({ adminId: String(a._id), ok: true, id: String(snap._id) });
    } catch (err) {
      results.push({ adminId: String(a._id), ok: false, error: err.message });
    }
  }
  return results;
}

export async function buildTeacherDigest(teacherUser, weekStart, weekEnd, schoolSnap) {
  const tid = teacherUser._id || teacherUser.teacherId;
  const sessions = await sessionStatsForUsers([tid], weekStart, weekEnd);
  const gens = await teacherGenerations(tid, weekStart, weekEnd);
  const mine = (schoolSnap?.teachers || []).find((t) => String(t.teacherId) === String(tid));
  const metrics = {
    sessions: sessions.byUser.get(String(tid))?.sessions || 0,
    minutes: sessions.byUser.get(String(tid))?.minutes || 0,
    generationsCreated: gens,
    status: mine?.status || teacherStatusFromActiveDays(mine?.activeDays || 0),
    schoolStudentsAccessed: schoolSnap?.studentsAccessed || 0,
    schoolSessions: schoolSnap?.totalLearningSessions || 0,
  };
  const highlights = [];
  if (metrics.generationsCreated > 0) {
    highlights.push(`You created ${metrics.generationsCreated} AI teaching resource(s) this week.`);
  }
  if (metrics.sessions > 0) {
    highlights.push(`You had ${metrics.sessions} learning session(s) on the platform.`);
  }
  if (metrics.status === 'inactive') {
    highlights.push('Tip: log in 3+ days in the next two weeks to stay Active on the school impact report.');
  } else if (metrics.status === 'active') {
    highlights.push('Status: Active — great consistency for your school’s pilot metrics.');
  }
  if (!highlights.length) {
    highlights.push('Open Vidya AI or an AI tool this week to start building your teaching trail.');
  }

  return WeeklyDigest.findOneAndUpdate(
    { userId: tid, weekStart },
    {
      $set: {
        role: 'teacher',
        adminId: schoolSnap?.adminId,
        weekEnd,
        title: 'Your weekly AsliLearn teacher report',
        summary: `Week of ${formatPeriodLabel(weekStart, weekEnd)}`,
        metrics,
        highlights,
        emailStatus: 'pending',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

function formatMinutesLabel(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} min`;
  if (m <= 0) return `${h} hr${h === 1 ? '' : 's'}`;
  return `${h} hr${h === 1 ? '' : 's'} ${m} min`;
}

/**
 * Full student tracking metrics for a week window (matches Student Tracking Structure).
 */
export async function computeStudentWeeklyTracking(student, weekStart, weekEnd) {
  const sid = student._id;
  const sidStr = String(sid);
  const examDate = {
    $or: [
      { completedAt: { $gte: weekStart, $lte: weekEnd } },
      { createdAt: { $gte: weekStart, $lte: weekEnd } },
    ],
  };
  const progressDate = {
    $or: [
      { lastAccessed: { $gte: weekStart, $lte: weekEnd } },
      { updatedAt: { $gte: weekStart, $lte: weekEnd } },
    ],
  };

  const [
    sessions,
    vidya,
    practice,
    examAgg,
    examRows,
    iqCount,
    homeworkCount,
    videoAgg,
    chapterCount,
    aiToolOpens,
    earliestSession,
    lifetimeSessions,
    omrRows,
  ] = await Promise.all([
    sessionStatsForUsers([sid], weekStart, weekEnd),
    vidyaStatsForUsers([sid], weekStart, weekEnd),
    practiceStatsForUsers([sid], weekStart, weekEnd),
    ExamResult.aggregate([
      { $match: { userId: sid, ...examDate } },
      {
        $group: {
          _id: '$userId',
          attempts: { $sum: 1 },
          avgPct: { $avg: { $ifNull: ['$percentage', 0] } },
          bestPct: { $max: { $ifNull: ['$percentage', 0] } },
          totalCorrect: { $sum: { $ifNull: ['$correctAnswers', 0] } },
          totalQuestions: { $sum: { $ifNull: ['$totalQuestions', 0] } },
        },
      },
    ]).catch(() => []),
    ExamResult.find({ userId: sid, ...examDate })
      .select('examTitle percentage obtainedMarks totalMarks completedAt createdAt correctAnswers wrongAnswers unattempted')
      .sort({ completedAt: -1, createdAt: -1 })
      .limit(12)
      .lean()
      .catch(() => []),
    IQRankQuizResult.countDocuments({
      userId: sid,
      $or: [
        { completedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => 0),
    HomeworkSubmission.countDocuments({
      studentId: sid,
      $or: [
        { submittedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    }).catch(() => 0),
    UserProgress.aggregate([
      { $match: { userId: sid, videoId: { $ne: null }, ...progressDate } },
      {
        $group: {
          _id: '$userId',
          videos: { $addToSet: '$videoId' },
          touches: { $sum: 1 },
        },
      },
    ]).catch(() => []),
    StudentVideoChapterProgress.countDocuments({
      userId: sid,
      updatedAt: { $gte: weekStart, $lte: weekEnd },
    }).catch(() => 0),
    Promise.all([
      AiToolGeneration.countDocuments({
        generatedBy: sid,
        createdAt: { $gte: weekStart, $lte: weekEnd },
      }).catch(() => 0),
      AiToolGeneration.countDocuments({
        generatedBy: sidStr,
        createdAt: { $gte: weekStart, $lte: weekEnd },
      }).catch(() => 0),
      UserProgress.countDocuments({
        userId: sid,
        toolType: { $nin: [null, ''] },
        ...progressDate,
      }).catch(() => 0),
    ]),
    UserSession.findOne({ userId: sid }).sort({ date: 1 }).select('date startTime').lean().catch(() => null),
    UserSession.countDocuments({ userId: sid }).catch(() => 0),
    OmrResultRow.find({
      userId: sid,
      $or: [
        { assignedAt: { $gte: weekStart, $lte: weekEnd } },
        { createdAt: { $gte: weekStart, $lte: weekEnd } },
        { updatedAt: { $gte: weekStart, $lte: weekEnd } },
      ],
    })
      .select('batchId percentage totalMarks correct wrong left attempted testRank finalRank createdAt assignedAt')
      .sort({ assignedAt: -1, createdAt: -1 })
      .limit(12)
      .lean()
      .catch(() => []),
  ]);

  const mine = sessions.byUser.get(sidStr) || { sessions: 0, minutes: 0, activeDays: 0 };
  const topicMap = practice.topicByUser?.get(sidStr) || new Map();
  const topicsPractised = topicMap.size;
  let topicsRepeated = 0;
  let topicTouches = 0;
  for (const count of topicMap.values()) {
    topicTouches += count;
    if (count >= 2) topicsRepeated += 1;
  }
  const repeatPracticePct =
    topicsPractised > 0 ? Math.round((topicsRepeated / topicsPractised) * 1000) / 10 : 0;

  const practiceAttempts = practice.attempts || 0;
  const practiceCorrect = practice.correct || 0;
  const practiceAccuracy =
    practiceAttempts > 0 ? Math.round((practiceCorrect / practiceAttempts) * 1000) / 10 : 0;

  const ex = examAgg[0] || {};
  const examAttempts = ex.attempts || 0;
  const avgExamPct = Math.round((ex.avgPct || 0) * 10) / 10;
  const bestExamPct = Math.round((ex.bestPct || 0) * 10) / 10;
  const examQuestionAccuracy =
    ex.totalQuestions > 0
      ? Math.round(((ex.totalCorrect || 0) / ex.totalQuestions) * 1000) / 10
      : 0;

  const vidyaDoubts = vidya.byUser.get(sidStr) || 0;
  const [aiGenByOid, aiGenByStr, aiToolProgress] = aiToolOpens;
  const aiToolUses = (aiGenByOid || 0) + (aiGenByStr || 0) + (aiToolProgress || 0);
  const aiExplanations = vidyaDoubts + aiToolUses;

  const videoRow = videoAgg[0] || {};
  const videosWatched = (videoRow.videos || []).length;
  const avgSessionMinutes =
    mine.sessions > 0 ? Math.round(((mine.minutes || 0) / mine.sessions) * 10) / 10 : 0;

  const subjectMap = mergeSubjectMaps(practice.bySubject || new Map(), vidya.bySubject || new Map());
  const topSubjects = topSubjectsFromMap(subjectMap, 5).map((s) => s.subject);

  const activationDate =
    earliestSession?.date ||
    (earliestSession?.startTime ? calendarDayKey(earliestSession.startTime) : null) ||
    (student.createdAt ? calendarDayKey(student.createdAt) : null);

  const loggedInThisWeek =
    Boolean(student.lastLogin) &&
    calendarDayKey(student.lastLogin) >= calendarDayKey(weekStart) &&
    calendarDayKey(student.lastLogin) <= calendarDayKey(weekEnd);

  const loginDays = Math.max(mine.activeDays || 0, loggedInThisWeek ? 1 : 0, mine.sessions > 0 ? 1 : 0);
  // Prefer distinct active days as "logins" since we store one session row per calendar day.
  const loginCount = Math.max(loginDays, mine.activeDays || 0);

  const exams = (examRows || []).map((r) => ({
    title: r.examTitle || 'Exam',
    percentage: Math.round((Number(r.percentage) || 0) * 10) / 10,
    obtainedMarks: r.obtainedMarks,
    totalMarks: r.totalMarks,
    correctAnswers: r.correctAnswers,
    wrongAnswers: r.wrongAnswers,
    unattempted: r.unattempted,
    completedAt: r.completedAt || r.createdAt || null,
  }));

  const omrBatchIds = [...new Set((omrRows || []).map((r) => String(r.batchId || '')).filter(Boolean))];
  const omrBatches =
    omrBatchIds.length > 0
      ? await OmrResultBatch.find({ _id: { $in: omrBatchIds } })
          .select('_id testTitle testNo testDate')
          .lean()
          .catch(() => [])
      : [];
  const omrBatchById = new Map(omrBatches.map((b) => [String(b._id), b]));
  const omrResults = (omrRows || []).map((r) => {
    const batch = omrBatchById.get(String(r.batchId || ''));
    return {
      title: batch?.testTitle || batch?.testNo || 'OMR test',
      percentage: Math.round((Number(r.percentage) || 0) * 10) / 10,
      totalMarks: r.totalMarks,
      correct: r.correct,
      wrong: r.wrong,
      left: r.left,
      rank: r.finalRank ?? r.testRank ?? null,
      completedAt: r.assignedAt || r.createdAt || null,
    };
  });
  const omrAttempts = omrResults.length;
  const omrAvgPct =
    omrAttempts > 0
      ? Math.round(
          (omrResults.reduce((s, r) => s + (Number(r.percentage) || 0), 0) / omrAttempts) * 10,
        ) / 10
      : 0;
  const omrBestPct =
    omrAttempts > 0 ? Math.max(...omrResults.map((r) => Number(r.percentage) || 0)) : 0;
  const omrBestRank = (() => {
    const ranks = omrResults.map((r) => Number(r.rank)).filter((x) => Number.isFinite(x) && x > 0);
    return ranks.length ? Math.min(...ranks) : null;
  })();

  return {
    // Adoption
    activationDate,
    loginCount,
    loginDays,
    lastActiveDate: student.lastLogin ? calendarDayKey(student.lastLogin) : null,
    lifetimeLoginDays: lifetimeSessions || 0,

    // Engagement
    sessions: mine.sessions || 0,
    minutes: mine.minutes || 0,
    totalTimeLabel: formatMinutesLabel(mine.minutes || 0),
    avgSessionMinutes,
    daysActive: mine.activeDays || 0,

    // Learning behaviour
    topicsPractised,
    topicsRepeated,
    repeatPracticePct,
    topicTouches,

    // AI usage
    aiDoubts: vidyaDoubts,
    aiToolUses,
    aiExplanations,
    practiceAttempts,
    practiceCorrect,
    practiceAccuracy,
    iqAttempts: iqCount || 0,
    homeworkSubmissions: homeworkCount || 0,

    // Content focus
    topSubjects,
    videosWatched,
    chaptersCompleted: chapterCount || 0,

    // Progress
    streak: student.studyStreak?.current || 0,
    masteryPct: Math.round(Number(student.overallProgress) || 0),
    classNumber: student.classNumber || '',

    // Exams
    examAttempts,
    avgExamPct,
    bestExamPct,
    examQuestionAccuracy,
    exams,

    // OMR results
    omrAttempts,
    omrAvgPct,
    omrBestPct,
    omrBestRank,
    omrResults,
  };
}

function studentDigestHighlights(metrics) {
  const highlights = [];
  if (metrics.loginCount > 0) {
    highlights.push(`You logged in on ${metrics.loginCount} day(s) this week.`);
  }
  if (metrics.sessions > 0) {
    highlights.push(
      `You studied in ${metrics.sessions} session(s) (${metrics.totalTimeLabel || `${metrics.minutes} min`}).`,
    );
  }
  if (metrics.examAttempts > 0) {
    highlights.push(
      `You wrote ${metrics.examAttempts} exam(s) — avg ${metrics.avgExamPct}% (best ${metrics.bestExamPct}%).`,
    );
  }
  if (metrics.omrAttempts > 0) {
    const rankBit =
      metrics.omrBestRank != null ? ` · best rank #${metrics.omrBestRank}` : '';
    highlights.push(
      `OMR results this week: ${metrics.omrAttempts} test(s) — avg ${metrics.omrAvgPct}% (best ${metrics.omrBestPct}%)${rankBit}.`,
    );
  }
  if (metrics.aiExplanations > 0) {
    highlights.push(
      `You used AI ${metrics.aiExplanations} time(s) (Vidya ${metrics.aiDoubts}, tools ${metrics.aiToolUses}).`,
    );
  }
  if (metrics.topicsPractised > 0) {
    highlights.push(
      `You practised ${metrics.topicsPractised} topic(s)${
        metrics.topicsRepeated > 0
          ? ` · ${metrics.topicsRepeated} repeated (${metrics.repeatPracticePct}% repeat)`
          : ''
      }.`,
    );
  }
  if (metrics.practiceAttempts > 0) {
    highlights.push(
      `Practice / quiz attempts: ${metrics.practiceAttempts} · accuracy ${metrics.practiceAccuracy}%.`,
    );
  }
  if (metrics.topSubjects?.length) {
    highlights.push(`Top subjects: ${metrics.topSubjects.slice(0, 3).join(', ')}.`);
  }
  if (metrics.streak > 0) {
    highlights.push(`Current streak: ${metrics.streak} day(s). Keep it going!`);
  }
  if (!highlights.length) {
    highlights.push('Open one chapter this week and try a short practice or ask Vidya AI a doubt.');
  }
  return highlights;
}

export async function buildStudentDigest(student, weekStart, weekEnd, schoolSnap) {
  const sid = student._id;
  const metrics = await computeStudentWeeklyTracking(student, weekStart, weekEnd);
  const highlights = studentDigestHighlights(metrics);

  return WeeklyDigest.findOneAndUpdate(
    { userId: sid, weekStart },
    {
      $set: {
        role: 'student',
        adminId: schoolSnap?.adminId || student.assignedAdmin || undefined,
        weekEnd,
        title: 'Your weekly AsliLearn learning report',
        summary: `Week of ${formatPeriodLabel(weekStart, weekEnd)}`,
        metrics,
        highlights,
        emailStatus: 'pending',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/** Rebuild only this student's digest (dashboard refresh — not whole school). */
export async function rebuildStudentWeeklyDigestForUser(userId, weekStartInput = new Date()) {
  const weekStart = startOfIsoWeek(weekStartInput);
  const weekEnd = endOfIsoWeek(weekStart);
  const student = await User.findById(userId)
    .select('_id role fullName email lastLogin createdAt classNumber studyStreak overallProgress assignedAdmin')
    .lean();
  if (!student || student.role !== 'student') return null;
  return buildStudentDigest(student, weekStart, weekEnd, { adminId: student.assignedAdmin });
}

/**
 * Build digests for all teachers + students of one school for the week.
 */
export async function buildDigestsForSchool(adminId, weekStartInput = new Date()) {
  const weekStart = startOfIsoWeek(weekStartInput);
  const weekEnd = endOfIsoWeek(weekStart);
  const snap =
    (await WeeklyImpactSnapshot.findOne({ adminId, weekStart }).lean()) ||
    (await buildSchoolImpactSnapshot(adminId, weekStart, 'api'));

  const teachers = await teacherUserIdsForAdmin(adminId);
  const students = await studentUsersForAdmin(adminId);
  const digests = [];
  for (const t of teachers) {
    digests.push(await buildTeacherDigest(t, weekStart, weekEnd, snap));
  }
  for (const s of students) {
    digests.push(await buildStudentDigest(s, weekStart, weekEnd, snap));
  }
  return digests;
}

export async function listSchoolSnapshots(periodInput) {
  const { weekStart } = resolveImpactPeriod(
    periodInput && typeof periodInput === 'object' && !(periodInput instanceof Date)
      ? periodInput
      : { weekStart: periodInput || new Date() },
  );
  const rows = await WeeklyImpactSnapshot.find({ weekStart }).lean();
  // Active schools first so live usage is visible at the top of the list.
  rows.sort((a, b) => {
    const score = (s) =>
      (Number(s.studentsAccessed) || 0) * 1000 +
      (Number(s.totalLearningSessions) || 0) * 10 +
      (Number(s.teachersActive) || 0) * 5 +
      (Number(s.teachersLoggedIn) || 0) +
      (Number(s.aiExplanationsCount) || 0) +
      (Number(s.practiceAttempts) || 0);
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return String(a.schoolName || '').localeCompare(String(b.schoolName || ''));
  });
  return rows;
}

export async function getSchoolSnapshot(adminId, periodInput) {
  const periodOpts =
    periodInput && typeof periodInput === 'object' && !(periodInput instanceof Date)
      ? periodInput
      : { weekStart: periodInput || new Date() };
  // Always rebuild from live logins/sessions so weekly + day-to-day reflect the latest access
  // (cached Monday snapshots were staying at 0 after students logged in later in the week).
  const built = await buildSchoolImpactSnapshot(adminId, periodOpts, 'api');
  if (built?.toObject) return built.toObject();
  return (
    built ||
    (await WeeklyImpactSnapshot.findOne({
      adminId,
      weekStart: resolveImpactPeriod(periodOpts).weekStart,
    }).lean())
  );
}

export async function getLatestDigestForUser(userId) {
  return WeeklyDigest.findOne({ userId }).sort({ weekStart: -1 }).lean();
}

export { dateKey };
