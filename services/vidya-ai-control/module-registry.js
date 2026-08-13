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
import School from '../../models/School.js';
import SchoolOrder from '../../models/SchoolOrder.js';
import OmrResultBatch from '../../models/OmrResultBatch.js';
import OmrResultRow from '../../models/OmrResultRow.js';
import Assessment from '../../models/Assessment.js';
import HomeworkSubmission from '../../models/HomeworkSubmission.js';
import Video from '../../models/Video.js';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import Content from '../../models/Content.js';
import AuditLog from '../../models/AuditLog.js';
import TeacherToolUsage from '../../models/TeacherToolUsage.js';
import WeeklyImpactSnapshot from '../../models/WeeklyImpactSnapshot.js';
import AttendanceRecord from '../../models/AttendanceRecord.js';
import Timetable from '../../models/Timetable.js';
import Stream from '../../models/Stream.js';
import IQRankQuiz from '../../models/IQRankQuiz.js';
import IQRankQuizResult from '../../models/IQRankQuizResult.js';
import DemoLead from '../../models/DemoLead.js';
import StudentVideoChapterProgress from '../../models/StudentVideoChapterProgress.js';
import Question from '../../models/Question.js';

const FALLBACK_SCOPE_FIELDS = [
  'assignedAdmin',
  'adminId',
  'schoolId',
  'createdBy',
  'uploadedBy',
  'teacherId',
];

