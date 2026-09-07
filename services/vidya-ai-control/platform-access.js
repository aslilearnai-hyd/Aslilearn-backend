import mongoose from 'mongoose';
import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import ClassModel from '../../models/Class.js';
import School from '../../models/School.js';
import { getEffectiveTeacherSubjectObjectIds } from '../../utils/teacherSubjectScope.js';
import { resolveStudentClassDoc, resolveStudentSubjectIdsForLibrary } from '../../routes/student/helpers.js';

const ids = values => [...new Map((values || []).filter(mongoose.isValidObjectId).map(v => [String(v), new mongoose.Types.ObjectId(String(v))])).values()];
const inIds = values => ({ $in: values || [] });
const deny = () => ({ __scopeError: 'This module is not available within your account permissions.' });
const personModules = {
  results: 'userId', omr_results: 'userId', learning_sessions: 'userId', video_progress: 'userId',
  iq_rank_results: 'userId', homework_submissions: 'studentId', reports: 'studentId',
  risk_reports: 'studentId', user_progress: 'userId', daily_quiz_logs: 'userId',
  performance_reports: 'studentId',
};

export async function loadPlatformAccess(viewerRole, viewerUserId) {
  let role = String(viewerRole || '').toLowerCase();
  if (role === 'school-admin' || role === 'school_admin') role = 'admin';
  if (role === 'super_admin') role = 'super-admin';
  if (!['super-admin', 'admin', 'teacher', 'student'].includes(role)) throw new Error('Unsupported platform role');
  if (role === 'super-admin') return { role, userId: String(viewerUserId), scopeLabel: 'Platform-wide' };
  const [id] = ids([viewerUserId]);
  if (!id) throw new Error('Cannot resolve authenticated account');
  const person = role === 'teacher' ? await Teacher.findById(id).lean() : await User.findById(id).lean();
  if (!person || (role !== 'teacher' && person.role !== role)) throw new Error('Cannot resolve authenticated account');
  const adminIds = ids([role === 'admin' ? id : role === 'teacher' ? person.adminId : person.assignedAdmin]);
  let classes = [], studentIds = [], subjectIds = [], teacherIds = [];
  if (role === 'teacher') {
    classes = await ClassModel.find({ _id: inIds(ids([...(person.assignedClassIds || []), ...(person.assignments || []).map(a => a.classId)])), ...(adminIds.length ? { assignedAdmin: inIds(adminIds) } : {}) }).select('_id classNumber assignedSubjects').lean();
    studentIds = await User.find({ role: 'student', ...(adminIds.length ? { assignedAdmin: inIds(adminIds) } : {}), $or: [{ assignedClass: inIds(classes.map(c => c._id)) }, { assignedTeacher: id }] }).distinct('_id');
    subjectIds = await getEffectiveTeacherSubjectObjectIds(person);
    teacherIds = [id];
  } else if (role === 'admin') {
    classes = await ClassModel.find({ assignedAdmin: id }).select('_id classNumber assignedSubjects').lean();
    studentIds = await User.find({ role: 'student', assignedAdmin: id }).distinct('_id');
    teacherIds = await Teacher.find({ adminId: id }).distinct('_id');
    subjectIds = classes.flatMap(c => c.assignedSubjects || []);
  } else {
    const classDoc = await resolveStudentClassDoc(person);
    classes = classDoc ? [classDoc] : [];
    studentIds = [id];
    subjectIds = await resolveStudentSubjectIdsForLibrary(person, classDoc);
  }
  const schools = adminIds.length ? await School.find({ adminUserId: inIds(adminIds) }).select('_id').lean() : [];
  return {
    role, userId: String(id), viewerId: id, name: person.fullName || '', adminIds,
    profile: { fullName: person.fullName, schoolName: person.schoolName, classNumber: person.classNumber, section: person.section, board: person.board },
    schoolIds: schools.map(s => s._id), classIds: classes.map(c => c._id),
    classNumbers: [...new Set(classes.map(c => String(c.classNumber)))],
    studentIds: ids(studentIds), teacherIds: ids(teacherIds), subjectIds: ids(subjectIds),
    scopeLabel: role === 'teacher' ? 'Assigned classes and students' : role === 'admin' ? 'Your school' : 'Your own records and assigned learning',
  };
}

