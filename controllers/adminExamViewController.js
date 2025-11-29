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

// Get student exam results (filtered by admin's students)
export const getStudentExamResults = async (req, res) => {
  try {
    const adminId = req.adminId;
    const { examId, classNumber, subject, startDate, endDate } = req.query;

    // Get admin's board
    const admin = await User.findById(adminId);
    if (!admin || !admin.board) {
      return res.status(400).json({ success: false, message: 'Admin board not assigned' });
    }

    // Get all students assigned to this admin
    const studentFilter = { assignedAdmin: adminId, role: 'student', board: admin.board };
    if (classNumber) {
      studentFilter.classNumber = classNumber;
    }

    const students = await User.find(studentFilter).select('_id');
    const studentIds = students.map(s => s._id);

    // Build query for exam results
    const resultQuery = {
      adminId: adminId,
      board: admin.board,
      userId: { $in: studentIds }
    };

    if (examId) resultQuery.examId = examId;
    if (startDate || endDate) {
      resultQuery.completedAt = {};
      if (startDate) resultQuery.completedAt.$gte = new Date(startDate);
      if (endDate) resultQuery.completedAt.$lte = new Date(endDate);
    }

    const results = await ExamResult.find(resultQuery)
      .populate('userId', 'fullName email classNumber')
      .populate('examId', 'title examType')
      .sort({ completedAt: -1 });

    // Filter by subject if provided
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
      data: filteredResults,
      count: filteredResults.length
    });
  } catch (error) {
    console.error('Get student exam results error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam results' });
  }
};

// Get exam performance analytics for admin's students
export const getExamPerformanceAnalytics = async (req, res) => {
  try {
    const adminId = req.adminId;
    const { examId } = req.params;

    // Get admin's board
    const admin = await User.findById(adminId);
    if (!admin || !admin.board) {
      return res.status(400).json({ success: false, message: 'Admin board not assigned' });
    }

    // Get all students assigned to this admin
    const students = await User.find({ assignedAdmin: adminId, role: 'student', board: admin.board }).select('_id');
    const studentIds = students.map(s => s._id);

    // Get results for this exam
    const results = await ExamResult.find({
      examId,
      adminId,
      board: admin.board,
      userId: { $in: studentIds }
    })
    .populate('userId', 'fullName email classNumber')
    .sort({ percentage: -1 });

    // Calculate statistics
    const totalStudents = studentIds.length;
    const attemptedCount = results.length;
    const averageScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.percentage, 0) / results.length
      : 0;

    // Get top performers
    const topPerformers = results.slice(0, 10).map((r, idx) => ({
      rank: idx + 1,
      studentName: r.userId?.fullName || 'Unknown',
      studentEmail: r.userId?.email || '',
      classNumber: r.userId?.classNumber || '',
      percentage: r.percentage,
      marks: `${r.obtainedMarks}/${r.totalMarks}`,
      completedAt: r.completedAt
    }));

    // Class-wise performance
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



