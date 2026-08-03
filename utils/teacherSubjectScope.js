import mongoose from 'mongoose';
import Class from '../models/Class.js';

function addSubjectId(idSet, raw) {
  if (raw == null) return;
  const id = raw._id != null ? raw._id : raw;
  const str = id.toString();
  if (mongoose.Types.ObjectId.isValid(str)) idSet.add(str);
}

/**
 * All Subject ObjectIds a teacher may use for prep content, homework, Vidya AI, etc.:
 * - explicit Teacher.subjects
 * - Teacher.assignments[].subjectId
 * - assignedSubjects on every Class the teacher is assigned to
 *
 * Admins often wire subjects only on the class roster (not on the teacher record).
 * Without class subjects here, My Classes / Vidya AI stay stuck on Math/English/Science.
 */
export async function getEffectiveTeacherSubjectObjectIds(teacher) {
  if (!teacher) return [];

  const idSet = new Set();

  if (Array.isArray(teacher.subjects)) {
    teacher.subjects.forEach((raw) => addSubjectId(idSet, raw));
  }

  if (Array.isArray(teacher.assignments)) {
    for (const row of teacher.assignments) {
      addSubjectId(idSet, row?.subjectId);
    }
  }

  const classIdSet = new Set();
  (teacher.assignedClassIds || []).forEach((id) => classIdSet.add(String(id)));
  (teacher.assignments || []).forEach((a) => {
    if (a?.classId) classIdSet.add(String(a.classId));
  });

  if (classIdSet.size > 0) {
    const classIdList = [...classIdSet];
    const objectIds = classIdList.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const classNumbers = classIdList.filter((id) => !mongoose.Types.ObjectId.isValid(id));

    const classOr = [];
    if (objectIds.length) classOr.push({ _id: { $in: objectIds } });
    if (classNumbers.length) classOr.push({ classNumber: { $in: classNumbers } });

    if (classOr.length > 0) {
      const classDocs = await Class.find({
        ...(teacher.adminId ? { assignedAdmin: teacher.adminId } : {}),
        isActive: true,
        $or: classOr,
      }).select('assignedSubjects');

      for (const cd of classDocs) {
        for (const sub of cd.assignedSubjects || []) {
          addSubjectId(idSet, sub);
        }
      }
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
 * Prefer getEffectiveTeacherSubjectObjectIds for tools / dashboard teaching aids.
 */
export function getExplicitTeacherSubjectObjectIds(teacher) {
  if (!teacher) return [];

  const idSet = new Set();
  (teacher.subjects || []).forEach((raw) => addSubjectId(idSet, raw));

  return Array.from(idSet).map((s) => new mongoose.Types.ObjectId(s));
}
