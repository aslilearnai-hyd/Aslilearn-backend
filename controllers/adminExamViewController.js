import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import Question from '../models/Question.js';
import { examVisibleToSchoolAdmin } from '../utils/exam-visibility.js';
import {
  getExamAssignedClassNumbers,
  normalizeClassNumberLabel,
} from '../utils/studentClassContent.js';

function studentInExamClasses(studentClassNumber, examClasses) {
  if (!Array.isArray(examClasses) || examClasses.length === 0) return true;
  const want = normalizeClassNumberLabel(studentClassNumber);
  if (!want) return false;
  return examClasses.some((c) => normalizeClassNumberLabel(c) === want);
}

/** Keep best attempt per student, highest percentage first. */
function bestAttemptsSorted(results) {
  const best = new Map();
  for (const r of results || []) {
    const id = String(r.userId?._id || r.userId || '').trim();
    if (!id) continue;
    const prev = best.get(id);
    if (!prev || Number(r.percentage) > Number(prev.percentage)) {
      best.set(id, r);
    }
  }
  return [...best.values()].sort(
    (a, b) => Number(b.percentage || 0) - Number(a.percentage || 0)
  );
}

function buildRankedPerformers(results) {
  return bestAttemptsSorted(results).map((r, idx) => ({
    rank: idx + 1,
    studentName: r.userId?.fullName || 'Unknown',
    studentEmail: r.userId?.email || '',
    classNumber: r.userId?.classNumber || '',
    percentage: r.percentage,
    marks: `${r.obtainedMarks}/${r.totalMarks}`,
    completedAt: r.completedAt,
    attemptNumber: Number(r.attemptNumber) >= 1 ? Number(r.attemptNumber) : 1,
  }));
}

function buildTopPerformersAndClassStats(results) {
  const rankedStudents = buildRankedPerformers(results);
  const topPerformers = rankedStudents.slice(0, 10);

  const classPerformance = {};
  bestAttemptsSorted(results).forEach((result) => {
    const classNum = result.userId?.classNumber || 'Unknown';
    if (!classPerformance[classNum]) {
      classPerformance[classNum] = {
        total: 0,
        sum: 0,
        students: []
      };
    }
    classPerformance[classNum].total++;
    classPerformance[classNum].sum += Number(result.percentage) || 0;
    classPerformance[classNum].students.push({
      name: result.userId?.fullName,
      percentage: result.percentage
    });
  });

  const classStats = Object.entries(classPerformance).map(([classNum, data]) => ({
    classNumber: classNum,
    studentsAttempted: data.total,
    averageScore: data.total > 0 ? (data.sum / data.total).toFixed(2) : '0.00',
    studentList: data.students
  }));

  return { topPerformers, rankedStudents, classStats };
}
export const getViewableExams = async (req, res) => {
  try {
    const adminId = req.adminId;
    if (!adminId || !mongoose.Types.ObjectId.isValid(String(adminId))) {
      return res.status(400).json({ success: false, message: 'Admin context missing' });
    }

    const admin = await User.findById(adminId)
      .select('_id board curriculumBoard isAsliPrepExclusive iitCategories schoolName fullName role')
      .lean();
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'School admin access required' });
    }

    const exams = await Exam.find({
      createdByRole: 'super-admin',
      isActive: true,
    })
      .populate('questions')
      .populate('createdBy', 'fullName email')
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ createdAt: -1 })
      .lean();

    const visible = exams.filter((exam) => examVisibleToSchoolAdmin(exam, admin));

    res.json({
      success: true,
      data: visible,
      message: 'Exams fetched successfully',
    });
  } catch (error) {
    console.error('Get viewable exams error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
};

/** Exam details — same school/board targeting as the list. */
export const getExamDetails = async (req, res) => {
  try {
    const { examId } = req.params;
    const adminId = req.adminId;

    if (!adminId || !mongoose.Types.ObjectId.isValid(String(adminId))) {
      return res.status(400).json({ success: false, message: 'Admin context missing' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(examId))) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }

    const admin = await User.findById(adminId)
      .select('_id board curriculumBoard isAsliPrepExclusive iitCategories role')
      .lean();
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'School admin access required' });
    }

    const exam = await Exam.findOne({
      _id: examId,
      createdByRole: 'super-admin',
      isActive: { $ne: false },
    })
      .populate('questions')
      .populate('createdBy', 'fullName email')
      .populate('targetSchools', 'schoolName fullName email')
      .lean();

    if (!exam || !examVisibleToSchoolAdmin(exam, admin)) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    res.json({
      success: true,
      data: exam,
    });
  } catch (error) {
    console.error('Get exam details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam details' });
  }
};

