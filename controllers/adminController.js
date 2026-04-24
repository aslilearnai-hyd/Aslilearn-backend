import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Video from '../models/Video.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import ExamResult from '../models/ExamResult.js';
import Class from '../models/Class.js';
import Subject from '../models/Subject.js';
import Content from '../models/Content.js';
import RiskAnalysisReport from '../models/RiskAnalysisReport.js';
import { getExplicitTeacherSubjectObjectIds } from '../utils/teacherSubjectScope.js';

const buildSafeAppendQuestionPipeline = (questionId) => [
  {
    $set: {
      questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] },
    },
  },
  {
    $set: {
      questions: { $concatArrays: ['$questions', [questionId]] },
      totalQuestions: { $add: [{ $ifNull: ['$totalQuestions', 0] }, 1] },
    },
  },
];

const buildSafeRemoveQuestionPipeline = (questionId) => [
  {
    $set: {
      questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] },
    },
  },
  {
    $set: {
      questions: {
        $filter: {
          input: '$questions',
          as: 'existingQuestionId',
          cond: { $ne: ['$$existingQuestionId', questionId] },
        },
      },
      totalQuestions: {
        $max: [0, { $subtract: [{ $ifNull: ['$totalQuestions', 0] }, 1] }]
      },
    },
  },
];

// Admin Dashboard Stats
export const getAdminDashboardStats = async (req, res) => {
  try {
    const adminId = req.adminId;
    
    // Get admin to find their board (use lean for faster query)
    const admin = await User.findById(adminId).select('board').lean();
    const adminBoard = admin?.board;
    
    // Build filter based on user role
    const filter = adminId ? { adminId } : {};
    const userFilter = adminId ? { assignedAdmin: adminId } : {};
    const classFilter = adminId ? { assignedAdmin: adminId, isActive: true } : { isActive: true };
    
    // Build content filter based on admin's board
    const contentFilter = adminBoard ? { board: adminBoard, isActive: true } : { isActive: true };
    
    const [
      totalStudents,
      totalTeachers,
      totalVideos,
      totalAssessments,
      totalExams,
      activeUsers,
      totalClasses,
      totalQuizzes,
      totalContent
    ] = await Promise.all([
      User.countDocuments({ role: 'student', ...userFilter }),
      Teacher.countDocuments(filter),
      Video.countDocuments(filter),
      Assessment.countDocuments(filter),
      Exam.countDocuments(filter),
      User.countDocuments({ 
        role: 'student', 
        isActive: true, 
        ...userFilter 
      }),
      Class.countDocuments(classFilter),
      Assessment.countDocuments({ ...filter, isPublished: true }),
      adminBoard ? Content.countDocuments(contentFilter) : Promise.resolve(0)
    ]);
    
    res.json({
      success: true,
      data: {
        totalStudents,
        totalTeachers,
        totalVideos,
        totalAssessments,
        totalExams,
        activeUsers,
        totalClasses,
        totalQuizzes,
        totalContent
      }
    });
  } catch (error) {
    console.error('Admin dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
};

// Student Management
export const getStudents = async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = adminId ? { assignedAdmin: adminId } : {};
    
    const students = await User.find({ 
      role: 'student', 
      ...filter 
    })
    .select('-password')
    .populate('assignedClass', 'name classNumber section description')
    .sort({ createdAt: -1 })
    .limit(1000); // Reasonable limit
    // Note: lean() removed to maintain populate() functionality
    
    res.json({
      success: true,
      data: students
    });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch students' });
  }
};

export const createStudent = async (req, res) => {
  try {
    const { email, password, fullName, classNumber, phone } = req.body;
    
    // Get admin ID from request (set by extractAdminId middleware)
    // Try multiple sources: req.adminId, req.userId, req.user.id, req.user._id
    const adminId = req.adminId || req.userId || req.user?.id || req.user?._id || req.user?.userId;
    
    // Debug logging
    console.log('createStudent - req.adminId:', req.adminId);
    console.log('createStudent - req.userId:', req.userId);
    console.log('createStudent - req.user:', req.user);
    console.log('createStudent - adminId to use:', adminId);
    console.log('createStudent - adminId type:', typeof adminId);
    
    if (!adminId) {
      console.error('createStudent - No admin ID found in request');
      return res.status(401).json({ 
        success: false, 
        message: 'Admin ID not found. Please ensure you are authenticated as an admin. Try logging out and logging back in.' 
      });
    }
    
    // Validate required fields
    if (!fullName || !email || !classNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Full name, email, and class number are required' 
      });
    }
    
    // Get admin to inherit board and school
    // Try to find admin by ID (MongoDB ObjectId or string)
    let admin = null;
    try {
      // Try as ObjectId first
      if (mongoose.Types.ObjectId.isValid(adminId)) {
        admin = await User.findById(adminId).select('board schoolName role fullName email');
      } else {
        // If not valid ObjectId, try finding by email or other field
        console.log('adminId is not a valid ObjectId, trying alternative lookup');
        admin = await User.findOne({ 
          $or: [
            { _id: adminId },
            { email: req.user?.email }
          ]
        }).select('board schoolName role fullName email');
      }
    } catch (dbError) {
      console.error('Database error finding admin:', dbError);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error while finding admin' 
      });
    }
    
    console.log('createStudent - Found admin:', admin ? { 
      id: admin._id, 
      role: admin.role, 
      board: admin.board,
      email: admin.email,
      fullName: admin.fullName
    } : 'null');
    
    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: `Admin not found with ID: ${adminId}. Please ensure you are logged in as an admin.` 
      });
    }
    
    if (admin.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: `User with ID ${adminId} is not an admin. Role: ${admin.role}. Please log in as an admin.` 
      });
    }

    if (!admin.board) {
      return res.status(400).json({ success: false, message: 'Admin must have a board assigned' });
    }
    
    // Check if student already exists
    const existingStudent = await User.findOne({ email });
    if (existingStudent) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student with this email already exists' 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password || 'Password123', 12);
    
    // Create new student with admin's board and school
    const newStudent = new User({
      email,
      password: hashedPassword,
      fullName,
      classNumber: classNumber.trim(), // Required, no default
      phone: phone || '',
      role: 'student',
      board: admin.board, // Inherit board from admin
      schoolName: admin.schoolName || '', // Inherit school from admin
      isActive: true,
      assignedAdmin: adminId
    });
    
    await newStudent.save();
    
    res.status(201).json({
      success: true,
      message: 'Student created successfully',
      data: {
        id: newStudent._id,
        email: newStudent.email,
        fullName: newStudent.fullName,
        classNumber: newStudent.classNumber,
        phone: newStudent.phone,
        board: newStudent.board,
        schoolName: newStudent.schoolName,
        isActive: newStudent.isActive
      }
    });
  } catch (error) {
    console.error('Create student error:', error);
    res.status(500).json({ success: false, message: 'Failed to create student' });
  }
};

export const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, classNumber, phone, isActive } = req.body;
    const adminId = req.adminId;
    
    // Build update filter
    const filter = { _id: id, role: 'student' };
    if (adminId) {
      filter.assignedAdmin = adminId;
    }
    
    const updatedStudent = await User.findOneAndUpdate(
      filter,
      { fullName, classNumber, phone, isActive },
      { new: true }
    ).select('-password');
    
    if (!updatedStudent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Student updated successfully',
      data: updatedStudent
    });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ success: false, message: 'Failed to update student' });
  }
};

export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminId;
    
    // Build delete filter
    const filter = { _id: id, role: 'student' };
    if (adminId) {
      filter.assignedAdmin = adminId;
    }
    
    const deletedStudent = await User.findOneAndDelete(filter);
    
    if (!deletedStudent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Student deleted successfully'
    });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete student' });
  }
};

// Teacher Management
export const getTeachers = async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = adminId ? { adminId } : {};
    
    const teachers = await Teacher.find(filter)
      .populate({
        path: 'subjects',
        match: { isActive: true },
        select: 'name description isActive',
      })
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(500) // Reasonable limit
      .lean(); // Faster, returns plain objects
    
    // Transform the data to match frontend expectations
    const transformedTeachers = teachers.map(teacher => ({
      _id: teacher._id,
      id: teacher._id,
      fullName: teacher.fullName,
      email: teacher.email,
      phone: teacher.phone,
      department: teacher.department,
      qualifications: teacher.qualifications,
      subjects: (teacher.subjects || []).filter(
        (s) => s != null && s._id && s.isActive !== false
      ),
      role: teacher.role,
      isActive: teacher.isActive,
      createdAt: teacher.createdAt,
      updatedAt: teacher.updatedAt
    }));
    
    res.json(transformedTeachers);
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers' });
  }
};

