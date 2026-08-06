import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import mongoose from 'mongoose';
import Timetable, { parseTimeToMinutes, DAY_NAMES } from '../models/Timetable.js';
import Class from '../models/Class.js';
import Subject from '../models/Subject.js';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import {
  extractPlainSubjectNameForContent,
  subjectGroupKey,
} from '../utils/resolveSubjectContentIds.js';

const POPULATE_FIELDS = [
  { path: 'classId', select: 'classNumber section name' },
  { path: 'subjectId', select: 'name code' },
  { path: 'teacherId', select: 'fullName email' },
];

const SESSION_TYPES = new Set([
  'Lecture',
  'Lab',
  'Exam',
  'Workshop',
  'Activity',
  'Holiday',
  'Special Class',
]);

const STATUS_VALUES = new Set(['Scheduled', 'Completed', 'Cancelled']);

function timesOverlap(startA, endA, startB, endB) {
  const a1 = parseTimeToMinutes(startA);
  const a2 = parseTimeToMinutes(endA);
  const b1 = parseTimeToMinutes(startB);
  const b2 = parseTimeToMinutes(endB);
  return a1 < b2 && b1 < a2;
}

function startOfDay(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
}

function endOfDay(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate(), 23, 59, 59, 999));
}

function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return startOfDay(x);
}

function addMonths(d, n) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return startOfDay(x);
}

function resolveAdminId(req) {
  if (req.user?.role === 'super-admin') return null;
  return req.user?.userId || req.user?.id;
}

function toObjectId(id) {
  if (!id) return null;
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(String(id));
  }
  return null;
}

async function buildScopeFilter(req) {
  const role = req.user?.role;
  const filter = {};

  if (role === 'admin') {
    const adminId = toObjectId(resolveAdminId(req));
    if (!adminId) {
      throw new Error('Invalid admin context');
    }
    filter.schoolAdminId = adminId;
  } else if (role === 'super-admin') {
    // no admin filter
  } else if (role === 'teacher') {
    filter.teacherId = req.user?.userId || req.user?.id;
    const teacher = await Teacher.findById(filter.teacherId).select('adminId').lean();
    if (teacher?.adminId) filter.schoolAdminId = teacher.adminId;
  } else if (role === 'student') {
    const user = await User.findById(req.user?.userId || req.user?.id)
      .populate('assignedClass', 'classNumber section')
      .lean();
    if (user?.assignedClass?._id) {
      filter.classId = user.assignedClass._id;
      if (user.assignedClass.section) {
        const section = String(user.assignedClass.section).toUpperCase();
        filter.$or = [
          { sectionId: section },
          { sectionId: { $in: [null, ''] } },
          { sectionId: { $exists: false } },
        ];
      }
    } else if (user?.assignedAdmin) {
      filter.schoolAdminId = user.assignedAdmin;
    }
  }

  return filter;
}

export async function detectConflicts(entry, excludeId, schoolAdminId) {
  const dateStart = startOfDay(entry.date);
  const dateEnd = endOfDay(entry.date);
  const baseQuery = {
    date: { $gte: dateStart, $lte: dateEnd },
    status: { $ne: 'Cancelled' },
  };
  if (schoolAdminId) baseQuery.schoolAdminId = schoolAdminId;
  if (excludeId) baseQuery._id = { $ne: excludeId };

  const sameDay = await Timetable.find(baseQuery).populate(POPULATE_FIELDS).lean();
  const conflicts = [];

  for (const existing of sameDay) {
    if (!timesOverlap(entry.startTime, entry.endTime, existing.startTime, existing.endTime)) {
      continue;
    }
    if (entry.teacherId && String(existing.teacherId?._id || existing.teacherId) === String(entry.teacherId)) {
      conflicts.push({ type: 'teacher', existing });
    }
    if (entry.room && existing.room && entry.room === existing.room) {
      conflicts.push({ type: 'room', existing });
    }
    const entryClass = String(entry.classId?._id || entry.classId);
    const existClass = String(existing.classId?._id || existing.classId);
    const entrySection = (entry.sectionId || '').toUpperCase();
    const existSection = (existing.sectionId || '').toUpperCase();
    if (entryClass === existClass && entrySection === existSection) {
      conflicts.push({ type: 'class', existing });
    }
  }

  return { hasConflict: conflicts.length > 0, conflicts };
}

