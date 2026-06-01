import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Video from '../models/Video.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import Content from '../models/Content.js';
import {
  buildActiveSubjectIdSet,
  filterContentRowsForActiveCatalog,
  getActiveCatalogSubjectIds,
} from '../utils/activeCatalog.js';
import TeacherWorkDiary from '../models/TeacherWorkDiary.js';
import RiskAnalysisReport from '../models/RiskAnalysisReport.js';
import {
  verifyToken,
  verifyAdmin,
  extractAdminId,
  authorizeRoles,
  verifyDataOwnership,
  addAdminIdToBody
} from '../middleware/auth.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import {
  getAdminDashboardStats,
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  getTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  bulkDeleteTeachers,
  assignSubjects,
  assignClasses,
  getStudentAnalytics,
  assignSubjectsToStudent,
  assignClassToStudent,
  assignSubjectsToClass,
  assignSubjectsToClassById,
  getTeacherDashboardStats,
  getVideos,
  getAssessments,
  getAnalytics,
  getClasses,
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  uploadTeachersCsv,
  uploadStudentsCsv,
  createClass,
  deleteClass,
  deleteAllClasses,
  promoteClasses,
  analyzeStudentRisk,
  downloadAndSendRiskAnalysisPDF,
  downloadRiskAnalysisPDF
} from '../controllers/adminController.js';
import {
  getViewableExams,
  getExamDetails,
  getStudentExamResults,
  getExamPerformanceAnalytics
} from '../controllers/adminExamViewController.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Apply authentication middleware to all routes
router.use(verifyToken);
router.use(verifyAdmin);
router.use(extractAdminId);