export const createTeacher = async (req, res) => {
  try {
    const { email, password, fullName, phone, department, qualifications, subjects } = req.body;
    
    // Get admin ID from request (set by extractAdminId middleware)
    // Try multiple sources: req.adminId, req.userId, req.user.id, req.user._id
    const adminId = req.adminId || req.userId || req.user?.id || req.user?._id || req.user?.userId;
    
    // Debug logging
    console.log('createTeacher - req.adminId:', req.adminId);
    console.log('createTeacher - req.userId:', req.userId);
    console.log('createTeacher - req.user:', req.user);
    console.log('createTeacher - adminId to use:', adminId);
    console.log('createTeacher - Request body:', { email, fullName, department, subjectsCount: subjects?.length });
    
    if (!adminId) {
      console.error('createTeacher - No admin ID found in request');
      return res.status(401).json({ 
        success: false, 
        message: 'Admin ID not found. Please ensure you are authenticated as an admin. Try logging out and logging back in.' 
      });
    }
    
    // Validate required fields
    if (!fullName || !email || !department || !subjects || subjects.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, email, department, and at least one subject are required' 
      });
    }
    
    // Check if teacher already exists
    const existingTeacher = await Teacher.findOne({ email });
    if (existingTeacher) {
      return res.status(400).json({ 
        success: false, 
        message: 'Teacher with this email already exists' 
      });
    }
    
    // Get admin details to get school and board
    // Try to find admin by ID (MongoDB ObjectId or string)
    let admin = null;
    try {
      // Try as ObjectId first
      if (mongoose.Types.ObjectId.isValid(adminId)) {
        admin = await User.findById(adminId).select('schoolName board role fullName email');
      } else {
        // If not valid ObjectId, try finding by email or other field
        console.log('adminId is not a valid ObjectId, trying alternative lookup');
        admin = await User.findOne({ 
          $or: [
            { _id: adminId },
            { email: req.user?.email }
          ]
        }).select('schoolName board role fullName email');
      }
    } catch (dbError) {
      console.error('Database error finding admin:', dbError);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error while finding admin' 
      });
    }
    
    console.log('createTeacher - Found admin:', admin ? { 
      id: admin._id, 
      role: admin.role, 
      board: admin.board,
      schoolName: admin.schoolName,
      email: admin.email
    } : 'null');
    
    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: `Admin not found with ID: ${adminId}. Please ensure you are logged in as an admin.` 
      });
    }
    
    if (admin.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: `User with ID ${adminId} is not an admin. Role: ${admin.role}. Please log in as an admin.` 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password || 'Password123', 12);
    
    // Ensure adminId is a valid ObjectId
    let validAdminId = adminId;
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      // If adminId is not valid, use the admin's _id from database
      validAdminId = admin._id;
    } else {
      // Convert string to ObjectId if needed
      validAdminId = new mongoose.Types.ObjectId(adminId);
    }
    
    // Handle board enum validation
    let teacherBoard = null;
    if (admin.board && admin.board === 'ASLI_EXCLUSIVE_SCHOOLS') {
      teacherBoard = admin.board.toUpperCase();
    }
    
    console.log('createTeacher - Creating teacher with:', {
      email,
      fullName,
      department,
      school: admin.schoolName || '',
      board: teacherBoard,
      adminId: validAdminId,
      subjectsCount: subjects?.length
    });
    
    // Create new teacher
    const newTeacher = new Teacher({
      email,
      password: hashedPassword,
      fullName,
      phone: phone || '',
      department: department || '',
      school: admin.schoolName || '',
      board: teacherBoard,
      qualifications: qualifications || '',
      subjects: subjects || [],
      role: 'teacher',
      isActive: true,
      adminId: validAdminId
    });
    
    await newTeacher.save();
    console.log('createTeacher - Teacher saved successfully:', newTeacher._id);
    
    res.status(201).json({
      success: true,
      message: 'Teacher created successfully',
      data: {
        id: newTeacher._id,
        email: newTeacher.email,
        fullName: newTeacher.fullName,
        phone: newTeacher.phone,
        department: newTeacher.department,
        school: newTeacher.school,
        board: newTeacher.board,
        qualifications: newTeacher.qualifications,
        subjects: newTeacher.subjects,
        isActive: newTeacher.isActive
      }
    });
  } catch (error) {
    console.error('Create teacher error:', error);
    console.error('Create teacher error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create teacher';
    
    if (error.name === 'ValidationError') {
      errorMessage = `Validation error: ${Object.values(error.errors).map((e) => e.message).join(', ')}`;
    } else if (error.code === 11000) {
      // Duplicate key error (MongoDB)
      errorMessage = 'A teacher with this email already exists';
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

export const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, phone, department, qualifications, subjects, isActive } = req.body;
    const adminId = req.adminId;
    
    // Build update filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const updatedTeacher = await Teacher.findOneAndUpdate(
      filter,
      { fullName, phone, department, qualifications, subjects, isActive },
      { new: true }
    ).select('-password');
    
    if (!updatedTeacher) {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Teacher updated successfully',
      data: updatedTeacher
    });
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ success: false, message: 'Failed to update teacher' });
  }
};

export const deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminId;
    
    // Build delete filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const deletedTeacher = await Teacher.findOneAndDelete(filter);
    
    if (!deletedTeacher) {
      return res.status(404).json({ 
        success: false, 
        message: 'Teacher not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Teacher deleted successfully'
    });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete teacher' });
  }
};

// Video/Course Management
export const getVideos = async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = adminId ? { adminId } : {};
    
    const videos = await Video.find(filter)
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(500); // Reasonable limit
    
    res.json({
      success: true,
      data: videos
    });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch videos' });
  }
};

export const createVideo = async (req, res) => {
  try {
    const { title, description, videoUrl, thumbnailUrl, duration, subjectId, difficulty, youtubeUrl } = req.body;
    const adminId = req.adminId;
    
    const newVideo = new Video({
      title,
      description,
      videoUrl,
      thumbnailUrl,
      duration,
      subjectId,
      difficulty: difficulty || 'beginner',
      youtubeUrl,
      isYouTubeVideo: !!youtubeUrl,
      isPublished: true,
      adminId
    });
    
    await newVideo.save();
    
    res.status(201).json({
      success: true,
      message: 'Video created successfully',
      data: newVideo
    });
  } catch (error) {
    console.error('Create video error:', error);
    res.status(500).json({ success: false, message: 'Failed to create video' });
  }
};

export const updateVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const adminId = req.adminId;
    
    // Build update filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const updatedVideo = await Video.findOneAndUpdate(
      filter,
      updateData,
      { new: true }
    );
    
    if (!updatedVideo) {
      return res.status(404).json({ 
        success: false, 
        message: 'Video not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Video updated successfully',
      data: updatedVideo
    });
  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ success: false, message: 'Failed to update video' });
  }
};

export const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminId;
    
    // Build delete filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const deletedVideo = await Video.findOneAndDelete(filter);
    
    if (!deletedVideo) {
      return res.status(404).json({ 
        success: false, 
        message: 'Video not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Video deleted successfully'
    });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete video' });
  }
};

// Assessment Management
export const getAssessments = async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = adminId ? { adminId } : {};
    
    const assessments = await Assessment.find(filter)
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(500); // Reasonable limit
    
    res.json({
      success: true,
      data: assessments
    });
  } catch (error) {
    console.error('Get assessments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assessments' });
  }
};

export const createAssessment = async (req, res) => {
  try {
    const { title, description, questions, subjectIds, difficulty, duration, driveLink } = req.body;
    const adminId = req.adminId;
    
    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    const newAssessment = new Assessment({
      title,
      description,
      questions,
      subjectIds,
      difficulty: difficulty || 'beginner',
      duration,
      totalPoints,
      driveLink,
      isDriveQuiz: !!driveLink,
      isPublished: true,
      adminId
    });
    
    await newAssessment.save();
    
    res.status(201).json({
      success: true,
      message: 'Assessment created successfully',
      data: newAssessment
    });
  } catch (error) {
    console.error('Create assessment error:', error);
    res.status(500).json({ success: false, message: 'Failed to create assessment' });
  }
};

export const updateAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const adminId = req.adminId;
    
    // Recalculate total points if questions are updated
    if (updateData.questions) {
      updateData.totalPoints = updateData.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }
    
    // Build update filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const updatedAssessment = await Assessment.findOneAndUpdate(
      filter,
      updateData,
      { new: true }
    );
    
    if (!updatedAssessment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Assessment not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Assessment updated successfully',
      data: updatedAssessment
    });
  } catch (error) {
    console.error('Update assessment error:', error);
    res.status(500).json({ success: false, message: 'Failed to update assessment' });
  }
};