function generateRepeatDates(baseDate, repeatRule, effectiveFrom, effectiveTo) {
  const dates = [startOfDay(baseDate)];
  if (repeatRule === 'none' || !effectiveFrom || !effectiveTo) return dates;

  const from = startOfDay(effectiveFrom);
  const to = startOfDay(effectiveTo);
  let current = startOfDay(baseDate);

  if (repeatRule === 'daily') {
    current = addDays(from, 0);
    while (current <= to) {
      if (current.getTime() !== startOfDay(baseDate).getTime()) dates.push(new Date(current));
      current = addDays(current, 1);
    }
  } else if (repeatRule === 'weekly') {
    current = addDays(from, 0);
    const targetDow = startOfDay(baseDate).getUTCDay();
    while (current <= to) {
      if (current.getUTCDay() === targetDow && current.getTime() !== startOfDay(baseDate).getTime()) {
        dates.push(new Date(current));
      }
      current = addDays(current, 1);
    }
  } else if (repeatRule === 'monthly') {
    let m = addMonths(from, 0);
    const dayOfMonth = startOfDay(baseDate).getUTCDate();
    while (m <= to) {
      const candidate = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), dayOfMonth));
      if (candidate.getUTCDate() === dayOfMonth && candidate.getTime() !== startOfDay(baseDate).getTime() && candidate >= from && candidate <= to) {
        dates.push(candidate);
      }
      m = addMonths(m, 1);
    }
  }

  return dates;
}

function requireRoomAndBuilding(body) {
  const room = String(body?.room ?? '').trim();
  const building = String(body?.building ?? '').trim();
  if (!room || !building) {
    return { ok: false, message: 'Room and building are required' };
  }
  return { ok: true, room, building };
}

function entryPayload(body, schoolAdminId, createdBy) {
  const room = String(body.room ?? '').trim();
  const building = String(body.building ?? '').trim();
  return {
    schoolAdminId,
    date: body.date,
    day: body.day,
    startTime: body.startTime,
    endTime: body.endTime,
    classId: body.classId,
    sectionId: body.sectionId,
    subjectId: body.subjectId,
    teacherId: body.teacherId,
    room,
    building,
    repeatRule: body.repeatRule || 'none',
    effectiveFrom: body.effectiveFrom,
    effectiveTo: body.effectiveTo,
    sessionType: body.sessionType || 'Lecture',
    attendanceRequired: body.attendanceRequired !== false,
    expectedStudents: body.expectedStudents,
    capacity: body.capacity,
    status: body.status || 'Scheduled',
    priority: body.priority ?? 0,
    notes: body.notes || '',
    colorTag: body.colorTag || '',
    attachment: body.attachment || '',
    createdBy,
  };
}

