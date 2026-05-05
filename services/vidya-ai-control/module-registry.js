import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import ClassModel from '../../models/Class.js';
import Subject from '../../models/Subject.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import UserSession from '../../models/UserSession.js';
import LearningPath from '../../models/LearningPath.js';
import AiToolGeneration from '../../models/AiToolGeneration.js';
import AiContentEngineSource from '../../models/AiContentEngineSource.js';
import AIGeneratorRecord from '../../models/AIGeneratorRecord.js';
import VidyaCallLog from '../../models/VidyaCallLog.js';
import ChatSession from '../../models/ChatSession.js';
import Event from '../../models/Event.js';
import CalendarEvent from '../../models/CalendarEvent.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import PDFContent from '../../models/PDFContent.js';
import GeminiPerformanceReport from '../../models/GeminiPerformanceReport.js';
import StudentRemark from '../../models/StudentRemark.js';

const FALLBACK_SCOPE_FIELDS = [
  'assignedAdmin',
  'adminId',
  'schoolId',
  'createdBy',
  'uploadedBy',
  'teacherId',
];

export const MODULE_REGISTRY = {
  students: {
    model: User,
    aliases: ['student', 'students', 'learner', 'learners', 'pupils'],
    baseFilter: { role: 'student' },
    scopeFields: ['assignedAdmin'],
  },
  teachers: {
    model: Teacher,
    aliases: ['teacher', 'teachers', 'faculty', 'staff'],
    scopeFields: ['adminId'],
  },
  users: {
    model: User,
    aliases: ['user', 'users', 'user management', 'roles', 'permissions'],
    scopeFields: ['assignedAdmin'],
  },
  classes: {
    model: ClassModel,
    aliases: ['class', 'classes', 'section', 'sections', 'classroom'],
    scopeFields: ['assignedAdmin'],
  },
  subjects: {
    model: Subject,
    aliases: ['subject', 'subjects'],
  },
  attendance: {
    model: UserSession,
    aliases: ['attendance', 'attendance records', 'presence', 'session', 'sessions'],
  },
  exams: {
    model: Exam,
    aliases: ['exam', 'exams', 'test schedule', 'assessment schedule'],
    scopeFields: ['adminId', 'schoolId'],
  },
  results: {
    model: ExamResult,
    aliases: ['result', 'results', 'exam result', 'performance result'],
    scopeFields: ['adminId'],
  },
  learning_paths: {
    model: LearningPath,
    aliases: ['learning path', 'learning paths'],
  },
  ai_tool_data: {
    model: AiToolGeneration,
    aliases: ['ai tool', 'ai tools', 'ai generations', 'ai requests', 'ai tool data'],
  },
  ai_pdf_data: {
    model: AiContentEngineSource,
    aliases: ['ai pdf', 'pdf ai', 'ai pdf data', 'knowledge sources'],
  },
  ai_generator_data: {
    model: AIGeneratorRecord,
    aliases: ['ai generator', 'ai generator data', 'generator records'],
  },
  notices: {
    model: Event,
    aliases: ['notice', 'notices', 'events', 'announcements'],
    scopeFields: ['createdBy'],
  },
  timetable: {
    model: CalendarEvent,
    aliases: ['timetable', 'schedule', 'calendar'],
  },
  performance_reports: {
    model: GeminiPerformanceReport,
    aliases: ['performance report', 'performance reports', 'analysis reports'],
  },
  reports: {
    model: StudentRemark,
    aliases: ['report', 'reports', 'remarks'],
  },
  notifications: {
    model: TeacherWorkDiary,
    aliases: ['notification', 'notifications', 'work diary', 'diary'],
    scopeFields: ['adminId'],
  },
  analytics: {
    model: VidyaCallLog,
    aliases: ['analytics', 'ai analytics', 'usage analytics'],
  },
  audit_logs: {
    model: VidyaCallLog,
    aliases: ['audit', 'audit logs', 'logs', 'api logs'],
  },
  admin_dashboard: {
    model: ChatSession,
    aliases: ['dashboard', 'admin dashboard', 'chat sessions'],
  },
  school_performance_metrics: {
    model: PDFContent,
    aliases: ['school performance', 'school metrics', 'school performance metrics'],
  },
  fees: {
    model: null,
    aliases: ['fee', 'fees', 'payment', 'payments', 'billing', 'invoice', 'invoices'],
    unavailableReason:
      'No structured fee_records collection exists in this database. Billing appears external/unmodeled here.',
  },
};

export function moduleSchemaFields(model) {
  if (!model?.schema?.paths) return [];
  return Object.keys(model.schema.paths).filter(
    (k) => !k.startsWith('__') && !k.includes('.$*') && k !== 'password'
  );
}

export function resolveModuleKey(input) {
  const t = String(input || '').trim().toLowerCase();
  if (!t) return null;
  // 1) Prefer exact module key match first.
  for (const key of Object.keys(MODULE_REGISTRY)) {
    if (key === t) return key;
  }
  // 2) Fallback to alias match.
  for (const [key, cfg] of Object.entries(MODULE_REGISTRY)) {
    if ((cfg.aliases || []).some((a) => t === String(a).toLowerCase())) return key;
  }
  return null;
}

export function scopeFieldsForModule(moduleKey) {
  const cfg = MODULE_REGISTRY[moduleKey];
  if (!cfg) return [];
  return Array.from(new Set([...(cfg.scopeFields || []), ...FALLBACK_SCOPE_FIELDS]));
}
