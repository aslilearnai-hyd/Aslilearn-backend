import User from '../../models/User.js';
import Timetable from '../../models/Timetable.js';
import AttendanceRecord from '../../models/AttendanceRecord.js';
import ExamResult from '../../models/ExamResult.js';
import OmrResultRow from '../../models/OmrResultRow.js';
import { loadStudentLibraryContents } from '../../utils/studentLibraryContents.js';
import { dedupeLibraryContents } from '../../utils/dedupeLibraryContents.js';

// Read-only adapters. Identity is supplied by the authorized controller, never
// selected by text from the user or by the language model.
export function dashboardDataTopic(question) {
  const q = String(question || '');
  if (/\btimetable\b|\bclass schedule\b|\bperiods? today\b/i.test(q)) return 'timetable';
  if (/\battendance\b|\babsent\b|\bdays present\b/i.test(q) && !/login|study|streak/i.test(q)) return 'attendance';
  if (/\bmy profile\b|\bmy school\b|\bmy account details\b/i.test(q)) return 'profile';
  if (/how many|total|count/i.test(q) && /attempt|result|omr|offline/i.test(q) && /exam|result|omr|offline/i.test(q)) return 'result_counts';
  if (/\b(library|materials|pdfs|textbooks)\b/i.test(q) && /\b(list|available|how many|count|show all)\b/i.test(q) && !/chapter|lesson/i.test(q)) return 'materials';
  return null;
}

export function timetableScope(student) {
  const classId = student.assignedClass?._id;
  const adminId = student.assignedAdmin?._id || student.assignedAdmin;
  if (!classId || !adminId) return null;
  const filter = { classId, schoolAdminId: adminId };
  const section = student.assignedClass.section;
  if (section) filter.$or = [{ sectionId: String(section).toUpperCase() }, { sectionId: { $in: [null, ''] } }];
  return filter;
}

export async function answerStudentDashboardData({ studentId, question, profile, models = { User, Timetable, AttendanceRecord, ExamResult, OmrResultRow }, library = loadStudentLibraryContents }) {
  const topic = dashboardDataTopic(question);
  if (!topic) return null;
  if (topic === 'profile') return `**Your profile**\n• Name: ${profile.fullName}\n• School: ${profile.schoolName || 'Not recorded'}\n• Class: ${profile.classNumber || 'Not assigned'}${profile.section ? ` ${profile.section}` : ''}\n• Board: ${profile.board || 'Not recorded'}`;
  if (topic === 'result_counts') {
    const [exams, omr] = await Promise.all([
      models.ExamResult.countDocuments({ userId: studentId }),
      models.OmrResultRow.countDocuments({ userId: studentId }),
    ]);
    return `**Your saved result records**\n• In-app exam attempts: **${exams}**\n• Offline/OMR results: **${omr}**\n• Total: **${exams + omr}**\nThese are result records, not a count of unique exam titles.`;
  }
  if (topic === 'attendance') {
    const rows = await models.AttendanceRecord.find({ 'entries.studentId': studentId })
      .select({ date: 1, entries: { $elemMatch: { studentId } } }).sort({ date: -1 }).lean();
    const counts = { present: 0, absent: 0, late: 0 };
    for (const row of rows) {
      const status = row.entries?.find(e => String(e.studentId) === String(studentId))?.status;
      if (status in counts) counts[status]++;
    }
    return `**Your teacher-marked attendance**\n• Present: **${counts.present}**\n• Absent: **${counts.absent}**\n• Late: **${counts.late}**\nThese are attendance entries across classes, not unique days or login streaks.`;
  }
  const student = await models.User.findById(studentId).populate('assignedClass', 'classNumber section assignedSubjects').populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories iitCategoriesByClass').lean();
  if (!student || student.role !== 'student') throw new Error('Student unavailable');
  const scope = timetableScope(student);
  if (topic === 'timetable') {
    if (!scope) return 'Your school/class assignment is missing, so I cannot safely select your timetable yet.';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const start = new Date(`${today}T00:00:00.000Z`);
    const days = /today/i.test(question) ? 1 : 7;
    const end = new Date(start.getTime() + days * 86400000);
    const rows = await models.Timetable.find({ ...scope, date: { $gte: start, $lt: end }, status: { $ne: 'Cancelled' } })
      .select('date startTime endTime subjectId room building status').populate('subjectId', 'name').sort({ date: 1, startTime: 1 }).lean();
    return rows.length ? `**Your timetable — ${days === 1 ? 'today' : 'next 7 days'} (${rows.length} sessions)**\n` + rows.map(r => `• ${new Date(r.date).toISOString().slice(0, 10)} ${r.startTime}–${r.endTime}: ${r.subjectId?.name || 'Class'}${r.room ? ` · Room ${r.room}` : ''}`).join('\n') : `No scheduled classes found for ${days === 1 ? 'today' : 'the next 7 days'}.`;
  }
  if (!student.assignedClass?.classNumber && !student.classNumber) return 'No class is assigned, so I cannot select your learning materials yet.';
  const bundle = await library(studentId, student, student.assignedClass, student.assignedAdmin?.board || student.board, { surface: 'learning-path', allMatching: true });
  const rows = dedupeLibraryContents(bundle.contents || []);
  const counts = {};
  for (const row of rows) counts[row.type || 'Other'] = (counts[row.type || 'Other'] || 0) + 1;
  return `**Available Learning Paths content: ${rows.length} items**\n` + Object.entries(counts).map(([type, count]) => `• ${type}: ${count}`).join('\n') + (/list|show/i.test(question) ? '\n\n' + rows.slice(0, 30).map(r => `• ${r.title} (${r.type})`).join('\n') + (rows.length > 30 ? '\nShowing the first 30 titles; the total includes all matching items.' : '') : '');
}
