import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { setAuthCookie, setRefreshCookie } from '../utils/auth-cookie.js';
import User from '../models/User.js';
import Video from '../models/Video.js';
import Teacher from '../models/Teacher.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import Content from '../models/Content.js';
import Subject from '../models/Subject.js';
import Class from '../models/Class.js';
import RiskAnalysisReport from '../models/RiskAnalysisReport.js';
import {
  isRazorpayConfigured,
  fetchRazorpayPayments,
  fetchRazorpaySubscriptions,
  fetchBillingForAdminEmail,
} from '../services/razorpayService.js';
import {
  CURRICULUM_BOARDS,
  isValidCurriculumBoard,
  isStoredCurriculumBoard,
  resolveAdminStoredBoard,
  resolveUserDisplayBoard,
} from '../constants/boards.js';
import School from '../models/School.js';
import {
  PASS_THRESHOLD,
  contentVolume,
  activeStudentsPercentage as calcActiveStudentsPct,
} from '../utils/analytics-metrics.js';
import {
  normalizeSchoolDetails,
  buildSchoolFieldsFromBody,
  applySchoolToAdminUser,
  formatSchoolListItem,
  schoolShapeFromAdminUser,
  findSchoolByAdminId,
  deleteSchoolById,
  resolveSchoolAndAdminByParamId,
  normalizePhoneTenDigits,
  isValidOptionalPhoneTenDigits,
  isValidOptionalIndianPincode,
  isValidSchoolPlaceName,
  isValidOptionalAddressLine,
  normalizeAccountSeats,
} from '../services/schoolService.js';

// Super Admin Login — database accounts only (no hardcoded credentials)
/** POST /api/super-admin/change-password — authenticated super-admin only */
export const changeSuperAdminPassword = async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters',
      });
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirmation do not match',
      });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from the current password',
      });
    }

    const userId = req.userId || req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const superAdminUser = await User.findOne({ _id: userId, role: 'super-admin' });
    if (!superAdminUser) {
      return res.status(404).json({ success: false, message: 'Super admin not found' });
    }
    if (!superAdminUser.password) {
      return res.status(400).json({
        success: false,
        message: 'Password change is not available for this account',
      });
    }

    const valid = await bcrypt.compare(currentPassword, superAdminUser.password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    superAdminUser.password = await bcrypt.hash(newPassword, 12);
    await superAdminUser.save();

    req.setAudit?.({
      action: 'auth.change-password',
      summary: `Super admin changed password: ${superAdminUser.email}`,
      actor: {
        id: String(superAdminUser._id),
        role: 'super-admin',
        email: superAdminUser.email,
        name: superAdminUser.fullName || null,
      },
    });

    return res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Failed to change super-admin password:', error);
    return res.status(500).json({ success: false, message: 'Failed to change password' });
  }
};

export const superAdminLogin = async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const superAdminUser = await User.findOne({ email, role: 'super-admin' });
    if (!superAdminUser || !superAdminUser.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (!superAdminUser.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, superAdminUser.password);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await User.findByIdAndUpdate(
      superAdminUser._id,
      { lastLogin: new Date() },
      { runValidators: false }
    );

    const superAdminId = superAdminUser._id.toString();
    const token = jwt.sign(
      {
        id: superAdminId,
        userId: superAdminId,
        email: superAdminUser.email,
        fullName: superAdminUser.fullName,
        role: 'super-admin',
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256' }
    );
    setAuthCookie(res, token);

    let refreshToken = null;
    try {
      const { issueRefreshToken } = await import('../utils/auth-tokens.js');
      const issued = await issueRefreshToken({
        userId: superAdminUser._id,
        role: 'super-admin',
        userAgent: req.headers?.['user-agent'] || '',
        ip: req.ip || '',
      });
      refreshToken = issued.refreshToken;
      setRefreshCookie(res, refreshToken);
    } catch (refreshErr) {
      console.warn('Super-admin refresh token skipped:', refreshErr?.message);
    }

    req.setAudit?.({
      action: 'auth.login',
      summary: `Super admin login: ${superAdminUser.email}`,
      actor: {
        id: superAdminId,
        role: 'super-admin',
        email: superAdminUser.email,
        name: superAdminUser.fullName || null,
      },
      meta: { loginRole: 'super-admin' },
    });

    return res.json({
      success: true,
      token,
      accessToken: token,
      refreshToken,
      user: {
        id: superAdminId,
        _id: superAdminId,
        email: superAdminUser.email,
        fullName: superAdminUser.fullName,
        role: 'super-admin',
      },
    });
  } catch (error) {
    console.error('Super admin login error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get Dashboard Stats (Global view for Super Admin)
export const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await Teacher.countDocuments();
    const totalVideos = await Video.countDocuments();
    const totalContentItems = await Content.countDocuments();
    const totalAssessments = await Assessment.countDocuments();
    const totalExams = await Exam.countDocuments();
    const totalAdmins = await School.countDocuments({});

    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalExamResults = await ExamResult.countDocuments();
    const activeVideos = await Video.countDocuments({ isActive: true });
    const activeAssessments = await Assessment.countDocuments({ isActive: true });

    const avgExamsPerStudent =
      totalStudents > 0 ? (totalExamResults / totalStudents).toFixed(1) : 0;

    // Named content volume (videos + content + assessments + exams) — not a percentage.
    const contentVolumeValue = contentVolume({
      videos: totalVideos,
      content: totalContentItems,
      assessments: totalAssessments,
      exams: totalExams,
    });

    const [passAgg, studentsWithExams] = await Promise.all([
      ExamResult.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            passing: {
              $sum: {
                $cond: [{ $gte: [{ $ifNull: ['$percentage', 0] }, PASS_THRESHOLD] }, 1, 0],
              },
            },
            avgPercentage: { $avg: { $ifNull: ['$percentage', 0] } },
          },
        },
      ]),
      ExamResult.distinct('userId'),
    ]);

    const passStats = passAgg[0] || { total: 0, passing: 0, avgPercentage: 0 };
    const passRate =
      passStats.total > 0
        ? Math.round((passStats.passing / passStats.total) * 1000) / 10
        : 0;
    const activeStudents = (studentsWithExams || []).filter(Boolean).length;
    const activeStudentsPercentage = calcActiveStudentsPct(activeStudents, totalStudents);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalStudents,
        totalTeachers,
        totalAdmins,
        courses: totalContentItems,
        totalContent: totalContentItems,
        totalVideos,
        assessments: totalAssessments,
        exams: totalExams,
        examResults: totalExamResults,
        activeVideos,
        activeAssessments,
        avgExamsPerStudent,
        // contentVolume is the truthful metric; contentEngagement kept as alias for older clients.
        contentVolume: contentVolumeValue,
        contentEngagement: contentVolumeValue,
        passRate,
        averageScore: Math.round((passStats.avgPercentage || 0) * 100) / 100,
        activeStudents,
        activeStudentsPercentage,
        passThreshold: PASS_THRESHOLD,
        superAdmins: 1,
      },
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
};

