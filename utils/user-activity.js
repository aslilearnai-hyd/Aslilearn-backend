import mongoose from 'mongoose';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import UserSession from '../models/UserSession.js';

const MAX_SESSION_MINUTES_PER_DAY = 12 * 60;

/** YYYY-MM-DD in Asia/Kolkata (school timezone). */
export function activityDayKey(d, timeZone = 'Asia/Kolkata') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(d));
  } catch {
    return new Date(d).toISOString().slice(0, 10);
  }
}

export function capSessionMinutesPerDay(minutes) {
  const n = Math.round(Number(minutes) || 0);
  return Math.min(MAX_SESSION_MINUTES_PER_DAY, Math.max(0, n));
}

function toObjectId(userId) {
  if (!userId) return null;
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  const s = String(userId);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

export async function touchLastLogin(userId) {
  const id = toObjectId(userId);
  if (!id) return null;
  const now = new Date();
  await Promise.all([
    Teacher.findByIdAndUpdate(id, { lastLogin: now }, { runValidators: false }).catch(() => null),
    User.findByIdAndUpdate(id, { lastLogin: now }, { runValidators: false }).catch(() => null),
  ]);
  return now;
}

export async function recordDailyAccessSession(userId, { at = new Date(), minDuration = 1 } = {}) {
  const id = toObjectId(userId);
  if (!id) return null;
  const dateKey = activityDayKey(at);
  const session = await UserSession.findOne({ userId: id, date: dateKey });
  if (session) {
    // Presence ping: bump endTime only. Never let (endTime - midnight) rewrite duration.
    const nextDuration = Math.max(Number(session.duration) || 0, minDuration);
    session.endTime = at;
    session.duration = capSessionMinutesPerDay(nextDuration);
    session.markModified('duration');
    await session.save();
    return session;
  }
  return UserSession.create({
    userId: id,
    date: dateKey,
    startTime: new Date(`${dateKey}T00:00:00.000+05:30`),
    endTime: at,
    duration: capSessionMinutesPerDay(minDuration),
  });
}

/** Mark a teacher/user as present today: lastLogin + daily session row. */
export async function recordUserPresence(userId, opts) {
  if (!userId) return;
  await Promise.all([
    touchLastLogin(userId).catch(() => null),
    recordDailyAccessSession(userId, opts).catch((err) => {
      console.warn('Presence session skipped:', err?.message);
    }),
  ]);
}

export async function upsertSessionMinutes(userId, date, totalMinutes) {
  const id = toObjectId(userId);
  if (!id) return null;
  const dateKey = String(date || '').includes('T')
    ? String(date).split('T')[0]
    : String(date || activityDayKey(new Date()));
  const duration = capSessionMinutesPerDay(totalMinutes);
  const now = new Date();
  const session = await UserSession.findOne({ userId: id, date: dateKey });
  if (session) {
    session.endTime = now;
    // Always re-assert duration so pre-save never falls back to wall-clock math.
    session.duration = Math.max(duration, Number(session.duration) || 0);
    session.markModified('duration');
    await session.save();
    return session;
  }
  return UserSession.create({
    userId: id,
    date: dateKey,
    startTime: new Date(`${dateKey}T00:00:00.000+05:30`),
    endTime: now,
    duration,
  });
}

export async function getRecentSessionTime(userId, days = 7) {
  const id = toObjectId(userId);
  if (!id) {
    return { today: 0, thisWeek: 0, weeklyData: {}, sessions: [] };
  }
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  const fromKey = activityDayKey(from);
  const sessions = await UserSession.find({
    userId: id,
    date: { $gte: fromKey },
  })
    .sort({ date: 1 })
    .lean();

  const durationByDate = new Map();
  sessions.forEach((session) => {
    const duration = capSessionMinutesPerDay(session?.duration || 0);
    durationByDate.set(session.date, Math.max(durationByDate.get(session.date) || 0, duration));
  });
  const weeklyData = {};
  for (let i = 0; i < days; i += 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = activityDayKey(d);
    weeklyData[key] = durationByDate.get(key) || 0;
  }
  const weeklyTotal = Object.values(weeklyData).reduce((sum, mins) => sum + mins, 0);
  const todayKey = activityDayKey(today);
  return {
    today: capSessionMinutesPerDay(weeklyData[todayKey] || 0),
    thisWeek: weeklyTotal,
    weeklyData,
    sessions,
  };
}

export async function handleSaveSessionTime(req, res) {
  try {
    const userId = req.teacherId || req.userId;
    const { date, totalMinutes } = req.body || {};
    if (!date || totalMinutes === undefined) {
      return res.status(400).json({ success: false, message: 'Date and totalMinutes are required' });
    }
    await touchLastLogin(userId).catch(() => null);
    const session = await upsertSessionMinutes(userId, date, totalMinutes);
    return res.json({
      success: true,
      message: 'Session time saved successfully',
      data: session,
    });
  } catch (error) {
    console.error('Save session time error:', error);
    return res.status(500).json({ success: false, message: 'Failed to save session time' });
  }
}

export async function handleGetSessionTime(req, res, { recordPresence = false } = {}) {
  try {
    const userId = req.teacherId || req.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    if (recordPresence) {
      await recordUserPresence(userId).catch(() => null);
    }
    const data = await getRecentSessionTime(userId, 7);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Get session time error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch session time' });
  }
}
