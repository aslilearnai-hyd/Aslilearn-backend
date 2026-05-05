import VidyaStudentMemory from '../../models/VidyaStudentMemory.js';

export async function upsertStudentMemory({
  studentId,
  weakTopics = [],
  strongTopics = [],
  recommendations = [],
  actionCard = null,
  streakDays = 0,
  lastExamSummary = null,
}) {
  const update = {
    weakTopics: weakTopics.map((w) => String(w.chapter || w || '')).filter(Boolean).slice(0, 10),
    strongTopics: strongTopics.map((s) => String(s.chapter || s || '')).filter(Boolean).slice(0, 10),
    recentRecommendations: recommendations.map((x) => String(x)).filter(Boolean).slice(0, 8),
    lastFocusAction: String(actionCard?.action || ''),
    streakDays: Number(streakDays || 0),
    lastExamSummary: lastExamSummary || null,
  };
  return VidyaStudentMemory.findOneAndUpdate(
    { studentId },
    { $set: update },
    { upsert: true, new: true }
  ).lean();
}