export function platformModuleScope(moduleKey, access, model) {
  const a = access;
  if (a.role === 'super-admin') return {};
  if (!a.viewerId) return deny();
  if (moduleKey in personModules) return { [personModules[moduleKey]]: inIds(a.studentIds) };
  if (moduleKey === 'students') return { _id: inIds(a.studentIds) };
  if (moduleKey === 'users') return { _id: inIds(a.role === 'admin' ? [a.viewerId, ...a.studentIds] : [a.viewerId]) };
  if (moduleKey === 'teachers') return a.role === 'student' ? deny() : { _id: inIds(a.teacherIds) };
  if (moduleKey === 'classes') return { _id: inIds(a.classIds) };
  if (moduleKey === 'subjects') return { _id: inIds(a.subjectIds) };
  if (moduleKey === 'schools') return { _id: inIds(a.schoolIds) };
  if (moduleKey === 'payment_receipts') return { accountId: a.viewerId };
  if (moduleKey === 'timetable') return { schoolId: inIds(a.schoolIds) };
  if (moduleKey === 'timetables' || moduleKey === 'notifications' || moduleKey === 'attendance') {
    if (moduleKey === 'attendance' && a.role === 'student') return deny(); // nested roster; student adapter exposes only own entry
    if (a.role === 'admin') return { [moduleKey === 'timetables' ? 'schoolAdminId' : 'adminId']: inIds(a.adminIds) };
    if (moduleKey === 'notifications' && a.role === 'teacher') return { adminId: inIds(a.adminIds), $or: [{ teacherId: a.viewerId }, { classId: inIds(a.classIds) }] };
    return { classId: inIds(a.classIds), [moduleKey === 'timetables' ? 'schoolAdminId' : 'adminId']: inIds(a.adminIds) };
  }
  if (moduleKey === 'learning_paths') return { enrolledUsers: inIds(a.studentIds) };
  if (moduleKey === 'videos') return { subjectId: inIds(a.subjectIds.map(String)), isPublished: true, isActive: { $ne: false } };
  if (moduleKey === 'assessments') return { subjectIds: inIds(a.subjectIds.map(String)), isPublished: true };
  if (moduleKey === 'teacher_tool_usage') return a.role === 'student' ? deny() : { teacherId: inIds(a.teacherIds) };
  if (['analytics', 'admin_dashboard'].includes(moduleKey)) return { userId: inIds(a.role === 'admin' ? [...a.studentIds, ...a.teacherIds, a.viewerId] : [a.viewerId]) };
  if (moduleKey === 'exams') {
    const school = { $or: [{ adminId: inIds(a.adminIds) }, { schoolId: inIds([...a.adminIds, ...a.schoolIds]) }, { targetSchools: inIds([...a.adminIds, ...a.schoolIds]) }] };
    return a.role === 'admin' ? school : { $and: [school, { classNumber: inIds(a.classNumbers) }] };
  }
  if (['library_content', 'homework_content'].includes(moduleKey)) {
    // Catalog visibility is handled by the existing curriculum retrieval adapter;
    // operational content here is restricted to the creator's school/team.
    if (a.role === 'student') return deny();
    return { $or: [{ teacherId: inIds(a.teacherIds) }, { createdBy: inIds([a.viewerId, ...a.teacherIds]) }] };
  }
  if (moduleKey === 'ai_tool_data') return { generatedBy: inIds([a.viewerId, String(a.viewerId)]) };
  if (moduleKey === 'weekly_digests') return { userId: inIds(a.role === 'student' ? [a.viewerId] : [a.viewerId, ...a.studentIds]) };
  if (a.role !== 'admin') return deny();
  // School admin modules with explicit ownership; never infer scope from an empty schema.
  const paths = model?.schema?.paths || {};
  const filters = ['adminId', 'assignedAdmin', 'schoolAdminId'].filter(k => paths[k]).map(k => ({ [k]: inIds(a.adminIds) }));
  if (paths.schoolId) filters.push({ schoolId: inIds([...a.schoolIds, ...a.adminIds]) });
  if (paths.teacherId) filters.push({ teacherId: inIds(a.teacherIds) });
  if (paths.studentId) filters.push({ studentId: inIds(a.studentIds) });
  if (paths.userId) filters.push({ userId: inIds([...a.studentIds, ...a.teacherIds, a.viewerId]) });
  if (paths.createdBy) filters.push({ createdBy: inIds([a.viewerId, ...a.teacherIds]) });
  return filters.length ? { $or: filters } : deny();
}

export function platformReadableFields(fields, role, moduleKey) {
  if (role === 'super-admin') return fields;
  // Published catalog documents can contain enrollments/attempts from other schools.
  const scopedFields = fields.filter(f => !/^(?:attempts|enrolledUsers)(?:\.|$)/.test(f));
  if (role === 'admin' || role === 'teacher') return scopedFields;
  const hidden = /^(?:questions|attempts|enrolledUsers|entries|passwordHistory|metadata|messages|conversation|history|answers|correctAnswer)(?:\.|$)/;
  return scopedFields.filter(f => !hidden.test(f));
}
