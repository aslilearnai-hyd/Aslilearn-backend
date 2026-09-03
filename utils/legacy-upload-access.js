import Content from '../models/Content.js';
import HomeworkSubmission from '../models/HomeworkSubmission.js';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import { resolveStudentClassDoc } from '../routes/student/helpers.js';
import { loadStudentLibraryContents } from './studentLibraryContents.js';
import { getEffectiveTeacherSubjectObjectIds } from './teacherSubjectScope.js';

// Old uploads have no UploadAsset row. Resolve them through a real resource,
// never through a directory name or a filename supplied by the caller.
export async function canAccessLegacyUpload(path, identity) {
  const id = identity?.userId || identity?.id;
  if (!id) return false;
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const url = new RegExp(`^(?:https?://[^/]+)?${escaped}(?:\\?.*)?$`);
  const submission = await HomeworkSubmission.findOne({ submissionLink: url }).lean();
  if (submission) {
    if (identity.role === 'student') return String(submission.studentId) === String(id);
    const hw = await Content.findById(submission.homeworkId).lean();
    if (identity.role === 'teacher') return !!hw && String(hw.teacherId) === String(id);
    if (identity.role === 'admin') {
      const student = await User.findById(submission.studentId).lean();
      return !!student?.assignedAdmin && String(student.assignedAdmin) === String(id);
    }
    return false;
  }
  const content = await Content.findOne({ isActive: true, $or: [{ fileUrl: url }, { fileUrls: url }, { thumbnailUrl: url }] }).populate('subject').lean();
  if (!content) return false;
  if (identity.role === 'teacher' && content.teacherId && String(content.teacherId) === String(id)) return true;
  const teacher = content.teacherId ? await Teacher.findById(content.teacherId).lean() : null;
  if (identity.role === 'admin') return !!teacher?.adminId && String(teacher.adminId) === String(id);
  if (identity.role === 'teacher') {
    if (content.createdBy !== 'super-admin' || content.teacherId) return false;
    const viewer = await Teacher.findById(id).lean();
    const subjects = await getEffectiveTeacherSubjectObjectIds(viewer);
    return subjects.some(s => String(s) === String(content.subject?._id || content.subject));
  }
  if (identity.role !== 'student') return false;
  const student = await User.findById(id).populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories iitCategoriesByClass').lean();
  if (!student || student.role !== 'student') return false;
  if (content.createdBy === 'teacher' || content.teacherId) {
    const adminId = student.assignedAdmin?._id || student.assignedAdmin;
    if (!teacher?.adminId || !adminId || String(teacher.adminId) !== String(adminId)) return false;
  } else if (content.createdBy !== 'super-admin') return false;
  const classDoc = await resolveStudentClassDoc(student);
  // Authorize the resource through the same IIT merge, sibling-subject, active
  // catalog, program/track and class filters used by Learning Paths. Query only
  // this resource so the library's list limit cannot deny an older upload.
  const library = await loadStudentLibraryContents(id, student, classDoc,
    student.assignedAdmin?.board || student.board, { contentId: content._id });
  if (!library.studentClassNum) return false;
  return library.contents.some(row => String(row._id) === String(content._id));
}