// Get all schools from schools collection (canonical table)
export const getAllSchools = async (req, res) => {
  try {
    const schools = await School.find().sort({ name: 1 }).lean();
    res.json({
      success: true,
      data: schools.map((s) => ({
        schoolId: s._id,
        adminUserId: s.adminUserId,
        name: s.name,
        board: s.board,
        curriculumBoard: s.curriculumBoard,
        isAsliPrepExclusive: s.isAsliPrepExclusive,
        isActive: s.isActive,
        place: s.place,
        schoolDetails: s.schoolDetails,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Get all schools error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch schools' });
  }
};

// Get All Admins with comprehensive analytics (schools table + admin login)
export const getAllAdmins = async (req, res) => {
  try {
    const schoolRows = await School.find().sort({ name: 1 }).lean();
    const linkedAdminIds = new Set(
      schoolRows.map((s) => s.adminUserId?.toString()).filter(Boolean),
    );

    // Show admin logins even when schools collection row was deleted (partial DB recovery)
    const orphanAdmins = await User.find({ role: 'admin' })
      .select('-password')
      .lean();
    const syntheticSchools = orphanAdmins
      .filter((a) => !linkedAdminIds.has(a._id.toString()))
      .map((a) => schoolShapeFromAdminUser(a))
      .filter(Boolean);

    const schools = [...schoolRows, ...syntheticSchools];
    const adminIds = schools.map((s) => s.adminUserId).filter(Boolean);

    const admins = adminIds.length
      ? await User.find({ _id: { $in: adminIds } }).select('-password').lean()
      : [];
    const adminById = new Map(admins.map((a) => [a._id.toString(), a]));

    const [
      studentsByAdminAgg,
      studentsViaExamAgg,
      teachersByAdminAgg,
      videosByAdminAgg,
      assessmentsByAdminAgg,
      examsByAdminAgg,
      examResultsByAdminAgg,
    ] = await Promise.all([
      User.aggregate([
        { $match: { role: 'student', assignedAdmin: { $in: adminIds } } },
        { $group: { _id: '$assignedAdmin', userIds: { $addToSet: '$_id' } } },
      ]),
      ExamResult.aggregate([
        { $match: { adminId: { $in: adminIds }, userId: { $ne: null } } },
        { $group: { _id: { adminId: '$adminId', userId: '$userId' } } },
        { $group: { _id: '$_id.adminId', userIds: { $addToSet: '$_id.userId' } } },
      ]),
      Teacher.aggregate([
        { $match: { adminId: { $in: adminIds } } },
        { $group: { _id: '$adminId', count: { $sum: 1 } } },
      ]),
      Video.aggregate([
        { $match: { adminId: { $in: adminIds } } },
        { $group: { _id: '$adminId', count: { $sum: 1 } } },
      ]),
      Assessment.aggregate([
        { $match: { adminId: { $in: adminIds } } },
        { $group: { _id: '$adminId', count: { $sum: 1 } } },
      ]),
      Exam.aggregate([
        { $match: { adminId: { $in: adminIds } } },
        { $group: { _id: '$adminId', count: { $sum: 1 } } },
      ]),
      ExamResult.find({ adminId: { $in: adminIds } })
        .populate('userId', 'fullName email')
        .lean()
        .catch(() => []),
    ]);

    const mergeStudentCount = (adminIdStr) => {
      const assigned =
        studentsByAdminAgg.find((r) => r._id?.toString() === adminIdStr)?.userIds || [];
      const fromExams =
        studentsViaExamAgg.find((r) => r._id?.toString() === adminIdStr)?.userIds || [];
      return new Set([
        ...assigned.map((id) => id.toString()),
        ...fromExams.map((id) => id.toString()),
      ]).size;
    };

    const countMap = (aggRows) =>
      new Map(aggRows.map((r) => [r._id?.toString(), r.count || 0]));

    const teacherCountMap = countMap(teachersByAdminAgg);
    const videoCountMap = countMap(videosByAdminAgg);
    const assessmentCountMap = countMap(assessmentsByAdminAgg);
    const examCountMap = countMap(examsByAdminAgg);

    const examResultsByAdmin = examResultsByAdminAgg.reduce((acc, result) => {
      const key = result.adminId?.toString();
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(result);
      return acc;
    }, {});

    const adminsWithAnalytics = schools.map((school) => {
        const admin = adminById.get(school.adminUserId?.toString());
        const adminKey = school.adminUserId?.toString() || '';
        if (!adminKey) {
          return formatSchoolListItem(school, null, {
            students: 0,
            teachers: 0,
            videos: 0,
            assessments: 0,
            exams: 0,
            totalExamsTaken: 0,
            averageScore: 0,
            averageAccuracy: 0,
            analytics: {
              topStudents: [],
              recentResults: [],
              subjectPerformance: [],
              totalQuestionsAnswered: 0,
              totalCorrectAnswers: 0,
              totalMarksObtained: 0,
              totalMarksPossible: 0,
            },
          });
        }
        const studentCount = mergeStudentCount(adminKey);
        const teacherCount = teacherCountMap.get(adminKey) || 0;
        const videoCount = videoCountMap.get(adminKey) || 0;
        const assessmentCount = assessmentCountMap.get(adminKey) || 0;
        const examCount = examCountMap.get(adminKey) || 0;
        const examResults = examResultsByAdmin[adminKey] || [];
        
        // Calculate exam performance analytics
        const totalExamsTaken = examResults.length;
        const totalQuestionsAnswered = examResults.reduce((sum, result) => sum + (result.totalQuestions || 0), 0);
        const totalCorrectAnswers = examResults.reduce((sum, result) => sum + (result.correctAnswers || 0), 0);
        const totalMarksObtained = examResults.reduce((sum, result) => sum + (result.obtainedMarks || 0), 0);
        const totalMarksPossible = examResults.reduce((sum, result) => sum + (result.totalMarks || 0), 0);
        
        const averageScore = totalMarksPossible > 0 ? (totalMarksObtained / totalMarksPossible * 100).toFixed(1) : 0;
        const averageAccuracy = totalQuestionsAnswered > 0 ? (totalCorrectAnswers / totalQuestionsAnswered * 100).toFixed(1) : 0;
        
        // Get top performing students
        const studentPerformance = examResults.reduce((acc, result) => {
          if (!result.userId || !result.userId._id) return acc;
          const studentId = result.userId._id.toString();
          if (!acc[studentId]) {
            acc[studentId] = {
              studentName: result.userId.fullName || 'Unknown',
              studentEmail: result.userId.email || 'unknown@email.com',
              totalExams: 0,
              totalMarks: 0,
              totalPossibleMarks: 0,
              averageScore: 0
            };
          }
          acc[studentId].totalExams += 1;
          acc[studentId].totalMarks += (result.obtainedMarks || 0);
          acc[studentId].totalPossibleMarks += (result.totalMarks || 0);
          return acc;
        }, {});
        
        // Calculate average scores for each student
        Object.values(studentPerformance).forEach(student => {
          student.averageScore = student.totalPossibleMarks > 0 
            ? (student.totalMarks / student.totalPossibleMarks * 100).toFixed(1)
            : 0;
        });
        
        // Sort students by performance
        const topStudents = Object.values(studentPerformance)
          .sort((a, b) => parseFloat(b.averageScore) - parseFloat(a.averageScore))
          .slice(0, 5);
        
        // Get recent exam results
        const recentResults = examResults
          .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
          .slice(0, 10)
          .map(result => ({
            examTitle: result.examTitle || 'Unknown Exam',
            studentName: result.userId?.fullName || 'Unknown Student',
            score: result.percentage || 0,
            marks: `${result.obtainedMarks || 0}/${result.totalMarks || 0}`,
            completedAt: result.completedAt || new Date()
          }));
        
        // Calculate subject-wise performance
        const subjectPerformance = {};
        examResults.forEach(result => {
          if (result.subjectWiseScore) {
            Object.entries(result.subjectWiseScore).forEach(([subject, data]) => {
              if (!subjectPerformance[subject]) {
                subjectPerformance[subject] = {
                  totalQuestions: 0,
                  correctAnswers: 0,
                  totalMarks: 0,
                  obtainedMarks: 0
                };
              }
              subjectPerformance[subject].totalQuestions += data.total || 0;
              subjectPerformance[subject].correctAnswers += data.correct || 0;
              // `marks` on subjectWiseScore is obtained marks; use accuracy for averageScore
              subjectPerformance[subject].obtainedMarks += data.marks || 0;
              subjectPerformance[subject].totalMarks += data.total || 0;
            });
          }
        });
        
        // Calculate subject-wise averages
        const subjectAnalytics = Object.entries(subjectPerformance).map(([subject, data]) => ({
          subject,
          accuracy: data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions * 100).toFixed(1) : 0,
          averageScore: data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions * 100).toFixed(1) : 0,
          totalQuestions: data.totalQuestions,
          correctAnswers: data.correctAnswers,
          obtainedMarks: data.obtainedMarks,
        }));
        
        return formatSchoolListItem(school, admin, {
          students: studentCount,
          teachers: teacherCount,
          videos: videoCount,
          assessments: assessmentCount,
          exams: examCount,
          totalExamsTaken,
          averageScore,
          averageAccuracy,
          analytics: {
            topStudents,
            recentResults,
            subjectPerformance: subjectAnalytics,
            totalQuestionsAnswered,
            totalCorrectAnswers,
            totalMarksObtained,
            totalMarksPossible,
          },
        });
    });
    
    res.json({
      success: true,
      data: adminsWithAnalytics
    });
  } catch (error) {
    console.error('Get admins analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admin analytics' });
  }
};

// Get detailed analytics for a specific admin
export const getAdminAnalytics = async (req, res) => {
  try {
    const { adminId } = req.params;
    
    // Verify admin exists
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    // Get all exam results for this admin
    const examResults = await ExamResult.find({ adminId })
      .populate('userId', 'fullName email')
      .populate('examId', 'title subject')
      .sort({ completedAt: -1 });
    
    // Get all students assigned to this admin
    const students = await User.find({ role: 'student', assignedAdmin: adminId })
      .select('fullName email createdAt');
    
    // Get all teachers for this admin
    const teachers = await Teacher.find({ adminId })
      .select('fullName email department subjects createdAt');
    
    // Calculate comprehensive analytics
    const totalExamsTaken = examResults.length;
    const totalStudents = students.length;
    const totalTeachers = teachers.length;
    
    // Performance metrics
    const totalQuestionsAnswered = examResults.reduce((sum, result) => sum + result.totalQuestions, 0);
    const totalCorrectAnswers = examResults.reduce((sum, result) => sum + result.correctAnswers, 0);
    const totalMarksObtained = examResults.reduce((sum, result) => sum + result.obtainedMarks, 0);
    const totalMarksPossible = examResults.reduce((sum, result) => sum + result.totalMarks, 0);
    
    const averageScore = totalMarksPossible > 0 ? (totalMarksObtained / totalMarksPossible * 100).toFixed(1) : 0;
    const averageAccuracy = totalQuestionsAnswered > 0 ? (totalCorrectAnswers / totalQuestionsAnswered * 100).toFixed(1) : 0;
    
    // Student performance analysis
    const studentPerformance = {};
    examResults.forEach(result => {
      const studentId = result.userId._id.toString();
      if (!studentPerformance[studentId]) {
        studentPerformance[studentId] = {
          studentName: result.userId.fullName,
          studentEmail: result.userId.email,
          totalExams: 0,
          totalMarks: 0,
          totalPossibleMarks: 0,
          examHistory: []
        };
      }
      studentPerformance[studentId].totalExams += 1;
      studentPerformance[studentId].totalMarks += result.obtainedMarks;
      studentPerformance[studentId].totalPossibleMarks += result.totalMarks;
      studentPerformance[studentId].examHistory.push({
        examTitle: result.examTitle,
        score: result.percentage,
        marks: `${result.obtainedMarks}/${result.totalMarks}`,
        completedAt: result.completedAt
      });
    });
    
    // Calculate average scores for each student
    Object.values(studentPerformance).forEach(student => {
      student.averageScore = student.totalPossibleMarks > 0 
        ? (student.totalMarks / student.totalPossibleMarks * 100).toFixed(1)
        : 0;
    });
    
    // Sort students by performance
    const topPerformers = Object.values(studentPerformance)
      .sort((a, b) => parseFloat(b.averageScore) - parseFloat(a.averageScore))
      .slice(0, 10);
    
    // Subject-wise analysis
    const subjectAnalysis = {};
    examResults.forEach(result => {
      if (result.subjectWiseScore) {
        Object.entries(result.subjectWiseScore).forEach(([subject, data]) => {
          if (!subjectAnalysis[subject]) {
            subjectAnalysis[subject] = {
              totalQuestions: 0,
              correctAnswers: 0,
              totalMarks: 0,
              obtainedMarks: 0,
              examCount: 0
            };
          }
          subjectAnalysis[subject].totalQuestions += data.total || 0;
          subjectAnalysis[subject].correctAnswers += data.correct || 0;
          subjectAnalysis[subject].obtainedMarks += data.marks || 0;
          subjectAnalysis[subject].totalMarks += data.total || 0;
          subjectAnalysis[subject].examCount += 1;
        });
      }
    });
    
    // Calculate subject-wise averages (accuracy-based; marks field is obtained-only)
    const subjectAnalytics = Object.entries(subjectAnalysis).map(([subject, data]) => ({
      subject,
      accuracy: data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions * 100).toFixed(1) : 0,
      averageScore: data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions * 100).toFixed(1) : 0,
      totalQuestions: data.totalQuestions,
      correctAnswers: data.correctAnswers,
      examCount: data.examCount,
      obtainedMarks: data.obtainedMarks,
    }));
    
    // Recent activity
    const recentActivity = examResults.slice(0, 20).map(result => ({
      type: 'exam_completed',
      studentName: result.userId.fullName,
      examTitle: result.examTitle,
      score: result.percentage,
      completedAt: result.completedAt
    }));
    
    res.json({
      success: true,
      data: {
        admin: {
          id: admin._id,
          name: admin.fullName,
          email: admin.email,
          joinDate: admin.createdAt
        },
        overview: {
          totalStudents,
          totalTeachers,
          totalExamsTaken,
          averageScore,
          averageAccuracy,
          totalQuestionsAnswered,
          totalCorrectAnswers,
          totalMarksObtained,
          totalMarksPossible
        },
        topPerformers,
        subjectAnalytics,
        recentActivity,
        allStudents: students,
        allTeachers: teachers
      }
    });
  } catch (error) {
    console.error('Get admin analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admin analytics' });
  }
};

