import { parseDynamicIntent } from './gemini-intent-service.js';
import { runPlatformIntelligence } from '../vidya-platform-intelligence.js';
import { resolveClassRosterQuestion } from '../vidya-class-conversation.js';
import { generateGeneralKnowledgeAnswer } from '../vidya-student/gemini-general-knowledge-service.js';
import { executeDynamicDbPlan } from './db-access-layer.js';
import { buildAuditSelect } from './dynamic-sql-builder.js';
import { formatDynamicResponse, answerAsVidyaControlKnowledge, looksLikeDeadDbReply } from './response-formatter.js';
import {
  buildControlOverviewFacts,
  buildNamedSchoolDetailFacts,
  buildPublishedCatalogFacts,
  buildSchoolActivityFacts,
  formatSchoolActivityAnswer,
  extractSchoolNameQuery,
  isNamedSchoolMetricQuery,
  isHeadcountOverviewQuery,
  isReportsOverviewQuery,
  isPublishedCatalogQuery,
  isSchoolActivityQuery,
} from './school-overview-facts.js';
import {
  buildNamedPersonDetailFacts,
  buildClassGroupFacts,
  isClassGroupQuery,
} from './entity-detail-facts.js';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import UserSession from '../../models/UserSession.js';
import School from '../../models/School.js';
import { istYmd, istStartOfDayInstant, istEndOfDayInstant } from './ist-time.js';

async function answerTodayLoginQuestion({ userMessage, history = [] }) {
  const recent = (Array.isArray(history) ? history : []).slice(-6).map(turn => String(turn?.content || '')).join('\n');
  const explicit = /\b(?:logins?|logined|logged\s+in|login users?)\b/i.test(userMessage);
  const loginFollowUp = /\b(?:who (?:are )?(?:those|they|them|users)|give (?:me )?all|list (?:them|those|users)|their names?)\b/i.test(userMessage)
    && /\b(?:logins?|logged\s+in)\b[\s\S]{0,80}\btoday\b/i.test(recent);
  if ((!explicit && !loginFollowUp) || (!/\btoday\b/i.test(userMessage) && !loginFollowUp)) return null;
  const ymd = istYmd(new Date());
  const range = { $gte: istStartOfDayInstant(ymd), $lte: istEndOfDayInstant(ymd) };
  const [users, teachers] = await Promise.all([
    User.find({ lastLogin: range }).select('fullName email role lastLogin').sort({ lastLogin: -1 }).lean(),
    Teacher.find({ lastLogin: range }).select('fullName email lastLogin').sort({ lastLogin: -1 }).lean(),
  ]);
  const people = [
    ...users.map(row => ({ id: String(row._id), name: row.fullName || row.email || 'User', role: row.role || 'user', lastLogin: row.lastLogin })),
    ...teachers.map(row => ({ id: String(row._id), name: row.fullName || row.email || 'Teacher', role: 'teacher', lastLogin: row.lastLogin })),
  ].sort((a, b) => new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0));
  const asksWho = /\bwho\b|\bthose\b|\bthem\b|\bnames?\b/i.test(userMessage);
  const message = asksWho
    ? people.length
      ? `${people.length} unique users logged in today:\n\n${people.map((person, index) => `${index + 1}. ${person.name} [${person.role}]`).join('\n')}`
      : 'No users have logged in today.'
    : `${people.length} unique user${people.length === 1 ? '' : 's'} logged in today.`;
  return { message, count: people.length, rows: people, date: ymd };
}

