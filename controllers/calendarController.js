import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import CalendarEvent from '../models/CalendarEvent.js';
import Event from '../models/Event.js';

export function monthBounds(monthStr) {
  const [y, m] = monthStr.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || m < 1 || m > 12) return null;
  const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
  return { monthStart, monthEnd };
}

function eventOverlapsMonth(eventDate, eventEndDate, monthStart, monthEnd) {
  const start = new Date(eventDate);
  const end = eventEndDate ? new Date(eventEndDate) : new Date(eventDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return start <= monthEnd && end >= monthStart;
}

/** Admin-created school events (legacy Event + CalendarEvent) for a school admin user id. */
export async function getSchoolAdminCalendarEvents(schoolAdminId, month) {
  const bounds = monthBounds(month);
  if (!bounds || !mongoose.Types.ObjectId.isValid(schoolAdminId)) return [];
  const { monthStart, monthEnd } = bounds;
  const schoolOid = new mongoose.Types.ObjectId(schoolAdminId);

  const legacyEvents = await Event.find({
    createdBy: schoolOid,
    date: { $lte: monthEnd },
  })
    .sort({ date: 1 })
    .lean();

  const adminLegacyEvents = legacyEvents
    .filter((ev) => eventOverlapsMonth(ev.date, ev.endDate, monthStart, monthEnd))
    .map((ev) => ({
      id: `admin-event-${ev._id.toString()}`,
      title: ev.name,
      startDate: ev.date,
      endDate: ev.endDate || ev.date,
      eventType: 'admin_event',
      description: ev.description || '',
      room: '',
    }));

  const calendarEvents = await CalendarEvent.find({
    schoolId: schoolOid,
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  })
    .sort({ startDate: 1 })
    .lean();

  const adminCalendarEvents = calendarEvents.map((ev) => ({
    id: `calendar-event-${ev._id.toString()}`,
    title: ev.title,
    startDate: ev.startDate,
    endDate: ev.endDate,
    eventType: 'admin_event',
    description: ev.description || '',
    room: '',
  }));

  return [...adminLegacyEvents, ...adminCalendarEvents].sort(
    (a, b) => new Date(a.startDate) - new Date(b.startDate)
  );
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
      .populate('targetSchools', 'schoolName fullName name email')
      .populate('schoolId', 'schoolName fullName name email')
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

    const examEvents = examsFiltered.map((ex) => {
      const targetSchoolNames = Array.isArray(ex.targetSchools)
        ? ex.targetSchools
            .map((school) => school?.schoolName || school?.fullName || school?.name || school?.email)
            .filter(Boolean)
        : [];
      const primarySchoolName =
        ex.schoolId?.schoolName || ex.schoolId?.fullName || ex.schoolId?.name || ex.schoolId?.email || '';
      const targetSchoolIds = Array.isArray(ex.targetSchools)
        ? ex.targetSchools
            .map((school) => (school?._id || school || '').toString())
            .filter(Boolean)
        : [];
      const primarySchoolId = ex.schoolId?._id ? ex.schoolId._id.toString() : '';
      const visibleSchoolIds =
        targetSchoolIds.length > 0
          ? targetSchoolIds
          : primarySchoolId
            ? [primarySchoolId]
            : [];
      const visibleToSchools =
        targetSchoolNames.length > 0
          ? targetSchoolNames
          : primarySchoolName
            ? [primarySchoolName]
            : ex.isSchoolSpecific
              ? []
              : ['All Schools'];

      return {
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
          schoolNames: visibleToSchools,
          schoolIds: visibleSchoolIds,
          isSchoolSpecific: ex.isSchoolSpecific === true,
        },
      };
    });

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