export const deleteAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminId;
    
    // Build delete filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const deletedAssessment = await Assessment.findOneAndDelete(filter);
    
    if (!deletedAssessment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Assessment not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Assessment deleted successfully'
    });
  } catch (error) {
    console.error('Delete assessment error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete assessment' });
  }
};

// Analytics
export const getAnalytics = async (req, res) => {
  try {
    const adminId = req.adminId;
    
    // Build filters based on user role
    const videoFilter = adminId ? { adminId } : {};
    const assessmentFilter = adminId ? { adminId } : {};
    const userFilter = adminId ? { assignedAdmin: adminId } : {};
    const teacherFilter = adminId ? { adminId } : {};
    
    const [
      totalVideos,
      totalAssessments,
      totalStudents,
      totalTeachers,
      activeStudents,
      recentVideos,
      recentAssessments
    ] = await Promise.all([
      Video.countDocuments(videoFilter),
      Assessment.countDocuments(assessmentFilter),
      User.countDocuments({ role: 'student', ...userFilter }),
      Teacher.countDocuments(teacherFilter),
      User.countDocuments({ 
        role: 'student', 
        isActive: true, 
        ...userFilter 
      }),
      Video.find(videoFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title createdAt views'),
      Assessment.find(assessmentFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .select('title createdAt totalPoints')
    ]);
    
    // Calculate engagement metrics
    const totalViews = await Video.aggregate([
      { $match: videoFilter },
      { $group: { _id: null, totalViews: { $sum: '$views' } } }
    ]);
    
    const avgViews = totalViews.length > 0 ? totalViews[0].totalViews / totalVideos : 0;
    
    res.json({
      success: true,
      data: {
        overview: {
          totalVideos,
          totalAssessments,
          totalStudents,
          totalTeachers,
          activeStudents,
          avgViews: Math.round(avgViews)
        },
        recentActivity: {
          videos: recentVideos,
          assessments: recentAssessments
        },
        engagement: {
          studentEngagement: totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 0,
          contentEngagement: avgViews > 0 ? Math.round(Math.min(avgViews / 100, 100)) : 0
        }
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

// Student Analytics for Admin Dashboard - Optimized with aggregation
export const getStudentAnalytics = async (req, res) => {
  try {
    const adminId = req.adminId;
    
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Admin ID not found' });
    }

    // Use aggregation for class distribution (much faster)
    const classDistributionAgg = await User.aggregate([
      { $match: { role: 'student', assignedAdmin: adminId } },
      { $group: { 
          _id: { $ifNull: ['$classNumber', 'Unassigned'] }, 
          count: { $sum: 1 } 
        } 
      },
      { $project: { className: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }
    ]);

    const classDistributionArray = classDistributionAgg.map(item => ({
      className: item.className,
      count: item.count
    }));

    // Get exam results with limit and lean for performance
    const examResults = await ExamResult.find({ adminId })
      .populate('userId', 'fullName email classNumber')
      .populate('examId', 'title subject')
      .sort({ completedAt: -1 })
      .limit(1000) // Limit to recent 1000 results
      .lean();

    // Performance Metrics using aggregation
    const performanceMetricsAgg = await ExamResult.aggregate([
      { $match: { adminId: adminId } },
      { $group: {
          _id: null,
          totalExams: { $sum: 1 },
          totalMarksObtained: { $sum: '$obtainedMarks' },
          totalMarksPossible: { $sum: '$totalMarks' }
        }
      }
    ]);

    const metrics = performanceMetricsAgg[0] || { totalExams: 0, totalMarksObtained: 0, totalMarksPossible: 0 };
    const averageScore = metrics.totalMarksPossible > 0 
      ? ((metrics.totalMarksObtained / metrics.totalMarksPossible) * 100).toFixed(1) 
      : 0;

    // Top Performers using aggregation
    const topPerformersAgg = await ExamResult.aggregate([
      { $match: { adminId: adminId } },
      { $group: {
          _id: '$userId',
          totalExams: { $sum: 1 },
          totalMarks: { $sum: '$obtainedMarks' },
          totalPossibleMarks: { $sum: '$totalMarks' }
        }
      },
      { $sort: { totalMarks: -1 } },
      { $limit: 10 },
      { $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'student'
        }
      },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      { $project: {
          studentName: { $ifNull: ['$student.fullName', 'Unknown'] },
          studentEmail: { $ifNull: ['$student.email', ''] },
          totalExams: 1,
          averageScore: {
            $cond: [
              { $gt: ['$totalPossibleMarks', 0] },
              { $multiply: [{ $divide: ['$totalMarks', '$totalPossibleMarks'] }, 100] },
              0
            ]
          }
        }
      }
    ]);

    const topPerformers = topPerformersAgg.map(perf => ({
        studentName: perf.studentName,
        studentEmail: perf.studentEmail,
        totalExams: perf.totalExams,
      averageScore: parseFloat(perf.averageScore.toFixed(1))
    }));

    // Subject Performance using aggregation
    const subjectPerformanceAgg = await ExamResult.aggregate([
      { $match: { adminId: adminId } },
      { $lookup: {
          from: 'exams',
          localField: 'examId',
          foreignField: '_id',
          as: 'exam'
        }
      },
      { $unwind: { path: '$exam', preserveNullAndEmptyArrays: true } },
      { $group: {
          _id: { $ifNull: ['$exam.subject', 'Unknown'] },
          totalExams: { $sum: 1 },
          totalMarks: { $sum: '$obtainedMarks' },
          totalPossibleMarks: { $sum: '$totalMarks' }
        }
      },
      { $project: {
          subject: '$_id',
          totalExams: 1,
          averageScore: {
            $cond: [
              { $gt: ['$totalPossibleMarks', 0] },
              { $multiply: [{ $divide: ['$totalMarks', '$totalPossibleMarks'] }, 100] },
              0
            ]
          },
          _id: 0
        }
      },
      { $sort: { averageScore: -1 } }
    ]);

    const subjectPerformanceArray = subjectPerformanceAgg.map(subj => ({
        subject: subj.subject,
      averageScore: parseFloat(subj.averageScore.toFixed(1)),
        totalExams: subj.totalExams
    }));

    // Recent Activity (last 5 exam results) - already limited above
    const recentActivity = examResults.slice(0, 5).map(result => ({
      studentName: result.userId?.fullName || 'Unknown',
      examTitle: result.examId?.title || result.examTitle || 'Unknown',
      score: result.percentage || 0,
      completedAt: result.completedAt
    }));

    res.json({
      success: true,
      data: {
        classDistribution: classDistributionArray,
        performanceMetrics: {
          averageScore: parseFloat(averageScore),
          totalExamsTaken: metrics.totalExams,
          topPerformers
        },
        subjectPerformance: subjectPerformanceArray,
        recentActivity
      }
    });
  } catch (error) {
    console.error('Student analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch student analytics' });
  }
};

// Exam Management
export const getExams = async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = adminId ? { adminId } : {};
    
    const exams = await Exam.find(filter)
      .populate('createdBy', 'fullName')
      .populate('questions')
      .sort({ createdAt: -1 })
      .limit(200); // Reasonable limit (exams can be large with questions)
    
    res.json({
      success: true,
      data: exams
    });
  } catch (error) {
    console.error('Get exams error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
};

export const createExam = async (req, res) => {
  try {
    const { title, description, examType, duration, totalQuestions, totalMarks, instructions, startDate, endDate } = req.body;
    const adminId = req.adminId;
    
    const newExam = new Exam({
      title,
      description,
      examType: examType || 'weekend',
      duration,
      totalQuestions,
      totalMarks,
      instructions,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      isActive: true,
      createdBy: req.userId,
      adminId
    });
    
    await newExam.save();
    
    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: newExam
    });
  } catch (error) {
    console.error('Create exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to create exam' });
  }
};

export const updateExam = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const adminId = req.adminId;
    
    // Convert date strings to Date objects if provided
    if (updateData.startDate) {
      updateData.startDate = new Date(updateData.startDate);
    }
    if (updateData.endDate) {
      updateData.endDate = new Date(updateData.endDate);
    }
    
    // Build update filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const updatedExam = await Exam.findOneAndUpdate(
      filter,
      updateData,
      { new: true }
    ).populate('questions');
    
    if (!updatedExam) {
      return res.status(404).json({ 
        success: false, 
        message: 'Exam not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Exam updated successfully',
      data: updatedExam
    });
  } catch (error) {
    console.error('Update exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to update exam' });
  }
};

export const deleteExam = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminId;
    
    // Build delete filter
    const filter = { _id: id };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const deletedExam = await Exam.findOneAndDelete(filter);
    
    if (!deletedExam) {
      return res.status(404).json({ 
        success: false, 
        message: 'Exam not found or access denied' 
      });
    }
    
    // Also delete associated questions
    await Question.deleteMany({ exam: id, adminId });
    
    res.json({
      success: true,
      message: 'Exam deleted successfully'
    });
  } catch (error) {
    console.error('Delete exam error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete exam' });
  }
};

