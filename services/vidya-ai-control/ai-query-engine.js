import { parseDynamicIntent } from './gemini-intent-service.js';
import { generateGeneralKnowledgeAnswer } from '../vidya-student/gemini-general-knowledge-service.js';
import { executeDynamicDbPlan } from './db-access-layer.js';
import { buildAuditSelect } from './dynamic-sql-builder.js';
import { formatDynamicResponse } from './response-formatter.js';
import {
  buildControlOverviewFacts,
  buildNamedSchoolDetailFacts,
  buildPublishedCatalogFacts,
} from './school-overview-facts.js';
import {
  buildNamedPersonDetailFacts,
  buildClassGroupFacts,
} from './entity-detail-facts.js';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import { istYmd, istStartOfDayInstant, istEndOfDayInstant } from './ist-time.js';

async function answerTodayLoginQuestion({ userMessage }) {
  if (!/\b(?:logins?|logged\s+in|login users?)\b/i.test(userMessage) || !/\b(?:today|those|them|who)\b/i.test(userMessage)) return null;
  const ymd = istYmd(new Date());
  const range = { $gte: istStartOfDayInstant(ymd), $lte: istEndOfDayInstant(ymd) };
  const [users, teachers] = await Promise.all([
    User.find({ lastLogin: range }).select('fullName email role lastLogin').sort({ lastLogin: -1 }).lean(),
    Teacher.find({ lastLogin: range }).select('fullName email lastLogin').sort({ lastLogin: -1 }).lean(),
  ]);
  const people = [
    ...users.map(row => ({ name: row.fullName || row.email || 'User', role: row.role || 'user', lastLogin: row.lastLogin })),
    ...teachers.map(row => ({ name: row.fullName || row.email || 'Teacher', role: 'teacher', lastLogin: row.lastLogin })),
  ].sort((a, b) => new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0));
  const asksWho = /\bwho\b|\bthose\b|\bthem\b|\bnames?\b/i.test(userMessage);
  const message = asksWho
    ? people.length
      ? `${people.length} unique users logged in today:\n\n${people.map((person, index) => `${index + 1}. ${person.name} [${person.role}]`).join('\n')}`
      : 'No users have logged in today.'
    : `${people.length} unique user${people.length === 1 ? '' : 's'} logged in today.`;
  return { message, count: people.length, rows: people, date: ymd };
}

async function answerExamAttemptFollowUp({ userMessage, history, viewerRole, viewerUserId }) {
  if (!/\bhow many\b[\s\S]{0,40}\b(?:attempted|took|completed)\b|\b(?:attempted|took|completed)\b[\s\S]{0,40}\b(?:exam|test)\b/i.test(userMessage)) return null;
  const transcript = (Array.isArray(history) ? history : []).slice(-8).map(turn => String(turn?.content || '')).join('\n');
  const named = transcript.match(/(?:last|latest) (?:exam|test)(?: taken)?(?: is|:)?\s*["“']([^"”'\n]+)["”']/i)?.[1]?.trim();
  const viewerOid = mongoose.isValidObjectId(viewerUserId) ? new mongoose.Types.ObjectId(String(viewerUserId)) : null;
  const examScope = viewerRole === 'admin' && viewerOid
    ? { $or: [{ adminId: viewerOid }, { schoolId: viewerOid }, { targetSchools: viewerOid }] }
    : {};
  const titleFilter = named ? { title: new RegExp(`^${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } : {};
  const exam = await Exam.findOne({ ...examScope, ...titleFilter }).sort({ endDate: -1, createdAt: -1 }).select('_id title').lean();
  if (!exam) return { message: 'I could not identify the exam from the previous message. Please mention its title.', count: null, examTitle: named || '' };
  let resultFilter = { examId: exam._id };
  if (viewerRole === 'admin' && viewerOid) {
    const studentIds = await User.find({ role: 'student', assignedAdmin: viewerOid }).distinct('_id');
    resultFilter = { ...resultFilter, userId: { $in: studentIds } };
  }
  const attempted = await ExamResult.distinct('userId', resultFilter);
  return { message: `${attempted.length} student${attempted.length === 1 ? '' : 's'} attempted “${exam.title}”.`, count: attempted.length, examTitle: exam.title };
}

export async function runDynamicAiQuery({
  userMessage,
  history = [],
  viewerRole,
  viewerUserId,
}) {
  const todayLogins = await answerTodayLoginQuestion({ userMessage });
  if (todayLogins) {
    return { ok: true, plan: { mode: 'database', module: 'users', operation: /\bwho\b|\bthose\b|\bthem\b|\bnames?\b/i.test(userMessage) ? 'list' : 'count' }, facts: todayLogins, message: todayLogins.message, auditQuery: 'SELECT users and teachers WHERE lastLogin is today (IST)', notes: ['Count and list use the same unique-user definition.'] };
  }
  const examAttempt = await answerExamAttemptFollowUp({ userMessage, history, viewerRole, viewerUserId });
  if (examAttempt) {
    return { ok: true, plan: { mode: 'database', module: 'results', operation: 'count' }, facts: examAttempt, message: examAttempt.message, auditQuery: 'SELECT COUNT(DISTINCT userId) FROM exam_results WHERE examId=<scoped latest exam>', notes: ['Resolved exam from conversation history.'] };
  }
  const plan = await parseDynamicIntent({ userMessage, history });
  const notes = [];
  let facts = { mode: plan.mode };
  if (['admin', 'super-admin'].includes(viewerRole) && plan.mode === 'knowledge' &&
      /\b(teach|explain|chapter|textbook|lesson|curriculum|syllabus|subtopic)\b/i.test(userMessage)) {
    const message = await generateGeneralKnowledgeAnswer({
      viewerUserId, viewerRole, question: userMessage, conversationHistory: history,
    });
    return { ok: true, plan, facts: { mode: 'curriculum' }, message, auditQuery: '--', notes: ['Curriculum and indexed textbook lookup.'] };
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
      return {
        ok: false,
        error: db.error || 'Database query planning failed.',
        plan,
        facts: {},
        auditQuery: '--',
      };
    }
    facts = db.facts || {};
    notes.push('Database Truth First: response must be grounded to DB facts only.');
  } else {
    notes.push('Handled as knowledge response (no DB query required by intent parser).');
  }

  const auditQuery = buildAuditSelect(plan, facts);
  const message = await formatDynamicResponse({
    userPrompt: userMessage,
    plan,
    facts,
    notes,
    viewerRole,
    history,
  });

  return { ok: true, plan, facts, auditQuery, message, notes };
}
