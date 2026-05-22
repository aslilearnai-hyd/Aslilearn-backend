import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
  normalizeSchoolDetails,
  buildSchoolFieldsFromBody,
  applySchoolToAdminUser,
  formatSchoolListItem,
  findSchoolByAdminId,
  deleteSchoolById,
  resolveSchoolAndAdminByParamId,
  normalizePhoneTenDigits,
  isValidOptionalPhoneTenDigits,
} from '../services/schoolService.js';

// Super Admin Login
export const superAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Super admin credentials
    const superAdminCredentials = [
      { email: 'sealucknow2017@gmail.com', password: 'Asli123', fullName: 'Super Admin' }
    ];
    
    // Check super admin credentials
    const validCredential = superAdminCredentials.find(
      cred => cred.email.toLowerCase() === email.toLowerCase() && cred.password === password
    );
    
    if (validCredential) {
      const token = jwt.sign(
        { 
          id: 'super-admin-001',
          email: validCredential.email,
          fullName: validCredential.fullName,
          role: 'super-admin'
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
      );
      
      res.json({
        success: true,
        token,
        user: {
          id: 'super-admin-001',
          email: validCredential.email,
          fullName: validCredential.fullName,
          role: 'super-admin'
        }
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Super admin login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
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
    
    // Calculate meaningful metrics instead of mock revenue
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalExamResults = await ExamResult.countDocuments();
    const activeVideos = await Video.countDocuments({ isActive: true });
    const activeAssessments = await Assessment.countDocuments({ isActive: true });
    
    // Calculate engagement metrics
    const avgExamsPerStudent = totalStudents > 0 ? (totalExamResults / totalStudents).toFixed(1) : 0;
    const contentEngagement = totalContentItems + totalAssessments + totalExams;
    
    // Calculate pass rate from real exam results (assuming passing is >= 40%)
    const allExamResults = await ExamResult.find().select('percentage');
    const passingResults = allExamResults.filter(result => (result.percentage || 0) >= 40);
    const passRate = allExamResults.length > 0 ? ((passingResults.length / allExamResults.length) * 100).toFixed(1) : 0;
    
    // Calculate active students (students who have taken at least one exam)
    const studentsWithExams = await ExamResult.distinct('userId');
    const activeStudents = studentsWithExams.length;
    const activeStudentsPercentage = totalStudents > 0 ? ((activeStudents / totalStudents) * 100).toFixed(0) : 0;
    
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
        contentEngagement,
        passRate: parseFloat(passRate),
        activeStudents,
        activeStudentsPercentage: parseFloat(activeStudentsPercentage),
        superAdmins: 1
      }
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
    const schools = await School.find().sort({ name: 1 }).lean();
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
              subjectPerformance[subject].totalQuestions += data.total;
              subjectPerformance[subject].correctAnswers += data.correct;
              subjectPerformance[subject].totalMarks += data.marks;
              subjectPerformance[subject].obtainedMarks += data.marks;
            });
          }
        });
        
        // Calculate subject-wise averages
        const subjectAnalytics = Object.entries(subjectPerformance).map(([subject, data]) => ({
          subject,
          accuracy: data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions * 100).toFixed(1) : 0,
          averageScore: data.totalMarks > 0 ? (data.obtainedMarks / data.totalMarks * 100).toFixed(1) : 0,
          totalQuestions: data.totalQuestions,
          correctAnswers: data.correctAnswers
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
          subjectAnalysis[subject].totalQuestions += data.total;
          subjectAnalysis[subject].correctAnswers += data.correct;
          subjectAnalysis[subject].totalMarks += data.marks;
          subjectAnalysis[subject].obtainedMarks += data.marks;
          subjectAnalysis[subject].examCount += 1;
        });
      }
    });
    
    // Calculate subject-wise averages
    const subjectAnalytics = Object.entries(subjectAnalysis).map(([subject, data]) => ({
      subject,
      accuracy: data.totalQuestions > 0 ? (data.correctAnswers / data.totalQuestions * 100).toFixed(1) : 0,
      averageScore: data.totalMarks > 0 ? (data.obtainedMarks / data.totalMarks * 100).toFixed(1) : 0,
      totalQuestions: data.totalQuestions,
      correctAnswers: data.correctAnswers,
      examCount: data.examCount
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

    const admin = await User.findById(adminId).select('-password');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const [assignedStudents, examStudentIds, teacherCount] = await Promise.all([
      User.find({ role: 'student', assignedAdmin: adminId }).select('_id').lean(),
      ExamResult.distinct('userId', { adminId, userId: { $ne: null } }),
      Teacher.countDocuments({ adminId }),
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
      curriculumBoard:
        admin.curriculumBoard ||
        (isStoredCurriculumBoard(admin.board) ? String(admin.board).toUpperCase().trim() : 'CBSE'),
      isAsliPrepExclusive:
        admin.isAsliPrepExclusive === true || admin.board === 'ASLI_EXCLUSIVE_SCHOOLS',
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
        stats: { students: studentCount, teachers: teacherCount },
        billing,
      },
    });
  } catch (error) {
    console.error('Get admin school detail error:', error);
    res.status(500).json({ success: false, message: 'Failed to load school details' });
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

    if (
      !isValidOptionalPhoneTenDigits(schoolFields.phone) ||
      !isValidOptionalPhoneTenDigits(schoolFields.secondaryContactPhone)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Phone numbers must be exactly 10 digits, or left empty',
      });
    }

    // Check if admin already exists (including soft-deleted or inactive ones)
    const existingAdmin = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingAdmin) {
      // If the existing admin is inactive or was deleted, we can remove it first
      if (!existingAdmin.isActive || existingAdmin.role !== 'admin') {
        console.log(`Found inactive/deleted admin with email ${email}, removing it first...`);
        await User.deleteOne({ _id: existingAdmin._id });
      } else {
        return res.status(400).json({ 
          success: false, 
          message: 'Admin with this email already exists',
          hint: 'If you deleted this school, please wait a moment and try again'
        });
      }
    }
    
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const school = await School.create({
      ...schoolFields,
      contactPerson: schoolFields.contactPerson || name.trim(),
      isActive: true,
    });

    const newAdmin = new User({
      fullName: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: 'admin',
      permissions: permissions || [],
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

// Update Admin
export const updateAdmin = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      permissions,
      isActive,
      board,
      isAsliPrepExclusive,
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
    const paramId = req.params.id;

    console.log('📝 Updating admin:', paramId, { name, email, board, schoolName, isActive });

    const { admin, school } = await resolveSchoolAndAdminByParamId(paramId);
    if (!admin) {
      console.error('Admin not found for param:', paramId);
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const adminId = admin._id.toString();

    // Prepare update object
    const updateData = {};
    const schoolUpdate = {};
    if (name !== undefined && name !== null && name.trim() !== '') {
      updateData.fullName = name.trim();
    }
    if (email !== undefined && email !== null && email.trim() !== '') {
      const emailLower = email.toLowerCase().trim();
      // Check if email is being changed and if it's already taken
      if (emailLower !== admin.email.toLowerCase()) {
        const existingUser = await User.findOne({ email: emailLower });
        if (existingUser && existingUser._id.toString() !== adminId) {
          return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        updateData.email = emailLower;
      }
    }
    if (permissions !== undefined) updateData.permissions = permissions;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    if (password !== undefined && password !== null && String(password).trim() !== '') {
      const plainPassword = String(password).trim();
      if (plainPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters',
        });
      }
      updateData.password = await bcrypt.hash(plainPassword, 10);
    }

    const touchedCurriculum =
      board !== undefined && board !== null && String(board).trim() !== '';
    const touchedExclusive = isAsliPrepExclusive !== undefined && isAsliPrepExclusive !== null;

    if (touchedCurriculum || touchedExclusive) {
      let curriculum =
        admin.curriculumBoard ||
        (isStoredCurriculumBoard(admin.board) ? String(admin.board).toUpperCase().trim() : '');
      if (!isValidCurriculumBoard(curriculum)) curriculum = 'CBSE';

      if (touchedCurriculum) {
        const cu = String(board).toUpperCase().trim();
        if (!isValidCurriculumBoard(cu)) {
          return res.status(400).json({
            success: false,
            message: `Board (curriculum) must be one of: ${CURRICULUM_BOARDS.join(', ')}`,
          });
        }
        curriculum = cu;
        updateData.curriculumBoard = cu;
      }

      let exclusive =
        admin.isAsliPrepExclusive === true || admin.board === 'ASLI_EXCLUSIVE_SCHOOLS';
      if (touchedExclusive) {
        exclusive = Boolean(isAsliPrepExclusive);
        updateData.isAsliPrepExclusive = exclusive;
      }

      updateData.board = resolveAdminStoredBoard(exclusive, curriculum);
    }
    if (schoolName !== undefined && schoolName !== null) {
      updateData.schoolName = schoolName.trim();
    }
    if (schoolLogo !== undefined && schoolLogo !== null) {
      updateData.schoolLogo = schoolLogo.trim();
    }
    if (contactPerson !== undefined && contactPerson !== null) {
      updateData.contactPerson = contactPerson.trim();
    }
    if (phone !== undefined && phone !== null) {
      const normalizedPhone = normalizePhoneTenDigits(phone);
      if (!isValidOptionalPhoneTenDigits(normalizedPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Primary contact number must be exactly 10 digits, or left empty',
        });
      }
      updateData.phone = normalizedPhone;
    }
    if (secondaryContactPerson !== undefined && secondaryContactPerson !== null) {
      updateData.secondaryContactPerson = String(secondaryContactPerson).trim();
    }
    if (secondaryContactPhone !== undefined && secondaryContactPhone !== null) {
      const normalizedSecondary = normalizePhoneTenDigits(secondaryContactPhone);
      if (!isValidOptionalPhoneTenDigits(normalizedSecondary)) {
        return res.status(400).json({
          success: false,
          message: 'Secondary contact number must be exactly 10 digits, or left empty',
        });
      }
      updateData.secondaryContactPhone = normalizedSecondary;
    }
    if (place !== undefined && place !== null) {
      updateData.place = place.trim();
    }
    if (pin !== undefined && pin !== null) {
      updateData.pin = pin.trim();
    }

    const currentSd =
      admin.schoolDetails && typeof admin.schoolDetails.toObject === 'function'
        ? admin.schoolDetails.toObject()
        : { ...(admin.schoolDetails || {}) };

    if (rawSchoolDetails !== undefined && rawSchoolDetails !== null) {
      const merged = {
        ...currentSd,
        ...(typeof rawSchoolDetails === 'object' ? rawSchoolDetails : {})
      };
      const normalized = normalizeSchoolDetails(merged, state ?? merged.state);
      if (!normalized.city || !normalized.district || !normalized.state) {
        return res.status(400).json({
          success: false,
          message: 'City, district, and state are required for school information'
        });
      }
      updateData.schoolDetails = normalized;
      const placeLine =
        place !== undefined && place !== null && String(place).trim()
          ? String(place).trim()
          : [normalized.city, normalized.district, normalized.state].filter(Boolean).join(', ');
      updateData.place = placeLine;
    } else if (state !== undefined && state !== null && String(state).trim() !== '') {
      const normalized = normalizeSchoolDetails(
        { ...currentSd, state: String(state).trim() },
        state
      );
      updateData.schoolDetails = normalized;
      const noExplicitPlace =
        place === undefined || place === null || String(place).trim() === '';
      if (
        noExplicitPlace &&
        normalized.city &&
        normalized.district &&
        normalized.state
      ) {
        updateData.place = [normalized.city, normalized.district, normalized.state]
          .filter(Boolean)
          .join(', ');
      }
    }

    console.log('Update data:', updateData);

    const updatedAdmin = await User.findByIdAndUpdate(
      adminId,
      updateData,
      { new: true, runValidators: false } // Using runValidators: false to avoid board enum issues
    );
    
    if (!updatedAdmin) {
      return res.status(500).json({ success: false, message: 'Failed to update admin' });
    }

    console.log('✅ Admin updated successfully:', updatedAdmin.email, updatedAdmin.board);

    const boardSyncFields = {};
    if (updateData.board !== undefined) boardSyncFields.board = updateData.board;
    if (updateData.curriculumBoard !== undefined) {
      boardSyncFields.curriculumBoard = updateData.curriculumBoard;
    }
    if (updateData.isAsliPrepExclusive !== undefined) {
      boardSyncFields.isAsliPrepExclusive = updateData.isAsliPrepExclusive;
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

    const sd =
      updatedAdmin.schoolDetails && typeof updatedAdmin.schoolDetails.toObject === 'function'
        ? updatedAdmin.schoolDetails.toObject()
        : updatedAdmin.schoolDetails || {};

    res.json({
      success: true,
      message: 'Admin updated successfully',
      data: {
        id: updatedAdmin._id,
        name: updatedAdmin.fullName,
        email: updatedAdmin.email,
        board: updatedAdmin.board,
        curriculumBoard: updatedAdmin.curriculumBoard,
        isAsliPrepExclusive: updatedAdmin.isAsliPrepExclusive,
        schoolName: updatedAdmin.schoolName,
        schoolLogo: updatedAdmin.schoolLogo,
        contactPerson: updatedAdmin.contactPerson,
        phone: updatedAdmin.phone,
        secondaryContactPerson: updatedAdmin.secondaryContactPerson,
        secondaryContactPhone: updatedAdmin.secondaryContactPhone,
        place: updatedAdmin.place,
        pin: updatedAdmin.pin,
        state: sd.state || updatedAdmin.place || '',
        schoolDetails: sd,
        permissions: updatedAdmin.permissions,
        status: updatedAdmin.isActive ? 'Active' : 'Inactive'
      }
    });
  } catch (error) {
    console.error('❌ Update admin error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to update admin', error: error.message });
  }
};

