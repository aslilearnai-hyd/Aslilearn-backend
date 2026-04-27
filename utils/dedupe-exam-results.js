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

  const attemptSeen = new Set();
  list = list.filter((r) => {
    const eid = getExamIdString(r);
    if (!eid) return true;
    const att = Number(r.attemptNumber) >= 1 ? Number(r.attemptNumber) : 1;
    const k = `${eid}::${att}`;
    if (attemptSeen.has(k)) return false;
    attemptSeen.add(k);
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

  return out.sort(
    (a, b) => new Date(b?.completedAt || 0) - new Date(a?.completedAt || 0)
  );
}