function queryClassNumber(raw) {
  const s = raw != null ? String(raw).trim() : '';
  return s || '';
}

function mapLikeToObject(value) {
  if (value == null) return value;
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value === 'object' && typeof value.get === 'function') {
    try {
      return Object.fromEntries(value);
    } catch (_e) {
      return { ...value };
    }
  }
  return value;
}

function serializeExamResultRow(row) {
  const plain =
    row && typeof row.toObject === 'function'
      ? row.toObject({ flattenMaps: true })
      : { ...row };
  return {
    ...plain,
    attemptNumber: Number(plain.attemptNumber) >= 1 ? Number(plain.attemptNumber) : 1,
    subjectWiseScore: mapLikeToObject(plain.subjectWiseScore) || {},
    answers: mapLikeToObject(plain.answers) || {},
  };
}

// Get student exam results (filtered by admin's students)
export const getStudentExamResults = async (req, res) => {
  try {
    const adminId = req.adminId;
    const { examId, classNumber, subject, startDate, endDate } = req.query;
    const isSuperAdmin = req.user?.role === 'super-admin';
    const classNum = queryClassNumber(classNumber);

    if (isSuperAdmin) {
      if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
        return res.status(400).json({ success: false, message: 'examId is required for exam results' });
      }
      const resultQuery = {
        examId: new mongoose.Types.ObjectId(examId)
      };
      if (startDate || endDate) {
        resultQuery.completedAt = {};
        if (startDate) resultQuery.completedAt.$gte = new Date(startDate);
        if (endDate) resultQuery.completedAt.$lte = new Date(endDate);
      }
      let results = await ExamResult.find(resultQuery)
        .populate('userId', 'fullName email classNumber')
        .populate('examId', 'title examType')
        .sort({ completedAt: -1 });

      if (classNum) {
        results = results.filter(
          (r) => String(r.userId?.classNumber || '').trim() === classNum
        );
      }

      let filteredResults = results;
      if (subject) {
        filteredResults = results.filter((result) =>
          subjectWiseScoreHasKey(result.subjectWiseScore, subject)
        );
      }

      return res.json({
        success: true,
        data: filteredResults.map(serializeExamResultRow),
        count: filteredResults.length
      });
    }

    if (!adminId || !mongoose.Types.ObjectId.isValid(String(adminId))) {
      return res.status(400).json({ success: false, message: 'Admin context missing' });
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(400).json({ success: false, message: 'Admin not found' });
    }

    const studentFilter = { assignedAdmin: adminId, role: 'student' };
    if (classNum) {
      studentFilter.classNumber = classNum;
    }

    const students = await User.find(studentFilter).select('_id');
    const studentIds = students.map(s => s._id);

    if (studentIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        count: 0
      });
    }

    const resultQuery = {
      userId: { $in: studentIds }
    };

    if (examId) {
      if (!mongoose.Types.ObjectId.isValid(examId)) {
        return res.status(400).json({ success: false, message: 'Invalid exam id' });
      }
      resultQuery.examId = new mongoose.Types.ObjectId(examId);
    }
    if (startDate || endDate) {
      resultQuery.completedAt = {};
      if (startDate) resultQuery.completedAt.$gte = new Date(startDate);
      if (endDate) resultQuery.completedAt.$lte = new Date(endDate);
    }

    const results = await ExamResult.find(resultQuery)
      .populate('userId', 'fullName email classNumber')
      .populate('examId', 'title examType')
      .sort({ completedAt: -1 });

    let filteredResults = results;
    if (subject) {
      filteredResults = results.filter((result) =>
        subjectWiseScoreHasKey(result.subjectWiseScore, subject)
      );
    }

    res.json({
      success: true,
      data: filteredResults.map(serializeExamResultRow),
      count: filteredResults.length
    });
  } catch (error) {
    console.error('Get student exam results error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam results' });
  }
};