// Delete Admin (School) - Cascading deletion
export const deleteAdmin = async (req, res) => {
  try {
    const paramId = req.params.id;
    const { admin, school } = await resolveSchoolAndAdminByParamId(paramId);

    if (!admin && !school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const adminId = admin?._id?.toString() || school?.adminUserId?.toString();
    const adminEmail = admin?.email || school?.name || 'unknown';
    console.log(
      `🗑️ Starting deletion of school: ${adminEmail} (param: ${paramId}, admin: ${adminId || 'none'}, school: ${school?._id || 'none'})`
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
      User.deleteMany({ assignedAdmin: adminId }),
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
    
    console.log(`✅ Successfully deleted school (admin) ${adminId} (${adminEmail}) and all associated data`);
    console.log(`   Deleted: ${deletionResults[0].deletedCount} students, ${deletionResults[1].deletedCount} teachers, ${deletionResults[2].deletedCount} videos`);
    
    res.json({
      success: true,
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
    const hashedPassword = await bcrypt.hash('password123', 10); // Default password
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
    
    // Create new teacher
    const hashedPassword = await bcrypt.hash(password || 'Password123', 12);
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
    // Get all exam results with populated user and exam data
    const allResults = await ExamResult.find({})
      .populate('userId', 'fullName email')
      .populate('examId', 'title examType')
      .populate('adminId', 'fullName email')
      .sort({ completedAt: -1 })
      .limit(1000); // Limit for performance
    
    // Get top scorers per exam
    const examTopScorers = {};
    allResults.forEach(result => {
      const examId = result.examId?._id?.toString() || result.examId?.toString();
      const examTitle = result.examId?.title || result.examTitle || 'Unknown Exam';
      
      if (!examTopScorers[examId]) {
        examTopScorers[examId] = {
          examId,
          examTitle,
          topScorers: []
        };
      }
      
      examTopScorers[examId].topScorers.push({
        studentName: result.userId?.fullName || 'Unknown',
        studentEmail: result.userId?.email || 'unknown@email.com',
        marks: result.obtainedMarks,
        totalMarks: result.totalMarks,
        percentage: result.percentage,
        completedAt: result.completedAt
      });
    });
    
    // Sort top scorers for each exam and get top 5
    Object.keys(examTopScorers).forEach(examId => {
      examTopScorers[examId].topScorers.sort((a, b) => b.percentage - a.percentage);
      examTopScorers[examId].topScorers = examTopScorers[examId].topScorers.slice(0, 5);
    });
    
    // Get admin performance metrics
    const adminPerformance = {};
    allResults.forEach(result => {
      const adminId = result.adminId?._id?.toString() || result.adminId?.toString();
      if (!adminId) return;
      
      if (!adminPerformance[adminId]) {
        adminPerformance[adminId] = {
          adminId,
          adminName: result.adminId?.fullName || result.adminId?.email || 'Unknown Admin',
          adminEmail: result.adminId?.email || 'unknown@email.com',
          totalStudents: new Set(),
          totalExams: 0,
          totalMarksObtained: 0,
          totalMarksPossible: 0,
          studentResults: []
        };
      }
      
      const admin = adminPerformance[adminId];
      admin.totalExams += 1;
      admin.totalMarksObtained += result.obtainedMarks;
      admin.totalMarksPossible += result.totalMarks;
      
      if (result.userId?._id) {
        admin.totalStudents.add(result.userId._id.toString());
      }
      
      admin.studentResults.push({
        studentName: result.userId?.fullName || 'Unknown',
        percentage: result.percentage,
        marks: result.obtainedMarks,
        totalMarks: result.totalMarks
      });
    });
    
    // Calculate average performance per admin
    const adminAnalytics = Object.values(adminPerformance).map(admin => {
      const avgPercentage = admin.totalMarksPossible > 0 
        ? (admin.totalMarksObtained / admin.totalMarksPossible) * 100 
        : 0;
      
      // Calculate average student performance
      const avgStudentPerformance = admin.studentResults.length > 0
        ? admin.studentResults.reduce((sum, r) => sum + r.percentage, 0) / admin.studentResults.length
        : 0;
      
      return {
        adminId: admin.adminId,
        adminName: admin.adminName,
        adminEmail: admin.adminEmail,
        totalStudents: admin.totalStudents.size,
        totalExams: admin.totalExams,
        averageScore: avgPercentage.toFixed(1),
        averageStudentPerformance: avgStudentPerformance.toFixed(1),
        totalMarksObtained: admin.totalMarksObtained,
        totalMarksPossible: admin.totalMarksPossible
      };
    });
    
    // Identify low-performing admins (below 50% average)
    const lowPerformingAdmins = adminAnalytics
      .filter(admin => parseFloat(admin.averageScore) < 50)
      .sort((a, b) => parseFloat(a.averageScore) - parseFloat(b.averageScore));
    
    // Get overall analytics
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalExams = await Exam.countDocuments();
    const overallAverage = allResults.length > 0
      ? allResults.reduce((sum, r) => sum + r.percentage, 0) / allResults.length
      : 0;
    
    res.json({
      success: true,
      data: {
        topScorersByExam: Object.values(examTopScorers),
        lowPerformingAdmins,
        adminAnalytics,
        overallMetrics: {
          totalStudents,
          totalExams,
          totalExamResults: allResults.length,
          overallAverage: overallAverage.toFixed(1)
        },
        recentActivity: allResults.slice(0, 10).map(result => ({
          examTitle: result.examId?.title || result.examTitle,
          studentName: result.userId?.fullName || 'Unknown',
          score: result.percentage.toFixed(1),
          completedAt: result.completedAt
        }))
      }
    });
  } catch (error) {
    console.error('Real-time analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch real-time analytics' });
  }
};

// Get Analytics (Global view)
export const getAnalytics = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTeachers = await Teacher.countDocuments();
    const totalVideos = await Video.countDocuments();
    const totalAdmins = await School.countDocuments({});
    
    // Calculate daily active users (mock data)
    const dailyActive = Math.floor(totalUsers * 0.1);
    const weeklyActive = Math.floor(totalUsers * 0.3);
    const monthlyActive = Math.floor(totalUsers * 0.7);
    
    res.json({
      success: true,
      data: {
        dailyActive,
        weeklyActive,
        monthlyActive,
        avgSessionTime: "24m 35s",
        completionRate: 76,
        revenueGrowth: 23.5,
        userGrowth: 18.2,
        courseEngagement: 89,
        totalUsers,
        totalTeachers,
        totalVideos,
        totalAdmins
      }
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
    let daysAgo;
    if (timeRange === 'all') {
      daysAgo = 365 * 5;
    } else if (timeRange === '30days') {
      daysAgo = 30;
    } else if (timeRange === '90days') {
      daysAgo = 90;
    } else {
      daysAgo = parseInt(timeRange) || 90; // Default to 90 days if invalid
    }
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

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

    // Helper function to get best subject
    const getBestSubject = (results) => {
      const subjectScores = {};
      results.forEach(result => {
        if (result.subjectWiseScore) {
          Object.entries(result.subjectWiseScore).forEach(([subject, data]) => {
            if (!subjectScores[subject]) {
              subjectScores[subject] = { total: 0, count: 0 };
            }
            const percentage = data.total > 0 ? (data.correct / data.total) * 100 : 0;
            subjectScores[subject].total += percentage;
            subjectScores[subject].count += 1;
          });
        }
      });

      let bestSubject = null;
      let bestAvg = 0;
      Object.entries(subjectScores).forEach(([subject, data]) => {
        const avg = data.total / data.count;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestSubject = subject;
        }
      });
      return bestSubject;
    };

    // Helper function to get worst subject
    const getWorstSubject = (results) => {
      const subjectScores = {};
      results.forEach(result => {
        if (result.subjectWiseScore) {
          Object.entries(result.subjectWiseScore).forEach(([subject, data]) => {
            if (!subjectScores[subject]) {
              subjectScores[subject] = { total: 0, count: 0 };
            }
            const percentage = data.total > 0 ? (data.correct / data.total) * 100 : 0;
            subjectScores[subject].total += percentage;
            subjectScores[subject].count += 1;
          });
        }
      });

      let worstSubject = null;
      let worstAvg = 100;
      Object.entries(subjectScores).forEach(([subject, data]) => {
        const avg = data.total / data.count;
        if (avg < worstAvg) {
          worstAvg = avg;
          worstSubject = subject;
        }
      });
      return worstSubject;
    };

    // Prepare data for AI analysis
    const performanceData = {
      studentInfo: {
        name: student.fullName,
        email: student.email,
        classNumber: student.classNumber,
        totalExams: examResults.length
      },
      examHistory: examResults.map(result => ({
        examTitle: result.examTitle,
        date: result.completedAt,
        percentage: result.percentage,
        timeTaken: result.timeTaken,
        correctAnswers: result.correctAnswers,
        totalQuestions: result.totalQuestions,
        subjectScores: Object.fromEntries(result.subjectWiseScore || [])
      })),
      statistics: {
        averageScore: examResults.reduce((sum, r) => sum + r.percentage, 0) / examResults.length,
        latestScore: examResults[examResults.length - 1].percentage,
        trend: examResults.length >= 2 
          ? (examResults[examResults.length - 1].percentage - examResults[0].percentage)
          : 0,
        bestSubject: getBestSubject(examResults),
        worstSubject: getWorstSubject(examResults)
      }
    };

    // Generate AI analysis using configured AI service
    const analysisPrompt = `You are an expert educational analyst with deep knowledge of student performance patterns, learning psychology, and intervention strategies. Analyze this student's performance data and provide a comprehensive risk assessment.

STUDENT DATA:
${JSON.stringify(performanceData, null, 2)}

Provide a detailed analysis in the following JSON format (ONLY JSON, no markdown, no code blocks):
{
  "riskLevel": "high" | "medium" | "low",
  "riskScore": 0.0-1.0,
  "analysis": {
    "summary": "Brief summary of overall performance (2-3 sentences)",
    "trends": "Describe performance trends over time with specific details",
    "strengths": ["List 2-3 key strengths"],
    "weaknesses": ["List 2-3 key weaknesses"],
    "rootCauses": ["List 2-3 root causes of performance issues"]
  },
  "predictions": {
    "nextExamPrediction": 0-100,
    "confidence": 0.0-1.0,
    "trend": "declining" | "stable" | "improving"
  },
  "interventions": [
    {
      "priority": "high" | "medium" | "low",
      "action": "Specific actionable intervention",
      "reasoning": "Why this intervention is needed based on data",
      "expectedImpact": "Expected improvement with timeframe"
    }
  ],
  "subjectBreakdown": {
    "SubjectName": {
      "performance": "strong" | "average" | "weak",
      "trend": "improving" | "stable" | "declining",
      "recommendation": "Specific recommendation for this subject"
    }
  }
}

Be specific, actionable, and data-driven. Focus on identifying real issues and providing practical solutions. Use the actual data provided to make informed assessments.`;

    const { default: geminiService } = await import('../services/gemini-service.js');
    const aiResponse = await geminiService.generateStructuredContent(analysisPrompt, 'json');

    // Parse AI response
    let analysisResult;
    try {
      // Clean JSON response
      const cleanedResponse = aiResponse
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      
      analysisResult = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw AI response:', aiResponse?.substring(0, 500));
      return res.status(500).json({
        success: false,
        message: 'Failed to parse AI analysis. Please try again.',
        error: process.env.NODE_ENV === 'development' ? parseError.message : undefined
      });
    }

    // Add metadata
    analysisResult.generatedAt = new Date();
    analysisResult.studentId = studentId;
    analysisResult.dataPoints = examResults.length;
    analysisResult.analysisType = analysisType;
    analysisResult.timeRange = timeRange;

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