export const MODULE_REGISTRY = {
  schools: {
    model: School,
    aliases: [
      'school',
      'schools',
      'school profile',
      'school details',
      'institution',
      'institutions',
    ],
    scopeFields: ['adminUserId'],
  },
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
  trial_members: {
    model: User,
    aliases: [
      'trial',
      'trials',
      'trial member',
      'trial members',
      'individual account',
      'individual accounts',
      'b2c',
    ],
    baseFilter: { isIndividualAccount: true },
    scopeFields: [],
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
    model: AttendanceRecord,
    aliases: [
      'attendance',
      'attendance records',
      'presence',
      'class attendance',
      'marked attendance',
    ],
    scopeFields: ['adminId', 'teacherId'],
  },
  learning_sessions: {
    model: UserSession,
    aliases: [
      'learning session',
      'learning sessions',
      'user session',
      'user sessions',
      'session time',
      'study sessions',
    ],
    scopeFields: ['userId'],
  },
  exams: {
    model: Exam,
    aliases: ['exam', 'exams', 'test schedule', 'assessment schedule'],
    // Super-admin exams reach a school through targetSchools rather than
    // adminId/schoolId. Without it a school admin asking about exams matched
    // nothing and was told no records existed.
    scopeFields: ['adminId', 'schoolId', 'targetSchools'],
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
    aliases: [
      'analytics',
      'ai analytics',
      'usage analytics',
      'usage analytics entries',
      'vidya usage',
      'vidya calls',
      'vidya call logs',
      'ai usage',
      'ai conversation',
      'ai conversations',
    ],
  },
  teacher_tool_usage: {
    model: TeacherToolUsage,
    aliases: [
      'teacher tool usage',
      'tool usage',
      'ai tool usage',
      'teacher usage',
      'tool usage logs',
    ],
    scopeFields: ['teacherId'],
  },
  impact_snapshots: {
    model: WeeklyImpactSnapshot,
    aliases: [
      'impact',
      'impact snapshot',
      'impact snapshots',
      'weekly impact',
      'school impact',
      'usage reports',
      'school usage',
    ],
    scopeFields: ['adminId'],
  },
  audit_logs: {
    model: AuditLog,
    aliases: [
      'audit',
      'audit log',
      'audit logs',
      'audit log entries',
      'audit entries',
      'api logs',
      'action logs',
      'compliance logs',
    ],
  },
  admin_dashboard: {
    model: ChatSession,
    aliases: ['dashboard', 'admin dashboard', 'chat sessions', 'vidya chat sessions'],
  },
  school_performance_metrics: {
    model: PDFContent,
    aliases: ['school performance', 'school metrics', 'school performance metrics', 'pdf content'],
  },
  timetables: {
    model: Timetable,
    aliases: ['timetables', 'class timetable', 'period timetable'],
    scopeFields: ['schoolAdminId'],
  },
  live_streams: {
    model: Stream,
    aliases: ['live stream', 'live streams', 'edu ott live', 'livestream'],
    scopeFields: ['streamer'],
  },
  iq_rank_quizzes: {
    model: IQRankQuiz,
    aliases: ['iq rank', 'iq quiz', 'iq quizzes', 'rank boost quiz', 'rank boost'],
  },
  iq_rank_results: {
    model: IQRankQuizResult,
    aliases: ['iq result', 'iq results', 'rank boost result', 'rank boost results'],
    scopeFields: ['userId'],
  },
  demo_leads: {
    model: DemoLead,
    aliases: ['demo', 'demo lead', 'demo leads', 'trial lead', 'leads'],
  },
  video_progress: {
    model: StudentVideoChapterProgress,
    aliases: ['video progress', 'chapter progress', 'watch progress'],
    scopeFields: ['userId'],
  },
  questions: {
    model: Question,
    aliases: ['question', 'questions', 'question bank'],
  },
  school_orders: {
    model: SchoolOrder,
    aliases: [
      'school order',
      'school orders',
      'product order',
      'product orders',
      'subscription order',
      'orders',
    ],
    scopeFields: ['schoolAdminId', 'schoolId'],
  },
  omr_batches: {
    model: OmrResultBatch,
    aliases: ['omr', 'omr batch', 'omr batches', 'omr upload', 'optical mark'],
    scopeFields: ['adminId'],
  },
  omr_results: {
    model: OmrResultRow,
    aliases: ['omr result', 'omr results', 'omr scores', 'omr sheet', 'offline result', 'offline results', 'offline scores'],
    scopeFields: ['adminId'],
  },
  assessments: {
    model: Assessment,
    aliases: ['assessment', 'assessments', 'quiz', 'quizzes'],
    scopeFields: ['createdBy', 'adminId'],
  },
  homework_submissions: {
    model: HomeworkSubmission,
    aliases: ['homework', 'homework submissions', 'assignments submitted'],
    scopeFields: ['studentId'],
  },
  homework_content: {
    model: Content,
    aliases: ['homework assigned', 'homework content', 'assigned homework'],
    baseFilter: { type: 'Homework' },
    scopeFields: ['createdBy', 'teacherId'],
  },
  videos: {
    model: Video,
    aliases: ['video', 'videos', 'video lectures', 'eduott videos'],
    scopeFields: ['adminId', 'createdBy'],
  },
  risk_reports: {
    model: RiskAnalysisReport,
    aliases: ['risk', 'risk report', 'risk reports', 'student risk', 'at risk'],
    scopeFields: ['adminId', 'studentId'],
  },
  library_content: {
    model: Content,
    aliases: ['content', 'library', 'digital library', 'asli prep content'],
    scopeFields: ['createdBy', 'teacherId'],
  },
  fees: {
    model: null,
    aliases: ['fee', 'fees', 'payment', 'payments', 'billing', 'invoice', 'invoices'],
    unavailableReason:
      'No per-student fee_records collection exists. For school product / subscription orders ask about school orders instead.',
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
  if (MODULE_REGISTRY[t]) return t;
  // 2) Exact alias match.
  for (const [key, cfg] of Object.entries(MODULE_REGISTRY)) {
    if ((cfg.aliases || []).some((a) => t === String(a).toLowerCase())) return key;
  }
  // 3) Longest alias contained in the input (or vice versa) — skip very short
  // aliases so "ai" / "omr" do not steal unrelated phrases.
  let bestKey = null;
  let bestLen = 0;
  for (const [key, cfg] of Object.entries(MODULE_REGISTRY)) {
    for (const alias of cfg.aliases || []) {
      const a = String(alias).toLowerCase();
      if (a.length < 4) continue;
      if ((t.includes(a) || a.includes(t)) && a.length > bestLen) {
        bestKey = key;
        bestLen = a.length;
      }
    }
  }
  return bestKey;
}

export function scopeFieldsForModule(moduleKey) {
  const cfg = MODULE_REGISTRY[moduleKey];
  if (!cfg) return [];
  return Array.from(new Set([...(cfg.scopeFields || []), ...FALLBACK_SCOPE_FIELDS]));
}