// Question Management
export const getExamQuestions = async (req, res) => {
  try {
    const { examId } = req.params;
    const adminId = req.adminId;
    
    // Build filter
    const filter = { exam: examId };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const questions = await Question.find(filter).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    console.error('Get exam questions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch questions' });
  }
};

export const createQuestion = async (req, res) => {
  try {
    const { examId } = req.params;
    const { questionText, questionImage, questionType, options, correctAnswer, marks, negativeMarks, explanation, subject } = req.body;
    const adminId = req.adminId;
    
    const newQuestion = new Question({
      questionText,
      questionImage,
      questionType,
      options,
      correctAnswer,
      marks: marks || 1,
      negativeMarks: negativeMarks || 0,
      explanation,
      subject: subject || 'maths',
      exam: examId,
      createdBy: req.userId,
      adminId,
      isActive: true
    });
    
    await newQuestion.save();
    
    // Add question to exam and update totalQuestions count
    await Exam.updateOne(
      { _id: examId },
      buildSafeAppendQuestionPipeline(newQuestion._id)
    );
    
    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: newQuestion
    });
  } catch (error) {
    console.error('Create question error:', error);
    res.status(500).json({ success: false, message: 'Failed to create question' });
  }
};

export const updateQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const updateData = req.body;
    const adminId = req.adminId;
    
    // Build update filter
    const filter = { _id: questionId };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const updatedQuestion = await Question.findOneAndUpdate(
      filter,
      updateData,
      { new: true }
    );
    
    if (!updatedQuestion) {
      return res.status(404).json({ 
        success: false, 
        message: 'Question not found or access denied' 
      });
    }
    
    res.json({
      success: true,
      message: 'Question updated successfully',
      data: updatedQuestion
    });
  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({ success: false, message: 'Failed to update question' });
  }
};

export const deleteQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const adminId = req.adminId;
    
    // Build delete filter
    const filter = { _id: questionId };
    if (adminId) {
      filter.adminId = adminId;
    }
    
    const deletedQuestion = await Question.findOneAndDelete(filter);
    
    if (!deletedQuestion) {
      return res.status(404).json({ 
        success: false, 
        message: 'Question not found or access denied' 
      });
    }
    
    // Remove question from exam and decrement totalQuestions count
    await Exam.updateOne(
      { _id: deletedQuestion.exam },
      buildSafeRemoveQuestionPipeline(deletedQuestion._id)
    );
    
    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete question' });
  }
};

// Test endpoint to debug teacher data
export const testTeacherData = async (req, res) => {
  try {
    console.log('Test teacher data request received');
    console.log('req.teacherId:', req.teacherId);
    console.log('req.user:', req.user);
    
    const teacherId = req.teacherId;
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'No teacherId found' });
    }
    
    // Get teacher data
    const teacher = await Teacher.findById(teacherId).populate('subjects');
    console.log('Teacher found:', teacher);
    
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    res.json({
      success: true,
      teacher: {
        id: teacher._id,
        email: teacher.email,
        fullName: teacher.fullName,
        assignedClassIds: teacher.assignedClassIds,
        subjects: teacher.subjects
      }
    });
  } catch (error) {
    console.error('Test teacher data error:', error);
    res.status(500).json({ success: false, message: 'Test failed', error: error.message });
  }
};

// Teacher Dashboard Stats
export const getTeacherDashboardStats = async (req, res) => {
  try {
    console.log('Teacher dashboard request received');
    console.log('req.teacherId:', req.teacherId);
    console.log('req.user:', req.user);
    
    const teacherId = req.teacherId;
    
    if (!teacherId) {
      console.error('No teacherId found in request');
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Get teacher's assigned classes with details (only active subjects on profile)
    const teacher = await Teacher.findById(teacherId).populate({
      path: 'subjects',
      match: { isActive: true },
      select: '_id name description code board classNumber isActive',
    });
    console.log('Teacher found:', teacher ? teacher.email : 'Not found');
    console.log('Teacher assignedClassIds:', teacher?.assignedClassIds);
    console.log('Teacher assignedClassIds length:', teacher?.assignedClassIds?.length);
    console.log('Teacher subjects:', teacher?.subjects);
    console.log('Teacher subjects length:', teacher?.subjects?.length);
    
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const explicitSubjectIdStr = new Set(
      getExplicitTeacherSubjectObjectIds(teacher).map((id) => id.toString())
    );

    // Get class details for assigned classes
    let assignedClassesDetails = [];
    let students = [];
    
    if (teacher.assignedClassIds && teacher.assignedClassIds.length > 0) {
      // Fetch actual Class documents from database (once)
      const classDocuments = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } }
        ],
        isActive: true
      })
      .populate('assignedSubjects', '_id name description code board')
      .select('_id classNumber section description assignedSubjects');

      const classObjectIds = classDocuments.map(c => c._id);
      
      // Get students assigned to these classes by assignedClass ObjectId
      students = await User.find({ 
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId  // Filter by teacher's admin
      })
      .populate('assignedClass', '_id classNumber section')
      .select('fullName email classNumber phone isActive createdAt lastLogin assignedClass');
      
      console.log('Teacher dashboard - Found students:', students.length);
      console.log('Teacher adminId:', teacher.adminId);
      console.log('Teacher assignedClassIds:', teacher.assignedClassIds);
      console.log('Class ObjectIds:', classObjectIds);
      console.log('Students data:', students.map(s => ({ 
        name: s.fullName, 
        class: s.classNumber, 
        assignedClass: s.assignedClass?._id,
        admin: s.assignedAdmin 
      })));

      // Build a map of classId (ObjectId or classNumber) -> Class document
      const classMap = new Map();
      classDocuments.forEach(classDoc => {
        // Map by ObjectId
        classMap.set(classDoc._id.toString(), classDoc);
        // Map by classNumber for backward compatibility
        classMap.set(classDoc.classNumber, classDoc);
      });

      // Build a map of classId -> studentCount
      const classIdToCount = new Map();
      teacher.assignedClassIds.forEach(classId => {
        const classDoc = classMap.get(String(classId));
        if (classDoc) {
          classIdToCount.set(String(classId), 0);
        }
      });

      // Count students assigned to each class
      // Students are matched by assignedClass ObjectId
      for (const student of students) {
        if (student.assignedClass && student.assignedClass._id) {
          const studentClassId = student.assignedClass._id.toString();
          // Check if this student's class is in the teacher's assigned classes
          for (const [classId, count] of classIdToCount.entries()) {
            const classDoc = classMap.get(classId);
            if (classDoc && (classDoc._id.toString() === studentClassId || 
                classDoc.classNumber === String(classId))) {
              classIdToCount.set(classId, count + 1);
              break;
            }
          }
        }
      }

      // Create class cards with real class names and student details
      assignedClassesDetails = teacher.assignedClassIds
        .map((classId) => {
          const classDoc = classMap.get(String(classId));
          if (!classDoc) {
            // If class not found, skip it
            return null;
          }

          // Get students for this specific class by assignedClass ObjectId
          const classStudents = students.filter(s => 
            s.assignedClass && 
            s.assignedClass._id && 
            s.assignedClass._id.toString() === classDoc._id.toString()
          );

          // Build class name from classNumber and section (e.g., "10C")
          const className = `${classDoc.classNumber}${classDoc.section || ''}`;
          
          // Subjects on the class row, limited to those on the teacher profile
          const assignedSubjects = classDoc.assignedSubjects
            ? classDoc.assignedSubjects
                .filter((subj) => {
                  const sid = (subj._id != null ? subj._id : subj).toString();
                  return explicitSubjectIdStr.has(sid);
                })
                .map((subj) => ({
                  _id: subj._id ? subj._id.toString() : subj.toString(),
                  name: subj.name || 'Unknown Subject',
                  description: subj.description || '',
                  code: subj.code || '',
                  board: subj.board || '',
                }))
            : [];

          return {
            id: classDoc._id.toString(),
            name: className,
            classNumber: classDoc.classNumber,
            section: classDoc.section,
            description: classDoc.description || '',
            assignedSubjects: assignedSubjects,
            subject:
              assignedSubjects.length > 0
                ? assignedSubjects[0].name
                : teacher.subjects && teacher.subjects.length > 0
                  ? teacher.subjects[0].name
                  : 'General',
            schedule: 'Mon, Wed, Fri',
            room: `Room ${className}`,
            studentCount: classIdToCount.get(String(classId)) || 0,
            students: classStudents.map(student => ({
              id: student._id,
              name: student.fullName,
              email: student.email,
              classNumber: student.classNumber,
              phone: student.phone,
              status: student.isActive ? 'active' : 'inactive',
              createdAt: student.createdAt,
              lastLogin: student.lastLogin
            }))
          };
        })
        .filter(classItem => classItem !== null); // Remove null entries
    }

    // Get teacher's videos and assessments
    const [videos, assessments, exams] = await Promise.all([
      Video.find({ createdBy: teacherId }).populate('createdBy', 'fullName email'),
      Assessment.find({ createdBy: teacherId }).populate('createdBy', 'fullName email'),
      Exam.find({ createdBy: teacherId }).populate('createdBy', 'fullName email')
    ]);

    // Calculate average performance
    const examResults = await ExamResult.find({ 
      studentId: { $in: students.map(s => s._id) }
    });
    
    const averagePerformance = examResults.length > 0 
      ? examResults.reduce((sum, result) => sum + result.score, 0) / examResults.length 
      : 0;

    // Get recent activity from real data
    const recentActivity = [];
    
    // Add recent video uploads
    const recentVideos = videos
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 3)
      .map(video => ({
        action: `Video uploaded: ${video.title}`,
        time: new Date(video.createdAt).toLocaleDateString(),
        type: 'video'
      }));
    
    // Add recent assessments
    const recentAssessments = assessments
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 2)
      .map(assessment => ({
        action: `Assessment created: ${assessment.title}`,
        time: new Date(assessment.createdAt).toLocaleDateString(),
        type: 'assessment'
      }));
    
    // Add recent exam completions
    const recentExams = examResults
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 2)
      .map(result => ({
        action: `Student completed exam (Score: ${result.score}%)`,
        time: new Date(result.createdAt).toLocaleDateString(),
        type: 'exam'
      }));
    
    recentActivity.push(...recentVideos, ...recentAssessments, ...recentExams);

    // Only subjects explicitly assigned on the teacher profile (not every class subject)
    const teacherSubjectsExplicit = (teacher.subjects || []).filter(
      (s) => s != null && s._id && s.isActive !== false
    );

    res.json({
      success: true,
      data: {
        stats: {
          totalStudents: students.length,
          totalClasses: teacher.assignedClassIds?.length || 0,
          totalVideos: videos.length,
          totalAssessments: assessments.length,
          totalExams: exams.length,
          averagePerformance: Math.round(averagePerformance)
        },
        teacherId: teacher._id.toString(),
        teacherEmail: teacher.email,
        teacherSubjects: teacherSubjectsExplicit,
        assignedClasses: assignedClassesDetails,
        students: students.map(student => ({
          id: student._id,
          name: student.fullName,
          email: student.email,
          classNumber: student.classNumber
        })),
        videos: videos.map(video => ({
          id: video._id,
          title: video.title,
          subject: video.subject,
          duration: video.duration,
          views: video.views || 0,
          createdAt: video.createdAt,
          createdBy: video.createdBy ? {
            name: video.createdBy.fullName,
            email: video.createdBy.email
          } : null
        })),
        assessments: assessments.map(assessment => ({
          id: assessment._id,
          title: assessment.title,
          subject: assessment.subject,
          questions: assessment.questions?.length || 0,
          attempts: assessment.attempts || 0,
          averageScore: assessment.averageScore || 0,
          createdAt: assessment.createdAt,
          createdBy: assessment.createdBy ? {
            name: assessment.createdBy.fullName,
            email: assessment.createdBy.email
          } : null
        })),
        exams: exams.map(exam => ({
          id: exam._id,
          title: exam.title,
          subject: exam.subject,
          questions: exam.questions?.length || 0,
          duration: exam.duration,
          createdAt: exam.createdAt,
          createdBy: exam.createdBy ? {
            name: exam.createdBy.fullName,
            email: exam.createdBy.email
          } : null
        })),
        recentActivity
      }
    });
    
    console.log(
      'Sending teacher subjects in response (explicit profile assignments only):',
      teacherSubjectsExplicit.length
    );
  } catch (error) {
    console.error('Teacher dashboard stats error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch teacher dashboard stats', error: error.message });
  }
};

