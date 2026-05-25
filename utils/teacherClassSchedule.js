import mongoose from 'mongoose';
import Timetable from '../models/Timetable.js';

export const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Normalize API day name or date to Mon–Sun abbrev. */
export function dayToAbbrev(dayOrDate) {
  if (dayOrDate == null || dayOrDate === '') return null;

  if (typeof dayOrDate === 'string') {
    const d = dayOrDate.trim().toLowerCase();
    if (d.startsWith('mon')) return 'Mon';
    if (d.startsWith('tue')) return 'Tue';
    if (d.startsWith('wed')) return 'Wed';
    if (d.startsWith('thu')) return 'Thu';
    if (d.startsWith('fri')) return 'Fri';
    if (d.startsWith('sat')) return 'Sat';
    if (d.startsWith('sun')) return 'Sun';
  }

  const parsed = new Date(dayOrDate);
  if (!Number.isNaN(parsed.getTime())) {
    const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return map[parsed.getDay()];
  }

  return null;
}

export function formatScheduleFromDays(daysSet) {
  const sorted = WEEKDAY_ORDER.filter((d) => daysSet.has(d));
  return sorted.length > 0 ? sorted.join(', ') : '';
}

function pickPrimaryRoom(roomsMap) {
  let best = '';
  let bestCount = 0;
  for (const [room, count] of roomsMap) {
    if (count > bestCount) {
      bestCount = count;
      best = room;
    }
  }
  return best;
}

/**
 * Timetable rows for a teacher → per-class schedule days and primary room.
 * @returns {Map<string, { schedule: string, room: string }>}
 */
export async function getClassScheduleAndRoomMap(teacherId, classObjectIds) {
  const map = new Map();
  if (!teacherId || !Array.isArray(classObjectIds) || classObjectIds.length === 0) {
    return map;
  }

  const validIds = classObjectIds
    .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(String(id)) : null))
    .filter(Boolean);

  if (validIds.length === 0) return map;

  const entries = await Timetable.find({
    teacherId,
    classId: { $in: validIds },
    status: { $ne: 'Cancelled' },
  })
    .select('classId day date room')
    .lean();

  const buckets = new Map();

  for (const entry of entries) {
    const cid = String(entry.classId);
    if (!buckets.has(cid)) {
      buckets.set(cid, { days: new Set(), rooms: new Map() });
    }
    const bucket = buckets.get(cid);
    const abbrev = dayToAbbrev(entry.day) || dayToAbbrev(entry.date);
    if (abbrev) bucket.days.add(abbrev);
    const room = String(entry.room || '').trim();
    if (room) {
      bucket.rooms.set(room, (bucket.rooms.get(room) || 0) + 1);
    }
  }

  for (const [cid, bucket] of buckets) {
    map.set(cid, {
      schedule: formatScheduleFromDays(bucket.days),
      room: pickPrimaryRoom(bucket.rooms),
    });
  }

  return map;
}
