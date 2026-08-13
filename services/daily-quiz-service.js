/**
 * Daily Quiz — pick 5 questions from the imported bank.
 * Follows spreadsheet rules: class filter, category spread, difficulty by streak,
 * 30-day no-repeat, seeded random (date + userId).
 */

import crypto from 'crypto';
import IQRankQuestion from '../models/IQRankQuestion.js';
import DailyQuizLog from '../models/DailyQuizLog.js';

export const DAILY_QUIZ_BANK_SOURCE = 'daily-quiz-xlsx';
export const DAILY_PICK_COUNT = 5;

const CATEGORIES = [
  'IQ & Critical Thinking',
  'Critical Reasoning',
  'Vocabulary & Verbal Skills',
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
];

function normalizeClassNumber(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/^Class\s+/i, '')
    .trim();
}

/** Calendar date key in Asia/Kolkata. */
export function indiaDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function hashSeed(parts) {
  const h = crypto.createHash('sha256').update(parts.join('|')).digest();
  return h.readUInt32BE(0);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(arr, rand) {
  if (!arr.length) return null;
  return arr[Math.floor(rand() * arr.length)];
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Rotate which 2 of 7 categories are skipped each day so all appear across a week. */
export function categoriesForDate(dateKey) {
  const dayIndex = Math.floor(new Date(`${dateKey}T00:00:00+05:30`).getTime() / 86400000);
  const skipA = ((dayIndex % 7) + 7) % 7;
  const skipB = (skipA + 3) % 7;
  return CATEGORIES.filter((_, i) => i !== skipA && i !== skipB);
}

function difficultyPoolForStreak(streakDays) {
  if (streakDays >= 30) return ['easy', 'medium', 'hard'];
  if (streakDays >= 7) return ['easy', 'medium', 'medium', 'hard'];
  return ['easy', 'easy', 'medium', 'medium'];
}

async function recentSourceIds(userId, beforeDateKey, days = 30) {
  const start = new Date(`${beforeDateKey}T00:00:00+05:30`);
  start.setDate(start.getDate() - days);
  const startKey = indiaDateKey(start);
  const logs = await DailyQuizLog.find({
    userId,
    dateKey: { $gte: startKey, $lt: beforeDateKey },
  })
    .select('sourceIds')
    .lean();
  const set = new Set();
  for (const log of logs) {
    for (const id of log.sourceIds || []) set.add(String(id));
  }
  return set;
}

async function computeStreak(userId, beforeDateKey) {
  let streak = 0;
  let cursor = new Date(`${beforeDateKey}T00:00:00+05:30`);
  for (let i = 0; i < 60; i += 1) {
    cursor.setDate(cursor.getDate() - 1);
    const key = indiaDateKey(cursor);
    const log = await DailyQuizLog.findOne({ userId, dateKey: key, completedAt: { $ne: null } })
      .select('_id')
      .lean();
    if (!log) break;
    streak += 1;
  }
  return streak;
}

/**
 * Returns up to `count` questions for this user/class/day (cached in DailyQuizLog).
 */
export async function getOrCreateDailyQuestions({
  userId,
  classNumber,
  quizId = null,
  count = DAILY_PICK_COUNT,
  now = new Date(),
}) {
  const classNum = normalizeClassNumber(classNumber);
  if (!classNum || !userId) {
    return { dateKey: indiaDateKey(now), questions: [], log: null };
  }

  const dateKey = indiaDateKey(now);
  let log = await DailyQuizLog.findOne({ userId, dateKey });
  if (log?.questionIds?.length) {
    const questions = await IQRankQuestion.find({
      _id: { $in: log.questionIds },
      isActive: true,
    })
      .populate('subject', 'name')
      .lean();
    const order = new Map(log.questionIds.map((id, i) => [String(id), i]));
    questions.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
    return { dateKey, questions, log };
  }

  const streak = await computeStreak(userId, dateKey);
  const recent = await recentSourceIds(userId, dateKey, 30);
  const cats = categoriesForDate(dateKey);
  const diffPool = difficultyPoolForStreak(streak);
  const rand = mulberry32(hashSeed([String(userId), dateKey, classNum, 'daily-quiz']));

  const picked = [];
  const pickedSource = new Set();

  for (const category of cats) {
    if (picked.length >= count) break;

    const baseQuery = {
      bankSource: DAILY_QUIZ_BANK_SOURCE,
      classNumber: classNum,
      category,
      isActive: true,
    };

    let pool = await IQRankQuestion.find({
      ...baseQuery,
      difficulty: { $in: [...new Set(diffPool)] },
      sourceId: { $nin: [...recent] },
    })
      .select('_id sourceId difficulty')
      .lean();

    if (!pool.length) {
      pool = await IQRankQuestion.find({
        ...baseQuery,
        sourceId: { $nin: [...recent] },
      })
        .select('_id sourceId difficulty')
        .lean();
    }

    if (!pool.length) {
      pool = await IQRankQuestion.find(baseQuery).select('_id sourceId difficulty').lean();
    }

    pool = pool.filter((q) => !pickedSource.has(String(q.sourceId || q._id)));
    if (!pool.length) continue;

    // Prefer difficulties weighted by pool list order of diffPool
    const preferred = [];
    for (const d of diffPool) {
      for (const q of pool) {
        if (q.difficulty === d) preferred.push(q);
      }
    }
    const choice = pickRandom(preferred.length ? preferred : pool, rand);
    if (!choice) continue;
    picked.push(choice);
    pickedSource.add(String(choice.sourceId || choice._id));
  }

  // Fallback fill if category spread ran short
  if (picked.length < count) {
    const exclude = [...pickedSource];
    let filler = await IQRankQuestion.find({
      bankSource: DAILY_QUIZ_BANK_SOURCE,
      classNumber: classNum,
      isActive: true,
      sourceId: { $nin: [...recent, ...exclude] },
    })
      .select('_id sourceId')
      .lean();
    if (filler.length < count - picked.length) {
      filler = await IQRankQuestion.find({
        bankSource: DAILY_QUIZ_BANK_SOURCE,
        classNumber: classNum,
        isActive: true,
        sourceId: { $nin: exclude },
      })
        .select('_id sourceId')
        .lean();
    }
    shuffleInPlace(filler, rand);
    for (const q of filler) {
      if (picked.length >= count) break;
      const sid = String(q.sourceId || q._id);
      if (pickedSource.has(sid)) continue;
      picked.push(q);
      pickedSource.add(sid);
    }
  }

  const questionIds = picked.map((q) => q._id);
  const sourceIds = picked.map((q) => String(q.sourceId || '')).filter(Boolean);

  log = await DailyQuizLog.findOneAndUpdate(
    { userId, dateKey },
    {
      $setOnInsert: {
        userId,
        dateKey,
        classNumber: classNum,
        quizId: quizId || null,
        questionIds,
        sourceIds,
      },
    },
    { upsert: true, new: true }
  ).catch(async (err) => {
    if (err?.code === 11000) {
      return DailyQuizLog.findOne({ userId, dateKey });
    }
    throw err;
  });

  // Another request may have won the upsert — always reload ordered questions from log
  if (log?.questionIds?.length) {
    const orderedIds = log.questionIds;
    const questionsReload = await IQRankQuestion.find({
      _id: { $in: orderedIds },
      isActive: true,
    })
      .populate('subject', 'name')
      .lean();
    const orderMap = new Map(orderedIds.map((id, i) => [String(id), i]));
    questionsReload.sort(
      (a, b) => (orderMap.get(String(a._id)) ?? 0) - (orderMap.get(String(b._id)) ?? 0)
    );
    return { dateKey, questions: questionsReload, log };
  }

  const questions = await IQRankQuestion.find({ _id: { $in: questionIds }, isActive: true })
    .populate('subject', 'name')
    .lean();
  const order = new Map(questionIds.map((id, i) => [String(id), i]));
  questions.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));

  return { dateKey, questions, log };
}

