import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import Question from '../models/Question.js';

// Get all exams for admin's board (Super Admin created + view only)
// ALL exams are visible to ALL schools regardless of board or school restrictions
export const getViewableExams = async (req, res) => {
  try {
    const adminId = req.adminId;
    
    // Get all exams created by Super Admin - no restrictions
    // All schools can see all exams regardless of board or school-specific targeting
    const exams = await Exam.find({
      createdByRole: 'super-admin',
      isActive: true
    })
    .populate('questions')
    .populate('createdBy', 'fullName email')
    .populate('targetSchools', 'schoolName fullName email')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: exams,
      message: 'Exams fetched successfully'
    });
  } catch (error) {
    console.error('Get viewable exams error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
};

// Get exam details (view only)
// All exams are accessible to all schools - no restrictions
export const getExamDetails = async (req, res) => {
  try {
    const { examId } = req.params;

    // All exams are accessible to all schools - no restrictions
    const exam = await Exam.findOne({
      _id: examId,
      createdByRole: 'super-admin'
    })
    .populate('questions')
    .populate('createdBy', 'fullName email')
    .populate('targetSchools', 'schoolName fullName email');

    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    res.json({
      success: true,
      data: exam
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
        filteredResults = results.filter((result) => {
          const subjectScores = result.subjectWiseScore;
          if (subjectScores && typeof subjectScores.get === 'function') {
            return subjectScores.has(subject);
          }
          return false;
        });
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
      filteredResults = results.filter(result => {
        const subjectScores = result.subjectWiseScore;
        if (subjectScores && typeof subjectScores.get === 'function') {
          return subjectScores.has(subject);
        }
        return false;
      });
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

function buildTopPerformersAndClassStats(results) {
  const topPerformers = results.slice(0, 10).map((r, idx) => ({
    rank: idx + 1,
    studentName: r.userId?.fullName || 'Unknown',
    studentEmail: r.userId?.email || '',
    classNumber: r.userId?.classNumber || '',
    percentage: r.percentage,
    marks: `${r.obtainedMarks}/${r.totalMarks}`,
    completedAt: r.completedAt
  }));

  const classPerformance = {};
  results.forEach(result => {
    const classNum = result.userId?.classNumber || 'Unknown';
    if (!classPerformance[classNum]) {
      classPerformance[classNum] = {
        total: 0,
        sum: 0,
        students: []
      };
    }
    classPerformance[classNum].total++;
    classPerformance[classNum].sum += result.percentage;
    classPerformance[classNum].students.push({
      name: result.userId?.fullName,
      percentage: result.percentage
    });
  });

  const classStats = Object.entries(classPerformance).map(([classNum, data]) => ({
    classNumber: classNum,
    studentsAttempted: data.total,
    averageScore: (data.sum / data.total).toFixed(2),
    studentList: data.students
  }));

  return { topPerformers, classStats };
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

    if (isSuperAdmin) {
      let results = await ExamResult.find({ examId: examObjectId })
        .populate('userId', 'fullName email classNumber')
        .sort({ percentage: -1 });

      if (classNum) {
        results = results.filter(
          (r) => String(r.userId?.classNumber || '').trim() === classNum
        );
      }

      const studentCountQuery = { role: 'student' };
      if (classNum) {
        studentCountQuery.classNumber = classNum;
      }
      const totalStudents = await User.countDocuments(studentCountQuery);

      const uniqueAttempters = new Set(
        results.map((r) => String(r.userId?._id || r.userId || '')).filter(Boolean)
      ).size;
      const attemptedCount = uniqueAttempters;
      const averageScore = results.length > 0
        ? results.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) / results.length
        : 0;

      const { topPerformers, classStats } = buildTopPerformersAndClassStats(results);

      return res.json({
        success: true,
        data: {
          totalStudents,
          attemptedCount,
          notAttemptedCount: Math.max(0, totalStudents - attemptedCount),
          averageScore: averageScore.toFixed(2),
          topPerformers,
          classPerformance: classStats
        }
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

    const results = await ExamResult.find({
      examId: examObjectId,
      userId: { $in: studentIds }
    })
    .populate('userId', 'fullName email classNumber')
    .sort({ percentage: -1 });

    const totalStudents = studentIds.length;
    const attemptedCount = results.length;
    const averageScore = results.length > 0
      ? results.reduce((sum, r) => sum + (Number(r.percentage) || 0), 0) / results.length
      : 0;

    const { topPerformers, classStats } = buildTopPerformersAndClassStats(results);

    res.json({
      success: true,
      data: {
        totalStudents,
        attemptedCount,
        notAttemptedCount: totalStudents - attemptedCount,
        averageScore: averageScore.toFixed(2),
        topPerformers,
        classPerformance: classStats
      }
    });
  } catch (error) {
    console.error('Get exam performance analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

