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

const POPULATE_FIELDS = [
  { path: 'classId', select: 'classNumber section name' },
  { path: 'subjectId', select: 'name code' },
  { path: 'teacherId', select: 'fullName email' },
];

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

function entryPayload(body, schoolAdminId, createdBy) {
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
    room: body.room || '',
    building: body.building || '',
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

    const payload = entryPayload(req.body, schoolAdminId, schoolAdminId);
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

const CSV_HEADERS = ['Date', 'Day', 'StartTime', 'EndTime', 'Class', 'Section', 'Subject', 'Teacher', 'Room', 'Type', 'Status', 'Notes'];

function parseCsvBuffer(buffer, originalName) {
  let csvData;
  try {
    ({ csv: csvData } = spreadsheetBufferToCsv(buffer, originalName));
  } catch {
    csvData = buffer.toString('utf8');
  }
  return parse(csvData, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
}

async function resolveCsvRow(row, schoolAdminId) {
  const classNumber = cleanCsvCell(row.Class || row.class);
  const section = cleanCsvCell(row.Section || row.section || '').toUpperCase();
  const subjectName = cleanCsvCell(row.Subject || row.subject);
  const teacherName = cleanCsvCell(row.Teacher || row.teacher);
  const teacherEmail = cleanCsvCell(row.TeacherEmail || row.email || '');

  const cls = await Class.findOne({ classNumber, section, assignedAdmin: schoolAdminId, isActive: true });
  if (!cls) return { error: `Class ${classNumber}-${section} not found` };

  const subject = await Subject.findOne({
    name: new RegExp(`^${subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    classIds: cls._id,
  });
  if (!subject) return { error: `Subject "${subjectName}" not found for class` };

  let teacher = null;
  if (teacherEmail) {
    teacher = await Teacher.findOne({ email: teacherEmail.toLowerCase(), adminId: schoolAdminId });
  }
  if (!teacher && teacherName) {
    teacher = await Teacher.findOne({
      fullName: new RegExp(`^${teacherName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      adminId: schoolAdminId,
    });
  }
  if (!teacher) return { error: `Teacher "${teacherName || teacherEmail}" not found` };

  const dateStr = cleanCsvCell(row.Date || row.date);
  const date = startOfDay(new Date(dateStr));
  if (Number.isNaN(date.getTime())) return { error: `Invalid date: ${dateStr}` };

  const entry = {
    schoolAdminId,
    date,
    day: cleanCsvCell(row.Day || row.day) || DAY_NAMES[date.getDay()],
    startTime: cleanCsvCell(row.StartTime || row.startTime),
    endTime: cleanCsvCell(row.EndTime || row.endTime),
    classId: cls._id,
    sectionId: section,
    subjectId: subject._id,
    teacherId: teacher._id,
    room: cleanCsvCell(row.Room || row.room || ''),
    sessionType: cleanCsvCell(row.Type || row.type || 'Lecture'),
    status: cleanCsvCell(row.Status || row.status || 'Scheduled'),
    notes: cleanCsvCell(row.Notes || row.notes || ''),
    repeatRule: 'none',
  };

  return { entry, rowMeta: { date: dateStr, class: `${classNumber}-${section}`, subject: subjectName, teacher: teacher.fullName } };
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
      const { hasConflict } = await detectConflicts(entry, null, schoolAdminId);
      if (mode === 'merge' && hasConflict) {
        skipped++;
        continue;
      }
      await new Timetable(entry).save();
      imported++;
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
2026-05-24,Monday,09:00,10:00,10,A,Mathematics,John Smith,Room-101,Lecture,Scheduled,Chapter 1 - Algebra
2026-05-24,Monday,10:00,11:00,10,A,Physics,Jane Doe,Lab-201,Lab,Scheduled,Practical session`;
  res.setHeader('Content-Type', 'text/csv');
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
