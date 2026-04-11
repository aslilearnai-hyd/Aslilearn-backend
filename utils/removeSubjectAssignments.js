import mongoose from 'mongoose';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';
import User from '../models/User.js';

/**
 * Remove a subject id from every Teacher.subjects, Class.assignedSubjects,
 * and student User.assignedSubjects. Subject model has no `teacher` field,
 * so deletes must not rely on subject.teacher.
 */
export async function removeSubjectIdFromAllAssignments(subjectId) {
  if (!subjectId || !mongoose.Types.ObjectId.isValid(String(subjectId))) {
    return;
  }
  const sid = new mongoose.Types.ObjectId(String(subjectId));

  await Promise.all([
    Teacher.updateMany({}, { $pull: { subjects: sid } }),
    Class.updateMany({}, { $pull: { assignedSubjects: sid } }),
    User.updateMany({ role: 'student' }, { $pull: { assignedSubjects: sid } }),
  ]);
}