// Full school / admin profile + stats + Razorpay billing scoped to admin email
export const getAdminSchoolDetail = async (req, res) => {
  try {
    const { adminId } = req.params;
    if (!adminId) {
      return res.status(400).json({ success: false, message: 'School id is required' });
    }

    const { admin, school } = await resolveSchoolAndAdminByParamId(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const [assignedStudents, examStudentIds, teacherCount] = await Promise.all([
      User.find({ role: 'student', assignedAdmin: admin._id }).select('_id').lean(),
      ExamResult.distinct('userId', { adminId: admin._id, userId: { $ne: null } }),
      Teacher.countDocuments({ adminId: admin._id }),
    ]);
    const studentCount = new Set([
      ...assignedStudents.map((s) => s._id.toString()),
      ...examStudentIds.map((id) => id.toString()),
    ]).size;

    const sd =
      admin.schoolDetails && typeof admin.schoolDetails.toObject === 'function'
        ? admin.schoolDetails.toObject()
        : admin.schoolDetails || {};

    const displayBoard = resolveUserDisplayBoard(admin, null);
    const schoolLean = school && typeof school.toObject === 'function' ? school.toObject() : school;

    const profile = {
      id: admin._id,
      name: admin.fullName,
      email: admin.email,
      board: displayBoard || admin.board,
      schoolName: admin.schoolName,
      schoolLogo: admin.schoolLogo,
      contactPerson: admin.contactPerson,
      phone: admin.phone,
      secondaryContactPerson: admin.secondaryContactPerson,
      secondaryContactPhone: admin.secondaryContactPhone,
      place: admin.place,
      pin: admin.pin,
      state: sd.state || admin.place || '',
      schoolDetails: sd,
      permissions: admin.permissions || [],
      vidyaEnabledForTeachers: admin.vidyaEnabledForTeachers !== false,
      vidyaEnabledForStudents: admin.vidyaEnabledForStudents !== false,
      vidyaUsageMode:
        String(admin.vidyaUsageMode || 'unlimited').toLowerCase() === 'limited'
          ? 'limited'
          : 'unlimited',
      vidyaLimitChatbot: Boolean(admin.vidyaLimitChatbot),
      vidyaLimitTools: Boolean(admin.vidyaLimitTools),
      vidyaChatPerDay: Math.max(1, Math.floor(Number(admin.vidyaChatPerDay) || 10)),
      vidyaGenerationsPerDay: Math.max(
        1,
        Math.floor(Number(admin.vidyaGenerationsPerDay) || 10)
      ),
      curriculumBoard:
        admin.curriculumBoard ||
        (isStoredCurriculumBoard(admin.board) ? String(admin.board).toUpperCase().trim() : 'CBSE'),
      isAsliPrepExclusive:
        admin.isAsliPrepExclusive === true || admin.board === 'ASLI_EXCLUSIVE_SCHOOLS',
      iitCategories: Array.isArray(admin.iitCategories) ? admin.iitCategories : [],
      iitCategoriesByClass:
        admin.iitCategoriesByClass && typeof admin.iitCategoriesByClass === 'object'
          ? admin.iitCategoriesByClass
          : {},
      status: admin.isActive ? 'Active' : 'Inactive',
      joinDate: admin.createdAt,
    };

    let billing = {
      razorpayConfigured: isRazorpayConfigured(),
      razorpayError: null,
      payments: [],
      subscriptions: [],
    };
    try {
      billing = await fetchBillingForAdminEmail(admin.email);
    } catch (err) {
      billing.razorpayError = err.message || 'Billing lookup failed';
    }

    res.json({
      success: true,
      data: {
        profile,
        stats: {
          students: studentCount,
          teachers: teacherCount,
          licensedStudents: Math.max(
            0,
            Math.floor(Number(schoolLean?.licensedStudents ?? admin.licensedStudents ?? 0) || 0)
          ),
          licensedTeachers: Math.max(
            0,
            Math.floor(Number(schoolLean?.licensedTeachers ?? admin.licensedTeachers ?? 0) || 0)
          ),
          accountSeatsNotes: String(
            schoolLean?.accountSeatsNotes ?? admin.accountSeatsNotes ?? ''
          ).trim(),
        },
        billing,
      },
    });
  } catch (error) {
    console.error('Get admin school detail error:', error);
    res.status(500).json({ success: false, message: 'Failed to load school details' });
  }
};

/** Manual entry: licensed teacher/student account seats for a school */
export const updateAdminAccountSeats = async (req, res) => {
  try {
    const { adminId } = req.params;
    if (!adminId) {
      return res.status(400).json({ success: false, message: 'School id is required' });
    }

    const { admin, school } = await resolveSchoolAndAdminByParamId(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const seats = normalizeAccountSeats(req.body);
    if (
      (seats.licensedStudents !== null && Number.isNaN(seats.licensedStudents)) ||
      (seats.licensedTeachers !== null && Number.isNaN(seats.licensedTeachers))
    ) {
      return res.status(400).json({
        success: false,
        message: 'Licensed student and teacher counts must be non-negative whole numbers',
      });
    }

    if (
      seats.licensedStudents === null &&
      seats.licensedTeachers === null &&
      seats.accountSeatsNotes === null
    ) {
      return res.status(400).json({
        success: false,
        message: 'Provide licensedStudents, licensedTeachers, and/or accountSeatsNotes',
      });
    }

    const schoolPatch = {};
    const userPatch = {};
    if (seats.licensedStudents !== null) {
      schoolPatch.licensedStudents = seats.licensedStudents;
      userPatch.licensedStudents = seats.licensedStudents;
    }
    if (seats.licensedTeachers !== null) {
      schoolPatch.licensedTeachers = seats.licensedTeachers;
      userPatch.licensedTeachers = seats.licensedTeachers;
    }
    if (seats.accountSeatsNotes !== null) {
      schoolPatch.accountSeatsNotes = seats.accountSeatsNotes;
      userPatch.accountSeatsNotes = seats.accountSeatsNotes;
    }

    let updatedSchool = school;
    if (school) {
      updatedSchool = await School.findByIdAndUpdate(school._id, schoolPatch, {
        new: true,
        runValidators: true,
      });
    } else if (Object.keys(schoolPatch).length) {
      // Orphan admin without schools row — still persist on user; create thin school if possible
      updatedSchool = await School.create({
        name: admin.schoolName || admin.fullName || admin.email || 'School',
        adminUserId: admin._id,
        board: admin.board || 'ASLI_EXCLUSIVE_SCHOOLS',
        curriculumBoard: admin.curriculumBoard || 'CBSE',
        isAsliPrepExclusive: Boolean(admin.isAsliPrepExclusive),
        schoolDetails: normalizeSchoolDetails(admin.schoolDetails),
        ...schoolPatch,
      });
      userPatch.schoolId = updatedSchool._id;
    }

    const updatedAdmin = await User.findByIdAndUpdate(admin._id, userPatch, {
      new: true,
      runValidators: false,
    }).select('-password');

    const [assignedStudents, examStudentIds, teacherCount] = await Promise.all([
      User.find({ role: 'student', assignedAdmin: admin._id }).select('_id').lean(),
      ExamResult.distinct('userId', { adminId: admin._id, userId: { $ne: null } }),
      Teacher.countDocuments({ adminId: admin._id }),
    ]);
    const studentCount = new Set([
      ...assignedStudents.map((s) => s._id.toString()),
      ...examStudentIds.map((id) => id.toString()),
    ]).size;

    res.json({
      success: true,
      message: 'Account seats updated',
      data: {
        id: updatedAdmin._id.toString(),
        schoolId: updatedSchool?._id?.toString(),
        licensedStudents: Math.max(
          0,
          Math.floor(
            Number(
              updatedSchool?.licensedStudents ?? updatedAdmin.licensedStudents ?? 0
            ) || 0
          )
        ),
        licensedTeachers: Math.max(
          0,
          Math.floor(
            Number(
              updatedSchool?.licensedTeachers ?? updatedAdmin.licensedTeachers ?? 0
            ) || 0
          )
        ),
        accountSeatsNotes: String(
          updatedSchool?.accountSeatsNotes ?? updatedAdmin.accountSeatsNotes ?? ''
        ).trim(),
        usedStudents: studentCount,
        usedTeachers: teacherCount,
      },
    });
  } catch (error) {
    console.error('Update admin account seats error:', error);
    res.status(500).json({ success: false, message: 'Failed to update account seats' });
  }
};

// Create New Admin (creates schools row + admin login user)
export const createAdmin = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      permissions,
      vidyaEnabledForTeachers,
      vidyaEnabledForStudents,
      board,
      isAsliPrepExclusive: rawExclusive,
      schoolName,
      schoolLogo,
      contactPerson,
      phone,
      secondaryContactPerson,
      secondaryContactPhone,
      place,
      pin,
      state,
      schoolDetails: rawSchoolDetails
    } = req.body;

    const { schoolVidyaPolicyFromBody } = await import('../utils/schoolVidyaLimits.js');
    const vidyaPolicy = schoolVidyaPolicyFromBody(req.body);
    if (
      String(req.body.vidyaUsageMode || '').toLowerCase() === 'limited' &&
      !vidyaPolicy.vidyaLimitChatbot &&
      !vidyaPolicy.vidyaLimitTools
    ) {
      return res.status(400).json({
        success: false,
        message:
          'When Vidya is Limited, select Chatbot and/or AI Tools and set the daily limits.',
      });
    }
    
    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and email are required' 
      });
    }

    const plainPassword = String(password || '').trim();
    if (!plainPassword || plainPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 6 characters',
      });
    }
    
    const curriculumUpper = (board || '').toUpperCase().trim();
    if (!isValidCurriculumBoard(curriculumUpper)) {
      return res.status(400).json({
        success: false,
        message: `Board (curriculum) must be one of: ${CURRICULUM_BOARDS.join(', ')}`,
      });
    }
    const exclusive =
      rawExclusive === undefined || rawExclusive === null ? false : Boolean(rawExclusive);
    const finalBoard = resolveAdminStoredBoard(exclusive, curriculumUpper);
    
    if (!schoolName || schoolName.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'School name is required' 
      });
    }

    const schoolFields = buildSchoolFieldsFromBody(req.body);
    if (!schoolFields.name) {
      return res.status(400).json({ success: false, message: 'School name is required' });
    }
    if (!schoolFields.schoolDetails.city || !schoolFields.schoolDetails.district || !schoolFields.schoolDetails.state) {
      return res.status(400).json({
        success: false,
        message: 'City, district, and state are required for school information'
      });
    }

    if (!isValidSchoolPlaceName(schoolFields.name, { min: 2, max: 200 })) {
      return res.status(400).json({
        success: false,
        message: 'School name must be 2–200 characters and include letters (symbols-only names are not allowed)',
      });
    }
    if (!isValidSchoolPlaceName(schoolFields.schoolDetails.city, { min: 2, max: 100 })) {
      return res.status(400).json({
        success: false,
        message: 'City must be 2–100 characters and include letters',
      });
    }
    if (!isValidSchoolPlaceName(schoolFields.schoolDetails.district, { min: 2, max: 100 })) {
      return res.status(400).json({
        success: false,
        message: 'District must be 2–100 characters and include letters',
      });
    }
    // Validate raw pin from the request — normalized schoolFields.pin may have been cleared.
    if (!isValidOptionalIndianPincode(req.body?.pin)) {
      return res.status(400).json({
        success: false,
        message:
          'Pincode must be exactly 6 digits (Indian PIN, e.g. 500001), or left empty. Longer or non-numeric values are not allowed',
      });
    }
    if (
      !isValidOptionalAddressLine(schoolFields.schoolDetails.doorNo) ||
      !isValidOptionalAddressLine(schoolFields.schoolDetails.street) ||
      !isValidOptionalAddressLine(schoolFields.schoolDetails.area)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Door No, Street, and Area may only use letters, numbers, and common punctuation',
      });
    }

    if (
      !isValidOptionalPhoneTenDigits(schoolFields.phone) ||
      !isValidOptionalPhoneTenDigits(schoolFields.secondaryContactPhone)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Phone numbers must be exactly 10 digits, or left empty',
      });
    }

    // Never auto-delete an existing user to "free" an email — that wiped students/teachers before.
    const emailLower = email.toLowerCase().trim();
    const existingAdmin = await User.findOne({ email: emailLower });
    if (existingAdmin) {
      if (existingAdmin.role === 'admin' && existingAdmin.isActive !== false) {
        return res.status(400).json({
          success: false,
          message: 'Admin with this email already exists',
          hint: 'Update the existing school instead of creating a new one. Do not delete and recreate — that removes students.',
        });
      }
      if (existingAdmin.role === 'admin' && existingAdmin.isActive === false) {
        return res.status(409).json({
          success: false,
          message: 'An inactive school admin already uses this email',
          hint: 'Reactivate that school from Super Admin (set Active), or use a different admin email. Recreating after delete is blocked to protect student data.',
          existingAdminId: String(existingAdmin._id),
        });
      }
      return res.status(400).json({
        success: false,
        message: `Email is already used by a ${existingAdmin.role || 'user'} account`,
        hint: 'Choose a different admin login email. Existing accounts are never deleted automatically.',
      });
    }
    
    const hashedPassword = await bcrypt.hash(plainPassword, 12);

    const school = await School.create({
      ...schoolFields,
      contactPerson: schoolFields.contactPerson || name.trim(),
      isActive: true,
      vidyaUsageMode: vidyaPolicy.vidyaUsageMode,
      vidyaLimitChatbot: vidyaPolicy.vidyaLimitChatbot,
      vidyaLimitTools: vidyaPolicy.vidyaLimitTools,
      vidyaChatPerDay: vidyaPolicy.vidyaChatPerDay,
      vidyaGenerationsPerDay: vidyaPolicy.vidyaGenerationsPerDay,
    });

    const newAdmin = new User({
      fullName: name.trim(),
      email: emailLower,
      password: hashedPassword,
      role: 'admin',
      permissions: permissions || [],
      vidyaEnabledForTeachers: vidyaEnabledForTeachers !== false,
      vidyaEnabledForStudents: vidyaEnabledForStudents !== false,
      vidyaUsageMode: vidyaPolicy.vidyaUsageMode,
      vidyaLimitChatbot: vidyaPolicy.vidyaLimitChatbot,
      vidyaLimitTools: vidyaPolicy.vidyaLimitTools,
      vidyaChatPerDay: vidyaPolicy.vidyaChatPerDay,
      vidyaGenerationsPerDay: vidyaPolicy.vidyaGenerationsPerDay,
      isActive: true,
    });
    applySchoolToAdminUser(newAdmin, school);
    await newAdmin.save();

    school.adminUserId = newAdmin._id;
    await school.save();

    console.log('School + admin created:', {
      schoolId: school._id,
      adminId: newAdmin._id,
      email: newAdmin.email,
      schoolName: school.name,
    });

    req.setAudit?.({
      action: 'school.create',
      summary: `Created school ${school.name} (admin ${newAdmin.email})`,
      target: {
        type: 'school',
        id: String(school._id),
        label: school.name,
        email: newAdmin.email,
      },
      meta: { adminId: String(newAdmin._id) },
    });

    res.json({
      success: true,
      message: 'School and admin created successfully',
      data: formatSchoolListItem(school.toObject(), newAdmin.toObject(), {
        students: 0,
        teachers: 0,
        videos: 0,
        assessments: 0,
        exams: 0,
      }),
    });
  } catch (error) {
    console.error('Create admin error:', error);
    console.error('Create admin error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create admin';
    
    if (error.name === 'ValidationError') {
      errorMessage = `Validation error: ${Object.values(error.errors).map((e) => e.message).join(', ')}`;
    } else if (error.code === 11000) {
      // Duplicate key error (MongoDB)
      errorMessage = 'An admin with this email already exists';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      success: false, 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update Admin (syncs schools collection + admin login user)
export const updateAdmin = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      permissions,
      vidyaEnabledForTeachers,
      vidyaEnabledForStudents,
      isActive,
      board,
      isAsliPrepExclusive,
      schoolName,
      schoolDetails: rawSchoolDetails,
    } = req.body;
    const paramId = req.params.id;

    console.log('📝 Updating admin:', paramId, { name, email, board, schoolName, isActive });

    const { admin, school } = await resolveSchoolAndAdminByParamId(paramId);
    if (!admin) {
      console.error('Admin not found for param:', paramId);
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const adminId = admin._id.toString();
    const userUpdate = {};

    if (name !== undefined && name !== null && name.trim() !== '') {
      userUpdate.fullName = name.trim();
    }
    if (email !== undefined && email !== null && email.trim() !== '') {
      const emailLower = email.toLowerCase().trim();
      if (emailLower !== admin.email.toLowerCase()) {
        const existingUser = await User.findOne({ email: emailLower });
        if (existingUser && existingUser._id.toString() !== adminId) {
          return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        userUpdate.email = emailLower;
      }
    }
    if (permissions !== undefined) userUpdate.permissions = permissions;
    if (vidyaEnabledForTeachers !== undefined) {
      userUpdate.vidyaEnabledForTeachers = Boolean(vidyaEnabledForTeachers);
    }
    if (vidyaEnabledForStudents !== undefined) {
      userUpdate.vidyaEnabledForStudents = Boolean(vidyaEnabledForStudents);
    }

    const vidyaPolicyTouched =
      req.body.vidyaUsageMode !== undefined ||
      req.body.vidyaLimitChatbot !== undefined ||
      req.body.vidyaLimitTools !== undefined ||
      req.body.vidyaChatPerDay !== undefined ||
      req.body.vidyaGenerationsPerDay !== undefined;
    if (vidyaPolicyTouched) {
      const { schoolVidyaPolicyFromBody } = await import('../utils/schoolVidyaLimits.js');
      const vidyaPolicy = schoolVidyaPolicyFromBody({
        vidyaUsageMode: req.body.vidyaUsageMode ?? admin.vidyaUsageMode,
        vidyaLimitChatbot:
          req.body.vidyaLimitChatbot !== undefined
            ? req.body.vidyaLimitChatbot
            : admin.vidyaLimitChatbot,
        vidyaLimitTools:
          req.body.vidyaLimitTools !== undefined
            ? req.body.vidyaLimitTools
            : admin.vidyaLimitTools,
        vidyaChatPerDay: req.body.vidyaChatPerDay ?? admin.vidyaChatPerDay,
        vidyaGenerationsPerDay:
          req.body.vidyaGenerationsPerDay ?? admin.vidyaGenerationsPerDay,
      });
      if (
        String(req.body.vidyaUsageMode || '').toLowerCase() === 'limited' &&
        !vidyaPolicy.vidyaLimitChatbot &&
        !vidyaPolicy.vidyaLimitTools
      ) {
        return res.status(400).json({
          success: false,
          message:
            'When Vidya is Limited, select Chatbot and/or AI Tools and set the daily limits.',
        });
      }
      userUpdate.vidyaUsageMode = vidyaPolicy.vidyaUsageMode;
      userUpdate.vidyaLimitChatbot = vidyaPolicy.vidyaLimitChatbot;
      userUpdate.vidyaLimitTools = vidyaPolicy.vidyaLimitTools;
      userUpdate.vidyaChatPerDay = vidyaPolicy.vidyaChatPerDay;
      userUpdate.vidyaGenerationsPerDay = vidyaPolicy.vidyaGenerationsPerDay;
    }

    if (isActive !== undefined) userUpdate.isActive = Boolean(isActive);

    if (password !== undefined && password !== null && String(password).trim() !== '') {
      const plainPassword = String(password).trim();
      if (plainPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters',
        });
      }
      userUpdate.password = await bcrypt.hash(plainPassword, 12);
    }

    const schoolProfileTouched =
      schoolName !== undefined ||
      req.body.schoolLogo !== undefined ||
      req.body.contactPerson !== undefined ||
      req.body.phone !== undefined ||
      req.body.secondaryContactPerson !== undefined ||
      req.body.secondaryContactPhone !== undefined ||
      req.body.pin !== undefined ||
      rawSchoolDetails !== undefined ||
      req.body.state !== undefined ||
      board !== undefined ||
      isAsliPrepExclusive !== undefined ||
      req.body.licensedStudents !== undefined ||
      req.body.licensedTeachers !== undefined ||
      req.body.accountSeatsNotes !== undefined;

    let updatedSchool = school;

    if (schoolProfileTouched) {
      if (board !== undefined && board !== null && String(board).trim() !== '') {
        const cu = String(board).toUpperCase().trim();
        if (!isValidCurriculumBoard(cu)) {
          return res.status(400).json({
            success: false,
            message: `Board (curriculum) must be one of: ${CURRICULUM_BOARDS.join(', ')}`,
          });
        }
      }

      const schoolFields = buildSchoolFieldsFromBody(req.body);
      if (schoolName !== undefined && schoolName !== null && !schoolFields.name) {
        return res.status(400).json({ success: false, message: 'School name is required' });
      }
      if (
        !schoolFields.schoolDetails.city ||
        !schoolFields.schoolDetails.district ||
        !schoolFields.schoolDetails.state
      ) {
        return res.status(400).json({
          success: false,
          message: 'City, district, and state are required for school information',
        });
      }
      if (schoolFields.name && !isValidSchoolPlaceName(schoolFields.name, { min: 2, max: 200 })) {
        return res.status(400).json({
          success: false,
          message: 'School name must be 2–200 characters and include letters (symbols-only names are not allowed)',
        });
      }
      if (!isValidSchoolPlaceName(schoolFields.schoolDetails.city, { min: 2, max: 100 })) {
        return res.status(400).json({
          success: false,
          message: 'City must be 2–100 characters and include letters',
        });
      }
      if (!isValidSchoolPlaceName(schoolFields.schoolDetails.district, { min: 2, max: 100 })) {
        return res.status(400).json({
          success: false,
          message: 'District must be 2–100 characters and include letters',
        });
      }
      if (req.body?.pin !== undefined && !isValidOptionalIndianPincode(req.body.pin)) {
        return res.status(400).json({
          success: false,
          message:
            'Pincode must be exactly 6 digits (Indian PIN, e.g. 500001), or left empty. Longer or non-numeric values are not allowed',
        });
      }
      if (
        !isValidOptionalAddressLine(schoolFields.schoolDetails.doorNo) ||
        !isValidOptionalAddressLine(schoolFields.schoolDetails.street) ||
        !isValidOptionalAddressLine(schoolFields.schoolDetails.area)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Door No, Street, and Area may only use letters, numbers, and common punctuation',
        });
      }
      if (
        !isValidOptionalPhoneTenDigits(schoolFields.phone) ||
        !isValidOptionalPhoneTenDigits(schoolFields.secondaryContactPhone)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Phone numbers must be exactly 10 digits, or left empty',
        });
      }
      if (isActive !== undefined) {
        schoolFields.isActive = Boolean(isActive);
      }

      if (school) {
        updatedSchool = await School.findByIdAndUpdate(school._id, schoolFields, {
          new: true,
          runValidators: true,
        });
      } else {
        updatedSchool = await School.create({
          ...schoolFields,
          adminUserId: admin._id,
          contactPerson: schoolFields.contactPerson || admin.fullName || '',
          isActive: isActive !== undefined ? Boolean(isActive) : admin.isActive !== false,
        });
        if (!admin.schoolId) {
          userUpdate.schoolId = updatedSchool._id;
        }
      }

      applySchoolToAdminUser(userUpdate, updatedSchool);
    } else if (isActive !== undefined && school) {
      updatedSchool = await School.findByIdAndUpdate(
        school._id,
        { isActive: Boolean(isActive) },
        { new: true }
      );
    }

    if (vidyaPolicyTouched && (updatedSchool || school)) {
      const schoolId = (updatedSchool || school)._id;
      updatedSchool = await School.findByIdAndUpdate(
        schoolId,
        {
          vidyaUsageMode: userUpdate.vidyaUsageMode,
          vidyaLimitChatbot: userUpdate.vidyaLimitChatbot,
          vidyaLimitTools: userUpdate.vidyaLimitTools,
          vidyaChatPerDay: userUpdate.vidyaChatPerDay,
          vidyaGenerationsPerDay: userUpdate.vidyaGenerationsPerDay,
        },
        { new: true }
      );
    }

    console.log('Update data:', userUpdate);

    const updatedAdmin = await User.findByIdAndUpdate(adminId, userUpdate, {
      new: true,
      runValidators: false,
    });

    if (!updatedAdmin) {
      return res.status(500).json({ success: false, message: 'Failed to update admin' });
    }

    console.log('✅ Admin updated successfully:', updatedAdmin.email, updatedAdmin.board);
    if (updatedSchool) {
      console.log('✅ School record synced:', updatedSchool.name, updatedSchool._id);
    }

    const boardSyncFields = {};
    if (userUpdate.board !== undefined) boardSyncFields.board = userUpdate.board;
    if (userUpdate.curriculumBoard !== undefined) {
      boardSyncFields.curriculumBoard = userUpdate.curriculumBoard;
    }
    if (userUpdate.isAsliPrepExclusive !== undefined) {
      boardSyncFields.isAsliPrepExclusive = userUpdate.isAsliPrepExclusive;
    }
    if (Object.keys(boardSyncFields).length > 0) {
      const studentSync = await User.updateMany(
        { role: 'student', assignedAdmin: adminId },
        { $set: boardSyncFields }
      );
      console.log(
        `📋 Synced board fields to ${studentSync.modifiedCount} student(s) for admin ${adminId}`
      );
    }

    const schoolLean = updatedSchool?.toObject?.() || updatedSchool;
    const adminLean = updatedAdmin.toObject();

    res.json({
      success: true,
      message: 'Admin updated successfully',
      data: formatSchoolListItem(schoolLean, adminLean),
    });
  } catch (error) {
    console.error('❌ Update admin error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to update admin', error: error.message });
  }
};

