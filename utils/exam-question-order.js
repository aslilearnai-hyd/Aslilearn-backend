/** Shared exam-question ordering helpers. */

export const QUESTION_LIST_SORT = { displayOrder: 1, createdAt: 1, _id: 1 };

export const SUBJECT_SECTION_LABELS = {
  maths: 'Maths',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
};

export function subjectSectionLabel(subject) {
  const key = String(subject || '')
    .trim()
    .toLowerCase();
  return SUBJECT_SECTION_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'General');
}

/** Resolve heading shown in student/admin paper for a question. */
export function resolveQuestionSectionHeading(question) {
  const custom = String(question?.sectionHeading || '').trim();
  if (custom) return custom;
  return subjectSectionLabel(question?.subject);
}

/**
 * Next displayOrder for a new question on an exam (max existing + 1).
 * @param {import('mongoose').Model} QuestionModel
 * @param {string|import('mongoose').Types.ObjectId} examId
 */
export async function nextQuestionDisplayOrder(QuestionModel, examId) {
  const top = await QuestionModel.findOne({ exam: examId })
    .sort({ displayOrder: -1, createdAt: -1, _id: -1 })
    .select('displayOrder')
    .lean();
  const current = Number(top?.displayOrder) || 0;
  return current > 0 ? current + 1 : 1;
}

/**
 * Backfill displayOrder for questions missing it (0 / null / undefined),
 * preserving current createdAt order. Safe to call before listing.
 */
export async function ensureExamQuestionDisplayOrders(QuestionModel, examId) {
  const rows = await QuestionModel.find({ exam: examId })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id displayOrder')
    .lean();
  const needs = rows.some((r) => !Number(r.displayOrder) || Number(r.displayOrder) < 1);
  if (!needs || rows.length === 0) return;
  const ops = rows.map((r, idx) => ({
    updateOne: {
      filter: { _id: r._id },
      update: { $set: { displayOrder: idx + 1, updatedAt: new Date() } },
    },
  }));
  if (ops.length) await QuestionModel.bulkWrite(ops);
}