// Assign classes to teacher
export const assignClasses = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { classIds } = req.body;
    const adminId = req.adminId;

    console.log('Assign classes request:', { teacherId, classIds, adminId });

    if (!teacherId || !classIds || !Array.isArray(classIds)) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID and class IDs array are required'
      });
    }

    // Find the teacher
    const teacher = await Teacher.findOne({ 
      _id: teacherId,
      ...(adminId ? { adminId } : {})
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Update teacher with new class IDs
    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherId,
      { 
        assignedClassIds: classIds,
        updatedAt: new Date()
      },
      { new: true }
    );

    console.log('Updated teacher classes:', updatedTeacher);
    console.log('Updated teacher assignedClassIds:', updatedTeacher.assignedClassIds);

    res.json({
      success: true,
      message: 'Classes assigned successfully',
      data: updatedTeacher
    });
  } catch (error) {
    console.error('Assign classes error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign classes' 
    });
  }
};

// Assign subjects to teacher
export const assignSubjects = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { subjectIds } = req.body;
    const adminId = req.adminId;

    console.log('Assign subjects request:', { teacherId, subjectIds, adminId });

    if (!teacherId || !subjectIds || !Array.isArray(subjectIds)) {
      return res.status(400).json({
        success: false,
        message: 'Teacher ID and subject IDs array are required'
      });
    }

    // Find the teacher
    const teacher = await Teacher.findOne({ 
      _id: teacherId,
      ...(adminId ? { adminId } : {})
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Update teacher with new subjects
    const updatedTeacher = await Teacher.findByIdAndUpdate(
      teacherId,
      { 
        subjects: subjectIds,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('subjects');

    console.log('Updated teacher:', updatedTeacher);

    res.json({
      success: true,
      message: 'Subjects assigned successfully',
      data: updatedTeacher
    });
  } catch (error) {
    console.error('Assign subjects error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign subjects' 
    });
  }
};

// Assign subjects to student
export const assignSubjectsToStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { subjectIds } = req.body;
    const adminId = req.adminId;

    console.log('Assign subjects to student request:', { studentId, subjectIds, adminId });

    if (!studentId || !subjectIds || !Array.isArray(subjectIds)) {
      return res.status(400).json({
        success: false,
        message: 'Student ID and subject IDs array are required'
      });
    }

    // Find the student
    const student = await User.findOne({ 
      _id: studentId,
      role: 'student',
      ...(adminId ? { assignedAdmin: adminId } : {})
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied'
      });
    }

    // Verify all subjects belong to the same board as the student
    const Subject = (await import('../models/Subject.js')).default;
    const subjects = await Subject.find({ 
      _id: { $in: subjectIds },
      board: student.board
    });

    if (subjects.length !== subjectIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Some subjects do not exist or belong to a different board'
      });
    }

    // Update student with assigned subjects
    const updatedStudent = await User.findByIdAndUpdate(
      studentId,
      { 
        assignedSubjects: subjectIds,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('assignedSubjects', 'name description board').select('-password');

    console.log('Updated student subjects:', updatedStudent);

    res.json({
      success: true,
      message: 'Subjects assigned to student successfully',
      data: updatedStudent
    });
  } catch (error) {
    console.error('Assign subjects to student error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign subjects to student' 
    });
  }
};