// Delete / deactivate school admin.
// Default = soft deactivate (keeps students/teachers/classes).
// Hard wipe only with ?hard=1 and body.confirmEmail matching the admin email.
export const deleteAdmin = async (req, res) => {
  try {
    const paramId = req.params.id;
    const { admin, school } = await resolveSchoolAndAdminByParamId(paramId);

    if (!admin && !school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const adminId = admin?._id?.toString() || school?.adminUserId?.toString();
    const adminEmail = admin?.email || school?.name || 'unknown';
    const hard =
      String(req.query.hard || req.body?.hard || '').toLowerCase() === '1' ||
      req.body?.hardDelete === true ||
      String(req.body?.mode || '').toLowerCase() === 'hard';

    const studentCount = adminId
      ? await User.countDocuments({ role: 'student', assignedAdmin: adminId })
      : 0;
    const teacherCount = adminId
      ? await (await import('../models/Teacher.js')).default.countDocuments({ adminId })
      : 0;

    // Soft deactivate by default — preserves all school data
    if (!hard) {
      if (adminId) {
        await User.findByIdAndUpdate(adminId, { $set: { isActive: false } });
      }
      if (school?._id) {
        await School.findByIdAndUpdate(school._id, { $set: { isActive: false } });
      } else if (adminId) {
        await School.updateMany({ adminUserId: adminId }, { $set: { isActive: false } });
      }

      req.setAudit?.({
        action: 'school.deactivate',
        summary: `Deactivated school ${school?.name || adminEmail} (students preserved: ${studentCount})`,
        target: {
          type: 'school',
          id: String(school?._id || adminId || ''),
          label: school?.name || adminEmail,
          email: admin?.email || null,
        },
        meta: { soft: true, studentCount, teacherCount, adminId },
      });

      return res.json({
        success: true,
        soft: true,
        message:
          `School deactivated. ${studentCount} student(s) and ${teacherCount} teacher(s) were kept. ` +
          `Reactivate from Super Admin instead of creating a new school with the same email.`,
        deletedEmail: null,
        preserved: { students: studentCount, teachers: teacherCount },
      });
    }

    // Permanent school wipes are disabled. A school may be deactivated and
    // later reactivated, but its students and academic history must survive.
    req.setAudit?.({
      action: 'school.hard_delete_blocked',
      summary: `Blocked permanent deletion of school ${school?.name || adminEmail}`,
      target: {
        type: 'school',
        id: String(school?._id || adminId || ''),
        label: school?.name || adminEmail,
        email: admin?.email || null,
      },
      meta: { studentCount, teacherCount, adminId },
    });
    return res.status(410).json({
      success: false,
      message: 'Permanent school deletion is disabled. Deactivate the school to preserve all data.',
      preserved: { students: studentCount, teachers: teacherCount },
    });

    const confirmEmail = String(req.body?.confirmEmail || req.query.confirmEmail || '')
      .trim()
      .toLowerCase();
    if (!admin?.email || confirmEmail !== String(admin.email).toLowerCase()) {
      return res.status(400).json({
        success: false,
        message:
          `Hard delete blocked. Send confirmEmail=${admin?.email || 'admin-email'} and hard=1 to permanently wipe ` +
          `${studentCount} student(s) and ${teacherCount} teacher(s). Prefer soft deactivate (default DELETE).`,
        studentCount,
        teacherCount,
      });
    }

    console.log(
      `🗑️ HARD deletion of school: ${adminEmail} (param: ${paramId}, admin: ${adminId || 'none'}, school: ${school?._id || 'none'}, students: ${studentCount})`
    );

    if (!adminId) {
      if (school?._id) {
        await deleteSchoolById(school._id);
      }
      return res.json({
        success: true,
        message: 'School record deleted successfully',
        deletedEmail: adminEmail,
      });
    }
    
    // Import all required models
    const Teacher = (await import('../models/Teacher.js')).default;
    const Video = (await import('../models/Video.js')).default;
    const Assessment = (await import('../models/Assessment.js')).default;
    const Exam = (await import('../models/Exam.js')).default;
    const ExamResult = (await import('../models/ExamResult.js')).default;
    const Question = (await import('../models/Question.js')).default;
    const Class = (await import('../models/Class.js')).default;
    const Stream = (await import('../models/Stream.js')).default;
    
    // Get all exams created by this admin to delete their results and questions
    const adminExams = await Exam.find({ adminId: adminId });
    const examIds = adminExams.map(exam => exam._id);
    
    // Delete all related data in parallel
    const deletionResults = await Promise.all([
      // Delete all students assigned to this admin
      User.deleteMany({ role: 'student', assignedAdmin: adminId }),
      // Delete all teachers assigned to this admin
      Teacher.deleteMany({ adminId }),
      // Delete all videos created by this admin
      Video.deleteMany({ adminId }),
      // Delete all assessments created by this admin
      Assessment.deleteMany({ adminId }),
      // Delete all exams created by this admin
      Exam.deleteMany({ adminId }),
      // Delete all exam results for exams created by this admin
      ExamResult.deleteMany({ adminId }),
      // Also delete exam results for the specific exams
      ExamResult.deleteMany({ examId: { $in: examIds } }),
      // Delete all questions created by this admin
      Question.deleteMany({ adminId }),
      // Delete all classes assigned to this admin
      Class.deleteMany({ assignedAdmin: adminId }),
      // Delete all streams created by this admin
      Stream.deleteMany({ adminId }),
      // Finally, delete the admin login user
      User.deleteOne({ _id: adminId }),
      // Remove canonical school row from schools collection
      school?._id
        ? School.deleteOne({ _id: school._id })
        : School.deleteOne({ adminUserId: adminId }),
    ]);
    
    // Verify the admin was actually deleted
    const verifyDeletion = await User.findById(adminId);
    if (verifyDeletion) {
      console.error(`❌ WARNING: Admin ${adminId} still exists after deletion attempt!`);
      // Force delete using deleteOne
      await User.deleteOne({ _id: adminId });
    }
    
    // Also verify by email to ensure no duplicate exists
    const verifyByEmail = await User.findOne({ email: adminEmail.toLowerCase() });
    if (verifyByEmail && verifyByEmail._id.toString() === adminId) {
      console.error(`❌ WARNING: Admin with email ${adminEmail} still exists! Force deleting...`);
      await User.deleteOne({ email: adminEmail.toLowerCase() });
    }
    
    console.log(`✅ Successfully HARD-deleted school (admin) ${adminId} (${adminEmail}) and all associated data`);
    console.log(`   Deleted: ${deletionResults[0].deletedCount} students, ${deletionResults[1].deletedCount} teachers, ${deletionResults[2].deletedCount} videos`);

    req.setAudit?.({
      action: 'school.delete.hard',
      summary: `HARD-deleted school ${school?.name || adminEmail} (${deletionResults[0].deletedCount} students wiped)`,
      target: {
        type: 'school',
        id: String(school?._id || adminId),
        label: school?.name || adminEmail,
        email: adminEmail,
      },
      meta: {
        hard: true,
        studentsDeleted: deletionResults[0].deletedCount,
        teachersDeleted: deletionResults[1].deletedCount,
      },
    });
    
    res.json({
      success: true,
      hard: true,
      message: 'School and all associated data (students, teachers, exams, results, content) deleted successfully',
      deletedEmail: adminEmail // Return email so frontend knows it can be reused
    });
  } catch (error) {
    console.error('Delete school error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete school', error: error.message });
  }
};