async function answerIndividualUsageTime({ userMessage, history = [] }) {
  const recent = (Array.isArray(history) ? history : []).slice(-8).map(turn => String(turn?.content || '')).join('\n');
  const explicit = /\b(each|individual|per[- ]?user)\b[\s\S]{0,50}\b(time|minutes?|usage)\b|\btime\b[\s\S]{0,40}\beach\b/i.test(userMessage);
  const followUp = /\b(where are those|show (?:it|them|records?)|what (?:are|is) (?:that|those) records?)\b/i.test(userMessage)
    && /\b(?:individual|each|per[- ]?user|learning_sessions|time spent)\b/i.test(recent);
  if (!explicit && !followUp) return null;
  const ymd = istYmd(new Date());
  const range = { $gte: istStartOfDayInstant(ymd), $lte: istEndOfDayInstant(ymd) };
  const [users, teachers, sessions] = await Promise.all([
    User.find({ lastLogin: range }).select('_id fullName email role').lean(),
    Teacher.find({ lastLogin: range }).select('_id fullName email').lean(),
    UserSession.aggregate([{ $match: { date: ymd } }, { $group: { _id: '$userId', minutes: { $sum: '$duration' } } }]),
  ]);
  const minutes = new Map(sessions.map(row => [String(row._id), Math.max(0, Number(row.minutes) || 0)]));
  const people = [
    ...users.map(row => ({ id: String(row._id), name: row.fullName || row.email || 'User', role: row.role || 'user' })),
    ...teachers.map(row => ({ id: String(row._id), name: row.fullName || row.email || 'Teacher', role: 'teacher' })),
  ];
  const lines = people.map((person, index) => `${index + 1}. ${person.name} [${person.role}] — ${minutes.get(person.id) || 0} minutes`);
  return { message: people.length ? `Today's tracked time for ${people.length} logged-in users:\n\n${lines.join('\n')}` : 'No users logged in today.', rows: people, date: ymd };
}

async function answerLargestSchool({ userMessage, history = [] }) {
  const recent = (Array.isArray(history) ? history : []).slice(-6).map(turn => String(turn?.content || '')).join('\n');
  const explicit = /\b(?:which|what|show)\b[\s\S]{0,40}\bschool\b[\s\S]{0,50}\b(?:maximum|most|highest|largest)\b|\b(?:maximum|most|highest|largest)\b[\s\S]{0,50}\bstudents?\b/i.test(userMessage);
  const recheck = /\b(?:wrong|recheck|check again|verify again)\b/i.test(userMessage) && /\bschool\b[\s\S]{0,80}\b(?:maximum|most|highest|largest|students?)\b/i.test(recent);
  if (!explicit && !recheck) return null;
  const top = await User.aggregate([
    { $match: { role: 'student', assignedAdmin: { $type: 'objectId' } } },
    { $group: { _id: '$assignedAdmin', students: { $sum: 1 } } },
    { $sort: { students: -1 } },
    { $limit: 1 },
  ]);
  if (!top.length) return { message: 'No school-linked students were found.', schoolName: '', studentCount: 0 };
  const adminId = top[0]._id;
  const [school, admin] = await Promise.all([
    School.findOne({ adminUserId: adminId }).select('name').lean(),
    User.findById(adminId).select('schoolName fullName email').lean(),
  ]);
  const schoolName = school?.name || admin?.schoolName || admin?.fullName || admin?.email || 'Unknown school';
  return { message: `${schoolName} has the highest student count: ${top[0].students}.`, schoolName, studentCount: top[0].students };
}