// Get Classes
export const getClasses = async (req, res) => {
  try {
    const adminId = req.adminId;

    // Get classes from Class model with assignedSubjects populated
    const classDocuments = await Class.find({
      assignedAdmin: adminId,
      isActive: true
    })
    .populate('assignedSubjects', '_id name description code board')
    .sort({ classNumber: 1, section: 1 });

    // Get students assigned to this admin with their assignedClass populated
    const students = await User.find({ 
      role: 'student',
      assignedAdmin: adminId 
    })
    .select('fullName email classNumber phone isActive createdAt lastLogin assignedClass')
    .populate('assignedClass', '_id name classNumber section')
    .limit(2000); // Reasonable limit for students
    // Note: lean() removed to maintain populate() functionality

    // Get all teachers assigned to this admin
    const teachers = await Teacher.find({
      adminId: adminId,
      isActive: true
    }).select('fullName email assignedClassIds');
    
    console.log(`Found ${teachers.length} teachers for admin ${adminId}`);
    teachers.forEach(teacher => {
      console.log(`  Teacher: ${teacher.fullName}, assignedClassIds:`, teacher.assignedClassIds);
    });

    // Format classes with students and teachers
    // Only show students who are explicitly assigned to this class via assignedClass field
    const classes = classDocuments.map(classDoc => {
      // Get students who have this specific class assigned (by assignedClass ObjectId)
      const classStudents = students
        .filter(student => {
          // Check if student has assignedClass that matches this class
          const studentAssignedClass = student.assignedClass;
          if (!studentAssignedClass) return false;
          
          // Handle both populated and non-populated cases
          const assignedClassId = studentAssignedClass._id 
            ? studentAssignedClass._id.toString() 
            : studentAssignedClass.toString();
          
          return assignedClassId === classDoc._id.toString();
        })
        .map(student => ({
          id: student._id,
          name: student.fullName,
          email: student.email,
          classNumber: student.classNumber,
          phone: student.phone,
          status: student.isActive ? 'active' : 'inactive',
          createdAt: student.createdAt,
          lastLogin: student.lastLogin
        }));

      // Get teachers assigned to this class
      // Teachers have assignedClassIds which can contain class ObjectId (from frontend)
      const classIdStr = classDoc._id.toString();
      const classNumberStr = classDoc.classNumber;
      
      console.log(`Checking class ${classDoc.name} (ID: ${classIdStr}, Number: ${classNumberStr})`);
      
      const classTeachers = teachers
        .filter(teacher => {
          if (!teacher.assignedClassIds || teacher.assignedClassIds.length === 0) {
            return false;
          }
          
          // Check if teacher's assignedClassIds contains this class's _id
          // assignedClassIds stores ObjectIds from the frontend (classItem.id)
          const matches = teacher.assignedClassIds.some(assignedId => {
            // Normalize both IDs to strings for comparison
            const assignedIdStr = String(assignedId);
            const classIdStrNormalized = String(classIdStr);
            
            // Match by ObjectId (primary method - what frontend sends)
            if (assignedIdStr === classIdStrNormalized) {
              console.log(`  ✓ Teacher ${teacher.fullName} matched by ObjectId: ${assignedIdStr}`);
              return true;
            }
            
            // Fallback: Match by classNumber (for backward compatibility)
            if (assignedIdStr === classNumberStr) {
              console.log(`  ✓ Teacher ${teacher.fullName} matched by classNumber: ${assignedIdStr}`);
              return true;
            }
            
            return false;
          });
          
          if (!matches) {
            console.log(`  ✗ Teacher ${teacher.fullName} not matched. Their assignedClassIds:`, teacher.assignedClassIds);
          }
          
          return matches;
        })
        .map(teacher => ({
          id: teacher._id.toString(),
          name: teacher.fullName,
          email: teacher.email
        }));
      
      console.log(`  Found ${classTeachers.length} teachers for class ${classDoc.name}`);
      
      // Format assignedSubjects for frontend
      const assignedSubjects = classDoc.assignedSubjects 
        ? classDoc.assignedSubjects.map(subj => ({
            _id: subj._id ? subj._id.toString() : subj.toString(),
            id: subj._id ? subj._id.toString() : subj.toString(),
            name: subj.name || 'Unknown Subject',
            description: subj.description || '',
            code: subj.code || '',
            board: subj.board || ''
          }))
        : [];

      return {
        id: classDoc._id.toString(),
        name: classDoc.name || `Class ${classDoc.classNumber}${classDoc.section}`,
        description: classDoc.description || '',
        classNumber: classDoc.classNumber,
        section: classDoc.section,
        assignedSubjects: assignedSubjects,
        subject: 'General',
        grade: classDoc.classNumber,
        teacher: classTeachers.length > 0 ? classTeachers.map(t => t.name).join(', ') : 'TBD',
        teachers: classTeachers,
        schedule: 'Mon-Fri 9:00 AM',
        room: `Room ${classDoc.classNumber}${classDoc.section}`,
        studentCount: classStudents.length,
        students: classStudents,
        createdAt: classDoc.createdAt
      };
    });

    // Only return classes that were explicitly created through the Add Class form
    // No automatic class creation from student data
    
    console.log('Classes being returned:', classes.map(c => ({ 
      name: c.name, 
      classNumber: c.classNumber,
      section: c.section,
      studentCount: c.studentCount
    })));
    res.json(classes);
  } catch (error) {
    console.error('Failed to fetch classes:', error);
    res.status(500).json({ message: 'Failed to fetch classes' });
  }
};

// Subject Management (Admin scoped by board)
export const getSubjects = async (req, res) => {
  try {
    const admin = await User.findById(req.adminId).select('board').lean();
    const board = admin?.board || 'ASLI_EXCLUSIVE_SCHOOLS';
    const subjects = await Subject.find({ board }).sort({ name: 1 }).lean();
    res.json({ success: true, data: subjects });
  } catch (error) {
    console.error('getSubjects error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects' });
  }
};

export const createSubject = async (req, res) => {
  try {
    const admin = await User.findById(req.adminId).select('board').lean();
    const board = admin?.board || 'ASLI_EXCLUSIVE_SCHOOLS';
    const { name, code, description, grade, department } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Subject name is required' });
    }

    const normalizedName = String(name).trim();
    const normalizedCode = String(code || '').trim();
    const existing = await Subject.findOne({
      board,
      isActive: true,
      $or: [{ name: normalizedName }, ...(normalizedCode ? [{ code: normalizedCode }] : [])],
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Subject already exists' });
    }

    const subject = await Subject.create({
      name: normalizedName,
      ...(normalizedCode ? { code: normalizedCode } : {}),
      description: String(description || '').trim(),
      classNumber: String(grade || '').trim() || undefined,
      board,
      createdBy: 'super-admin',
      isActive: true,
      department: String(department || '').trim() || undefined,
    });

    res.status(201).json({ success: true, data: subject });
  } catch (error) {
    console.error('createSubject error:', error);
    res.status(500).json({ success: false, message: 'Failed to create subject' });
  }
};

export const updateSubject = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid subject id' });
    }
    const { name, code, description, grade, department, isActive } = req.body;

    const subject = await Subject.findById(id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    if (name !== undefined) subject.name = String(name).trim();
    if (code !== undefined) subject.code = String(code).trim() || undefined;
    if (description !== undefined) subject.description = String(description).trim();
    if (grade !== undefined) subject.classNumber = String(grade).trim() || undefined;
    if (department !== undefined) subject.department = String(department).trim() || undefined;
    if (isActive !== undefined) subject.isActive = Boolean(isActive);
    await subject.save();

    res.json({ success: true, data: subject });
  } catch (error) {
    console.error('updateSubject error:', error);
    res.status(500).json({ success: false, message: 'Failed to update subject' });
  }
};

export const deleteSubject = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid subject id' });
    }
    const subject = await Subject.findById(id);
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    subject.isActive = false;
    subject.code = undefined;
    subject.name = `${subject.name}__deleted__${Date.now()}`;
    await subject.save();
    res.json({ success: true, message: 'Subject deleted' });
  } catch (error) {
    console.error('deleteSubject error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete subject' });
  }
};