// Get All Users (Global view)
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .populate('assignedAdmin', 'fullName email')
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
};

// Migrate all boards to ASLI_EXCLUSIVE_SCHOOLS
export const migrateAllBoards = async (req, res) => {
  try {
    console.log('🔄 Starting board migration to ASLI_EXCLUSIVE_SCHOOLS...');
    
    const oldBoards = ['CBSE_AP', 'CBSE_TS', 'STATE_AP', 'STATE_TS'];
    const newBoard = 'ASLI_EXCLUSIVE_SCHOOLS';
    
    let results = {
      users: 0,
      teachers: 0,
      exams: 0,
      examResults: 0,
      content: 0,
      subjects: 0,
      classes: 0
    };

    // Update Users (admins and students)
    const userUpdate = await User.updateMany(
      { board: { $in: oldBoards } },
      { $set: { board: newBoard } },
      { runValidators: false }
    );
    results.users = userUpdate.modifiedCount;
    console.log(`✅ Updated ${results.users} users`);

    // Update Teachers
    const teacherUpdate = await Teacher.updateMany(
      { board: { $in: oldBoards } },
      { $set: { board: newBoard } },
      { runValidators: false }
    );
    results.teachers = teacherUpdate.modifiedCount;
    console.log(`✅ Updated ${results.teachers} teachers`);

    // Update Exams
    const examUpdate = await Exam.updateMany(
      { board: { $in: oldBoards } },
      { $set: { board: newBoard } },
      { runValidators: false }
    );
    results.exams = examUpdate.modifiedCount;
    console.log(`✅ Updated ${results.exams} exams`);

    // Update Exam Results
    const examResultUpdate = await ExamResult.updateMany(
      { board: { $in: oldBoards } },
      { $set: { board: newBoard } },
      { runValidators: false }
    );
    results.examResults = examResultUpdate.modifiedCount;
    console.log(`✅ Updated ${results.examResults} exam results`);

    // Update Content
    const contentUpdate = await Content.updateMany(
      { board: { $in: oldBoards } },
      { $set: { board: newBoard } },
      { runValidators: false }
    );
    results.content = contentUpdate.modifiedCount;
    console.log(`✅ Updated ${results.content} content items`);

    // Update Subjects
    const subjectUpdate = await Subject.updateMany(
      { board: { $in: oldBoards } },
      { $set: { board: newBoard } },
      { runValidators: false }
    );
    results.subjects = subjectUpdate.modifiedCount;
    console.log(`✅ Updated ${results.subjects} subjects`);

    // Update Classes
    const classUpdate = await Class.updateMany(
      { board: { $in: oldBoards } },
      { $set: { board: newBoard } },
      { runValidators: false }
    );
    results.classes = classUpdate.modifiedCount;
    console.log(`✅ Updated ${results.classes} classes`);

    const totalUpdated = Object.values(results).reduce((sum, count) => sum + count, 0);
    
    console.log(`✅ Migration completed! Total records updated: ${totalUpdated}`);
    
    res.json({
      success: true,
      message: 'All boards migrated to ASLI_EXCLUSIVE_SCHOOLS successfully',
      results,
      totalUpdated
    });
  } catch (error) {
    console.error('❌ Migration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to migrate boards', 
      error: error.message 
    });
  }
};

