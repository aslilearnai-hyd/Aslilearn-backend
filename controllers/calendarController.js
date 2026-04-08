import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import CalendarEvent from '../models/CalendarEvent.js';
import Event from '../models/Event.js';

function monthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || m < 1 || m > 12) return null;
  const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
  return { monthStart, monthEnd };
}

/** Whether an exam should appear on the calendar for the selected school admin. */
export function examVisibleToSchool(exam, schoolOid) {
  const sid = schoolOid.toString();
  if (exam.schoolId && exam.schoolId.toString() === sid) return true;
  if (Array.isArray(exam.targetSchools) && exam.targetSchools.length > 0) {
    return exam.targetSchools.some((t) => (t._id || t).toString() === sid);
  }
  if (exam.isSchoolSpecific === true) return false;
  return true;
}

/**
 * GET /api/super-admin/calendar/events?schoolId=&month=yyyy-mm
 * Also intended for GET /api/calendar/events (alias) with same auth.
 */
export const getCalendarEvents = async (req, res) => {
  try {
    const { schoolId, month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: 'Query param month is required (format yyyy-mm)',
      });
    }
    const bounds = monthBounds(month);
    if (!bounds) {
      return res.status(400).json({ success: false, message: 'Invalid month' });
    }
    const { monthStart, monthEnd } = bounds;

    const allSchools = !schoolId || schoolId === 'all';

    const examQuery = {
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
      createdByRole: 'super-admin',
      isActive: { $ne: false },
    };

    const examDocs = await Exam.find(examQuery)
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ startDate: 1 })
      .lean();

    let examsFiltered = examDocs;
    if (!allSchools) {
      if (!mongoose.Types.ObjectId.isValid(schoolId)) {
        return res.status(400).json({ success: false, message: 'Invalid schoolId' });
      }
      const schoolOid = new mongoose.Types.ObjectId(schoolId);
      examsFiltered = examDocs.filter((ex) => examVisibleToSchool(ex, schoolOid));
    }

    const examEvents = examsFiltered.map((ex) => ({
      id: ex._id.toString(),
      title: ex.title,
      startDate: ex.startDate,
      endDate: ex.endDate,
      type: 'exam',
      examId: ex._id.toString(),
      description: ex.description || '',
      meta: {
        examType: ex.examType,
        subject: ex.subject,
        duration: ex.duration,
      },
    }));

    const calQuery = {
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
    };
    if (!allSchools) {
      calQuery.schoolId = new mongoose.Types.ObjectId(schoolId);
    }

    const calDocs = await CalendarEvent.find(calQuery).sort({ startDate: 1 }).lean();

    const calMapped = calDocs.map((ev) => ({
      id: ev._id.toString(),
      title: ev.title,
      startDate: ev.startDate,
      endDate: ev.endDate,
      type: ev.eventKind === 'holiday' ? 'holiday' : 'custom',
      description: ev.description || '',
    }));

    const legacyQuery = {
      date: { $gte: monthStart, $lte: monthEnd },
    };
    if (!allSchools && mongoose.Types.ObjectId.isValid(schoolId)) {
      legacyQuery.createdBy = new mongoose.Types.ObjectId(schoolId);
    }

    const legacy = await Event.find(legacyQuery).sort({ date: 1 }).lean();
    const legacyMapped = legacy.map((ev) => ({
      id: ev._id.toString(),
      title: ev.name,
      startDate: ev.date,
      endDate: ev.endDate || ev.date,
      type: 'school_event',
      description: ev.description || '',
    }));

    const data = [...examEvents, ...calMapped, ...legacyMapped].sort(
      (a, b) => new Date(a.startDate) - new Date(b.startDate)
    );

    res.json({ success: true, data });
  } catch (e) {
    console.error('getCalendarEvents', e);
    res.status(500).json({ success: false, message: 'Failed to load calendar events' });
  }
};

export const createCalendarEvent = async (req, res) => {
  try {
    const { title, schoolId, startDate, endDate, eventKind, description } = req.body;
    if (!title || !schoolId || !startDate) {
      return res.status(400).json({
        success: false,
        message: 'title, schoolId, and startDate are required',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ success: false, message: 'Invalid schoolId' });
    }
    const start = new Date(startDate);
    let end = endDate ? new Date(endDate) : start;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid dates' });
    }
    if (end < start) {
      end = start;
    }
    const kind = eventKind === 'holiday' ? 'holiday' : 'custom';
    const doc = await CalendarEvent.create({
      title: title.trim(),
      schoolId,
      startDate: start,
      endDate: end,
      eventKind: kind,
      description: (description || '').trim(),
    });
    res.status(201).json({
      success: true,
      data: {
        id: doc._id.toString(),
        title: doc.title,
        startDate: doc.startDate,
        endDate: doc.endDate,
        type: kind === 'holiday' ? 'holiday' : 'custom',
      },
    });
  } catch (e) {
    console.error('createCalendarEvent', e);
    res.status(500).json({ success: false, message: 'Failed to create event' });
  }
};
