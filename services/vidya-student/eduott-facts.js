import User from '../../models/User.js';
import { resolveStudentClassDoc } from '../../routes/student/helpers.js';
import { loadStudentLibraryContents } from '../../utils/studentLibraryContents.js';
import { dedupeLibraryContents } from '../../utils/dedupeLibraryContents.js';
import { contentRowMatchesSubjectGroup } from '../../utils/resolveSubjectContentIds.js';

export function summarizeEduOtt(bundle, question) {
  const program = bundle.programCtx || {};
  if (!program.isAsliPrepExclusive || !program.iitCategories?.length) {
    return { verified: true, enabled: false, total: 0, classNumber: bundle.studentClassNum };
  }
  const track = String(question).match(/\b(alpha|beta|gamma|delta)\b/i)?.[1]?.toUpperCase();
  const subject = String(question).match(/\b(maths?|mathematics|physics|chemistry|biology|science|english)\b/i)?.[1];
  let rows = bundle.contents || [];
  if (track) rows = rows.filter(r => String(r.productCategory || r.subject?.productCategory || '').toUpperCase() === track);
  if (subject) rows = rows.filter(r => contentRowMatchesSubjectGroup(r, /^math/i.test(subject) ? 'Mathematics' : subject));
  rows = dedupeLibraryContents(rows);
  return { verified: true, enabled: true, total: rows.length, classNumber: bundle.studentClassNum, track, subject };
}

export async function loadStudentEduOttFacts(studentId, question) {
  const student = await User.findById(studentId).populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories iitCategoriesByClass').lean();
  if (!student || student.role !== 'student') throw new Error('Student not available');
  const classDoc = await resolveStudentClassDoc(student);
  const bundle = await loadStudentLibraryContents(studentId, student, classDoc, student.assignedAdmin?.board || student.board,
    { surface: 'eduott', type: 'Video', allMatching: true });
  if (!bundle.studentClassNum) throw new Error('Student class not assigned');
  return summarizeEduOtt(bundle, question);
}