// Dashboard Routes
router.get('/dashboard/stats', getAdminDashboardStats);
router.get('/analytics', getAnalytics);
router.get('/risk-summary', async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = {
      'analysisData.riskLevel': { $regex: /^high$/i },
    };
    if (adminId) {
      filter.adminId = adminId;
    }

    const reports = await RiskAnalysisReport.find(filter)
      .sort({ sentAt: -1 })
      .limit(50)
      .populate('studentId', 'fullName name email classNumber')
      .lean();

    const students = reports.slice(0, 10).map((r) => {
      const scoreRaw = r.analysisData?.riskScore;
      const riskScorePct =
        scoreRaw != null && Number.isFinite(Number(scoreRaw))
          ? Math.round(Number(scoreRaw) <= 1 ? Number(scoreRaw) * 100 : Number(scoreRaw))
          : null;
      return {
        _id: r._id,
        studentId: r.studentId,
        riskScore: riskScorePct,
      };
    });

    res.json({ success: true, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Teacher Dashboard Routes
router.get('/teacher/dashboard', getTeacherDashboardStats);

// Student Management Routes
router.get('/students', getStudents);
router.get('/students/analytics', getStudentAnalytics);
router.post('/students', addAdminIdToBody, createStudent);
router.put('/students/:id', verifyDataOwnership(User), updateStudent);
router.delete('/students/:id', verifyDataOwnership(User), deleteStudent);
router.post('/students/:studentId/assign-subjects', assignSubjectsToStudent);
router.post('/students/:studentId/assign-class', assignClassToStudent);

// Class Management Routes
router.get('/classes', getClasses);
router.get('/subjects', getSubjects);
router.post('/subjects', createSubject);
router.put('/subjects/:id', updateSubject);
router.delete('/subjects/:id', deleteSubject);
router.post('/classes', createClass);
router.post('/classes/by-id/:classId/assign-subjects', assignSubjectsToClassById);
router.delete('/classes/delete-all', deleteAllClasses); // Must come before /classes/:id to avoid route conflict
router.delete('/classes/:id', deleteClass);
router.post('/classes/promote', promoteClasses);
router.post('/classes/:classNumber/assign-subjects', assignSubjectsToClass);

// Teacher Management Routes
router.get('/teachers', getTeachers);
router.post('/teachers', addAdminIdToBody, createTeacher);
router.post('/teachers/bulk-delete', bulkDeleteTeachers);
router.post('/teachers/upload', upload.single('file'), uploadTeachersCsv);
router.put('/teachers/:id', verifyDataOwnership(Teacher), updateTeacher);
router.delete('/teachers/:id', verifyDataOwnership(Teacher), deleteTeacher);
router.post('/teachers/:teacherId/assign-subjects', assignSubjects);
router.post('/teachers/:teacherId/assign-classes', assignClasses);

// Video/Course Management Routes - REMOVED (Admins cannot create content)
// router.post('/videos', addAdminIdToBody, createVideo);
// router.put('/videos/:id', verifyDataOwnership(Video), updateVideo);
// router.delete('/videos/:id', verifyDataOwnership(Video), deleteVideo);

// Assessment Management Routes - REMOVED (Admins cannot create assessments)
// router.post('/assessments', addAdminIdToBody, createAssessment);
// router.put('/assessments/:id', verifyDataOwnership(Assessment), updateAssessment);
// router.delete('/assessments/:id', verifyDataOwnership(Assessment), deleteAssessment);

// CSV Upload for Students (class, section, per-row password)
router.post('/students/upload', upload.single('file'), uploadStudentsCsv);

// Exam View Routes (Admins can only view Super Admin created exams)
router.get('/exams/viewable', getViewableExams); // View Super Admin created exams for their board
router.get('/exams/:examId/view', getExamDetails); // View exam details
router.get('/exam-results', getStudentExamResults); // View student exam results with filters
router.get('/exams/:examId/analytics', getExamPerformanceAnalytics); // View exam performance analytics

// Get Asli Prep content for admin's board
router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic } = req.query;
    const adminId = req.adminId;
    
    console.log('📚 Fetching Asli Prep content for admin:', adminId);
    console.log('Query params:', { subject, type, topic });
    
    // Remove board restrictions - show all content to all admins
    // Content is filtered only by class/subject, not by board
    console.log('📚 Fetching all content (board restrictions removed)');

    const { getAdminSchoolProgramContext, applySchoolProgramContentFilters, isAllowedContentType } =
      await import('../utils/schoolProgram.js');
    const programCtx = await getAdminSchoolProgramContext(adminId);

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      return res.json({ success: true, data: [] });
    }
    
    // Match Super Admin catalog: active content on active subjects only (no soft-deleted rows).
    const activeSubjectIds = await getActiveCatalogSubjectIds();
    const activeIdSet = buildActiveSubjectIdSet(activeSubjectIds);

    const query = {
      isActive: true,
      subject: { $in: activeSubjectIds },
    };

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(subject)) {
      const sid = String(subject);
      if (activeIdSet.has(sid)) {
        query.subject = new mongoose.Types.ObjectId(sid);
      } else {
        return res.json({ success: true, data: [] });
      }
    }

    if (type && type !== 'all') {
      query.type = type;
    }

    if (topic && topic.trim()) {
      query.topic = { $regex: topic.trim(), $options: 'i' };
    }

    console.log('📋 Content query:', JSON.stringify(query, null, 2));

    let contents = await Content.find(query)
      .populate('subject', 'name isActive classNumber board stateName')
      .sort({ createdAt: -1 })
      .lean();

    contents = filterContentRowsForActiveCatalog(contents, activeIdSet);

    contents = applySchoolProgramContentFilters(contents, programCtx);

    console.log(`✅ Found ${contents.length} active catalog contents`);

    const { enrichContentDurations } = await import('../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    res.json({
      success: true,
      data: contents,
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content for admin:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

// Removed: POST /exams, PUT /exams/:id, DELETE /exams/:id
// Removed: POST /exams/:examId/questions, PUT /questions/:questionId, DELETE /questions/:questionId
// Admins can NO LONGER create, edit, or delete exams

// AI Student Risk Analysis
router.post('/ai/student-risk-analysis', verifyAdmin, analyzeStudentRisk);
router.post('/ai/student-risk-analysis/download-send', verifyAdmin, downloadAndSendRiskAnalysisPDF);
router.get('/reports/download/:reportId', verifyAdmin, downloadRiskAnalysisPDF);

// Teacher daily work diaries for this school (admin) or all (super-admin)
router.get('/teacher-work-diary', async (req, res) => {
  try {
    const { teacherId, limit = '60' } = req.query;
    const q = {};
    if (req.adminId) {
      q.adminId = req.adminId;
    }
    if (teacherId && mongoose.Types.ObjectId.isValid(String(teacherId))) {
      q.teacherId = new mongoose.Types.ObjectId(String(teacherId));
    }
    const lim = Math.min(parseInt(String(limit), 10) || 60, 200);
    const entries = await TeacherWorkDiary.find(q)
      .sort({ forDate: -1 })
      .limit(lim)
      .populate('teacherId', 'fullName email')
      .populate('classId', 'classNumber section name')
      .lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('Admin teacher-work-diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to load teacher diaries' });
  }
});

export default router;