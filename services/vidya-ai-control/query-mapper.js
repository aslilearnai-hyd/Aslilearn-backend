import mongoose from 'mongoose';
import User from '../../models/User.js';
import Teacher from '../../models/Teacher.js';
import Class from '../../models/Class.js';
import Subject from '../../models/Subject.js';
import Exam from '../../models/Exam.js';
import ExamResult from '../../models/ExamResult.js';
import UserSession from '../../models/UserSession.js';
import AiToolGeneration from '../../models/AiToolGeneration.js';
import VidyaCallLog from '../../models/VidyaCallLog.js';
import LearningPath from '../../models/LearningPath.js';
import { istYmd, istWeekDateKeys, istStartOfDayInstant, istEndOfDayInstant } from './ist-time.js';

/** @typedef {{ operation: string, filters: { classNumber: string, section: string, activeOnly: boolean, board: string }, timeframe: string }} ControlIntent */

function oid(id) {
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

export function normalizeClassDigits(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (/iit/i.test(s)) {
    const dig = s.match(/\d+/);
    return dig ? `IIT-${dig[0]}` : 'IIT';
  }
  const m = s.match(/\d+/);
  return m ? m[0] : '';
}

async function distinctClassNumbersForAdmin(adminOid) {
  const rows = await Class.find({ assignedAdmin: adminOid }).select('classNumber').lean();
  const set = new Set();
  for (const r of rows || []) {
    const n = normalizeClassDigits(r.classNumber || '');
    if (n) set.add(n);
  }
  return Array.from(set);
}

function studentScopeFilter(viewerRole, viewerOid) {
  const base = { role: 'student' };
  if (viewerRole === 'admin') {
    const a = oid(viewerOid);
    if (!a) return null;
    return { ...base, assignedAdmin: a };
  }
  return base;
}

function teacherScopeFilter(viewerRole, viewerOid) {
  if (viewerRole === 'admin') {
    const a = oid(viewerOid);
    if (!a) return null;
    return { adminId: a };
  }
  return {};
}

function classScopeFilter(viewerRole, viewerOid) {
  if (viewerRole === 'admin') {
    const a = oid(viewerOid);
    if (!a) return null;
    return { assignedAdmin: a };
  }
  return {};
}

function examScopeFilter(viewerRole, viewerOid) {
  const a = oid(viewerOid);
  if (viewerRole === 'admin') {
    if (!a) return null;
    return {
      $or: [{ adminId: a }, { schoolId: a }, { targetSchools: a }],
    };
  }
  return {};
}

function aiGenClassVariants(classNums) {
  const variants = new Set();
  for (const n of classNums) {
    if (!n) continue;
    variants.add(String(n));
    variants.add(`Class ${n}`);
    variants.add(`${n}`);
  }
  return Array.from(variants);
}

/**
 * @param {{ intent: ControlIntent, viewerRole: string, viewerUserId: string }} ctx
 */
export async function executeControlQuery({ intent, viewerRole, viewerUserId }) {
  const role = String(viewerRole || '').toLowerCase();
  const viewerOid = oid(viewerUserId);
  // Super-admin tokens in this project may use symbolic ids (e.g. "super-admin-001").
  // Only admin-scoped queries strictly require a DB ObjectId for tenant scoping.
  if (role === 'admin' && !viewerOid) {
    return { ok: false, error: 'Invalid viewer user id', auditQuery: '--', facts: {} };
  }

  const { operation, filters, timeframe } = intent;
  const cn = normalizeClassDigits(filters.classNumber);
  const section = filters.section && /^[ABC]$/i.test(filters.section) ? filters.section.toUpperCase() : '';

  /** @type {{ auditQuery?: string, facts?: Record<string, unknown>, dataSourceNotes?: string[] }} */
  const out = { ok: true, auditQuery: '', facts: {}, dataSourceNotes: [] };

  const pushNote = (s) => {
    const text = String(s || '').trim();
    if (!text) return;
    out.dataSourceNotes = out.dataSourceNotes || [];
    out.dataSourceNotes.push(text);
  };

  switch (operation) {
    case 'student_count_total': {
      const q = studentScopeFilter(role, viewerOid);
      if (!q) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const active = filters.activeOnly ? { ...q, isActive: true } : q;
      const count = await User.countDocuments(active);
      out.auditQuery = `SELECT COUNT(*) FROM users WHERE role='student'${role === 'admin' ? ` AND assignedAdmin='${viewerOid}'` : ''}${filters.activeOnly ? ` AND isActive=true` : ''}`;
      out.facts = { studentCount: count, scopedTo: role === 'admin' ? 'school' : 'platform', activeOnly: filters.activeOnly };
      return { ...out, ok: true };
    }

    case 'student_count_by_class_number': {
      const qf = studentScopeFilter(role, viewerOid);
      if (!qf) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      if (!cn) {
        return {
          ok: true,
          auditQuery: '--',
          facts: { clarificationNeeded: true, message: 'Which class number should be counted?' },
          dataSourceNotes: ['Missing filters.classNumber after normalization'],
        };
      }
      const q = { ...qf, classNumber: cn };
      if (filters.activeOnly) q.isActive = true;
      const count = await User.countDocuments(q);
      out.auditQuery = `SELECT COUNT(*) FROM users WHERE role='student' AND classNumber='${cn}'${role === 'admin' ? ` AND assignedAdmin='${viewerOid}'` : ''}`;
      out.facts = { studentCount: count, classNumber: cn };
      return { ...out, ok: true };
    }

    case 'student_count_by_class_section': {
      const sq = studentScopeFilter(role, viewerOid);
      if (!sq) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      if (!cn || !section) {
        return {
          ok: true,
          auditQuery: '--',
          facts: { clarificationNeeded: true, message: 'Specify both class and section (e.g. Class 8 Section B).' },
          dataSourceNotes: [],
        };
      }
      const cf = { ...classScopeFilter(role, viewerOid), classNumber: cn, section };
      const classes = await Class.find(cf).select('_id').lean();
      const ids = (classes || []).map((c) => c._id);
      const q = { ...sq, assignedClass: { $in: ids } };
      if (filters.activeOnly) q.isActive = true;
      const count = ids.length ? await User.countDocuments(q) : 0;
      out.auditQuery = `SELECT COUNT(*) FROM users JOIN classes ON assignedClass=classes._id WHERE users.role='student' AND classes.classNumber='${cn}' AND classes.section='${section}'`;
      out.facts = { studentCount: count, classNumber: cn, section, matchedClassRooms: ids.length };
      return { ...out, ok: true };
    }

    case 'teacher_count_active': {
      const q = { ...teacherScopeFilter(role, viewerOid), isActive: true };
      if (!q.adminId && role === 'admin') return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const count = await Teacher.countDocuments(q);
      out.auditQuery = `SELECT COUNT(*) FROM teachers WHERE isActive=true${role === 'admin' ? ` AND adminId='${viewerOid}'` : ''}`;
      out.facts = { teacherCountActive: count };
      return { ...out, ok: true };
    }

    case 'teacher_count_total': {
      const q = teacherScopeFilter(role, viewerOid);
      if (!q) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const count = await Teacher.countDocuments(q);
      out.auditQuery = `SELECT COUNT(*) FROM teachers${role === 'admin' ? ` WHERE adminId='${viewerOid}'` : ''}`;
      out.facts = { teacherCount: count };
      return { ...out, ok: true };
    }

    case 'class_count': {
      const q = classScopeFilter(role, viewerOid);
      if (!q) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const activeQ = filters.activeOnly ? { ...q, isActive: true } : q;
      const count = await Class.countDocuments(activeQ);
      out.auditQuery = `SELECT COUNT(*) FROM classes${role === 'admin' ? ` WHERE assignedAdmin='${viewerOid}'` : ''}`;
      out.facts = { classCount: count };
      return { ...out, ok: true };
    }

    case 'subject_count_active': {
      const q = { isActive: true };
      const count = await Subject.countDocuments(q);
      pushNote(role === 'admin' ? 'Subject catalog is mostly global (super-admin); count is workspace-wide catalogue.' : '');
      out.auditQuery = `SELECT COUNT(*) FROM subjects WHERE isActive=true`;
      out.facts = { activeSubjectCatalogCount: count };
      return { ...out, ok: true };
    }

    case 'exam_count_this_week': {
      const xf = examScopeFilter(role, viewerOid);
      if (xf === null && role === 'admin') return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const weekKeys = istWeekDateKeys(new Date());
      const start = istStartOfDayInstant(weekKeys[0]);
      const end = istEndOfDayInstant(weekKeys[6]);
      const q =
        role === 'admin'
          ? { ...xf, isActive: filters.activeOnly !== false, startDate: { $lte: end }, endDate: { $gte: start } }
          : {
              isActive: filters.activeOnly !== false,
              startDate: { $lte: end },
              endDate: { $gte: start },
            };
      const count = await Exam.countDocuments(q);
      out.auditQuery = `SELECT COUNT(*) FROM exams WHERE isActive=true AND dateRangeOverlaps(scheduled,startDate,endDate, current_ist_week)`;
      out.facts = {
        examsScheduledOverlappingWeek: count,
        weekStartIst: weekKeys[0],
        weekEndIst: weekKeys[6],
      };
      pushNote('Counted exams whose [startDate,endDate] overlaps the IST week (Mon–Sun) containing today.');
      return { ...out, ok: true };
    }

    case 'exam_count_all_active': {
      const xf = examScopeFilter(role, viewerOid);
      if (xf === null && role === 'admin') return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const q = role === 'admin' ? { ...xf, isActive: true } : { isActive: true };
      const count = await Exam.countDocuments(q);
      out.auditQuery = `SELECT COUNT(*) FROM exams WHERE isActive=true`;
      out.facts = { activeExamCount: count };
      return { ...out, ok: true };
    }

    case 'rank_class_student_count': {
      const sf = studentScopeFilter(role, viewerOid);
      if (!sf) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const match = filters.activeOnly ? { ...sf, isActive: true } : sf;
      const agg = await User.aggregate([
        { $match: match },
        { $group: { _id: '$classNumber', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]);
      const top = agg[0] || null;
      out.auditQuery =
        `SELECT classNumber AS grade, COUNT(*) AS c FROM users WHERE role='student' GROUP BY classNumber ORDER BY c DESC`;
      out.facts = {
        top5ByDeclaredClassNumber: (agg || []).map((r) => ({ classNumber: r._id || 'Unassigned', count: r.count })),
        leadingClassNumber: top?._id || null,
        leadingCount: top?.count ?? 0,
      };
      pushNote('Ranking uses Student.classNumber (declared grade). Assigned class sections are not merged here.');
      return { ...out, ok: true };
    }

    case 'attendance_summary_today': {
      const todayKey = istYmd(new Date());
      const sf = studentScopeFilter(role, viewerOid);
      if (!sf) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };
      const scopedStudents = await User.find(sf).select('_id').lean();
      const ids = scopedStudents.map((s) => s._id);
      const totalStudents = ids.length;
      const distinctPresent = await UserSession.distinct('userId', {
        date: todayKey,
        userId: { $in: ids },
      });
      const present = distinctPresent.length;
      out.auditQuery = `SELECT COUNT(DISTINCT userId) FROM user_sessions WHERE date='${todayKey}' AND userId IN (scoped_students)`;
      out.facts = {
        istDate: todayKey,
        studentsWithSessionLogged: present,
        totalStudentsInScope: totalStudents,
        approximateAttendanceRatePct:
          totalStudents > 0 ? Math.round((present / totalStudents) * 1000) / 10 : null,
      };
      pushNote(
        'There is no dedicated attendance register in the database. This uses UserSession login-activity rows for IST date.'
      );
      return { ...out, ok: true };
    }

    case 'rank_section_attendance_week': {
      const weekKeys = istWeekDateKeys(new Date());
      const sf = studentScopeFilter(role, viewerOid);
      if (!sf) return { ok: false, error: 'Scope unavailable', auditQuery: '--', facts: {} };

      /** @type {{ _id?: { cn: string, sec?: string }, present?: number, enrolled?: number }[]} */
      const pipeline = [
        { $match: { date: { $in: weekKeys } } },
        {
          $lookup: {
            from: User.collection.name,
            localField: 'userId',
            foreignField: '_id',
            as: 'u',
          },
        },
        { $unwind: '$u' },
        {
          $match: {
            'u.role': 'student',
            ...(role === 'admin' ? { 'u.assignedAdmin': viewerOid } : {}),
          },
        },
        {
          $lookup: {
            from: Class.collection.name,
            localField: 'u.assignedClass',
            foreignField: '_id',
            as: 'c',
          },
        },
        {
          $project: {
            uid: '$userId',
            cn: '$u.classNumber',
            sec: { $arrayElemAt: ['$c.section', 0] },
            clsNum: { $arrayElemAt: ['$c.classNumber', 0] },
          },
        },
        {
          $group: {
            _id: { cn: { $ifNull: ['$clsNum', '$cn'] }, sec: '$sec' },
            present: { $addToSet: '$uid' },
          },
        },
        {
          $project: {
            classNumber: '$_id.cn',
            section: '$_id.sec',
            distinctPresent: { $size: '$present' },
          },
        },
        { $sort: { distinctPresent: -1 } },
        { $limit: 8 },
      ];

      const presentRows = await UserSession.aggregate(pipeline);

      const enrollAgg = await User.aggregate([
        { $match: { ...sf } },
        {
          $lookup: {
            from: Class.collection.name,
            localField: 'assignedClass',
            foreignField: '_id',
            as: 'c',
          },
        },
        {
          $group: {
            _id: { cn: { $ifNull: [{ $arrayElemAt: ['$c.classNumber', 0] }, '$classNumber'] }, sec: { $arrayElemAt: ['$c.section', 0] } },
            enrolled: { $sum: 1 },
          },
        },
      ]);

      const enrollMap = new Map();
      for (const r of enrollAgg) {
        const key = `${r._id?.cn || '?'}::${r._id?.sec || '—'}`;
        enrollMap.set(key, r.enrolled || 0);
      }

      const ranked = (presentRows || []).map((r) => {
        const key = `${r.classNumber || '?'}::${r.section || '—'}`;
        const enrolled = enrollMap.get(key) || 0;
        const pct = enrolled > 0 ? Math.round((r.distinctPresent / enrolled) * 1000) / 10 : null;
        return {
          classNumber: r.classNumber,
          section: r.section || '—',
          distinctStudentsWithSessions: r.distinctPresent,
          enrolledStudentsApprox: enrolled,
          ratePctApprox: pct,
        };
      });

      ranked.sort((a, b) => (b.ratePctApprox || 0) - (a.ratePctApprox || 0));
      const best = ranked[0] || null;

      out.auditQuery =
        '-- aggregate user_sessions(users.role=student) DISTINCT userId by week IST joined classes for section label';
      out.facts = { weekIstDates: weekKeys, rankedSectionsApprox: ranked, bestApprox: best };
      pushNote('Proxy attendance = distinct students with ≥1 UserSession row on IST week days.');
      return { ...out, ok: true };
    }

    case 'ai_generations_count_today': {
      const ymd = istYmd(new Date());
      const start = istStartOfDayInstant(ymd);
      const end = istEndOfDayInstant(ymd);
      if (role === 'super-admin') {
        const count = await AiToolGeneration.countDocuments({ createdAt: { $gte: start, $lte: end } });
        out.auditQuery = `SELECT COUNT(*) FROM ai_tool_generations WHERE createdAt BETWEEN '${start.toISOString()}' AND '${end.toISOString()}'`;
        out.facts = { aiGenerationsToday: count, istDate: ymd, scope: 'platform' };
        return { ...out, ok: true };
      }
      const adminOid = oid(viewerUserId);
      const nums = await distinctClassNumbersForAdmin(adminOid);
      const variants = aiGenClassVariants(nums);
      const count = await AiToolGeneration.countDocuments({
        createdAt: { $gte: start, $lte: end },
        $or: [{ classLabel: { $in: variants } }, { 'metadata.classNumber': { $in: [...nums, ...variants] } }],
      });
      out.auditQuery =
        `SELECT COUNT(*) FROM ai_tool_generations WHERE createdAt BETWEEN ... AND classLabel/metadata.classNumber IN admin_classes`;
      out.facts = { aiGenerationsTodayApprox: count, istDate: ymd, scope: 'school_approx', matchedClassBands: nums };
      pushNote('School scope approximates AiToolGeneration rows whose class labels match this admin\x27s class numbers.');
      return { ...out, ok: true };
    }

    case 'fee_records_status': {
      out.auditQuery = '-- no fee_records collection';
      out.facts = {
        billingDataAvailable: false,
        detail: 'Fee balances and invoices are not stored as structured records in this application database.',
      };
      pushNote(
        'If finance is tracked outside (e.g. Razorpay dashboard only), totals are not available here.'
      );
      return { ...out, ok: true };
    }

    case 'vidya_calls_count_today': {
      const ymd = istYmd(new Date());
      const start = istStartOfDayInstant(ymd);
      const end = istEndOfDayInstant(ymd);
      let count = await VidyaCallLog.countDocuments({ ts: { $gte: start, $lte: end } });
      if (role === 'admin') {
        count = await VidyaCallLog.countDocuments({
          ts: { $gte: start, $lte: end },
          userId: String(viewerOid),
        });
        pushNote('For school admins, Vidya usage is counted only when their own user id appears in Vidya logs (narrow). Platform-wide Vidya totals need super-admin.');
      }
      out.facts = { vidyaApiCallsToday: count, istDate: ymd, scopeNote: role === 'admin' ? 'admin_uid_only' : 'platform' };
      out.auditQuery = `SELECT COUNT(*) FROM ${VidyaCallLog.collection.name} WHERE ts BETWEEN ...`;
      return { ...out, ok: true };
    }

    case 'vidya_calls_count_week': {
      const weekKeys = istWeekDateKeys(new Date());
      const start = istStartOfDayInstant(weekKeys[0]);
      const end = istEndOfDayInstant(weekKeys[6]);
      let count = await VidyaCallLog.countDocuments({ ts: { $gte: start, $lte: end } });
      if (role === 'admin') {
        count = await VidyaCallLog.countDocuments({
          ts: { $gte: start, $lte: end },
          userId: String(viewerOid),
        });
      }
      out.facts = { vidyaApiCallsWeek: count, istWeekStart: weekKeys[0], istWeekEnd: weekKeys[6] };
      return { ...out, ok: true };
    }

    case 'user_role_breakdown': {
      if (role === 'admin') {
        const [studentsUnderAdmin, linkedTeachers] = await Promise.all([
          User.countDocuments({ role: 'student', assignedAdmin: viewerOid }),
          Teacher.countDocuments({ adminId: viewerOid }),
        ]);
        out.auditQuery =
          `SELECT (SELECT COUNT(*) FROM users WHERE role='student' AND assignedAdmin=id) AS students, ` +
          `(SELECT COUNT(*) FROM teachers WHERE adminId=id) AS teachers`;
        out.facts = {
          breakdownSchoolScoped: { students: studentsUnderAdmin, teachers: linkedTeachers },
        };
      } else {
        const buckets = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
        out.auditQuery = `SELECT role, COUNT(*) FROM ${User.collection.name} GROUP BY role`;
        out.facts = { usersByRole: buckets };
      }
      return { ...out, ok: true };
    }

    case 'learning_paths_published_count': {
      const count = await LearningPath.countDocuments({ isPublished: true });
      out.auditQuery = `SELECT COUNT(*) FROM learning_paths WHERE isPublished=true`;
      out.facts = { publishedLearningPaths: count };
      pushNote('Learning paths are platform-wide catalogue items.');
      return { ...out, ok: true };
    }

    case 'exam_results_count_period': {
      let start;
      let end = new Date();
      if (timeframe === 'today') {
        const ymd = istYmd(new Date());
        start = istStartOfDayInstant(ymd);
        end = istEndOfDayInstant(ymd);
      } else if (timeframe === 'this_week') {
        const keys = istWeekDateKeys(new Date());
        start = istStartOfDayInstant(keys[0]);
        end = istEndOfDayInstant(keys[6]);
      } else if (timeframe === 'this_month') {
        const today = istYmd(new Date());
        const firstDay = `${today.slice(0, 7)}-01`;
        start = istStartOfDayInstant(firstDay);
        end = new Date();
      } else {
        start = new Date(0);
      }

      let match = { completedAt: { $gte: start, $lte: end } };

      if (role === 'admin') {
        const studentIds = await User.find(studentScopeFilter(role, viewerOid)).distinct('_id');
        match = {
          completedAt: { $gte: start, $lte: end },
          userId: { $in: studentIds },
        };
      }

      const count = await ExamResult.countDocuments(match);
      out.auditQuery = `SELECT COUNT(*) FROM exam_results WHERE completedAt in range`;
      out.facts = { examResultsInPeriod: count, timeframe };
      return { ...out, ok: true };
    }

    default: {
      out.auditQuery = '--';
      out.facts = { unsupportedOperation: operation };
      pushNote(`No deterministic database mapping implemented for '${operation}'.`);
      return { ...out, ok: true };
    }
  }
}
