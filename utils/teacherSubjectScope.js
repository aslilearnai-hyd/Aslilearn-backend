import mongoose from 'mongoose';
import Class from '../models/Class.js';

/**
 * All Subject ObjectIds a teacher may use for prep content, homework, etc.:
 * - explicit Teacher.subjects
 * - plus assignedSubjects on every Class the teacher is assigned to
 * (admins often only wire subjects on the class, not on the teacher record).
 */
export async function getEffectiveTeacherSubjectObjectIds(teacher) {
  if (!teacher) return [];

  const idSet = new Set();

  const addRaw = (raw) => {
    if (raw == null) return;
    const id = raw._id != null ? raw._id : raw;
    const str = id.toString();
    if (mongoose.Types.ObjectId.isValid(str)) idSet.add(str);
  };

  const direct = teacher.subjects;
  if (Array.isArray(direct)) {
    direct.forEach(addRaw);
  }

  const classIds = teacher.assignedClassIds;
  if (Array.isArray(classIds) && classIds.length > 0) {
    const classDocs = await Class.find({
      $or: [{ _id: { $in: classIds } }, { classNumber: { $in: classIds } }],
      isActive: true,
    }).select('assignedSubjects');

    for (const cd of classDocs) {
      const arr = cd.assignedSubjects || [];
      for (const sub of arr) addRaw(sub);
    }
  }

  return Array.from(idSet).map((s) => new mongoose.Types.ObjectId(s));
}

export function subjectIdAllowed(subjectId, allowedObjectIds) {
  if (!subjectId || !mongoose.Types.ObjectId.isValid(String(subjectId))) return false;
  const want = String(subjectId);
  return allowedObjectIds.some((id) => id.toString() === want);
}

/**
 * Subject ids stored on Teacher.subjects only (admin "assign subjects to teacher").
 * Used for dashboard Learning Paths and APIs where we must not expand via class roster.
 */
export function getExplicitTeacherSubjectObjectIds(teacher) {
  if (!teacher) return [];

  const idSet = new Set();
  const addRaw = (raw) => {
    if (raw == null) return;
    const id = raw._id != null ? raw._id : raw;
    const str = id.toString();
    if (mongoose.Types.ObjectId.isValid(str)) idSet.add(str);
  };

  (teacher.subjects || []).forEach(addRaw);

  return Array.from(idSet).map((s) => new mongoose.Types.ObjectId(s));
}