function subjectWiseScoreHasKey(subjectScores, subject) {
  if (!subjectScores || !subject) return false;
  if (typeof subjectScores.get === 'function') {
    return subjectScores.has(subject);
  }
  if (typeof subjectScores === 'object') {
    return Object.prototype.hasOwnProperty.call(subjectScores, subject);
  }
  return false;
}

// Get exam performance analytics for admin's students
export const getExamPerformanceAnalytics = async (req, res) => {
  try {
    const adminId = req.adminId;
    const { examId } = req.params;
    const isSuperAdmin = req.user?.role === 'super-admin';
    const classNum = queryClassNumber(req.query.classNumber);

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }
    const examObjectId = new mongoose.Types.ObjectId(examId);
    const examDoc = await Exam.findById(examObjectId)
      .select('title classNumber assignedClasses')
      .lean();
    const examClasses = getExamAssignedClassNumbers(examDoc);
    const scopedClasses = classNum
      ? [normalizeClassNumberLabel(classNum)].filter(Boolean)
      : examClasses;

    const buildPayload = (eligibleStudents, results) => {
      const totalStudents = eligibleStudents.length;
      const ranked = bestAttemptsSorted(results);
      const attemptedCount = ranked.length;
      const averageScore =
        ranked.length > 0
          ? ranked.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) / ranked.length
          : 0;
      const { topPerformers, rankedStudents, classStats } =
        buildTopPerformersAndClassStats(results);
      return {
        totalStudents,
        attemptedCount,
        notAttemptedCount: Math.max(0, totalStudents - attemptedCount),
        averageScore: averageScore.toFixed(2),
        examClasses: scopedClasses,
        examTitle: examDoc?.title || '',
        topPerformers,
        rankedStudents,
        classPerformance: classStats,
      };
    };

    if (isSuperAdmin) {
      let results = await ExamResult.find({ examId: examObjectId })
        .populate('userId', 'fullName email classNumber')
        .sort({ percentage: -1 });

      if (scopedClasses.length) {
        results = results.filter((r) =>
          studentInExamClasses(r.userId?.classNumber, scopedClasses)
        );
      }

      const allStudents = await User.find({ role: 'student' })
        .select('_id classNumber')
        .lean();
      const eligible = scopedClasses.length
        ? allStudents.filter((s) => studentInExamClasses(s.classNumber, scopedClasses))
        : allStudents;

      return res.json({
        success: true,
        data: buildPayload(eligible, results),
      });
    }

    if (!adminId || !mongoose.Types.ObjectId.isValid(String(adminId))) {
      return res.status(400).json({ success: false, message: 'Admin context missing' });
    }

    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(400).json({ success: false, message: 'Admin not found' });
    }

    const schoolStudents = await User.find({ assignedAdmin: adminId, role: 'student' })
      .select('_id classNumber fullName email')
      .lean();

    const eligibleStudents = scopedClasses.length
      ? schoolStudents.filter((s) => studentInExamClasses(s.classNumber, scopedClasses))
      : schoolStudents;
    const eligibleIds = new Set(eligibleStudents.map((s) => String(s._id)));

    let results = await ExamResult.find({
      examId: examObjectId,
      userId: { $in: eligibleStudents.map((s) => s._id) },
    })
      .populate('userId', 'fullName email classNumber')
      .sort({ percentage: -1 });

    results = results.filter((r) =>
      eligibleIds.has(String(r.userId?._id || r.userId || ''))
    );

    res.json({
      success: true,
      data: buildPayload(eligibleStudents, results),
    });
  } catch (error) {
    console.error('Get exam performance analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