export const createTimetableEntry = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    if (!schoolAdminId) {
      return res.status(403).json({ success: false, message: 'Admin context required' });
    }

    const location = requireRoomAndBuilding(req.body);
    if (!location.ok) {
      return res.status(400).json({ success: false, message: location.message });
    }

    const payload = entryPayload(
      { ...req.body, room: location.room, building: location.building },
      schoolAdminId,
      schoolAdminId
    );
    const repeatGroupId = payload.repeatRule !== 'none' ? crypto.randomUUID() : undefined;
    const dates = generateRepeatDates(
      payload.date,
      payload.repeatRule,
      payload.effectiveFrom || payload.date,
      payload.effectiveTo || payload.date
    );

    const created = [];
    const skipped = [];

    for (const date of dates) {
      const entry = { ...payload, date, repeatGroupId };
      const { hasConflict, conflicts } = await detectConflicts(entry, null, schoolAdminId);
      if (hasConflict && !req.body.forceSave) {
        skipped.push({ date, conflicts });
        continue;
      }
      const doc = new Timetable(entry);
      await doc.save();
      created.push(doc);
    }

    const populated = await Timetable.find({ _id: { $in: created.map((c) => c._id) } }).populate(POPULATE_FIELDS);

    res.status(201).json({
      success: true,
      data: populated,
      skipped,
      hasConflict: skipped.length > 0,
    });
  } catch (error) {
    console.error('createTimetableEntry:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

function buildListFilter(req, scope) {
  const filter = { ...scope };
  const { startDate, endDate, classId, teacherId, subjectId, room, status, sessionType, sectionId } = req.query;

  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = startOfDay(new Date(startDate));
    if (endDate) filter.date.$lte = endOfDay(new Date(endDate));
  }
  if (classId) filter.classId = classId;
  if (teacherId && (req.user.role === 'admin' || req.user.role === 'super-admin')) {
    filter.teacherId = teacherId;
  }
  if (subjectId) filter.subjectId = subjectId;
  if (room) filter.room = room;
  if (status) filter.status = status;
  if (sessionType) filter.sessionType = sessionType;
  if (sectionId) filter.sectionId = String(sectionId).toUpperCase();

  return filter;
}

export const getTimetableEntries = async (req, res) => {
  try {
    const scope = await buildScopeFilter(req);
    const filter = buildListFilter(req, scope);

    const entries = await Timetable.find(filter)
      .populate(POPULATE_FIELDS)
      .sort({ date: 1, startTime: 1 })
      .lean();

    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('getTimetableEntries:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTimetableById = async (req, res) => {
  try {
    const scope = await buildScopeFilter(req);
    const entry = await Timetable.findOne({ _id: req.params.id, ...scope }).populate(POPULATE_FIELDS);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    res.json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTimetableEntry = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    const entry = await Timetable.findOne({ _id: req.params.id, schoolAdminId });
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });

    const updates = { ...req.body };
    delete updates.schoolAdminId;
    delete updates.createdBy;

    if (updates.room !== undefined || updates.building !== undefined) {
      const location = requireRoomAndBuilding({
        room: updates.room !== undefined ? updates.room : entry.room,
        building: updates.building !== undefined ? updates.building : entry.building,
      });
      if (!location.ok) {
        return res.status(400).json({ success: false, message: location.message });
      }
      updates.room = location.room;
      updates.building = location.building;
    }

    const merged = {
      date: updates.date || entry.date,
      startTime: updates.startTime || entry.startTime,
      endTime: updates.endTime || entry.endTime,
      teacherId: updates.teacherId || entry.teacherId,
      classId: updates.classId || entry.classId,
      sectionId: updates.sectionId ?? entry.sectionId,
      room: updates.room ?? entry.room,
    };

    const { hasConflict, conflicts } = await detectConflicts(merged, entry._id, schoolAdminId);
    if (hasConflict && !req.body.forceSave) {
      return res.status(409).json({ success: false, hasConflict: true, conflicts });
    }

    Object.assign(entry, updates);
    await entry.save();
    await entry.populate(POPULATE_FIELDS);
    res.json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const patchTimetableStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Scheduled', 'Completed', 'Cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const role = req.user?.role;
    let filter = { _id: req.params.id };

    if (role === 'teacher') {
      filter.teacherId = req.user.userId || req.user.id;
    } else if (role === 'admin') {
      filter.schoolAdminId = resolveAdminId(req);
    }

    const entry = await Timetable.findOne(filter);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });

    entry.status = status;
    await entry.save();
    await entry.populate(POPULATE_FIELDS);
    res.json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTimetableEntry = async (req, res) => {
  try {
    const entryId = toObjectId(req.params.id);
    if (!entryId) {
      return res.status(400).json({ success: false, message: 'Invalid entry id' });
    }
    const schoolAdminId = resolveAdminId(req);
    const query = { _id: entryId };
    if (schoolAdminId) query.schoolAdminId = toObjectId(schoolAdminId);
    const result = await Timetable.findOneAndDelete(query);
    if (!result) return res.status(404).json({ success: false, message: 'Entry not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDeleteByGroup = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    const { groupId } = req.params;
    const result = await Timetable.deleteMany({ repeatGroupId: groupId, schoolAdminId });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDeleteTimetable = async (req, res) => {
  try {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'super-admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required for bulk delete',
      });
    }

    const scope = await buildScopeFilter(req);
    const filter = buildListFilter(req, scope);
    const result = await Timetable.deleteMany(filter);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    console.error('bulkDeleteTimetable:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const CSV_HEADERS = ['Date', 'Day', 'StartTime', 'EndTime', 'Class', 'Section', 'Subject', 'Teacher', 'Room', 'Building', 'Type', 'Status', 'Notes'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize CSV header keys so "Start Time", "start_time", BOM-prefixed Date all map. */
function normalizeCsvRow(row) {
  const out = {};
  for (const [rawKey, value] of Object.entries(row || {})) {
    const key = String(rawKey || '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function cell(row, ...keys) {
  for (const key of keys) {
    const k = String(key).toLowerCase().replace(/[\s_-]+/g, '');
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return cleanCsvCell(row[k]);
    }
  }
  return '';
}

/** "10.0" / "10 " → "10"; keep alphanumeric sections. */
function normalizeClassNumber(value) {
  let s = cleanCsvCell(value);
  if (!s) return '';
  if (/^\d+(\.0+)?$/.test(s)) s = String(parseInt(s, 10));
  return s;
}

function normalizeTime(value) {
  const raw = cleanCsvCell(value);
  if (!raw) return '';
  // Excel serial time fraction (e.g. 0.375 = 09:00)
  if (/^0?\.\d+$/.test(raw)) {
    const fraction = Number(raw);
    if (Number.isFinite(fraction) && fraction >= 0 && fraction < 1) {
      const totalMins = Math.round(fraction * 24 * 60);
      const h = Math.floor(totalMins / 60) % 24;
      const m = totalMins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const meridiem = ampm[3].toLowerCase();
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const hm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) {
    return `${String(parseInt(hm[1], 10)).padStart(2, '0')}:${hm[2]}`;
  }
  return raw;
}

function parseCsvDate(value) {
  const raw = cleanCsvCell(value);
  if (!raw) return { date: null, dateStr: '' };

  // Excel serial day (e.g. 45801) when workbook exported with raw numbers
  if (/^\d{4,5}(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
      return { date: startOfDay(utc), dateStr: utc.toISOString().slice(0, 10) };
    }
  }

  // yyyy-mm-dd or yyyy/mm/dd
  let m = raw.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const utc = new Date(Date.UTC(y, mo - 1, d));
    if (!Number.isNaN(utc.getTime())) return { date: startOfDay(utc), dateStr: utc.toISOString().slice(0, 10) };
  }

  // dd/mm/yyyy or dd-mm-yyyy (common in India); prefer DMY when day > 12 or ambiguous
  m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let d = parseInt(m[1], 10);
    let mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    // If first part looks like month (US), only when day part > 12
    if (d > 12 && mo <= 12) {
      // already DMY
    } else if (mo > 12 && d <= 12) {
      [d, mo] = [mo, d];
    }
    // Prefer DMY for admin schools (India) when both <= 12
    const utc = new Date(Date.UTC(y, mo - 1, d));
    if (!Number.isNaN(utc.getTime())) return { date: startOfDay(utc), dateStr: utc.toISOString().slice(0, 10) };
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return { date: startOfDay(fallback), dateStr: startOfDay(fallback).toISOString().slice(0, 10) };
  }
  return { date: null, dateStr: raw };
}

function normalizeSessionType(value) {
  const raw = cleanCsvCell(value) || 'Lecture';
  if (SESSION_TYPES.has(raw)) return raw;
  const lower = raw.toLowerCase();
  for (const t of SESSION_TYPES) {
    if (t.toLowerCase() === lower) return t;
  }
  if (lower.includes('lab')) return 'Lab';
  if (lower.includes('exam')) return 'Exam';
  if (lower.includes('workshop')) return 'Workshop';
  if (lower.includes('activ')) return 'Activity';
  if (lower.includes('holiday')) return 'Holiday';
  if (lower.includes('special')) return 'Special Class';
  return 'Lecture';
}

function normalizeStatus(value) {
  const raw = cleanCsvCell(value) || 'Scheduled';
  if (STATUS_VALUES.has(raw)) return raw;
  const lower = raw.toLowerCase();
  for (const s of STATUS_VALUES) {
    if (s.toLowerCase() === lower) return s;
  }
  return 'Scheduled';
}

function subjectNameMatches(candidateName, wantedName) {
  const want = String(wantedName || '').trim();
  if (!want) return false;
  const cand = String(candidateName || '').trim();
  if (!cand) return false;
  if (cand.toLowerCase() === want.toLowerCase()) return true;
  const wantPlain = extractPlainSubjectNameForContent(want).toLowerCase();
  const candPlain = extractPlainSubjectNameForContent(cand).toLowerCase();
  if (wantPlain && candPlain && wantPlain === candPlain) return true;
  return subjectGroupKey(want) === subjectGroupKey(cand);
}

async function resolveSubjectForClass(cls, subjectName) {
  const want = cleanCsvCell(subjectName);
  if (!want) return null;

  const classDoc = await Class.findById(cls._id).select('assignedSubjects classNumber board').lean();
  const assignedIds = (classDoc?.assignedSubjects || []).map((id) => id);

  const candidates = [];
  if (assignedIds.length) {
    const assigned = await Subject.find({
      _id: { $in: assignedIds },
      isActive: { $ne: false },
      name: { $not: /__deleted__/ },
    })
      .select('_id name classNumber classIds')
      .lean();
    candidates.push(...assigned);
  }

  const byClassIds = await Subject.find({
    classIds: cls._id,
    isActive: { $ne: false },
    name: { $not: /__deleted__/ },
  })
    .select('_id name classNumber classIds')
    .lean();
  candidates.push(...byClassIds);

  if (cls.classNumber) {
    const byClassNumber = await Subject.find({
      classNumber: String(cls.classNumber),
      isActive: { $ne: false },
      name: { $not: /__deleted__/ },
    })
      .select('_id name classNumber classIds')
      .lean();
    candidates.push(...byClassNumber);
  }

  const exactSubjects = await Subject.find({
    $and: [
      { name: new RegExp(`^${escapeRegex(want)}$`, 'i') },
      { isActive: { $ne: false } },
      { name: { $not: /__deleted__/ } },
    ],
  })
    .select('_id name classNumber classIds')
    .lean();
  candidates.push(...exactSubjects);

  const seen = new Set();
  const unique = [];
  for (const s of candidates) {
    const id = String(s._id);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(s);
  }

  // Prefer subjects linked to this class, then any name match
  const linked = unique.filter(
    (s) =>
      assignedIds.some((id) => String(id) === String(s._id)) ||
      (s.classIds || []).some((id) => String(id) === String(cls._id)),
  );
  return (
    linked.find((s) => subjectNameMatches(s.name, want)) ||
    unique.find((s) => subjectNameMatches(s.name, want)) ||
    null
  );
}

function parseCsvBuffer(buffer, originalName) {
  let csvData;
  try {
    ({ csv: csvData } = spreadsheetBufferToCsv(buffer, originalName));
  } catch {
    csvData = buffer.toString('utf8');
  }
  const rows = parse(csvData, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  return (Array.isArray(rows) ? rows : []).map(normalizeCsvRow);
}

async function resolveCsvRow(row, schoolAdminId) {
  const classNumber = normalizeClassNumber(cell(row, 'Class', 'class', 'classnumber', 'classname'));
  const section = cell(row, 'Section', 'section', 'sec').toUpperCase();
  const subjectName = cell(row, 'Subject', 'subject', 'subjectname');
  const teacherName = cell(row, 'Teacher', 'teacher', 'teachername');
  const teacherEmail = cell(row, 'TeacherEmail', 'teacheremail', 'email');

  if (!classNumber || !section) {
    return { error: 'Class and Section are required' };
  }
  if (!subjectName) {
    return { error: 'Subject is required' };
  }
  if (!teacherName && !teacherEmail) {
    return { error: 'Teacher (or TeacherEmail) is required' };
  }

  const classNumberVariants = [
    ...new Set(
      [classNumber, String(Number(classNumber) || ''), String(classNumber).replace(/\.0+$/, '')].filter(
        Boolean,
      ),
    ),
  ];

  const resolvedClass =
    (await Class.findOne({
      classNumber: { $in: classNumberVariants },
      section,
      assignedAdmin: schoolAdminId,
      isActive: true,
    })) ||
    (await Class.findOne({
      section,
      assignedAdmin: schoolAdminId,
      isActive: true,
      $or: [
        { name: new RegExp(`^${escapeRegex(`${classNumber}${section}`)}$`, 'i') },
        { name: new RegExp(`^${escapeRegex(`${classNumber}-${section}`)}$`, 'i') },
      ],
    }));

  if (!resolvedClass) {
    return { error: `Class ${classNumber}-${section} not found for this school` };
  }

  const subject = await resolveSubjectForClass(resolvedClass, subjectName);
  if (!subject) {
    return {
      error: `Subject "${subjectName}" not found for class ${resolvedClass.classNumber}-${resolvedClass.section}. Assign it to the class in School Management first.`,
    };
  }

  let teacher = null;
  if (teacherEmail) {
    teacher = await Teacher.findOne({
      email: teacherEmail.toLowerCase(),
      adminId: schoolAdminId,
      isActive: { $ne: false },
    });
  }
  if (!teacher && teacherName) {
    teacher = await Teacher.findOne({
      fullName: new RegExp(`^${escapeRegex(teacherName)}$`, 'i'),
      adminId: schoolAdminId,
      isActive: { $ne: false },
    });
  }
  if (!teacher && teacherName && teacherName.length >= 3) {
    teacher = await Teacher.findOne({
      fullName: new RegExp(escapeRegex(teacherName), 'i'),
      adminId: schoolAdminId,
      isActive: { $ne: false },
    });
  }
  if (!teacher) return { error: `Teacher "${teacherName || teacherEmail}" not found for this school` };

  const room = cell(row, 'Room', 'room', 'classroom') || 'TBD';
  const building = cell(row, 'Building', 'building', 'block') || 'Main';

  const { date, dateStr } = parseCsvDate(cell(row, 'Date', 'date', 'scheduledate'));
  if (!date || Number.isNaN(date.getTime())) {
    return { error: `Invalid date: ${dateStr || '(empty)'}. Use YYYY-MM-DD or DD/MM/YYYY.` };
  }

  const startTime = normalizeTime(cell(row, 'StartTime', 'starttime', 'start', 'from'));
  const endTime = normalizeTime(cell(row, 'EndTime', 'endtime', 'end', 'to'));
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return { error: `Invalid time "${startTime}"–"${endTime}". Use HH:MM (e.g. 09:00).` };
  }
  if (parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) {
    return { error: `EndTime must be after StartTime (${startTime}–${endTime})` };
  }

  const dayRaw = cell(row, 'Day', 'day', 'weekday');
  const entry = {
    schoolAdminId,
    date,
    day: dayRaw || DAY_NAMES[date.getUTCDay()],
    startTime,
    endTime,
    classId: resolvedClass._id,
    sectionId: String(resolvedClass.section || section).toUpperCase(),
    subjectId: subject._id,
    teacherId: teacher._id,
    room,
    building,
    sessionType: normalizeSessionType(cell(row, 'Type', 'type', 'sessiontype', 'session')),
    status: normalizeStatus(cell(row, 'Status', 'status')),
    notes: cell(row, 'Notes', 'notes', 'remark', 'remarks'),
    repeatRule: 'none',
  };

  return {
    entry,
    rowMeta: {
      date: dateStr,
      class: `${resolvedClass.classNumber}-${resolvedClass.section}`,
      subject: subject.name,
      teacher: teacher.fullName,
    },
  };
}

async function processCsvRows(rows, schoolAdminId, { dryRun = false, mode = 'import' } = {}) {
  let imported = 0;
  let skipped = 0;
  const errors = [];
  const validEntries = [];

  for (let i = 0; i < rows.length; i++) {
    const resolved = await resolveCsvRow(rows[i], schoolAdminId);
    if (resolved.error) {
      errors.push({ row: i + 2, reason: resolved.error, status: 'error' });
      skipped++;
      continue;
    }

    const { hasConflict } = await detectConflicts(resolved.entry, null, schoolAdminId);
    if (hasConflict) {
      if (mode === 'merge') {
        errors.push({ row: i + 2, reason: 'Conflict detected', status: 'warning', ...resolved.rowMeta });
        skipped++;
        continue;
      }
      errors.push({ row: i + 2, reason: 'Conflict detected', status: 'warning', ...resolved.rowMeta });
      if (dryRun) {
        skipped++;
        continue;
      }
    }

    validEntries.push(resolved.entry);
    if (dryRun) {
      imported++;
    }
  }

  if (!dryRun && validEntries.length) {
    if (mode === 'replace') {
      const dates = validEntries.map((e) => e.date);
      const min = new Date(Math.min(...dates.map((d) => d.getTime())));
      const max = new Date(Math.max(...dates.map((d) => d.getTime())));
      await Timetable.deleteMany({
        schoolAdminId,
        date: { $gte: startOfDay(min), $lte: endOfDay(max) },
      });
    }

    for (const entry of validEntries) {
      try {
        const { hasConflict } = await detectConflicts(entry, null, schoolAdminId);
        if (mode === 'merge' && hasConflict) {
          errors.push({
            row: 0,
            reason: 'Conflict detected',
            status: 'warning',
            class: String(entry.sectionId || ''),
          });
          skipped++;
          continue;
        }
        await new Timetable(entry).save();
        imported++;
      } catch (saveErr) {
        errors.push({
          row: 0,
          reason: saveErr?.message || 'Failed to save row',
          status: 'error',
        });
        skipped++;
      }
    }
  }

  return { imported, skipped, errors };
}

export const validateTimetableCSV = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const rows = parseCsvBuffer(req.file.buffer, req.file.originalname);
    const result = await processCsvRows(rows, schoolAdminId, { dryRun: true });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const importTimetableCSV = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const mode = req.body.mode || 'import';
    const rows = parseCsvBuffer(req.file.buffer, req.file.originalname);
    const result = await processCsvRows(rows, schoolAdminId, { dryRun: false, mode });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const downloadCSVTemplate = async (req, res) => {
  const template = `${CSV_HEADERS.join(',')}
2026-05-24,Monday,09:00,10:00,10,A,Mathematics,John Smith,Room-101,Main Block,Lecture,Scheduled,Chapter 1 - Algebra
2026-05-24,Monday,10:00,11:00,10,A,Physics,Jane Doe,Lab-201,Science Wing,Lab,Scheduled,Practical session`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=timetable-template.csv');
  res.send(template);
};

export const exportTimetableCSV = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    const filter = { schoolAdminId };
    const { startDate, endDate, classId, teacherId } = req.query;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startOfDay(new Date(startDate));
      if (endDate) filter.date.$lte = endOfDay(new Date(endDate));
    }
    if (classId) filter.classId = classId;
    if (teacherId) filter.teacherId = teacherId;

    const entries = await Timetable.find(filter).populate(POPULATE_FIELDS).sort({ date: 1, startTime: 1 }).lean();

    const lines = [CSV_HEADERS.join(',')];
    for (const e of entries) {
      const d = new Date(e.date);
      const dateStr = d.toISOString().slice(0, 10);
      lines.push([
        dateStr,
        e.day || DAY_NAMES[d.getDay()],
        e.startTime,
        e.endTime,
        e.classId?.classNumber || '',
        e.sectionId || e.classId?.section || '',
        e.subjectId?.name || '',
        e.teacherId?.fullName || '',
        e.room || '',
        e.building || '',
        e.sessionType,
        e.status,
        (e.notes || '').replace(/,/g, ';'),
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=timetable-export.csv');
    res.send(lines.join('\n'));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const copyPreviousWeek = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    const { targetWeekStart } = req.body;
    if (!targetWeekStart) {
      return res.status(400).json({ success: false, message: 'targetWeekStart required' });
    }

    const targetStart = startOfDay(new Date(targetWeekStart));
    const sourceStart = addDays(targetStart, -7);
    const sourceEnd = addDays(sourceStart, 6);

    const sourceEntries = await Timetable.find({
      schoolAdminId,
      date: { $gte: sourceStart, $lte: endOfDay(sourceEnd) },
      status: { $ne: 'Cancelled' },
    }).lean();

    let copied = 0;
    let skipped = 0;

    for (const src of sourceEntries) {
      const srcDate = startOfDay(src.date);
      const dayOffset = Math.round((srcDate - sourceStart) / (24 * 60 * 60 * 1000));
      const newDate = addDays(targetStart, dayOffset);

      const entry = {
        ...src,
        _id: undefined,
        date: newDate,
        day: DAY_NAMES[newDate.getUTCDay()],
        repeatRule: 'none',
        repeatGroupId: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      };

      const { hasConflict } = await detectConflicts(entry, null, schoolAdminId);
      if (hasConflict) {
        skipped++;
        continue;
      }
      await new Timetable(entry).save();
      copied++;
    }

    res.json({ success: true, copied, skipped });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