export async function markDailyQuizCompleted({
  userId,
  dateKey,
  answers = {},
  correctCount = 0,
  score = null,
  quizId = null,
  classNumber = '',
  questionIds = [],
}) {
  const key = dateKey || indiaDateKey();
  const update = {
    $set: {
      answers,
      correctCount,
      score,
      completedAt: new Date(),
      quizId: quizId || null,
      classNumber: String(classNumber || 'all'),
    },
    $setOnInsert: {
      userId,
      dateKey: key,
      sourceIds: [],
      questionIds: [],
    },
  };
  if (Array.isArray(questionIds) && questionIds.length) {
    update.$set.questionIds = questionIds;
  }

  return DailyQuizLog.findOneAndUpdate({ userId, dateKey: key }, update, {
    upsert: true,
    new: true,
  });
}

export function isDailyBankQuiz(quiz) {
  return String(quiz?.questionBankSource || '') === DAILY_QUIZ_BANK_SOURCE;
}

/** Today's status + recent completed days for the student daily bank. */
export async function getDailyQuizStatusForUser(userId, { limit = 14 } = {}) {
  const todayKey = indiaDateKey();
  const todayLog = await DailyQuizLog.findOne({ userId, dateKey: todayKey }).lean();
  const history = await DailyQuizLog.find({
    userId,
    completedAt: { $ne: null },
  })
    .sort({ dateKey: -1 })
    .limit(Math.max(1, Math.min(60, Number(limit) || 14)))
    .select('dateKey score correctCount completedAt questionIds')
    .lean();

  const completedToday = Boolean(todayLog?.completedAt);
  // Next unlock = tomorrow 00:00 IST roughly expressed for UI
  const tomorrow = new Date(`${todayKey}T00:00:00+05:30`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDateKey = indiaDateKey(tomorrow);

  return {
    today: {
      dateKey: todayKey,
      completed: completedToday,
      score: completedToday ? Number(todayLog?.score) : null,
      correctCount: completedToday ? Number(todayLog?.correctCount) || 0 : 0,
      totalQuestions: Array.isArray(todayLog?.questionIds)
        ? todayLog.questionIds.length
        : DAILY_PICK_COUNT,
      completedAt: todayLog?.completedAt || null,
    },
    history: history.map((h) => ({
      dateKey: h.dateKey,
      score: h.score == null ? null : Number(h.score),
      correctCount: Number(h.correctCount) || 0,
      totalQuestions: Array.isArray(h.questionIds) ? h.questionIds.length : DAILY_PICK_COUNT,
      completedAt: h.completedAt,
    })),
    nextUnlockDateKey: nextDateKey,
    lockedUntilTomorrow: completedToday,
  };
}