// Assign class to student
export const assignClassToStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { classId } = req.body;
    const adminId = req.adminId || req.userId || req.user?.id || req.user?._id || req.user?.userId;

    console.log('Assign class to student request:', { studentId, classId, adminId });

    if (!studentId || !classId) {
      return res.status(400).json({
        success: false,
        message: 'Student ID and Class ID are required'
      });
    }

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Admin ID not found. Please ensure you are authenticated as an admin.'
      });
    }

    // Find the student
    const student = await User.findOne({ 
      _id: studentId,
      role: 'student',
      assignedAdmin: adminId
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or access denied'
      });
    }

    // Find the class and verify it belongs to the admin
    const classDoc = await Class.findOne({
      _id: classId,
      assignedAdmin: adminId,
      isActive: true
    });

    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found or access denied'
      });
    }

    // Update student with assigned class
    const updatedStudent = await User.findByIdAndUpdate(
      studentId,
      { 
        assignedClass: classId,
        classNumber: classDoc.classNumber, // Also update classNumber for backward compatibility
        updatedAt: new Date()
      },
      { new: true }
    )
    .populate('assignedClass', 'name classNumber section description')
    .select('-password');

    console.log('Updated student with class:', updatedStudent);

    res.json({
      success: true,
      message: 'Class assigned to student successfully',
      data: updatedStudent
    });
  } catch (error) {
    console.error('Assign class to student error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign class to student',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete Class
export const deleteClass = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminId;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID is required' 
      });
    }
    
    // Find the class and verify it belongs to this admin
    const classToDelete = await Class.findOne({
      _id: id,
      assignedAdmin: adminId
    });
    
    if (!classToDelete) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found or access denied' 
      });
    }
    
    // Delete the class from database
    await Class.findByIdAndDelete(id);
    
    console.log('Class deleted successfully:', {
      id: id,
      classNumber: classToDelete.classNumber,
      section: classToDelete.section,
      adminId: adminId
    });
    
    res.json({
      success: true,
      message: 'Class deleted successfully'
    });
  } catch (error) {
    console.error('Delete class error:', error);
    console.error('Delete class error stack:', error.stack);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to delete class';
    
    if (error.name === 'CastError') {
      errorMessage = 'Invalid class ID format';
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

// Delete All Classes
export const deleteAllClasses = async (req, res) => {
  try {
    const adminId = req.adminId;
    
    if (!adminId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Admin ID not found' 
      });
    }
    
    // Find all classes belonging to this admin
    const classesToDelete = await Class.find({
      assignedAdmin: adminId
    });
    
    if (classesToDelete.length === 0) {
      return res.json({
        success: true,
        message: 'No classes found to delete',
        deletedCount: 0
      });
    }
    
    // Delete all classes
    const deleteResult = await Class.deleteMany({
      assignedAdmin: adminId
    });
    
    console.log('All classes deleted successfully:', {
      deletedCount: deleteResult.deletedCount,
      adminId: adminId
    });
    
    res.json({
      success: true,
      message: `Successfully deleted ${deleteResult.deletedCount} class(es)`,
      deletedCount: deleteResult.deletedCount
    });
  } catch (error) {
    console.error('Delete all classes error:', error);
    console.error('Delete all classes error stack:', error.stack);
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete all classes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Promote Classes
export const promoteClasses = async (req, res) => {
  try {
    const { classIds } = req.body;
    const adminId = req.adminId;
    
    if (!adminId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Admin ID not found' 
      });
    }
    
    if (!classIds || !Array.isArray(classIds) || classIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class IDs are required' 
      });
    }
    
    // Convert classIds to ObjectIds if they are strings
    const mongoose = (await import('mongoose')).default;
    const objectIds = classIds.map(id => {
      try {
        // If it's already an ObjectId, return it
        if (mongoose.Types.ObjectId.isValid(id)) {
          return new mongoose.Types.ObjectId(id);
        }
        return id; // Return as-is if not valid ObjectId (shouldn't happen)
      } catch (error) {
        console.error(`Invalid class ID: ${id}`, error);
        return null;
      }
    }).filter(id => id !== null);
    
    console.log('Promoting classes - Admin ID:', adminId);
    console.log('Promoting classes - Class IDs received:', classIds);
    console.log('Promoting classes - Converted ObjectIds:', objectIds);
    
    // Find all classes belonging to this admin
    const classesToPromote = await Class.find({
      _id: { $in: objectIds },
      assignedAdmin: adminId
    });
    
    console.log('Promoting classes - Found classes to promote:', classesToPromote.length);
    console.log('Promoting classes - Classes found:', classesToPromote.map(c => ({
      id: c._id.toString(),
      name: c.name,
      classNumber: c.classNumber,
      section: c.section
    })));
    
    if (classesToPromote.length === 0) {
      console.error('No classes found to promote. Possible reasons:');
      console.error('- Class IDs do not match any classes in database');
      console.error('- Classes do not belong to this admin');
      console.error('- Class IDs format is incorrect');
      return res.status(404).json({ 
        success: false, 
        message: `No classes found to promote. Found ${objectIds.length} valid IDs but ${classesToPromote.length} matching classes.` 
      });
    }
    
    const promotedClasses = [];
    const finishedClasses = [];
    
    // Import User model to update student class assignments
    const User = (await import('../models/User.js')).default;
    
    for (const classDoc of classesToPromote) {
      // Handle both positive and negative class numbers
      const cleanClassNum = classDoc.classNumber.replace(/[^-\d]/g, '');
      const currentClassNum = parseInt(cleanClassNum);
      const absClassNum = Math.abs(currentClassNum);
      
      if (isNaN(currentClassNum) || absClassNum < 1 || absClassNum > 12) {
        continue; // Skip invalid class numbers
      }
      
      if (absClassNum === 12) {
        // Mark as finished academic career
        console.log(`Marking class ${classDoc.name} (${classDoc.classNumber}${classDoc.section || ''}) as finished`);
        classDoc.isActive = false;
        classDoc.description = classDoc.description 
          ? `${classDoc.description} - Finished Academic Career`
          : 'Finished Academic Career';
        // Note: status field may not exist in Class model, so we only set isActive
        await classDoc.save();
        console.log(`Class ${classDoc.name} marked as finished`);
        
        finishedClasses.push({
          id: classDoc._id.toString(),
          name: classDoc.name,
          classNumber: classDoc.classNumber,
          section: classDoc.section
        });
        
        // Update all students in this class to mark as finished
        const studentUpdateResult = await User.updateMany(
          { assignedClass: classDoc._id },
          { 
            $set: { 
              classNumber: 'Finished',
              isActive: false
            }
          }
        );
        console.log(`Updated ${studentUpdateResult.modifiedCount} students to Finished status for class ${classDoc.name}`);
      } else {
        // Promote to next class
        // Logic: 
        // - If abs value is 11, promote to 12 (regardless of sign)
        // - If abs value < 11, promote to abs value + 1 (always positive)
        // - Negative classes like -11, -10, -9 should become 12, 11, 10, etc.
        let nextClassNum;
        if (absClassNum === 11) {
          // Class 11 or -11 → Class 12
          nextClassNum = 12;
        } else if (absClassNum < 11) {
          // Class -10, -9, ..., -1, 1, 2, ..., 10 → Next positive class
          // -10 → 11, -9 → 10, ..., -1 → 2, 1 → 2, 2 → 3, ..., 10 → 11
          nextClassNum = absClassNum + 1;
        } else {
          // Should not reach here (absClassNum > 12 is filtered out)
          nextClassNum = absClassNum + 1;
        }
        
        const nextClassNumStr = nextClassNum.toString();
        const oldClassNumber = classDoc.classNumber;
        const oldName = classDoc.name;
        
        console.log(`Promoting: ${oldClassNumber}${classDoc.section || ''} (numeric: ${currentClassNum}, abs: ${absClassNum}) → Class ${nextClassNumStr}${classDoc.section || ''}`);
        
        // Check if a class with the new number already exists
        const existingClass = await Class.findOne({
          classNumber: nextClassNumStr,
          section: classDoc.section,
          assignedAdmin: adminId
        });
        
        if (existingClass) {
          // Merge students into existing class
          await User.updateMany(
            { assignedClass: classDoc._id },
            { 
              $set: { 
                assignedClass: existingClass._id,
                classNumber: nextClassNum.toString()
              }
            }
          );
          
          // Update student count
          existingClass.studentCount = (existingClass.studentCount || 0) + (classDoc.studentCount || 0);
          await existingClass.save();
          
          // Delete the old class
          await Class.findByIdAndDelete(classDoc._id);
          
          promotedClasses.push({
            id: classDoc._id.toString(),
            oldName: oldName,
            oldClassNumber: oldClassNumber,
            newName: existingClass.name,
            newClassNumber: nextClassNumStr,
            section: classDoc.section,
            merged: true
          });
        } else {
          // Update class to new number
          classDoc.classNumber = nextClassNumStr;
          classDoc.name = `Class ${nextClassNumStr}${classDoc.section || ''}`;
          classDoc.description = classDoc.description 
            ? `${classDoc.description} - Promoted from Class ${oldClassNumber}`
            : `Promoted from Class ${oldClassNumber}`;
          await classDoc.save();
          
          // Update all students in this class
          await User.updateMany(
            { assignedClass: classDoc._id },
            { 
              $set: { 
                classNumber: nextClassNumStr
              }
            }
          );
          
          promotedClasses.push({
            id: classDoc._id,
            oldName: oldName,
            newName: classDoc.name
          });
        }
      }
    }
    
    console.log('Classes promoted successfully:', {
      promotedCount: promotedClasses.length,
      finishedCount: finishedClasses.length,
      adminId: adminId
    });
    
    res.json({
      success: true,
      message: `Successfully promoted ${promotedClasses.length} class(es)${finishedClasses.length > 0 ? ` and marked ${finishedClasses.length} as finished` : ''}`,
      promotedCount: promotedClasses.length,
      finishedCount: finishedClasses.length,
      promotedClasses,
      finishedClasses
    });
  } catch (error) {
    console.error('Promote classes error:', error);
    console.error('Promote classes error stack:', error.stack);
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to promote classes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Create Class
export const createClass = async (req, res) => {
  try {
    const { classNumber, section, description } = req.body;
    
    // Get admin ID from request (set by extractAdminId middleware)
    // Try multiple sources: req.adminId, req.userId, req.user.id, req.user._id
    const adminId = req.adminId || req.userId || req.user?.id || req.user?._id || req.user?.userId;
    
    // Debug logging
    console.log('createClass - req.adminId:', req.adminId);
    console.log('createClass - req.userId:', req.userId);
    console.log('createClass - req.user:', req.user);
    console.log('createClass - adminId to use:', adminId);
    console.log('createClass - Request body:', { classNumber, section, description });
    
    if (!adminId) {
      console.error('createClass - No admin ID found in request');
      return res.status(401).json({ 
        success: false, 
        message: 'Admin ID not found. Please ensure you are authenticated as an admin. Try logging out and logging back in.' 
      });
    }
    
    // Validate required fields
    if (!classNumber || !section) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class number and section are required' 
      });
    }

    if (!['A', 'B', 'C'].includes(section)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Section must be A, B, or C' 
      });
    }
    
    // Get admin to inherit board and school
    // Try to find admin by ID (MongoDB ObjectId or string)
    let admin = null;
    try {
      // Try as ObjectId first
      if (mongoose.Types.ObjectId.isValid(adminId)) {
        admin = await User.findById(adminId).select('board schoolName role fullName email');
      } else {
        // If not valid ObjectId, try finding by email or other field
        console.log('adminId is not a valid ObjectId, trying alternative lookup');
        admin = await User.findOne({ 
          $or: [
            { _id: adminId },
            { email: req.user?.email }
          ]
        }).select('board schoolName role fullName email');
      }
    } catch (dbError) {
      console.error('Database error finding admin:', dbError);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error while finding admin' 
      });
    }
    
    console.log('createClass - Found admin:', admin ? { 
      id: admin._id, 
      role: admin.role, 
      board: admin.board,
      schoolName: admin.schoolName,
      email: admin.email
    } : 'null');
    
    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: `Admin not found with ID: ${adminId}. Please ensure you are logged in as an admin.` 
      });
    }
    
    if (admin.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: `User with ID ${adminId} is not an admin. Role: ${admin.role}. Please log in as an admin.` 
      });
    }

    if (!admin.board) {
      return res.status(400).json({ success: false, message: 'Admin must have a board assigned' });
    }

    // Check if class already exists (classNumber + section + admin)
    const existingClass = await Class.findOne({
      classNumber: classNumber.trim(),
      section: section,
      assignedAdmin: adminId
    });

    if (existingClass) {
      return res.status(400).json({ 
        success: false, 
        message: `Class ${classNumber}${section} already exists. Cannot create duplicate classes.` 
      });
    }

    // Create full class name
    const fullClassName = `Class ${classNumber}${section}`;
    
    // Create new class
    const newClass = new Class({
      classNumber: classNumber.trim(),
      section: section,
      name: fullClassName,
      description: description?.trim() || '',
      board: admin.board,
      school: admin.schoolName || '',
      assignedAdmin: adminId,
      isActive: true,
      assignedSubjects: []
    });

    await newClass.save();

    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      data: {
        id: newClass._id,
        classNumber: newClass.classNumber,
        section: newClass.section,
        name: newClass.name,
        description: newClass.description,
        board: newClass.board,
        school: newClass.school,
        assignedAdmin: newClass.assignedAdmin
      }
    });
  } catch (error) {
    console.error('Failed to create class:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create class';
    
    if (error.name === 'ValidationError') {
      errorMessage = `Validation error: ${Object.values(error.errors).map((e) => e.message).join(', ')}`;
    } else if (error.code === 11000) {
      // Duplicate key error (MongoDB)
      errorMessage = `Class ${req.body.classNumber}${req.body.section} already exists`;
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

export const assignSubjectsToClass = async (req, res) => {
  try {
    let { classNumber } = req.params;
    const { subjectIds } = req.body;
    const adminId = req.adminId;

    console.log('Assign subjects to class request:', { classNumber, subjectIds, adminId });

    if (!classNumber || !subjectIds || !Array.isArray(subjectIds)) {
      return res.status(400).json({
        success: false,
        message: 'Class number and subject IDs array are required'
      });
    }

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Admin ID is required'
      });
    }

    // Normalize classNumber - handle formats like "Class-9" or "9"
    // Remove "Class-" prefix if present
    if (classNumber.startsWith('Class-')) {
      classNumber = classNumber.replace('Class-', '');
    }
    // Also handle URL encoding
    classNumber = decodeURIComponent(classNumber);

    // Validate that classNumber is not an ObjectId (should be a string like "10", "11", etc.)
    if (mongoose.Types.ObjectId.isValid(classNumber) && classNumber.length === 24) {
      return res.status(400).json({
        success: false,
        message: 'Invalid class number format. Please select a class number (e.g., "10", "11"), not a class ID.'
      });
    }

    console.log('Normalized classNumber:', classNumber);

    // Validate subject IDs format (should be MongoDB ObjectIds)
    const validSubjectIds = subjectIds.filter(id => {
      try {
        return mongoose.Types.ObjectId.isValid(id);
      } catch (e) {
        return false;
      }
    });

    if (validSubjectIds.length !== subjectIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more subject IDs are invalid format'
      });
    }

    // Validate that all subject IDs exist
    const subjects = await Subject.find({ _id: { $in: validSubjectIds } });
    
    if (subjects.length !== validSubjectIds.length) {
      return res.status(400).json({
        success: false,
        message: `One or more subject IDs are invalid. Found ${subjects.length} out of ${validSubjectIds.length} subjects.`
      });
    }

    // Validate adminId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin ID format'
      });
    }

    // Find all classes with this classNumber (all sections: A, B, C)
    const classesWithThisNumber = await Class.find({ 
      classNumber: classNumber,
      assignedAdmin: adminId,
      isActive: true
    });

    console.log(`Found ${classesWithThisNumber.length} classes with classNumber ${classNumber}`);

    if (classesWithThisNumber.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No classes found with class number ${classNumber}. Please create classes first.`
      });
    }

    // Update all classes (all sections) with the same subjects
    const updatePromises = classesWithThisNumber.map(async (classDoc) => {
      // Use updateOne to avoid validation issues with save()
      await Class.updateOne(
        { _id: classDoc._id },
        { 
          $set: { 
            assignedSubjects: validSubjectIds,
            updatedAt: new Date()
          }
        }
      );
      console.log(`Updated class ${classDoc.classNumber}${classDoc.section} with subjects`);
      // Reload the document to get updated data
      return await Class.findById(classDoc._id);
    });

    const updatedClasses = await Promise.all(updatePromises);

    // Populate subjects for response
    await Promise.all(updatedClasses.map(c => c.populate('assignedSubjects')));

    console.log(`Updated ${updatedClasses.length} classes with subjects:`, updatedClasses.map(c => `${c.classNumber}${c.section}`));

    res.json({
      success: true,
      message: `Subjects assigned to all sections of Class ${classNumber} successfully`,
      data: {
        classNumber: classNumber,
        sectionsUpdated: updatedClasses.length,
        sections: updatedClasses.map(c => ({
          section: c.section,
          name: c.name,
          assignedSubjects: c.assignedSubjects
        }))
      }
    });
  } catch (error) {
    console.error('Assign subjects to class error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign subjects to class',
      error: error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// AI Student Risk Analysis - Uses configured local LLM
export const analyzeStudentRisk = async (req, res) => {
  try {
    const { studentId, analysisType = 'comprehensive', timeRange = '90days' } = req.body;
    const adminId = req.adminId;

    // Verify student belongs to this admin
    const student = await User.findOne({ 
      _id: studentId, 
      role: 'student', 
      assignedAdmin: adminId 
    });

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found or not assigned to you' 
      });
    }

    // Calculate date range
    const daysAgo = timeRange === 'all' ? 365 * 5 : parseInt(timeRange);
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

    // Generate AI analysis using configured LLM
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
      console.error('Raw AI response:', aiResponse);
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
    console.error('Student risk analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze student risk',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Download PDF and Send to Student (Admin version)
export const downloadAndSendRiskAnalysisPDF = async (req, res) => {
  try {
    const { studentId, analysisData } = req.body;
    const adminId = req.adminId;

    if (!studentId || !analysisData) {
      return res.status(400).json({
        success: false,
        message: 'Student ID and analysis data are required'
      });
    }

    // Verify student belongs to this admin
    const student = await User.findOne({ 
      _id: studentId, 
      role: 'student', 
      assignedAdmin: adminId 
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or not assigned to you'
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
      adminId: adminId,
      analysisData,
      pdfPath: filepath,
      pdfFilename: filename
    });

    res.json({
      success: true,
      message: 'PDF generated and sent to student successfully',
      data: {
        reportId: report._id,
        pdfPath: `/api/admin/reports/download/${report._id}`,
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

// Download PDF file (Admin version)
export const downloadRiskAnalysisPDF = async (req, res) => {
  try {
    const { reportId } = req.params;
    const adminId = req.adminId;

    const report = await RiskAnalysisReport.findById(reportId).populate('studentId');
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Check if admin has access to this student
    if (report.studentId.assignedAdmin.toString() !== adminId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const fs = await import('fs');

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