// Import subjects from existing content
export const importSubjectsFromContent = async (req, res) => {
  try {
    console.log('🔄 Starting subject import from content...');
    
    let results = {
      subjectsCreated: 0,
      subjectsSkipped: 0,
      contentUpdated: 0,
      errors: []
    };

    // Get all content items
    const allContent = await Content.find({ isActive: true })
      .populate('subject', 'name code classNumber description')
      .lean();

    console.log(`📚 Found ${allContent.length} content items`);

    // Map to store unique subjects by name + classNumber
    const subjectMap = new Map(); // key: "name_classNumber" -> subject data

    for (const content of allContent) {
      try {
        let subjectName = null;
        let subjectCode = null;
        let subjectClassNumber = null;
        let subjectDescription = null;
        let subjectId = null;

        // Try to get subject info from populated subject
        if (content.subject && content.subject._id) {
          subjectId = content.subject._id;
          subjectName = content.subject.name;
          subjectCode = content.subject.code;
          subjectClassNumber = content.subject.classNumber || content.classNumber;
          subjectDescription = content.subject.description;
        } else if (content.subject && typeof content.subject === 'object') {
          // Subject might be populated but not have _id (broken reference)
          subjectName = content.subject.name;
          subjectCode = content.subject.code;
          subjectClassNumber = content.subject.classNumber || content.classNumber;
          subjectDescription = content.subject.description;
        }

        // If we still don't have a name, skip this content
        if (!subjectName) {
          console.log(`⚠️  Content "${content.title}" has no subject name, skipping`);
          continue;
        }

        // Use classNumber from content if not from subject
        if (!subjectClassNumber && content.classNumber) {
          subjectClassNumber = content.classNumber;
        }

        // Create unique key
        const key = `${subjectName.toLowerCase().trim()}_${subjectClassNumber || 'none'}`;

        // Store subject info if not already stored
        if (!subjectMap.has(key)) {
          subjectMap.set(key, {
            name: subjectName,
            code: subjectCode,
            classNumber: subjectClassNumber,
            description: subjectDescription,
            originalId: subjectId,
            board: 'ASLI_EXCLUSIVE_SCHOOLS'
          });
        }
      } catch (error) {
        console.error(`❌ Error processing content "${content.title}":`, error.message);
        results.errors.push({
          content: content.title,
          error: error.message
        });
      }
    }

    console.log(`📋 Found ${subjectMap.size} unique subjects to process`);

    // For each unique subject, check if it exists, if not create it
    for (const [key, subjectData] of subjectMap.entries()) {
      try {
        // Check if subject already exists
        const existingSubject = await Subject.findOne({
          name: subjectData.name,
          classNumber: subjectData.classNumber || null,
          board: 'ASLI_EXCLUSIVE_SCHOOLS'
        });

        if (existingSubject) {
          console.log(`⏭️  Subject "${subjectData.name}" (Class ${subjectData.classNumber || 'N/A'}) already exists`);
          results.subjectsSkipped++;
          
          // Update content to reference this subject if it was referencing a different one
          if (subjectData.originalId && subjectData.originalId.toString() !== existingSubject._id.toString()) {
            const updateResult = await Content.updateMany(
              { subject: subjectData.originalId },
              { $set: { subject: existingSubject._id } }
            );
            if (updateResult.modifiedCount > 0) {
              results.contentUpdated += updateResult.modifiedCount;
              console.log(`   ↳ Updated ${updateResult.modifiedCount} content items to reference existing subject`);
            }
          }
          continue;
        }

        // Create new subject
        const newSubject = await Subject.create({
          name: subjectData.name,
          code: subjectData.code || null,
          classNumber: subjectData.classNumber || null,
          description: subjectData.description || null,
          board: 'ASLI_EXCLUSIVE_SCHOOLS',
          isActive: true,
          createdBy: 'super-admin'
        });

        console.log(`✅ Created subject: "${newSubject.name}" (Class ${newSubject.classNumber || 'N/A'})`);
        results.subjectsCreated++;

        // Update all content that was referencing the old subject ID (if any) to point to new subject
        if (subjectData.originalId) {
          const updateResult = await Content.updateMany(
            { subject: subjectData.originalId },
            { $set: { subject: newSubject._id } }
          );
          if (updateResult.modifiedCount > 0) {
            results.contentUpdated += updateResult.modifiedCount;
            console.log(`   ↳ Updated ${updateResult.modifiedCount} content items to reference new subject`);
          }
        } else {
          // If no original ID, find content by subject name and update
          // This handles cases where subject reference is broken
          const updateResult = await Content.updateMany(
            { 
              $or: [
                { 'subject.name': subjectData.name },
                { subject: null }
              ],
              classNumber: subjectData.classNumber || null
            },
            { $set: { subject: newSubject._id } }
          );
          if (updateResult.modifiedCount > 0) {
            results.contentUpdated += updateResult.modifiedCount;
            console.log(`   ↳ Updated ${updateResult.modifiedCount} content items to reference new subject`);
          }
        }

      } catch (error) {
        console.error(`❌ Error processing subject "${subjectData.name}":`, error.message);
        results.errors.push({
          subject: subjectData.name,
          error: error.message
        });
      }
    }

    console.log(`✅ Subject import completed!`);
    console.log(`   Created: ${results.subjectsCreated}`);
    console.log(`   Skipped: ${results.subjectsSkipped}`);
    console.log(`   Content Updated: ${results.contentUpdated}`);
    if (results.errors.length > 0) {
      console.log(`   Errors: ${results.errors.length}`);
    }
    
    res.json({
      success: true,
      message: 'Subjects imported from content successfully',
      results
    });
  } catch (error) {
    console.error('❌ Import subjects error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to import subjects from content', 
      error: error.message 
    });
  }
};

// Remove duplicate content and subjects
export const removeDuplicates = async (req, res) => {
  try {
    console.log('🔄 Starting duplicate removal for content and subjects...');
    
    let results = {
      contentRemoved: 0,
      subjectsRemoved: 0,
      contentKept: 0,
      subjectsKept: 0
    };

    // ===== DEDUPLICATE CONTENT =====
    // Group content by: title, type, subject, classNumber, topic
    // Keep the one with most views/downloads or most recent
    const allContent = await Content.find({ isActive: true })
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    const contentGroups = new Map();
    
    for (const content of allContent) {
      // Create a unique key based on identifying fields
      const key = `${content.title?.toLowerCase().trim()}_${content.type}_${content.subject?._id}_${content.classNumber || 'none'}_${content.topic || 'none'}`;
      
      if (!contentGroups.has(key)) {
        contentGroups.set(key, []);
      }
      contentGroups.get(key).push(content);
    }

    // For each group with duplicates, keep one and delete the rest
    for (const [key, contents] of contentGroups.entries()) {
      if (contents.length > 1) {
        // Sort by: views + downloadCount (desc), then createdAt (desc)
        contents.sort((a, b) => {
          const scoreA = (a.views || 0) + (a.downloadCount || 0);
          const scoreB = (b.views || 0) + (b.downloadCount || 0);
          if (scoreB !== scoreA) return scoreB - scoreA;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });

        // Keep the first one (best score/most recent)
        const toKeep = contents[0];
        const toDelete = contents.slice(1);

        // Delete duplicates
        const idsToDelete = toDelete.map(c => c._id);
        await Content.deleteMany({ _id: { $in: idsToDelete } });
        
        results.contentRemoved += toDelete.length;
        results.contentKept += 1;
        
        console.log(`✅ Content "${toKeep.title}": Kept 1, Removed ${toDelete.length} duplicates`);
      } else {
        results.contentKept += 1;
      }
    }

    // ===== DEDUPLICATE SUBJECTS =====
    // Group subjects by: name, classNumber
    // Keep the one with most content or most recent
    const allSubjects = await Subject.find({ isActive: true })
      .sort({ createdAt: -1 });

    const subjectGroups = new Map();
    
    for (const subject of allSubjects) {
      // Create a unique key based on name and classNumber
      const key = `${subject.name?.toLowerCase().trim()}_${subject.classNumber || 'none'}`;
      
      if (!subjectGroups.has(key)) {
        subjectGroups.set(key, []);
      }
      subjectGroups.get(key).push(subject);
    }

    // For each group with duplicates, keep one and delete the rest
    for (const [key, subjects] of subjectGroups.entries()) {
      if (subjects.length > 1) {
        // Count content for each subject
        const subjectsWithCounts = await Promise.all(
          subjects.map(async (subject) => {
            const contentCount = await Content.countDocuments({ subject: subject._id });
            return { subject, contentCount };
          })
        );

        // Sort by: contentCount (desc), then createdAt (desc)
        subjectsWithCounts.sort((a, b) => {
          if (b.contentCount !== a.contentCount) return b.contentCount - a.contentCount;
          return new Date(b.subject.createdAt) - new Date(a.subject.createdAt);
        });

        // Keep the first one (most content/most recent)
        const toKeep = subjectsWithCounts[0].subject;
        const toDelete = subjectsWithCounts.slice(1).map(s => s.subject);

        // Before deleting, update all content referencing deleted subjects to point to the kept subject
        const idsToDelete = toDelete.map(s => s._id);
        await Content.updateMany(
          { subject: { $in: idsToDelete } },
          { $set: { subject: toKeep._id } }
        );

        // Now delete duplicate subjects
        await Subject.deleteMany({ _id: { $in: idsToDelete } });
        
        results.subjectsRemoved += toDelete.length;
        results.subjectsKept += 1;
        
        console.log(`✅ Subject "${toKeep.name}": Kept 1, Removed ${toDelete.length} duplicates, Migrated ${toDelete.length} content items`);
      } else {
        results.subjectsKept += 1;
      }
    }

    const totalRemoved = results.contentRemoved + results.subjectsRemoved;
    
    console.log(`✅ Deduplication completed!`);
    console.log(`   Content: Kept ${results.contentKept}, Removed ${results.contentRemoved} duplicates`);
    console.log(`   Subjects: Kept ${results.subjectsKept}, Removed ${results.subjectsRemoved} duplicates`);
    
    res.json({
      success: true,
      message: 'Duplicates removed successfully',
      results,
      totalRemoved
    });
  } catch (error) {
    console.error('❌ Deduplication error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove duplicates',
      error: error.message
    });
  }
};

