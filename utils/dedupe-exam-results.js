/**
 * Deduplicate ExamResult rows (double-submit / race duplicates).
 * Logic aligned with asli-frontend/src/lib/dedupe-exam-results.ts
 */

function getExamIdString(row) {
  if (!row) return null;
  const resolve = (raw) => {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object') {
      const nested = raw._id ?? raw.$oid;
      if (nested != null) return String(nested);
      const s = String(raw);
      if (s && s !== '[object Object]') return s;
      return null;
    }
    try {
      return String(raw);
    } catch {
      return null;
    }
  };
  return resolve(row.examId) ?? (row.exam != null && typeof row.exam === 'object' ? resolve(row.exam._id ?? row.exam) : null);
}

function perfKey(row) {
  return [
    Number(row?.correctAnswers) || 0,
    Number(row?.wrongAnswers) || 0,
    Number(row?.unattempted) || 0,
    Number(row?.obtainedMarks) || 0,
    Number(row?.totalMarks) || 0,
    Number(row?.timeTaken) || 0,
  ].join('|');
}

/**
 * @param {any[]} rows Plain result objects (e.g. from .lean() or toObject)
 * @returns {any[]}
 */
export function dedupeExamResultRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const sorted = [...rows].sort(
    (a, b) => new Date(b?.completedAt || 0) - new Date(a?.completedAt || 0)
  );

  let list = sorted;

  const idSeen = new Set();
  list = list.filter((r) => {
    const id = r?._id != null ? String(r._id) : '';
    if (!id) return true;
    if (idSeen.has(id)) return false;
    idSeen.add(id);
    return true;
  });

  const out = [];
  const PROX_MS = 90_000;

  for (const r of list) {
    const eid = getExamIdString(r);
    if (!eid) {
      out.push(r);
      continue;
    }
    const fp = perfKey(r);
    const t = new Date(r?.completedAt || 0).getTime();
    const nearDup = out.some((x) => {
      const xe = getExamIdString(x);
      if (xe !== eid) return false;
      if (perfKey(x) !== fp) return false;
      const xt = new Date(x?.completedAt || 0).getTime();
      return Math.abs(xt - t) <= PROX_MS;
    });
    if (nearDup) continue;
    out.push(r);
  }

  // Historical result rows predate attemptNumber and therefore often all carry
  // the schema default `1`. They are distinct submissions, not duplicates. If
  // the stored numbers are missing/non-unique, reconstruct Attempt 1/2/3 in
  // chronological order after true duplicate removal.
  const groups = new Map();
  for (const row of out) {
    const examId = getExamIdString(row) || `row:${String(row?._id || '')}`;
    const userId = row?.userId?._id ?? row?.userId ?? '';
    const key = `${String(userId)}::${examId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const rowsForExam of groups.values()) {
    rowsForExam.sort(
      (a, b) => new Date(a?.completedAt || 0) - new Date(b?.completedAt || 0),
    );
    const stored = rowsForExam.map((row) => Number(row?.attemptNumber));
    const validStored = stored.every((n) => Number.isFinite(n) && n >= 1);
    const uniqueStored = new Set(stored).size === stored.length;
    if (!validStored || !uniqueStored) {
      rowsForExam.forEach((row, index) => {
        row.attemptNumber = index + 1;
      });
    }
  }

  return out.sort(
    (a, b) => new Date(b?.completedAt || 0) - new Date(a?.completedAt || 0)
  );
}
