/**
 * Teacher attendance helpers (pure — unit-testable, no DB).
 */

export function normalizeAttendanceStatus(raw) {
  const st = String(raw || 'present').toLowerCase();
  if (st === 'absent' || st === 'late') return st;
  return 'present';
}

/**
 * Accept both mobile body shapes:
 * - { students: [{ _id, status }] }
 * - { records: [{ studentId, status: 'Present'|'Absent' }] }
 */
export function collectAttendanceEntries(body = {}) {
  const rawEntries = [];
  if (Array.isArray(body.students)) {
    for (const s of body.students) {
      const id = s?._id || s?.id || s?.studentId;
      if (!id) continue;
      rawEntries.push({
        studentId: String(id),
        status: normalizeAttendanceStatus(s.status),
      });
    }
  }
  if (Array.isArray(body.records)) {
    for (const r of body.records) {
      const id = r?.studentId || r?._id || r?.id;
      if (!id) continue;
      rawEntries.push({
        studentId: String(id),
        status: normalizeAttendanceStatus(r.status),
      });
    }
  }
  return rawEntries;
}

export function summarizeAttendanceCounts(entries) {
  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  for (const e of entries) {
    if (e.status === 'absent') absentCount += 1;
    else if (e.status === 'late') lateCount += 1;
    else presentCount += 1;
  }
  return { presentCount, absentCount, lateCount };
}