// Delete all subjects that don't belong to ASLI_EXCLUSIVE_SCHOOLS or are inactive
export const deleteRemainingSubjects = async (req, res) => {
  try {
    console.log('🔄 Starting cleanup of remaining subjects...');
    
    // Delete subjects that:
    // 1. Don't have board = 'ASLI_EXCLUSIVE_SCHOOLS'
    // 2. OR are inactive
    const subjectsToDelete = await Subject.find({
      $or: [
        { board: { $ne: 'ASLI_EXCLUSIVE_SCHOOLS' } },
        { isActive: false }
      ]
    });

    console.log(`📋 Found ${subjectsToDelete.length} subjects to delete`);

    let deletedCount = 0;
    let contentUpdated = 0;

    for (const subject of subjectsToDelete) {
      try {
        // Find a replacement subject with the same name and classNumber but correct board
        const replacementSubject = await Subject.findOne({
          name: subject.name,
          classNumber: subject.classNumber || null,
          board: 'ASLI_EXCLUSIVE_SCHOOLS',
          isActive: true
        });

        // If replacement exists, update content to point to it
        if (replacementSubject) {
          const updateResult = await Content.updateMany(
            { subject: subject._id },
            { $set: { subject: replacementSubject._id } }
          );
          contentUpdated += updateResult.modifiedCount;
          console.log(`   ↳ Updated ${updateResult.modifiedCount} content items to reference replacement subject: ${replacementSubject.name}`);
        } else {
          // If no replacement, set content subject to null or keep it (depending on your preference)
          // For now, we'll just delete the subject and leave content without subject reference
          console.log(`   ⚠️  No replacement found for subject "${subject.name}", content will lose subject reference`);
        }

        // Delete the subject
        await Subject.findByIdAndDelete(subject._id);
        deletedCount++;
        console.log(`   ✅ Deleted subject: "${subject.name}" (Class ${subject.classNumber || 'N/A'}, Board: ${subject.board || 'N/A'})`);
      } catch (error) {
        console.error(`   ❌ Error deleting subject "${subject.name}":`, error.message);
      }
    }

    console.log(`✅ Cleanup completed! Deleted ${deletedCount} subjects, updated ${contentUpdated} content items`);

    res.json({
      success: true,
      message: `Deleted ${deletedCount} remaining subjects. Updated ${contentUpdated} content items.`,
      results: {
        deletedCount,
        contentUpdated
      }
    });
  } catch (error) {
    console.error('❌ Delete remaining subjects error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete remaining subjects',
      error: error.message
    });
  }
};

// Create New User (Global)
export const createUser = async (req, res) => {
  try {
    const { name, email, role, details, assignedAdmin } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    // Create new user
    const hashedPassword = await bcrypt.hash(String(process.env.DEFAULT_PROVISION_PASSWORD || '').trim() || (() => { throw new Error('DEFAULT_PROVISION_PASSWORD required'); })(), 12); // Default password
    const newUser = new User({
      fullName: name,
      email,
      password: hashedPassword,
      role: role,
      details: details,
      assignedAdmin: assignedAdmin || null,
      isActive: true
    });
    
    await newUser.save();
    
    res.json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser._id,
        name: newUser.fullName,
        email: newUser.email,
        role: newUser.role,
        details: newUser.details,
        assignedAdmin: newUser.assignedAdmin,
        status: 'Active',
        joinDate: newUser.createdAt
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
};

// Get All Teachers (Global view)
export const getAllTeachers = async (req, res) => {
  try {
    const teachers = await Teacher.find()
      .populate('subjects', 'name')
      .populate('adminId', 'fullName email')
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: teachers
    });
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers' });
  }
};

// Create New Teacher (Global)
export const createTeacher = async (req, res) => {
  try {
    const { email, password, fullName, phone, department, qualifications, subjects, adminId } = req.body;
    
    // Check if teacher already exists
    const existingTeacher = await Teacher.findOne({ email });
    if (existingTeacher) {
      return res.status(400).json({ success: false, message: 'Teacher already exists' });
    }
    
    // Verify admin exists
    if (adminId) {
      const admin = await User.findById(adminId);
      if (!admin || admin.role !== 'admin') {
        return res.status(400).json({ success: false, message: 'Invalid admin ID' });
      }
    }
    
    // Create new teacher — require explicit password (no fixed default)
    if (!password || String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 8 characters',
      });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const newTeacher = new Teacher({
      email,
      password: hashedPassword,
      fullName,
      phone: phone || '',
      department: department || '',
      qualifications: qualifications || '',
      subjects: subjects || [],
      role: 'teacher',
      isActive: true,
      adminId: adminId || null
    });
    
    await newTeacher.save();
    
    res.json({
      success: true,
      message: 'Teacher created successfully',
      data: {
        id: newTeacher._id,
        email: newTeacher.email,
        fullName: newTeacher.fullName,
        phone: newTeacher.phone,
        department: newTeacher.department,
        qualifications: newTeacher.qualifications,
        subjects: newTeacher.subjects,
        adminId: newTeacher.adminId,
        isActive: newTeacher.isActive
      }
    });
  } catch (error) {
    console.error('Create teacher error:', error);
    res.status(500).json({ success: false, message: 'Failed to create teacher' });
  }
};

// Get All Courses/Videos (Global view)
export const getAllCourses = async (req, res) => {
  try {
    const courses = await Video.find()
      .populate('createdBy', 'fullName')
      .populate('adminId', 'fullName email')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: courses
    });
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch courses' });
  }
};

// Create New Course (Global)
export const createCourse = async (req, res) => {
  try {
    const { title, subject, grade, board, teacherId, adminId } = req.body;
    
    // Find teacher
    let teacherQuery = { _id: teacherId };
    if (adminId) {
      teacherQuery.adminId = adminId;
    }
    const teacher = await Teacher.findOne(teacherQuery);
    
    if (!teacher) {
      return res.status(400).json({ success: false, message: 'Teacher not found' });
    }
    
    const newCourse = new Video({
      title: title,
      subject: subject,
      grade: grade,
      board: board,
      teacher: teacherId,
      createdBy: teacherId,
      description: `${subject} course for ${grade} - ${board}`,
      isPublished: true,
      adminId: adminId || teacher.adminId
    });
    
    await newCourse.save();
    
    res.json({
      success: true,
      message: 'Course created successfully',
      data: {
        id: newCourse._id,
        title: newCourse.title,
        subject: newCourse.subject,
        grade: newCourse.grade,
        board: newCourse.board,
        teacher: teacher.fullName,
        adminId: newCourse.adminId,
        status: 'Published',
        created: newCourse.createdAt
      }
    });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ success: false, message: 'Failed to create course' });
  }
};

