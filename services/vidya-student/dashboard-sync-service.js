import UserSession from '../../models/UserSession.js';
import VidyaProactivePrompt from '../../models/VidyaProactivePrompt.js';

const ymd = (d) =>
  new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

export async function buildStudyStreak(studentId) {
  const rows = await UserSession.find({ userId: studentId }).select('date').sort({ date: -1 }).limit(60).lean();
  const set = new Set(rows.map((r) => String(r.date || '')));
  let current = 0;
  for (let i = 0; i < 60; i += 1) {
    const d = new Date(Date.now() - i * 86400000);
    const k = ymd(d);
    if (set.has(k)) current += 1;
    else break;
  }
  return {
    current,
    message:
      current > 0
        ? `You studied for ${current} consecutive day${current === 1 ? '' : 's'}. Do not break your streak today.`
        : 'Start a new study streak today.',
  };
}

export async function getLatestProactivePrompt(studentId) {
  return VidyaProactivePrompt.findOne({ studentId })
    .sort({ createdAt: -1 })
    .lean();
}

