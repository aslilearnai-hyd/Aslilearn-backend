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
 * Backfill / heal displayOrder: missing/invalid values or duplicate numbers.
 * Renumbers densely 1..N in current sort order. Safe to call before listing.
 */
export async function ensureExamQuestionDisplayOrders(QuestionModel, examId) {
  const rows = await QuestionModel.find({ exam: examId })
    .sort({ displayOrder: 1, createdAt: 1, _id: 1 })
    .select('_id displayOrder')
    .lean();
  if (rows.length === 0) return;

  const orders = rows.map((r) => Number(r.displayOrder) || 0);
  const hasInvalid = orders.some((o) => o < 1);
  const hasDupes = new Set(orders).size !== orders.length;
  const notDense = orders.some((o, i) => o !== i + 1);
  if (!hasInvalid && !hasDupes && !notDense) return;

  // Prefer createdAt order when repairing broken/missing orders so we don't
  // scramble relative history; keep displayOrder sort when only densifying gaps/dupes.
  const ordered = hasInvalid
    ? await QuestionModel.find({ exam: examId })
        .sort({ createdAt: 1, _id: 1 })
        .select('_id')
        .lean()
    : rows;

  const ops = ordered.map((r, idx) => ({
    updateOne: {
      filter: { _id: r._id },
      update: { $set: { displayOrder: idx + 1, updatedAt: new Date() } },
    },
  }));
  if (ops.length) await QuestionModel.bulkWrite(ops);
}

/**
 * Move one question to a 1-based display position and shift neighbors.
 * Example: move #80 → #1 shifts old 1..79 up by one. Move #70 → #35 shifts 35..69 up by one.
 * Always renumbers densely 1..N. Returns sorted questions + the moved doc.
 */
export async function moveQuestionToDisplayOrder(QuestionModel, examId, questionId, targetOrder) {
  await ensureExamQuestionDisplayOrders(QuestionModel, examId);

  const rows = await QuestionModel.find({ exam: examId })
    .sort(QUESTION_LIST_SORT)
    .select('_id')
    .lean();

  if (!rows.length) {
    return { questions: [], moved: null, from: null, to: null };
  }

  const fromIndex = rows.findIndex((r) => String(r._id) === String(questionId));
  if (fromIndex < 0) {
    const err = new Error('Question not found');
    err.status = 404;
    throw err;
  }

  let toIndex = Math.floor(Number(targetOrder)) - 1;
  if (!Number.isFinite(toIndex) || toIndex < 0) toIndex = 0;
  if (toIndex >= rows.length) toIndex = rows.length - 1;

  const orderedIds = rows.map((r) => r._id);
  if (fromIndex !== toIndex) {
    const [item] = orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, item);
  }

  const ops = orderedIds.map((id, idx) => ({
    updateOne: {
      filter: { _id: id, exam: examId },
      update: { $set: { displayOrder: idx + 1, updatedAt: new Date() } },
    },
  }));
  if (ops.length) await QuestionModel.bulkWrite(ops);

  const questions = await QuestionModel.find({ exam: examId }).sort(QUESTION_LIST_SORT);
  const moved = questions.find((q) => String(q._id) === String(questionId)) || null;
  return {
    questions,
    moved,
    from: fromIndex + 1,
    to: toIndex + 1,
  };
}