// Get Real-time Analytics with Top Scorers and Low-performing Admins
export const getRealTimeAnalytics = async (req, res) => {
  try {
    const [
      totalStudents,
      totalExams,
      totalExamResults,
      overallAgg,
      adminAgg,
      topScorerAgg,
      recentResults,
    ] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      Exam.countDocuments(),
      ExamResult.countDocuments(),
      ExamResult.aggregate([
        {
          $group: {
            _id: null,
            avgPercentage: { $avg: { $ifNull: ['$percentage', 0] } },
          },
        },
      ]),
      ExamResult.aggregate([
        {
          $group: {
            _id: '$adminId',
            totalAttempts: { $sum: 1 },
            examIds: { $addToSet: '$examId' },
            studentIds: { $addToSet: '$userId' },
            avgPercentage: { $avg: { $ifNull: ['$percentage', 0] } },
            totalMarksObtained: { $sum: { $ifNull: ['$obtainedMarks', 0] } },
            totalMarksPossible: { $sum: { $ifNull: ['$totalMarks', 0] } },
          },
        },
        { $match: { _id: { $ne: null } } },
      ]),
      ExamResult.aggregate([
        { $match: { examId: { $ne: null } } },
        { $sort: { percentage: -1, completedAt: -1 } },
        {
          $group: {
            _id: '$examId',
            examTitle: { $first: '$examTitle' },
            topScorers: {
              $push: {
                studentId: '$userId',
                percentage: '$percentage',
                marks: '$obtainedMarks',
                totalMarks: '$totalMarks',
                completedAt: '$completedAt',
              },
            },
          },
        },
        {
          $project: {
            examId: '$_id',
            examTitle: 1,
            topScorers: { $slice: ['$topScorers', 5] },
          },
        },
        { $limit: 50 },
      ]),
      ExamResult.find({})
        .populate('userId', 'fullName email')
        .populate('examId', 'title examType')
        .sort({ completedAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const adminIds = adminAgg.map((a) => a._id).filter(Boolean);
    const admins = await User.find({ _id: { $in: adminIds } })
      .select('fullName email')
      .lean();
    const adminById = new Map(admins.map((a) => [a._id.toString(), a]));

    const adminAnalytics = adminAgg.map((row) => {
      const admin = adminById.get(String(row._id));
      const avgFromMarks =
        row.totalMarksPossible > 0
          ? (row.totalMarksObtained / row.totalMarksPossible) * 100
          : row.avgPercentage || 0;
      return {
        adminId: String(row._id),
        adminName: admin?.fullName || admin?.email || 'Unknown Admin',
        adminEmail: admin?.email || 'unknown@email.com',
        totalStudents: (row.studentIds || []).filter(Boolean).length,
        totalExams: (row.examIds || []).filter(Boolean).length,
        totalAttempts: row.totalAttempts || 0,
        averageScore: Number(avgFromMarks || 0).toFixed(1),
        averageStudentPerformance: Number(row.avgPercentage || 0).toFixed(1),
        totalMarksObtained: row.totalMarksObtained || 0,
        totalMarksPossible: row.totalMarksPossible || 0,
      };
    });

    const lowPerformingAdmins = adminAnalytics
      .filter((admin) => parseFloat(admin.averageScore) < 50)
      .sort((a, b) => parseFloat(a.averageScore) - parseFloat(b.averageScore));

    // Resolve top-scorer names for the aggregated rows
    const topStudentIds = [
      ...new Set(
        topScorerAgg.flatMap((e) =>
          (e.topScorers || []).map((s) => s.studentId).filter(Boolean).map(String),
        ),
      ),
    ];
    const topStudents = await User.find({ _id: { $in: topStudentIds } })
      .select('fullName email')
      .lean();
    const studentById = new Map(topStudents.map((s) => [s._id.toString(), s]));

    const examIdsNeedingTitle = topScorerAgg
      .filter((e) => !e.examTitle)
      .map((e) => e.examId || e._id)
      .filter(Boolean);
    const examsForTitle = await Exam.find({ _id: { $in: examIdsNeedingTitle } })
      .select('title')
      .lean();
    const examTitleById = new Map(examsForTitle.map((e) => [e._id.toString(), e.title]));

    const topScorersByExam = topScorerAgg.map((exam) => {
      const examId = String(exam.examId || exam._id);
      return {
        examId,
        examTitle: exam.examTitle || examTitleById.get(examId) || 'Unknown Exam',
        topScorers: (exam.topScorers || []).map((s) => {
          const student = studentById.get(String(s.studentId));
          return {
            studentId: s.studentId ? String(s.studentId) : undefined,
            studentName: student?.fullName || 'Unknown',
            studentEmail: student?.email || 'unknown@email.com',
            marks: s.marks,
            totalMarks: s.totalMarks,
            percentage: s.percentage,
            completedAt: s.completedAt,
          };
        }),
      };
    });

    const overallAverage = overallAgg[0]?.avgPercentage || 0;

    res.json({
      success: true,
      data: {
        topScorersByExam,
        lowPerformingAdmins,
        adminAnalytics,
        overallMetrics: {
          totalStudents,
          totalExams,
          totalExamResults,
          overallAverage: Number(overallAverage).toFixed(1),
        },
        recentActivity: recentResults.map((result) => ({
          examTitle: result.examId?.title || result.examTitle,
          studentName: result.userId?.fullName || 'Unknown',
          score: Number(result.percentage || 0).toFixed(1),
          completedAt: result.completedAt,
        })),
      },
    });
  } catch (error) {
    console.error('Real-time analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch real-time analytics' });
  }
};

// Get Analytics (Global view) — real counts only (no mock growth metrics)
export const getAnalytics = async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalTeachers,
      totalVideos,
      totalAdmins,
      schoolStudents,
      individualStudents,
      individualTeachers,
      individualPaidStudents,
      individualPaidTeachers,
      individualTrialStudents,
      individualTrialTeachers,
      weeklyActiveStudents,
      monthlyActiveStudents,
      paidStudentPayments,
      paidTeacherPayments,
    ] = await Promise.all([
      User.countDocuments(),
      Teacher.countDocuments(),
      Video.countDocuments(),
      School.countDocuments({}),
      User.countDocuments({ role: 'student', isIndividualAccount: { $ne: true } }),
      User.countDocuments({ role: 'student', isIndividualAccount: true }),
      Teacher.countDocuments({ isIndividualAccount: true }),
      User.countDocuments({
        role: 'student',
        isIndividualAccount: true,
        subscriptionStatus: 'active',
      }),
      Teacher.countDocuments({ isIndividualAccount: true, subscriptionStatus: 'active' }),
      User.countDocuments({
        role: 'student',
        isIndividualAccount: true,
        subscriptionStatus: 'trial',
      }),
      Teacher.countDocuments({ isIndividualAccount: true, subscriptionStatus: 'trial' }),
      User.countDocuments({
        role: 'student',
        lastLogin: { $gte: sevenDaysAgo },
      }),
      User.countDocuments({
        role: 'student',
        lastLogin: { $gte: thirtyDaysAgo },
      }),
      User.aggregate([
        {
          $match: {
            role: 'student',
            isIndividualAccount: true,
            subscriptionStatus: 'active',
            trialPaymentAmount: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: '$trialPaymentAmount' }, count: { $sum: 1 } } },
      ]),
      Teacher.aggregate([
        {
          $match: {
            isIndividualAccount: true,
            subscriptionStatus: 'active',
            trialPaymentAmount: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: '$trialPaymentAmount' }, count: { $sum: 1 } } },
      ]),
    ]);

    const individualTotal = individualStudents + individualTeachers;
    const individualPaid = individualPaidStudents + individualPaidTeachers;
    const individualTrial = individualTrialStudents + individualTrialTeachers;
    const individualExceeded = Math.max(0, individualTotal - individualPaid - individualTrial);
    const conversionRate =
      individualTotal > 0 ? Math.round((individualPaid / individualTotal) * 1000) / 10 : 0;
    const b2cRevenueInr =
      (paidStudentPayments[0]?.total || 0) + (paidTeacherPayments[0]?.total || 0);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalTeachers,
        totalVideos,
        totalAdmins,
        schoolStudents,
        weeklyActiveStudents,
        monthlyActiveStudents,
        individual: {
          total: individualTotal,
          students: individualStudents,
          teachers: individualTeachers,
          trialActive: individualTrial,
          exceeded: individualExceeded,
          paid: individualPaid,
          converted: individualPaid,
          conversionRate,
          revenueInr: Math.round(b2cRevenueInr * 100) / 100,
        },
      },
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

// Get billing: Razorpay payments + subscriptions (requires RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)
export const getSubscriptions = async (req, res) => {
  try {
    const configured = isRazorpayConfigured();
    let payments = [];
    let subscriptions = [];
    let razorpayError = null;

    if (configured) {
      try {
        [payments, subscriptions] = await Promise.all([
          fetchRazorpayPayments(50),
          fetchRazorpaySubscriptions(50),
        ]);
      } catch (err) {
        const msg =
          err.response?.data?.error?.description ||
          err.response?.data?.message ||
          err.message ||
          'Razorpay request failed';
        console.error('Razorpay billing fetch:', msg, err.response?.data);
        razorpayError = msg;
      }
    }

    const capturedAmount = payments
      .filter((p) => p.status === 'captured')
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    const summary = {
      paymentsListed: payments.length,
      subscriptionsListed: subscriptions.length,
      capturedAmountInr: Math.round(capturedAmount * 100) / 100,
      activeSubscriptions: subscriptions.filter((s) =>
        ['active', 'authenticated'].includes(String(s.status || '').toLowerCase())
      ).length,
    };

    res.json({
      success: true,
      data: {
        razorpayConfigured: configured,
        razorpayError,
        summary,
        payments,
        subscriptions,
      },
    });
  } catch (error) {
    console.error('Subscriptions / billing error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch billing data' });
  }
};

// AI Student Risk Analysis for Super Admin - Can analyze any student
export const analyzeStudentRiskSuperAdmin = async (req, res) => {
  try {
    console.log('🔍 AI Risk Analysis - Request received:', {
      studentId: req.body.studentId,
      analysisType: req.body.analysisType,
      timeRange: req.body.timeRange,
      user: req.user
    });
    
    const { studentId, analysisType = 'comprehensive', timeRange = '90days' } = req.body;

    // Super admin can access any student
    const student = await User.findOne({ 
      _id: studentId, 
      role: 'student'
    });

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Calculate date range
    const { parseRiskAnalysisTimeRange, buildRuleBasedStudentRiskAnalysis } = await import(
      '../services/student-risk-analysis-service.js'
    );
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseRiskAnalysisTimeRange(timeRange));

    // Fetch all exam results for this student
    const examResults = await ExamResult.find({
      userId: studentId,
      completedAt: { $gte: startDate }
    }).sort({ completedAt: 1 });

    if (examResults.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No exam data available for analysis. Student needs to complete at least one exam.'
      });
    }

    const analysisResult = buildRuleBasedStudentRiskAnalysis({
      student,
      examResults,
      studentId,
      analysisType,
      timeRange,
    });

    res.json({
      success: true,
      data: analysisResult
    });

  } catch (error) {
    console.error('❌ Student risk analysis error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze student risk',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// Download PDF and Send to Student
export const downloadAndSendRiskAnalysisPDF = async (req, res) => {
  try {
    const { studentId, analysisData } = req.body;

    if (!studentId || !analysisData) {
      return res.status(400).json({
        success: false,
        message: 'Student ID and analysis data are required'
      });
    }

    // Get student info
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Generate PDF
    const { generateRiskAnalysisPDF } = await import('../services/pdf-generator-service.js');
    const { filepath, filename } = await generateRiskAnalysisPDF(analysisData, {
      studentId: student._id.toString(),
      name: student.fullName,
      email: student.email,
      classNumber: student.classNumber
    });

    // Save report to database
    const report = await RiskAnalysisReport.create({
      studentId: student._id,
      adminId: req.user.role === 'admin' ? req.userId : null,
      analysisData,
      pdfPath: filepath,
      pdfFilename: filename
    });

    res.json({
      success: true,
      message: 'PDF generated and sent to student successfully',
      data: {
        reportId: report._id,
        pdfPath: `/api/reports/download/${report._id}`,
        filename: filename
      }
    });

  } catch (error) {
    console.error('❌ Error generating/sending PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate or send PDF',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Download PDF file
export const downloadRiskAnalysisPDF = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await RiskAnalysisReport.findById(reportId);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Check if user has access (student can only see their own, admin/super-admin can see all)
    if (req.user.role === 'student' && report.studentId.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(report.pdfPath)) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found'
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.pdfFilename}"`);
    
    const fileStream = fs.createReadStream(report.pdfPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('❌ Error downloading PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download PDF',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export Data (Global)
export const exportData = async (req, res) => {
  try {
    const users = await User.find().select('-password').populate('assignedAdmin', 'fullName email');
    const videos = await Video.find().populate('adminId', 'fullName email');
    const teachers = await Teacher.find().populate('adminId', 'fullName email');
    const assessments = await Assessment.find().populate('adminId', 'fullName email');
    
    const exportData = {
      users: users,
      videos: videos,
      teachers: teachers,
      assessments: assessments,
      exportDate: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: exportData
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Failed to export data' });
  }
};

