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

export function formatPeriodLabel(weekStart, weekEnd) {
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
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
    .select('_id fullName email lastLogin createdAt classNumber studyStreak')
    .lean();
}

async function sessionStatsForUsers(userIds, weekStart, weekEnd) {
  if (!userIds.length) {
    return { totalSessions: 0, totalMinutes: 0, byUser: new Map(), distinctActive: 0 };
  }
  const oids = userIds.map((id) => (id._id ? id._id : id));
  const rows = await UserSession.aggregate([
    {
      $match: {
        userId: { $in: oids },
        startTime: { $gte: weekStart, $lte: weekEnd },
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
    return { attempts: 0, correct: 0, topics: new Map(), repeatStudents: 0, bySubject: new Map() };
  }
  const oids = userIds.map((id) => (id._id ? id._id : id));
  const rows = await UserProgress.find({
    userId: { $in: oids },
    updatedAt: { $gte: weekStart, $lte: weekEnd },
    $or: [{ attempts: { $gt: 0 } }, { toolType: { $ne: '' } }, { topic: { $ne: '' } }],
  })
    .select('userId attempts correctCount subject topic toolType')
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
      `${snap.studentsAccessed} student(s) accessed the platform with ${snap.totalLearningSessions} learning sessions.`,
    );
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
 * Compute + upsert school impact snapshot for one admin and week.
 */
export async function buildSchoolImpactSnapshot(adminId, weekStartInput = new Date(), source = 'api') {
  const weekStart = startOfIsoWeek(weekStartInput);
  const weekEnd = endOfIsoWeek(weekStart);
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

  // Exam attempts in window count toward practice
  let examAttempts = 0;
  if (studentIds.length) {
    examAttempts = await ExamResult.countDocuments({
      userId: { $in: studentIds },
      completedAt: { $gte: weekStart, $lte: weekEnd },
    }).catch(() => 0);
  }

  const studentsAccessed = sessions.distinctActive;
  let studentsActive3Plus = 0;
  for (const stats of sessions.byUser.values()) {
    if (stats.sessions >= 3) studentsActive3Plus += 1;
  }

  const activeForRepeat = Math.max(1, studentsAccessed);
  const repeatPracticeStudentPct = Math.round((practice.repeatStudents / activeForRepeat) * 1000) / 10;

  const subjectMap = mergeSubjectMaps(vidya.bySubject, practice.bySubject);
  const topSubjects = topSubjectsFromMap(subjectMap);

  const practiceAttempts = practice.attempts + examAttempts;
  const practiceCorrectRate =
    practice.attempts > 0 ? Math.round((practice.correct / practice.attempts) * 1000) / 10 : 0;

  const avgSessionsPerActiveStudent =
    studentsAccessed > 0
      ? Math.round((sessions.totalSessions / studentsAccessed) * 10) / 10
      : 0;

  const payload = {
    adminId,
    schoolName,
    schoolEmail,
    location,
    weekStart,
    weekEnd,
    periodLabel: formatPeriodLabel(weekStart, weekEnd),
    freeTeacherLicenses: teachers.length,
    teachersIssued: teachers.length,
    teachersLoggedIn,
    teachersActive,
    teachersOccasional,
    teachersInactive,
    studentsIssued: students.length,
    studentsAccessed,
    studentsActive3Plus,
    totalLearningSessions: sessions.totalSessions,
    totalMinutesSpent: sessions.totalMinutes,
    avgSessionsPerActiveStudent,
    repeatPracticeStudentPct,
    aiExplanationsCount: vidya.calls,
    practiceAttempts,
    practiceCorrectRate,
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

export async function buildAllSchoolImpactSnapshots(weekStartInput = new Date(), source = 'cron') {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
  const results = [];
  for (const a of admins) {
    try {
      const snap = await buildSchoolImpactSnapshot(a._id, weekStartInput, source);
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

export async function buildStudentDigest(student, weekStart, weekEnd, schoolSnap) {
  const sid = student._id;
  const sessions = await sessionStatsForUsers([sid], weekStart, weekEnd);
  const mine = sessions.byUser.get(String(sid)) || { sessions: 0, minutes: 0 };
  const vidya = await vidyaStatsForUsers([sid], weekStart, weekEnd);
  const practice = await practiceStatsForUsers([sid], weekStart, weekEnd);
  const topicsPractised = practice.topicByUser.get(String(sid))?.size || 0;
  const metrics = {
    sessions: mine.sessions,
    minutes: mine.minutes,
    aiDoubts: vidya.byUser.get(String(sid)) || 0,
    practiceAttempts: practice.attempts,
    topicsPractised,
    streak: student.studyStreak?.current || 0,
    classNumber: student.classNumber || '',
  };
  const highlights = [];
  if (metrics.sessions > 0) {
    highlights.push(`You studied in ${metrics.sessions} session(s) (${metrics.minutes} min).`);
  }
  if (metrics.aiDoubts > 0) {
    highlights.push(`You asked Vidya AI ${metrics.aiDoubts} time(s).`);
  }
  if (metrics.topicsPractised > 0) {
    highlights.push(`You practised ${metrics.topicsPractised} topic(s).`);
  }
  if (metrics.streak > 0) {
    highlights.push(`Current streak: ${metrics.streak} day(s). Keep it going!`);
  }
  if (!highlights.length) {
    highlights.push('Open one chapter this week and try a short practice or ask Vidya AI a doubt.');
  }

  return WeeklyDigest.findOneAndUpdate(
    { userId: sid, weekStart },
    {
      $set: {
        role: 'student',
        adminId: schoolSnap?.adminId,
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

export async function listSchoolSnapshots(weekStartInput) {
  const weekStart = startOfIsoWeek(weekStartInput || new Date());
  return WeeklyImpactSnapshot.find({ weekStart }).sort({ schoolName: 1 }).lean();
}

export async function getSchoolSnapshot(adminId, weekStartInput) {
  const weekStart = startOfIsoWeek(weekStartInput || new Date());
  let snap = await WeeklyImpactSnapshot.findOne({ adminId, weekStart }).lean();
  if (!snap) {
    snap = (await buildSchoolImpactSnapshot(adminId, weekStart, 'api')).toObject?.() ||
      (await WeeklyImpactSnapshot.findOne({ adminId, weekStart }).lean());
  }
  return snap;
}

export async function getLatestDigestForUser(userId) {
  return WeeklyDigest.findOne({ userId }).sort({ weekStart: -1 }).lean();
}

export { dateKey };
