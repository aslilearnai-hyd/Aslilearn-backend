import * as XLSX from 'xlsx';

const DAY_ALIASES = {
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday',
  sun: 'Sunday',
  sunday: 'Sunday',
};

const BREAK_RE = /\b(break|lunch|recess|interval)\b/i;
const TIME_RANGE_RE =
  /(\d{1,2})(?:[.:](\d{2}))?\s*(?:am|pm)?\s*[-–—to]+\s*(\d{1,2})(?:[.:](\d{2}))?\s*(?:am|pm)?/i;

function cellStr(v) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDay(value) {
  const key = cellStr(value).toLowerCase().replace(/\./g, '');
  return DAY_ALIASES[key] || null;
}

function toHHMM(h, m = 0) {
  const hh = Math.max(0, Math.min(23, Number(h) || 0));
  const mm = Math.max(0, Math.min(59, Number(m) || 0));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Parse "8.40 - 9.25" / "10:20-11:05" into { startTime, endTime }. */
export function parseBellTimeRange(raw) {
  const text = cellStr(raw).toLowerCase().replace(/,/g, '.');
  const m = text.match(TIME_RANGE_RE);
  if (!m) return null;
  let h1 = Number(m[1]);
  let min1 = Number(m[2] || 0);
  let h2 = Number(m[3]);
  let min2 = Number(m[4] || 0);
  // School bells are daytime; 1.05 after lunch → 13:05 when end hour < start and start >= 8
  if (h1 >= 1 && h1 <= 7 && h2 >= 1 && h2 <= 7) {
    // leave as-is (early morning rare); most schools use 8–4
  }
  if (h1 < 8 && h1 >= 1) h1 += 12;
  if (h2 < 8 && h2 >= 1) h2 += 12;
  if (h2 * 60 + min2 <= h1 * 60 + min1 && h2 < 12) h2 += 12;
  return { startTime: toHHMM(h1, min1), endTime: toHHMM(h2, min2) };
}

function isTimeHeaderRow(cells) {
  const joined = cells.map(cellStr).join(' ').toLowerCase();
  if (!joined.includes('time')) return false;
  let ranges = 0;
  for (const c of cells) {
    if (parseBellTimeRange(c)) ranges += 1;
  }
  return ranges >= 2;
}

function isPeriodHeaderRow(cells) {
  const first = cellStr(cells[0]).toLowerCase();
  return first === 'period' || first.startsWith('period');
}

/** "6A - Ms. Razia", "6C-Ms. Padmavathi", "10-B", "IX - B New Phy" */
export function parseClassHeader(raw) {
  const text = cellStr(raw);
  if (!text) return null;

  // 6A, 6-A, 10AB, 10-B, Class 6 A
  let m = text.match(/^class\s*([0-9]{1,2})\s*[- ]?\s*([A-Za-z]{1,3})\b/i);
  if (!m) m = text.match(/^([0-9]{1,2})\s*[- ]?\s*([A-Za-z]{1,3})\b/);
  if (!m) {
    // Roman IX-B style → skip numeric conversion; not used in Brahmam file for main classes
    return null;
  }
  const classNumber = String(Number(m[1]));
  let section = String(m[2] || '').toUpperCase();
  // "10AB" means combined — keep first section letter for link, note full in title
  if (section.length > 1 && /^[A-Z]+$/.test(section)) {
    // Prefer single section when possible (A from AB); store full in notes later via title
  }
  if (!classNumber || !section) return null;
  return {
    classNumber,
    section: section.slice(0, 1),
    sectionRaw: section,
    title: text,
  };
}

function startOfIsoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dateForWeekdayName(weekStart, dayName) {
  const map = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  const offset = map[dayName];
  if (offset == null) return null;
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

/**
 * Expand one sheet matrix into flat timetable row objects
 * (compatible with existing CSV import columns).
 */
export function expandClassGridSheet(matrix, { weekStart } = {}) {
  const rows = Array.isArray(matrix) ? matrix : [];
  const ws = weekStart ? startOfIsoWeek(new Date(weekStart)) : startOfIsoWeek(new Date());
  const out = [];
  const errors = [];

  let i = 0;
  while (i < rows.length) {
    const headerCells = (rows[i] || []).map(cellStr);
    const classInfo = parseClassHeader(headerCells[0] || '');
    if (!classInfo) {
      i += 1;
      continue;
    }

    // Find Time + Period rows within the next few lines
    let timeRowIdx = -1;
    let periodRowIdx = -1;
    for (let j = i + 1; j < Math.min(i + 6, rows.length); j++) {
      const cells = (rows[j] || []).map(cellStr);
      if (timeRowIdx < 0 && isTimeHeaderRow(cells)) timeRowIdx = j;
      if (periodRowIdx < 0 && isPeriodHeaderRow(cells)) periodRowIdx = j;
      if (timeRowIdx >= 0 && periodRowIdx >= 0) break;
    }
    if (timeRowIdx < 0) {
      errors.push({
        row: i + 1,
        reason: `Class ${classInfo.classNumber}-${classInfo.sectionRaw}: no Time header row found under "${classInfo.title}"`,
        status: 'error',
      });
      i += 1;
      continue;
    }

    const timeCells = (rows[timeRowIdx] || []).map(cellStr);
    const periodCells =
      periodRowIdx >= 0 ? (rows[periodRowIdx] || []).map(cellStr) : timeCells.map(() => '');

    const slots = [];
    for (let c = 1; c < timeCells.length; c++) {
      const label = periodCells[c] || '';
      const range = parseBellTimeRange(timeCells[c]);
      if (!range) continue;
      const isBreak = BREAK_RE.test(label) || BREAK_RE.test(timeCells[c]);
      slots.push({
        col: c,
        ...range,
        periodLabel: label || `P${slots.length + 1}`,
        isBreak,
      });
    }
    if (!slots.length) {
      errors.push({
        row: timeRowIdx + 1,
        reason: `Class ${classInfo.classNumber}-${classInfo.section}: could not parse period times`,
        status: 'error',
      });
      i = Math.max(timeRowIdx, periodRowIdx) + 1;
      continue;
    }

    const dayStart = Math.max(timeRowIdx, periodRowIdx) + 1;
    let dayEnd = dayStart;
    for (let j = dayStart; j < Math.min(dayStart + 8, rows.length); j++) {
      const day = normalizeDay((rows[j] || [])[0]);
      if (!day) {
        // blank separator before next class block
        if (parseClassHeader(cellStr((rows[j] || [])[0]))) break;
        if (!cellStr((rows[j] || [])[0]) && j > dayStart) break;
        continue;
      }
      dayEnd = j + 1;
      const dayCells = (rows[j] || []).map(cellStr);
      const dateObj = dateForWeekdayName(ws, day);
      const dateStr = dateObj ? dateObj.toISOString().slice(0, 10) : '';

      for (const slot of slots) {
        if (slot.isBreak) {
          const label = String(slot.periodLabel || '').trim();
          const breakName = /lunch/i.test(label)
            ? 'Lunch'
            : /recess/i.test(label)
              ? 'Recess'
              : /interval/i.test(label)
                ? 'Interval'
                : label && !BREAK_RE.test(label)
                  ? label
                  : 'Break';
          out.push({
            Date: dateStr,
            Day: day,
            StartTime: slot.startTime,
            EndTime: slot.endTime,
            Class: classInfo.classNumber,
            Section: classInfo.section,
            Subject: breakName,
            Teacher: '',
            Room: 'TBD',
            Building: 'Main',
            Type: 'Activity',
            Status: 'Scheduled',
            Notes: `${classInfo.title} · ${breakName}`.slice(0, 200),
            __gridSource: true,
            __sectionRaw: classInfo.sectionRaw,
            __isBreak: true,
          });
          continue;
        }

        const subject = cellStr(dayCells[slot.col] || '');
        if (!subject) continue;
        // Skip pure break markers typed in teaching cells
        if (BREAK_RE.test(subject)) continue;

        out.push({
          Date: dateStr,
          Day: day,
          StartTime: slot.startTime,
          EndTime: slot.endTime,
          Class: classInfo.classNumber,
          Section: classInfo.section,
          Subject: subject,
          Teacher: '',
          Room: 'TBD',
          Building: 'Main',
          Type: /lab|practical|iit/i.test(subject) ? 'Lab' : /cca|art|dance|pet|sport|robot|diary/i.test(subject) ? 'Activity' : 'Lecture',
          Status: 'Scheduled',
          Notes: `${classInfo.title} · ${slot.periodLabel}`.slice(0, 200),
          __gridSource: true,
          __sectionRaw: classInfo.sectionRaw,
        });
      }
    }

    i = Math.max(dayEnd, dayStart + 1);
  }

  return { rows: out, errors, format: 'class-grid' };
}

/**
 * Read an uploaded workbook/CSV and expand class-grid sheets when detected.
 * Returns null if the file looks like a flat row CSV (has Date+StartTime headers).
 */
export function tryExpandClassTimetableGrid(buffer, originalName = '', options = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  if (!workbook.SheetNames?.length) return null;

  // Flat CSV detection on first sheet
  const first = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: false,
  });
  const headerLine = (first[0] || []).map(cellStr).join(' ').toLowerCase();
  if (
    headerLine.includes('starttime') ||
    (headerLine.includes('date') && headerLine.includes('class') && headerLine.includes('subject'))
  ) {
    return null;
  }

  const allRows = [];
  const allErrors = [];
  let gridBlocks = 0;

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false,
    });
    // Quick sniff: any class header + time row?
    let looksLikeGrid = false;
    for (let r = 0; r < Math.min(matrix.length, 40); r++) {
      if (parseClassHeader(cellStr((matrix[r] || [])[0]))) {
        looksLikeGrid = true;
        break;
      }
    }
    if (!looksLikeGrid) continue;

    const expanded = expandClassGridSheet(matrix, options);
    if (expanded.rows.length) {
      gridBlocks += 1;
      allRows.push(...expanded.rows);
    }
    allErrors.push(
      ...expanded.errors.map((e) => ({
        ...e,
        reason: `[${sheetName}] ${e.reason}`,
      })),
    );
  }

  if (!gridBlocks && !allRows.length) return null;
  return {
    rows: allRows,
    errors: allErrors,
    format: 'class-grid',
    sheets: workbook.SheetNames.length,
  };
}
