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
import { tryExpandClassTimetableGrid } from '../utils/class-timetable-grid-import.js';
import {
  subjectAliasMatchScore,
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

/**
 * Remap period bell times for a class week, and optionally insert/update/remove Break/Lunch slots.
 * Body: {
 *   classId, startDate, endDate,
 *   mappings: [{fromStart,toStart,toEnd}],
 *   breaksToAdd: [{startTime,endTime,label}],
 *   breaksToUpdate: [{fromStart,toStart,toEnd,label}],
 *   breaksToRemove: [{fromStart}],
 * }
 */
export const remapPeriodTimes = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    if (!schoolAdminId) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }
    const {
      classId,
      startDate,
      endDate,
      mappings = [],
      breaksToAdd = [],
      breaksToUpdate = [],
      breaksToRemove = [],
    } = req.body || {};
    if (!classId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'classId, startDate and endDate are required',
      });
    }

    const classOid = toObjectId(classId);
    if (!classOid) {
      return res.status(400).json({ success: false, message: 'Invalid classId' });
    }

    const dateFilter = {
      $gte: startOfDay(new Date(startDate)),
      $lte: endOfDay(new Date(endDate)),
    };

    let updated = 0;
    for (const m of mappings) {
      const fromStart = String(m.fromStart || '').trim();
      const toStart = String(m.toStart || '').trim();
      const toEnd = String(m.toEnd || '').trim();
      if (!/^\d{2}:\d{2}$/.test(fromStart) || !/^\d{2}:\d{2}$/.test(toStart) || !/^\d{2}:\d{2}$/.test(toEnd)) {
        continue;
      }
      if (parseTimeToMinutes(toEnd) <= parseTimeToMinutes(toStart)) continue;
      const result = await Timetable.updateMany(
        {
          schoolAdminId,
          classId: classOid,
          startTime: fromStart,
          date: dateFilter,
          sessionType: { $ne: 'Activity' },
        },
        { $set: { startTime: toStart, endTime: toEnd } },
      );
      updated += result.modifiedCount || 0;
    }

    let breaksUpdated = 0;
    let breaksRemoved = 0;

    if (Array.isArray(breaksToRemove) && breaksToRemove.length) {
      for (const br of breaksToRemove) {
        const fromStart = String(br.fromStart || br.startTime || '').trim();
        if (!/^\d{2}:\d{2}$/.test(fromStart)) continue;
        const result = await Timetable.deleteMany({
          schoolAdminId,
          classId: classOid,
          startTime: fromStart,
          date: dateFilter,
          sessionType: 'Activity',
        });
        breaksRemoved += result.deletedCount || 0;
      }
    }

    if (Array.isArray(breaksToUpdate) && breaksToUpdate.length) {
      for (const br of breaksToUpdate) {
        const fromStart = String(br.fromStart || '').trim();
        const toStart = String(br.toStart || br.startTime || '').trim();
        const toEnd = String(br.toEnd || br.endTime || '').trim();
        const label = String(br.label || 'Break').trim().slice(0, 40) || 'Break';
        if (!/^\d{2}:\d{2}$/.test(fromStart) || !/^\d{2}:\d{2}$/.test(toStart) || !/^\d{2}:\d{2}$/.test(toEnd)) {
          continue;
        }
        if (parseTimeToMinutes(toEnd) <= parseTimeToMinutes(toStart)) continue;
        const result = await Timetable.updateMany(
          {
            schoolAdminId,
            classId: classOid,
            startTime: fromStart,
            date: dateFilter,
            sessionType: 'Activity',
          },
          { $set: { startTime: toStart, endTime: toEnd, notes: label } },
        );
        breaksUpdated += result.modifiedCount || 0;
      }
    }

    let breaksCreated = 0;
    if (Array.isArray(breaksToAdd) && breaksToAdd.length) {
      const sample = await Timetable.findOne({
        schoolAdminId,
        classId: classOid,
        date: dateFilter,
      }).lean();
      if (!sample?.teacherId) {
        return res.status(400).json({
          success: false,
          message: 'No timetable rows found for this class/week to attach breaks.',
          updated,
          breaksUpdated,
          breaksRemoved,
        });
      }

      const admin = await User.findById(schoolAdminId).select('board').lean();
      const board = String(admin?.board || 'ASLI_EXCLUSIVE_SCHOOLS').toUpperCase();
      const dates = await Timetable.distinct('date', {
        schoolAdminId,
        classId: classOid,
        date: dateFilter,
      });

      for (const br of breaksToAdd) {
        const startTime = String(br.startTime || '').trim();
        const endTime = String(br.endTime || '').trim();
        const label = String(br.label || 'Break').trim().slice(0, 40) || 'Break';
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) continue;
        if (parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime)) continue;

        // Never auto-create subjects — only use an existing catalog/school subject.
        const subject = await Subject.findOne({
          board,
          isActive: { $ne: false },
          name: { $regex: `^${escapeRegex(label)}$`, $options: 'i' },
          $nor: [{ name: /__deleted__/i }],
        });
        if (!subject) continue;

        await Subject.updateOne({ _id: subject._id }, { $addToSet: { classIds: classOid } });
        await Class.updateOne({ _id: classOid }, { $addToSet: { assignedSubjects: subject._id } });

        for (const d of dates) {
          const exists = await Timetable.findOne({
            schoolAdminId,
            classId: classOid,
            date: d,
            startTime,
            subjectId: subject._id,
          }).select('_id').lean();
          if (exists) continue;

          const dayName = DAY_NAMES[new Date(d).getUTCDay()] || 'Monday';
          await Timetable.create({
            schoolAdminId,
            date: startOfDay(d),
            day: dayName,
            startTime,
            endTime,
            classId: classOid,
            sectionId: sample.sectionId || '',
            subjectId: subject._id,
            teacherId: sample.teacherId,
            room: sample.room || 'TBD',
            building: sample.building || 'Main',
            sessionType: 'Activity',
            status: 'Scheduled',
            notes: label,
            attendanceRequired: false,
            repeatRule: 'none',
          });
          breaksCreated += 1;
        }
      }
    }

    res.json({
      success: true,
      updated,
      breaksCreated,
      breaksUpdated,
      breaksRemoved,
    });
  } catch (error) {
    console.error('remapPeriodTimes:', error);
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

  // Also pull subjects whose name matches common aliases (Maths / Mathematics / Math)
  const aliasNames = [
    want,
    ...new Set(
      [want, want.replace(/\s+/g, ''), want.replace(/[-_/]+/g, ' ')].map((s) => String(s || '').trim()),
    ),
  ];
  const exactSubjects = await Subject.find({
    $and: [
      {
        $or: aliasNames.flatMap((alias) => {
          const esc = escapeRegex(alias);
          return [
            { name: new RegExp(`^${esc}$`, 'i') },
            { name: new RegExp(`^${esc}_\\d+$`, 'i') },
          ];
        }),
      },
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

  const isLinked = (s) =>
    assignedIds.some((id) => String(id) === String(s._id)) ||
    (s.classIds || []).some((id) => String(id) === String(cls._id));

  const scored = unique
    .map((s) => ({
      subject: s,
      score: subjectAliasMatchScore(s.name, want),
      linked: isLinked(s) ? 1 : 0,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.linked - a.linked);

  // Prefer strong alias/exact matches; avoid weak IIT↔non-IIT fallback unless nothing else
  const strong = scored.find((row) => row.score >= 90);
  if (strong) return strong.subject;
  const linkedStrong = scored.find((row) => row.linked && row.score >= 90);
  if (linkedStrong) return linkedStrong.subject;
  return scored[0]?.subject || null;
}

/** Resolve an existing subject for the class — never auto-create subjects from timetable import. */
async function resolveSubjectForClassOrCreate(cls, subjectName, schoolAdminId, { allowCreate = false } = {}) {
  void schoolAdminId;
  void allowCreate;
  let subject = await resolveSubjectForClass(cls, subjectName);
  if (!subject) return null;
  await Promise.all([
    Subject.updateOne({ _id: subject._id }, { $addToSet: { classIds: cls._id } }),
    Class.updateOne({ _id: cls._id }, { $addToSet: { assignedSubjects: subject._id } }),
  ]);
  return subject;
}

function isGridImportRow(row) {
  const flag = row?.gridsource ?? row?.__gridsource ?? row?.__gridSource;
  return flag === true || flag === 'true' || flag === 1 || flag === '1';
}

function parseCsvBuffer(buffer, originalName, options = {}) {
  const grid = tryExpandClassTimetableGrid(buffer, originalName, options);
  if (grid?.rows?.length) {
    return {
      rows: grid.rows.map((r) => {
        const n = normalizeCsvRow(r);
        n.gridsource = true;
        return n;
      }),
      format: 'class-grid',
      gridErrors: Array.isArray(grid.errors) ? grid.errors : [],
    };
  }

  let csvData;
  try {
    ({ csv: csvData } = spreadsheetBufferToCsv(buffer, originalName));
  } catch {
    csvData = buffer.toString('utf8');
  }
  const rows = parse(csvData, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  return {
    rows: (Array.isArray(rows) ? rows : []).map(normalizeCsvRow),
    format: 'flat',
    gridErrors: [],
  };
}

async function resolveCsvRow(row, schoolAdminId) {
  const classNumber = normalizeClassNumber(cell(row, 'Class', 'class', 'classnumber', 'classname'));
  const section = cell(row, 'Section', 'section', 'sec').toUpperCase();
  const subjectName = cell(row, 'Subject', 'subject', 'subjectname');
  const teacherName = cell(row, 'Teacher', 'teacher', 'teachername');
  const teacherEmail = cell(row, 'TeacherEmail', 'teacheremail', 'email');
  const fromGrid = isGridImportRow(row);

  if (!classNumber || !section) {
    return { error: 'Class and Section are required' };
  }
  if (!subjectName) {
    return { error: 'Subject is required' };
  }
  if (!teacherName && !teacherEmail && !fromGrid) {
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
    const existingClasses = await Class.find({ assignedAdmin: schoolAdminId, isActive: true })
      .select('classNumber section name')
      .sort({ classNumber: 1, section: 1 })
      .lean();
    const available = existingClasses
      .map((c) => `${c.classNumber}-${c.section}${c.name ? ` (${c.name})` : ''}`)
      .join(', ');
    return {
      error: `Class ${classNumber}-${section} not found for this school.${
        available ? ` Available: ${available}` : ' No classes exist yet — add classes in School Management first.'
      }`,
    };
  }

  const subject = await resolveSubjectForClassOrCreate(resolvedClass, subjectName, schoolAdminId, {
    allowCreate: false,
  });
  if (!subject) {
    const classDoc = await Class.findById(resolvedClass._id).select('assignedSubjects').lean();
    const assignedIds = classDoc?.assignedSubjects || [];
    const availableSubjects = assignedIds.length
      ? await Subject.find({ _id: { $in: assignedIds }, isActive: { $ne: false } }).select('name').lean()
      : [];
    const available = availableSubjects.map((s) => s.name).join(', ');
    return {
      error: `Subject "${subjectName}" not found for class ${resolvedClass.classNumber}-${resolvedClass.section}.${
        available
          ? ` Available: ${available}`
          : ' No subjects assigned to this class — assign one in School Management first.'
      }`,
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
  // Class-grid uploads often omit teacher — pick subject primary teacher, then any school teacher
  if (!teacher && subject?.teacherId) {
    teacher = await Teacher.findOne({
      _id: subject.teacherId,
      adminId: schoolAdminId,
      isActive: { $ne: false },
    });
  }
  if (!teacher) {
    const classIdStr = String(resolvedClass._id);
    teacher = await Teacher.findOne({
      adminId: schoolAdminId,
      isActive: { $ne: false },
      assignedClassIds: classIdStr,
    });
  }
  if (!teacher) {
    teacher = await Teacher.findOne({
      adminId: schoolAdminId,
      isActive: { $ne: false },
    }).sort({ fullName: 1 });
  }
  if (!teacher) {
    const availableTeachers = await Teacher.find({ adminId: schoolAdminId, isActive: { $ne: false } })
      .select('fullName')
      .sort({ fullName: 1 })
      .lean();
    const available = availableTeachers.map((t) => t.fullName).join(', ');
    return {
      error: `Teacher "${teacherName || teacherEmail || '(auto)'}" not found for this school.${
        available ? ` Available: ${available}` : ' Add at least one teacher login before importing the class grid.'
      }`,
    };
  }

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

async function buildImportContext(schoolAdminId) {
  const [classes, teachers, admin] = await Promise.all([
    Class.find({ assignedAdmin: schoolAdminId, isActive: true })
      .select('_id classNumber section name assignedSubjects')
      .lean(),
    Teacher.find({ adminId: schoolAdminId, isActive: { $ne: false } })
      .select('_id fullName email teacherId assignedClassIds')
      .sort({ fullName: 1 })
      .lean(),
    User.findById(schoolAdminId).select('board schoolName').lean(),
  ]);

  const board = String(admin?.board || 'ASLI_EXCLUSIVE_SCHOOLS').toUpperCase();
  const schoolName = String(admin?.schoolName || '').trim();
  const classOids = classes.map((c) => c._id);
  const assignedSubjectIds = [
    ...new Set(classes.flatMap((c) => (c.assignedSubjects || []).map((id) => String(id)))),
  ];

  const subjects = await Subject.find({
    isActive: { $ne: false },
    name: { $not: /__deleted__/ },
    $or: [
      ...(assignedSubjectIds.length ? [{ _id: { $in: assignedSubjectIds } }] : []),
      ...(classOids.length ? [{ classIds: { $in: classOids } }] : []),
      { board },
    ],
  })
    .select('_id name classNumber classIds teacherId board')
    .lean();

  const classByKey = new Map();
  for (const cls of classes) {
    const num = String(cls.classNumber || '').replace(/\.0+$/, '');
    const sec = String(cls.section || '').toUpperCase();
    classByKey.set(`${num}|${sec}`, cls);
    classByKey.set(`${String(Number(num) || num)}|${sec}`, cls);
  }

  const teacherByEmail = new Map();
  const teacherByName = new Map();
  for (const t of teachers) {
    if (t.email) teacherByEmail.set(String(t.email).toLowerCase(), t);
    if (t.fullName) teacherByName.set(String(t.fullName).toLowerCase(), t);
  }

  return {
    schoolAdminId,
    board,
    schoolName,
    classes,
    classByKey,
    teachers,
    teacherByEmail,
    teacherByName,
    defaultTeacher: teachers[0] || null,
    subjects,
    subjectById: new Map(subjects.map((s) => [String(s._id), s])),
    createdSubjectNames: new Map(),
    createdClasses: new Map(),
    pendingClassSubjectLinks: [], // { classId, subjectId }
    autoCreatedClasses: [],
  };
}

function registerClassInContext(ctx, cls) {
  const num = String(cls.classNumber || '').replace(/\.0+$/, '');
  const sec = String(cls.section || '').toUpperCase();
  ctx.classByKey.set(`${num}|${sec}`, cls);
  ctx.classByKey.set(`${String(Number(num) || num)}|${sec}`, cls);
  if (!ctx.classes.some((c) => String(c._id) === String(cls._id))) {
    ctx.classes.push(cls);
  }
}

async function ensureClassInContext(ctx, classNumber, section, { allowCreate }) {
  let resolved = findClassInContext(ctx, classNumber, section);
  if (resolved) return resolved;
  if (!allowCreate) return null;

  const num = String(classNumber || '').replace(/\.0+$/, '');
  const sec = String(section || '').toUpperCase();
  if (!num || !/^[A-Z0-9]{1,3}$/.test(sec)) return null;

  const cacheKey = `${num}|${sec}`;
  if (ctx.createdClasses.has(cacheKey)) {
    return ctx.createdClasses.get(cacheKey);
  }

  let created;
  try {
    created = await Class.create({
      classNumber: num,
      section: sec,
      name: `Class ${num}-${sec}`,
      description: 'Auto-created from class timetable grid import',
      school: ctx.schoolName || '',
      assignedAdmin: ctx.schoolAdminId,
      board: ctx.board,
      assignedSubjects: [],
      isActive: true,
    });
    created = created.toObject ? created.toObject() : created;
  } catch (err) {
    // Race / unique index — fetch existing
    created = await Class.findOne({
      classNumber: num,
      section: sec,
      assignedAdmin: ctx.schoolAdminId,
      isActive: true,
    }).lean();
    if (!created) {
      console.warn('[timetable-import] class create failed:', err?.message || err);
      return null;
    }
  }

  registerClassInContext(ctx, created);
  ctx.createdClasses.set(cacheKey, created);
  ctx.autoCreatedClasses.push(`${num}-${sec}`);
  return created;
}

function findClassInContext(ctx, classNumber, section) {
  const num = String(classNumber || '').replace(/\.0+$/, '');
  const sec = String(section || '').toUpperCase();
  return (
    ctx.classByKey.get(`${num}|${sec}`) ||
    ctx.classByKey.get(`${String(Number(num) || num)}|${sec}`) ||
    null
  );
}

function pickSubjectFromList(subjects, cls, want) {
  const assignedIds = new Set((cls.assignedSubjects || []).map((id) => String(id)));
  const isLinked = (s) =>
    assignedIds.has(String(s._id)) ||
    (s.classIds || []).some((id) => String(id) === String(cls._id));

  const scored = subjects
    .map((s) => ({
      subject: s,
      score: subjectAliasMatchScore(s.name, want),
      linked: isLinked(s) ? 1 : 0,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.linked - a.linked);

  const strong = scored.find((row) => row.score >= 90);
  if (strong) return strong.subject;
  return scored[0]?.subject || null;
}

async function resolveSubjectInContext(ctx, cls, subjectName, { allowCreate }) {
  void allowCreate;
  const want = cleanCsvCell(subjectName);
  if (!want) return null;

  const cacheKey = `${String(cls._id)}::${want.toLowerCase()}`;
  if (ctx.createdSubjectNames.has(cacheKey)) {
    return ctx.createdSubjectNames.get(cacheKey);
  }

  // Match existing subjects only (board-wide + class-linked). Never auto-create.
  let subject = pickSubjectFromList(ctx.subjects, cls, want);
  if (!subject) {
    subject = pickSubjectFromList(
      ctx.subjects.filter((s) => String(s.board || '').toUpperCase() === ctx.board),
      cls,
      want,
    );
  }

  if (subject) {
    ctx.createdSubjectNames.set(cacheKey, subject);
    ctx.pendingClassSubjectLinks.push({ classId: cls._id, subjectId: subject._id });
  }
  return subject || null;
}

function findTeacherInContext(ctx, { teacherName, teacherEmail, subject, classId }) {
  if (teacherEmail) {
    const hit = ctx.teacherByEmail.get(teacherEmail.toLowerCase());
    if (hit) return hit;
  }
  if (teacherName) {
    const exact = ctx.teacherByName.get(teacherName.toLowerCase());
    if (exact) return exact;
    const partial = ctx.teachers.find((t) =>
      String(t.fullName || '')
        .toLowerCase()
        .includes(teacherName.toLowerCase()),
    );
    if (partial && teacherName.length >= 3) return partial;
  }
  if (subject?.teacherId) {
    const t = ctx.teachers.find((x) => String(x._id) === String(subject.teacherId));
    if (t) return t;
  }
  const classIdStr = String(classId);
  const byClass = ctx.teachers.find((t) =>
    (t.assignedClassIds || []).some((id) => String(id) === classIdStr),
  );
  if (byClass) return byClass;
  return ctx.defaultTeacher;
}

function conflictKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

function entryConflictsWith(entry, existing, { ignoreTeacher = false } = {}) {
  if (!timesOverlap(entry.startTime, entry.endTime, existing.startTime, existing.endTime)) {
    return false;
  }
  // Grid imports often share one fallback teacher — don't treat that as a real clash
  if (
    !ignoreTeacher &&
    entry.teacherId &&
    existing.teacherId &&
    String(existing.teacherId) === String(entry.teacherId)
  ) {
    return true;
  }
  if (entry.room && existing.room && entry.room === existing.room && entry.room !== 'TBD') {
    return true;
  }
  if (
    String(entry.classId) === String(existing.classId) &&
    String(entry.sectionId || '').toUpperCase() === String(existing.sectionId || '').toUpperCase()
  ) {
    return true;
  }
  return false;
}

async function resolveCsvRowFast(row, ctx) {
  const classNumber = normalizeClassNumber(cell(row, 'Class', 'class', 'classnumber', 'classname'));
  const section = cell(row, 'Section', 'section', 'sec').toUpperCase();
  const subjectName = cell(row, 'Subject', 'subject', 'subjectname');
  const teacherName = cell(row, 'Teacher', 'teacher', 'teachername');
  const teacherEmail = cell(row, 'TeacherEmail', 'teacheremail', 'email');
  const fromGrid = isGridImportRow(row);

  if (!classNumber || !section) return { error: 'Class and Section are required' };
  if (!subjectName) return { error: 'Subject is required' };
  if (!teacherName && !teacherEmail && !fromGrid) {
    return { error: 'Teacher (or TeacherEmail) is required' };
  }

  const resolvedClass = await ensureClassInContext(ctx, classNumber, section, {
    allowCreate: fromGrid,
  });
  if (!resolvedClass) {
    const available = ctx.classes
      .map((c) => `${c.classNumber}-${c.section}${c.name ? ` (${c.name})` : ''}`)
      .join(', ');
    return {
      error: `Class ${classNumber}-${section} not found for this school.${
        available ? ` Available: ${available}` : ' No classes exist yet — add classes in School Management first.'
      }`,
    };
  }

  const subject = await resolveSubjectInContext(ctx, resolvedClass, subjectName, {
    allowCreate: false,
  });
  if (!subject) {
    const assignedIds = resolvedClass.assignedSubjects || [];
    const available = ctx.subjects
      .filter((s) => assignedIds.some((id) => String(id) === String(s._id)))
      .map((s) => s.name)
      .join(', ');
    return {
      error: `Subject "${subjectName}" not found for class ${resolvedClass.classNumber}-${resolvedClass.section}.${
        available
          ? ` Available: ${available}`
          : ' No subjects assigned to this class — assign one in School Management first.'
      }`,
    };
  }

  const teacher = findTeacherInContext(ctx, {
    teacherName,
    teacherEmail,
    subject,
    classId: resolvedClass._id,
  });
  if (!teacher) {
    return {
      error: `Teacher "${teacherName || teacherEmail || '(auto)'}" not found for this school.${
        ctx.teachers.length
          ? ` Available: ${ctx.teachers.map((t) => t.fullName).join(', ')}`
          : ' Add at least one teacher login before importing the class grid.'
      }`,
    };
  }

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
    schoolAdminId: ctx.schoolAdminId,
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

async function flushClassSubjectLinks(ctx) {
  const links = ctx.pendingClassSubjectLinks || [];
  if (!links.length) return;
  const byClass = new Map();
  const bySubject = new Map();
  for (const { classId, subjectId } of links) {
    const cKey = String(classId);
    const sKey = String(subjectId);
    if (!byClass.has(cKey)) byClass.set(cKey, { classId, subjectIds: new Set() });
    byClass.get(cKey).subjectIds.add(sKey);
    if (!bySubject.has(sKey)) bySubject.set(sKey, { subjectId, classIds: new Set() });
    bySubject.get(sKey).classIds.add(cKey);
  }
  await Promise.all([
    ...[...byClass.values()].map(({ classId, subjectIds }) =>
      Class.updateOne(
        { _id: classId },
        {
          $addToSet: {
            assignedSubjects: {
              $each: [...subjectIds].map((id) => new mongoose.Types.ObjectId(String(id))),
            },
          },
        },
      ),
    ),
    ...[...bySubject.values()].map(({ subjectId, classIds }) =>
      Subject.updateOne(
        { _id: subjectId },
        {
          $addToSet: {
            classIds: {
              $each: [...classIds].map((id) => new mongoose.Types.ObjectId(String(id))),
            },
          },
        },
      ),
    ),
  ]);
  ctx.pendingClassSubjectLinks = [];
}

async function processCsvRows(rows, schoolAdminId, { dryRun = false, mode = 'import', format = 'flat' } = {}) {
  const started = Date.now();
  const isGrid = format === 'class-grid';
  // Re-uploading the same class grid should refresh that week, not fight the previous import
  const effectiveMode = isGrid && mode === 'import' ? 'replace-grid' : mode;
  console.log(
    `[timetable-import] start rows=${rows.length} dryRun=${dryRun} mode=${mode} effective=${effectiveMode} format=${format}`,
  );

  let imported = 0;
  let skipped = 0;
  const errors = [];
  const validEntries = [];

  const ctx = await buildImportContext(schoolAdminId);
  if (!ctx.classes.length) {
    return {
      imported: 0,
      skipped: rows.length,
      errors: [
        {
          row: 0,
          reason: 'No classes exist yet — add classes in School Management first.',
          status: 'error',
        },
      ],
      autoCreatedClasses: [],
    };
  }

  // Prefetch existing timetable for conflict checks (skipped for grid replace)
  const datesPreview = [];
  for (const row of rows) {
    const { date } = parseCsvDate(cell(row, 'Date', 'date', 'scheduledate'));
    if (date && !Number.isNaN(date.getTime())) datesPreview.push(date);
  }
  const existingByDay = new Map();
  if (datesPreview.length && effectiveMode !== 'replace-grid' && effectiveMode !== 'replace') {
    const min = startOfDay(new Date(Math.min(...datesPreview.map((d) => d.getTime()))));
    const max = endOfDay(new Date(Math.max(...datesPreview.map((d) => d.getTime()))));
    const existing = await Timetable.find({
      schoolAdminId,
      date: { $gte: min, $lte: max },
      status: { $ne: 'Cancelled' },
    })
      .select('date startTime endTime teacherId classId sectionId room')
      .lean();
    for (const e of existing) {
      const key = conflictKey(e.date);
      if (!existingByDay.has(key)) existingByDay.set(key, []);
      existingByDay.get(key).push(e);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const resolved = await resolveCsvRowFast(rows[i], ctx);
    if (resolved.error) {
      errors.push({ row: i + 2, reason: resolved.error, status: 'error' });
      skipped++;
      continue;
    }

    const ignoreTeacher = isGrid || isGridImportRow(rows[i]);
    const dayList = existingByDay.get(conflictKey(resolved.entry.date)) || [];
    const hasConflict =
      effectiveMode !== 'replace-grid' &&
      effectiveMode !== 'replace' &&
      (dayList.some((ex) => entryConflictsWith(resolved.entry, ex, { ignoreTeacher })) ||
        validEntries.some(
          (e) =>
            conflictKey(e.date) === conflictKey(resolved.entry.date) &&
            entryConflictsWith(resolved.entry, e, { ignoreTeacher }),
        ));

    if (hasConflict) {
      errors.push({ row: i + 2, reason: 'Conflict detected', status: 'warning', ...resolved.rowMeta });
      if (effectiveMode === 'merge' || dryRun) {
        skipped++;
        continue;
      }
      // default import: warn but still save
    }

    validEntries.push(resolved.entry);
    if (dryRun) imported++;
  }

  await flushClassSubjectLinks(ctx);

  if (!dryRun && validEntries.length) {
    if (effectiveMode === 'replace' || effectiveMode === 'replace-grid') {
      const dates = validEntries.map((e) => e.date);
      const min = startOfDay(new Date(Math.min(...dates.map((d) => d.getTime()))));
      const max = endOfDay(new Date(Math.max(...dates.map((d) => d.getTime()))));
      const classIds = [...new Set(validEntries.map((e) => String(e.classId)))];
      const deleteFilter =
        effectiveMode === 'replace-grid'
          ? {
              schoolAdminId,
              classId: { $in: classIds },
              date: { $gte: min, $lte: max },
            }
          : {
              schoolAdminId,
              date: { $gte: min, $lte: max },
            };
      const del = await Timetable.deleteMany(deleteFilter);
      console.log(
        `[timetable-import] cleared ${del.deletedCount || 0} existing entries before replace (${effectiveMode})`,
      );
    }

    const BATCH = 100;
    for (let i = 0; i < validEntries.length; i += BATCH) {
      const chunk = validEntries.slice(i, i + BATCH);
      try {
        const inserted = await Timetable.insertMany(chunk, { ordered: false });
        imported += inserted.length;
      } catch (err) {
        const n = err?.insertedDocs?.length || err?.result?.nInserted || 0;
        imported += n;
        const writeErrors = err?.writeErrors || [];
        for (const we of writeErrors) {
          errors.push({
            row: 0,
            reason: we?.errmsg || we?.err?.message || 'Failed to save row',
            status: 'error',
          });
          skipped++;
        }
        if (!writeErrors.length && !n) {
          errors.push({
            row: 0,
            reason: err?.message || 'Failed to save batch',
            status: 'error',
          });
          skipped += chunk.length;
        }
      }
    }
  }

  console.log(
    `[timetable-import] done in ${Date.now() - started}ms imported=${imported} skipped=${skipped} errors=${errors.length} autoClasses=${ctx.autoCreatedClasses?.length || 0}`,
  );
  return {
    imported,
    skipped,
    errors,
    autoCreatedClasses: [...new Set(ctx.autoCreatedClasses || [])],
    replaced: effectiveMode === 'replace' || effectiveMode === 'replace-grid',
  };
}

export const validateTimetableCSV = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const weekStart = req.body?.weekStart || req.body?.week_start || req.query?.weekStart;
    const parsed = parseCsvBuffer(req.file.buffer, req.file.originalname, { weekStart });
    const result = await processCsvRows(parsed.rows, schoolAdminId, {
      dryRun: true,
      format: parsed.format,
    });
    const errors = [...(parsed.gridErrors || []), ...(result.errors || [])];
    res.json({
      success: true,
      ...result,
      errors,
      skipped: (result.skipped || 0) + (parsed.gridErrors?.length || 0),
      format: parsed.format,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const importTimetableCSV = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const mode = req.body.mode || 'import';
    const weekStart = req.body?.weekStart || req.body?.week_start || req.query?.weekStart;
    console.log(
      `[timetable-import] request file=${req.file.originalname} size=${req.file.size} mode=${mode}`,
    );
    const parsed = parseCsvBuffer(req.file.buffer, req.file.originalname, { weekStart });
    console.log(
      `[timetable-import] parsed format=${parsed.format} rows=${parsed.rows.length} gridErrors=${parsed.gridErrors?.length || 0}`,
    );
    if (parsed.format === 'class-grid' && !parsed.rows.length) {
      return res.status(400).json({
        success: false,
        message:
          'Class timetable grid was detected but no periods were found. Check class headers (e.g. 6A) and Time rows.',
        errors: parsed.gridErrors || [],
        format: parsed.format,
      });
    }
    const result = await processCsvRows(parsed.rows, schoolAdminId, {
      dryRun: false,
      mode,
      format: parsed.format,
    });
    const errors = [...(parsed.gridErrors || []), ...(result.errors || [])];
    res.json({
      success: true,
      ...result,
      errors,
      skipped: (result.skipped || 0) + (parsed.gridErrors?.length || 0),
      format: parsed.format,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const downloadCSVTemplate = async (req, res) => {
  try {
    const schoolAdminId = resolveAdminId(req);
    const sampleRows = [];

    if (schoolAdminId) {
      const classes = await Class.find({ assignedAdmin: schoolAdminId, isActive: true })
        .select('classNumber section assignedSubjects')
        .sort({ classNumber: 1, section: 1 })
        .limit(2)
        .lean();

      for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        const subject = cls.assignedSubjects?.length
          ? await Subject.findOne({ _id: { $in: cls.assignedSubjects }, isActive: { $ne: false } })
              .select('name')
              .lean()
          : null;
        const teacher = await Teacher.findOne({ adminId: schoolAdminId, isActive: { $ne: false } })
          .select('fullName')
          .lean();

        if (subject && teacher) {
          const startHour = 9 + i;
          sampleRows.push([
            new Date().toISOString().slice(0, 10),
            'Monday',
            `${String(startHour).padStart(2, '0')}:00`,
            `${String(startHour + 1).padStart(2, '0')}:00`,
            cls.classNumber,
            cls.section,
            subject.name,
            teacher.fullName,
            'Room-101',
            'Main Block',
            'Lecture',
            'Scheduled',
            'Sample entry - edit as needed',
          ]);
        }
      }
    }

    if (!sampleRows.length) {
      sampleRows.push(
        ['2026-05-24', 'Monday', '09:00', '10:00', '10', 'A', 'Mathematics', 'John Smith', 'Room-101', 'Main Block', 'Lecture', 'Scheduled', 'Chapter 1 - Algebra'],
        ['2026-05-24', 'Monday', '10:00', '11:00', '10', 'A', 'Physics', 'Jane Doe', 'Lab-201', 'Science Wing', 'Lab', 'Scheduled', 'Practical session'],
      );
    }

    const lines = [CSV_HEADERS.join(','), ...sampleRows.map((row) => row.map(csvEscape).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=timetable-template.csv');
    res.send(lines.join('\n'));
  } catch (error) {
    console.error('downloadCSVTemplate:', error);
    res.status(500).json({ success: false, message: error.message });
  }
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