async function answerExamAttemptFollowUp({ userMessage, history, viewerRole, viewerUserId }) {
  if (!/\bhow many\b[\s\S]{0,40}\b(?:attempted|took|completed)\b|\b(?:attempted|took|completed)\b[\s\S]{0,40}\b(?:exam|test)\b/i.test(userMessage)) return null;
  const transcript = (Array.isArray(history) ? history : []).slice(-8).map(turn => String(turn?.content || '')).join('\n');
  const named = (transcript.match(/(?:last|latest) (?:exam|test)(?: taken)?(?: is|:)?\s*["“']([^"”'\n]+)["”']/i)?.[1]
    || transcript.match(/Exam names?:\s*([^\n.]+)/i)?.[1])?.trim();
  const viewerOid = mongoose.isValidObjectId(viewerUserId) ? new mongoose.Types.ObjectId(String(viewerUserId)) : null;
  const examScope = viewerRole === 'admin' && viewerOid
    ? { $or: [{ adminId: viewerOid }, { schoolId: viewerOid }, { targetSchools: viewerOid }] }
    : {};
  const titleFilter = named ? { title: new RegExp(`^${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } : {};
  const excludeMock = named ? {} : { title: { $not: /\bmock\s+test\b/i } };
  const exam = await Exam.findOne({ ...examScope, ...excludeMock, ...titleFilter }).sort({ endDate: -1, createdAt: -1 }).select('_id title').lean();
  if (!exam) return { message: 'I could not identify the exam from the previous message. Please mention its title.', count: null, examTitle: named || '' };
  let resultFilter = { examId: exam._id };
  if (viewerRole === 'admin' && viewerOid) {
    const studentIds = await User.find({ role: 'student', assignedAdmin: viewerOid }).distinct('_id');
    resultFilter = { ...resultFilter, userId: { $in: studentIds } };
  }
  const attempted = await ExamResult.distinct('userId', resultFilter);
  return { message: `${attempted.length} student${attempted.length === 1 ? '' : 's'} attempted “${exam.title}”.`, count: attempted.length, examTitle: exam.title };
}

async function answerLatestRealExam({ userMessage, viewerRole, viewerUserId }) {
  if (!/\b(?:latest|last|recent)\s+(?:exam|test)\b/i.test(userMessage)) return null;
  const viewerOid = mongoose.isValidObjectId(viewerUserId) ? new mongoose.Types.ObjectId(String(viewerUserId)) : null;
  const scope = viewerRole === 'admin' && viewerOid
    ? { $or: [{ adminId: viewerOid }, { schoolId: viewerOid }, { targetSchools: viewerOid }] }
    : {};
  const exam = await Exam.findOne({ ...scope, title: { $not: /\bmock\s+test\b/i } })
    .sort({ endDate: -1, createdAt: -1 })
    .select('_id title endDate classNumber subject')
    .lean();
  if (!exam) return { message: 'No regular exam/test was found.', exam: null };
  return { message: `The latest exam is “${exam.title}”.`, exam };
}

async function answerNamedSchoolMetric({ userMessage, viewerRole, viewerUserId }) {
  if (!isNamedSchoolMetricQuery(userMessage)) return null;
  const schoolName = extractSchoolNameQuery(userMessage);
  const facts = await buildNamedSchoolDetailFacts(schoolName, { viewerRole, viewerUserId });
  const overview = facts?.overview || {};
  const label = facts?.profile?.name || facts?.schoolLabel || schoolName;
  const q = String(userMessage || '').toLowerCase();
  if (facts?.candidates?.length > 1) {
    return {
      message: facts.error,
      facts,
    };
  }
  if (facts?.error && typeof overview.teachers !== 'number' && typeof overview.students !== 'number') {
    return { message: facts.error, facts };
  }
  if (/\bteachers?\b|\bfaculty\b|\bstaff\b/.test(q) && typeof overview.teachers === 'number') {
    return {
      message: `${label} has ${overview.teachers} active teacher${overview.teachers === 1 ? '' : 's'}.`,
      facts,
    };
  }
  if (/\bstudents?\b/.test(q) && typeof overview.students === 'number') {
    return {
      message: `${label} has ${overview.students} student${overview.students === 1 ? '' : 's'}.`,
      facts,
    };
  }
  if (/\bclasses\b/.test(q) && typeof overview.classes === 'number') {
    return {
      message: `${label} has ${overview.classes} class${overview.classes === 1 ? '' : 'es'}.`,
      facts,
    };
  }
  if (/\bexams?\b/.test(q) && typeof overview.activeExams === 'number') {
    return {
      message: `${label} has ${overview.activeExams} active exam${overview.activeExams === 1 ? '' : 's'}.`,
      facts,
    };
  }
  return null;
}

export async function runDynamicAiQuery({
  userMessage,
  history = [],
  viewerRole,
  viewerUserId,
}) {
  userMessage = resolveClassRosterQuestion(userMessage, history);

  // Deterministic school-admin paths must not wait on (or be overwritten by) the
  // Gemini multi-module planner — that is what made Vidya look "completely dead".
  const preferLegacyControl =
    isHeadcountOverviewQuery(userMessage) ||
    isReportsOverviewQuery(userMessage) ||
    isPublishedCatalogQuery(userMessage) ||
    isSchoolActivityQuery(userMessage) ||
    isClassGroupQuery(userMessage);

  if (!preferLegacyControl) {
    try {
      const platform = await runPlatformIntelligence({
        question: userMessage,
        history,
        viewerRole,
        viewerUserId,
      });
      if (platform?.message && !looksLikeDeadDbReply(platform.message)) {
        return {
          ok: true,
          plan: { mode: 'platform_intelligence' },
          facts: platform.facts,
          message: platform.message,
          auditQuery: 'Read-only scoped multi-module plan',
          notes: [],
        };
      }
    } catch (err) {
      console.warn('[vidya-control] platform intelligence skipped:', err?.message || err);
    }
  }

  if (isSchoolActivityQuery(userMessage) && ['admin', 'super-admin'].includes(String(viewerRole || ''))) {
    const listNames = /\bwho\b|\bnames?\b|\blist\b/i.test(userMessage);
    const activityFacts = await buildSchoolActivityFacts({
      viewerRole,
      viewerUserId,
      listNames,
    });
    return {
      ok: true,
      plan: { mode: 'activity', module: 'learning_sessions', operation: 'overview', timeframe: 'today' },
      facts: activityFacts,
      message: formatSchoolActivityAnswer(activityFacts, userMessage),
      auditQuery: 'COUNT distinct UserSession/lastLogin for school students+teachers today (IST)',
      notes: ['School login and study activity from live sessions.'],
    };
  }

  const namedSchoolMetric = await answerNamedSchoolMetric({ userMessage, viewerRole, viewerUserId });
  if (namedSchoolMetric) {
    return {
      ok: true,
      plan: { mode: 'school_detail', module: 'schools', operation: 'overview', schoolNameQuery: extractSchoolNameQuery(userMessage) },
      facts: { mode: 'school_detail', ...namedSchoolMetric.facts },
      message: namedSchoolMetric.message,
      auditQuery: 'SELECT school by name, then COUNT teachers/students scoped to that school admin',
      notes: ['Named-school headcount uses live school metrics, not a teachers-name filter.'],
    };
  }
  const usageTime = viewerRole === 'super-admin' ? await answerIndividualUsageTime({ userMessage, history }) : null;
  if (usageTime) return { ok: true, plan: { mode: 'database', module: 'learning_sessions', operation: 'list' }, facts: usageTime, message: usageTime.message, auditQuery: 'SELECT SUM(duration) per logged-in user for today (IST)', notes: ['Joined session totals to user and teacher names.'] };
  const largestSchool = viewerRole === 'super-admin' ? await answerLargestSchool({ userMessage, history }) : null;
  if (largestSchool) return { ok: true, plan: { mode: 'database', module: 'schools', operation: 'aggregate' }, facts: largestSchool, message: largestSchool.message, auditQuery: 'SELECT assignedAdmin, COUNT(students) GROUP BY assignedAdmin ORDER BY count DESC LIMIT 1', notes: ['Returned both school identity and exact student count.'] };
  const todayLogins = viewerRole === 'super-admin' ? await answerTodayLoginQuestion({ userMessage, history }) : null;
  if (todayLogins) {
    return { ok: true, plan: { mode: 'database', module: 'users', operation: /\bwho\b|\bthose\b|\bthem\b|\bnames?\b/i.test(userMessage) ? 'list' : 'count' }, facts: todayLogins, message: todayLogins.message, auditQuery: 'SELECT users and teachers WHERE lastLogin is today (IST)', notes: ['Count and list use the same unique-user definition.'] };
  }
  const latestExam = await answerLatestRealExam({ userMessage, viewerRole, viewerUserId });
  if (latestExam) {
    return { ok: true, plan: { mode: 'database', module: 'exams', operation: 'list' }, facts: latestExam, message: latestExam.message, auditQuery: 'SELECT latest exam WHERE title is not a mock test', notes: ['Mock tests excluded from normal latest-exam lookup.'] };
  }
  const examAttempt = await answerExamAttemptFollowUp({ userMessage, history, viewerRole, viewerUserId });
  if (examAttempt) {
    return { ok: true, plan: { mode: 'database', module: 'results', operation: 'count' }, facts: examAttempt, message: examAttempt.message, auditQuery: 'SELECT COUNT(DISTINCT userId) FROM exam_results WHERE examId=<scoped latest exam>', notes: ['Resolved exam from conversation history.'] };
  }
  const plan = await parseDynamicIntent({ userMessage, history });
  const notes = [];
  let facts = { mode: plan.mode };
  if (['admin', 'super-admin'].includes(viewerRole) && plan.mode === 'knowledge') {
    // Full intelligent assistant for non-DB questions (ops, how-to, teaching, general).
    if (/\b(teach|explain|chapter|textbook|lesson|curriculum|syllabus|subtopic)\b/i.test(userMessage)) {
      const message = await generateGeneralKnowledgeAnswer({
        viewerUserId, viewerRole, question: userMessage, conversationHistory: history,
      });
      return { ok: true, plan, facts: { mode: 'curriculum' }, message, auditQuery: '--', notes: ['Curriculum and indexed textbook lookup.'] };
    }
    const message = await answerAsVidyaControlKnowledge({
      userPrompt: userMessage,
      viewerRole,
      history,
    });
    return {
      ok: true,
      plan,
      facts: { mode: 'knowledge' },
      message,
      auditQuery: '--',
      notes: ['Intelligent knowledge / ops assistant answer.'],
    };
  }

  // Gemini flagged a required detail as missing (e.g. "students in Class" with
  // no number) — ask instead of running a query that would silently match nothing.
  if (plan.mode === 'database' && plan.clarification) {
    return {
      ok: true,
      plan,
      facts: { mode: 'clarification' },
      auditQuery: '--',
      message: plan.clarification,
      notes: ['Clarification requested before running a database query.'],
    };
  }

  if (plan.mode === 'overview') {
    const overviewFacts = await buildControlOverviewFacts({ viewerRole, viewerUserId });
    facts = { mode: 'overview', ...overviewFacts };
    notes.push('School dashboard overview: multi-metric snapshot from scoped aggregates.');
  } else if (plan.mode === 'activity') {
    const listNames = /\bwho\b|\bnames?\b|\blist\b/i.test(userMessage);
    facts = await buildSchoolActivityFacts({ viewerRole, viewerUserId, listNames });
    notes.push('School login and study activity for today (IST).');
  } else if (plan.mode === 'catalog_counts') {
    const catalogFacts = await buildPublishedCatalogFacts({ viewerRole, viewerUserId });
    facts = { mode: 'catalog_counts', ...catalogFacts };
    notes.push('Published catalog: EduOTT videos, library video items, and published assessments.');
  } else if (plan.mode === 'school_detail') {
    const detailFacts = await buildNamedSchoolDetailFacts(plan.schoolNameQuery || '', {
      viewerRole,
      viewerUserId,
    });
    facts = { mode: 'school_detail', ...detailFacts };
    notes.push('Named school lookup: School collection + scoped live metrics.');
  } else if (plan.mode === 'person_detail') {
    const personFacts = await buildNamedPersonDetailFacts({
      personNameQuery: plan.personNameQuery || '',
      roleHint: plan.personRoleHint || '',
      viewerRole,
      viewerUserId,
    });
    facts = { mode: 'person_detail', ...personFacts };
    notes.push('Named person lookup: profile + exams/progress/classes within viewer scope.');
  } else if (plan.mode === 'class_detail') {
    const classFacts = await buildClassGroupFacts({
      classNumber: plan.classNumberQuery || '',
      section: plan.sectionQuery || '',
      viewerRole,
      viewerUserId,
    });
    facts = { mode: 'class_detail', ...classFacts };
    notes.push('Class/section group metrics within viewer scope.');
  } else if (plan.mode === 'database') {
    const db = await executeDynamicDbPlan({
      plan,
      viewerRole,
      viewerUserId,
    });
    if (!db.ok) {
      // Never dead-end the admin — answer intelligently when the DB plan cannot run.
      const message = await answerAsVidyaControlKnowledge({
        userPrompt: userMessage,
        viewerRole,
        history,
      });
      return {
        ok: true,
        plan: { ...plan, mode: 'knowledge' },
        facts: { mode: 'knowledge', priorDbError: db.error || '' },
        message,
        auditQuery: '--',
        notes: ['DB plan failed; answered as intelligent assistant instead of erroring out.'],
      };
    }
    facts = db.facts || {};
    notes.push('Database Truth First: response must be grounded to DB facts only.');
  } else {
    notes.push('Handled as knowledge response (no DB query required by intent parser).');
  }

  const auditQuery = buildAuditSelect(plan, facts);
  let message =
    plan.mode === 'activity' || facts?.mode === 'activity'
      ? formatSchoolActivityAnswer(facts, userMessage)
      : await formatDynamicResponse({
          userPrompt: userMessage,
          plan,
          facts,
          notes,
          viewerRole,
          history,
        });

  if (
    looksLikeDeadDbReply(message) &&
    !isHeadcountOverviewQuery(userMessage) &&
    !isPublishedCatalogQuery(userMessage) &&
    !isSchoolActivityQuery(userMessage)
  ) {
    message = await answerAsVidyaControlKnowledge({
      userPrompt: userMessage,
      viewerRole,
      history,
    });
    notes.push('Replaced empty/dead DB reply with intelligent assistant answer.');
  }

  return { ok: true, plan, facts, auditQuery, message, notes };
}
