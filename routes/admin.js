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
  assignSubjects,
  assignClasses,
  getStudentAnalytics,
  assignSubjectsToStudent,
  assignClassToStudent,
  assignSubjectsToClass,
  getTeacherDashboardStats,
  getVideos,
  getAssessments,
  getAnalytics,
  getClasses,
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
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
router.delete('/classes/delete-all', deleteAllClasses); // Must come before /classes/:id to avoid route conflict
router.delete('/classes/:id', deleteClass);
router.post('/classes/promote', promoteClasses);
router.post('/classes/:classNumber/assign-subjects', assignSubjectsToClass);

// Teacher Management Routes
router.get('/teachers', getTeachers);
router.post('/teachers', addAdminIdToBody, createTeacher);
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

// CSV Upload for Students
router.post('/students/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('CSV upload request received');
    console.log('File:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'No file');
    
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const adminId = req.adminId;
    console.log('Admin ID for CSV upload:', adminId);

    // Get admin to inherit board and school
    const admin = await User.findById(adminId).select('board schoolName role');
    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    if (!admin.board) {
      return res.status(400).json({ 
        message: 'Admin must have a board assigned before uploading students. Please update your admin profile first.' 
      });
    }

    console.log('Admin board:', admin.board, 'School:', admin.schoolName);

    // Accept .xlsx / .xls natively OR .csv (encoding auto-detected).
    let csvData;
    try {
      ({ csv: csvData } = spreadsheetBufferToCsv(req.file.buffer, req.file.originalname));
    } catch (err) {
      return res.status(400).json({ message: `Failed to read uploaded file: ${err.message}` });
    }
    
    // Parse CSV data - handle both \n and \r\n line endings
    const lines = csvData.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ message: 'File must have at least a header row and one data row' });
    }

    // Helper function to parse CSV line (handles quoted values); cleanCsvCell
    // also normalizes smart punctuation (−, –, —, ’, “, …) back to plain ASCII.
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(cleanCsvCell(current));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(cleanCsvCell(current)); // Add last field
      return result;
    };

    // Get header row
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    
    // Validate headers
    const requiredHeaders = ['name', 'email', 'phone'];
    const classHeader = headers.find(h => h === 'classnumber');
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    
    if (missingHeaders.length > 0) {
      return res.status(400).json({ 
        message: `Missing required headers: ${missingHeaders.join(', ')}` 
      });
    }
    
    if (!classHeader) {
      return res.status(400).json({ 
        message: 'Missing class header. Please include "classnumber" column' 
      });
    }

    const createdUsers = [];
    const errors = [];
    const createdClasses = new Map(); // Track created classes to avoid duplicates

    // Import Class model
    const Class = (await import('../models/Class.js')).default;

    // Helper function to parse class number and section from CSV
    const parseClassInfo = (classValue) => {
      if (!classValue || classValue.trim() === '' || classValue.toLowerCase() === 'unassigned') {
        return { classNumber: null, section: 'A' };
      }

      const classStr = classValue.trim();
      
      // Try to extract section from formats like "10-A", "10A", "Class 10-A", "Class 10A"
      const sectionMatch = classStr.match(/[-_]?([ABC])$/i);
      const section = sectionMatch ? sectionMatch[1].toUpperCase() : 'A';
      
      // Extract class number (remove "Class", "Class-", section, etc.)
      let classNumber = classStr
        .replace(/^class\s*/i, '')  // Remove "Class" prefix
        .replace(/[-_]?[ABC]$/i, '')  // Remove section suffix
        .trim();
      
      // If still empty or invalid, use the original value
      if (!classNumber || classNumber === '') {
        classNumber = classStr.replace(/[-_]?[ABC]$/i, '').trim();
      }

      return { classNumber, section };
    };

    // Helper function to get or create class
    const getOrCreateClass = async (classNumber, section) => {
      if (!classNumber || classNumber === 'Unassigned') {
        return null;
      }

      const classKey = `${classNumber}-${section}`;
      
      // Check if we already created this class in this batch
      if (createdClasses.has(classKey)) {
        return createdClasses.get(classKey);
      }

      // Check if class already exists
      let classDoc = await Class.findOne({
        classNumber: classNumber.trim(),
        section: section,
        assignedAdmin: adminId
      });

      if (!classDoc) {
        // Create new class
        const fullClassName = `Class ${classNumber}${section}`;
        classDoc = new Class({
          classNumber: classNumber.trim(),
          section: section,
          name: fullClassName,
          description: `Auto-created from CSV upload`,
          board: admin.board,
          school: admin.schoolName || '',
          assignedAdmin: adminId,
          isActive: true,
          assignedSubjects: []
        });

        await classDoc.save();
        console.log(`✅ Created new class: ${fullClassName}`);
      }

      createdClasses.set(classKey, classDoc);
      return classDoc;
    };

    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]).map(v => v.trim().replace(/^"|"$/g, ''));
        
        if (values.length !== headers.length) {
          errors.push(`Row ${i + 1}: Column count mismatch`);
          continue;
        }

        // Create user object
        const userData = {};
        headers.forEach((header, index) => {
          userData[header] = values[index];
        });

        // Check if user already exists
        const existingUser = await User.findOne({ email: userData.email });
        if (existingUser) {
          errors.push(`Row ${i + 1}: User with email ${userData.email} already exists`);
          continue;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash('Password123', 12);

        // Parse class information from CSV
        const classValue = userData.classnumber || userData.class || '';
        const { classNumber, section } = parseClassInfo(classValue);

        // Get or create class if class number is provided
        let assignedClass = null;
        if (classNumber && classNumber !== 'Unassigned') {
          try {
            assignedClass = await getOrCreateClass(classNumber, section);
          } catch (classError) {
            errors.push(`Row ${i + 1}: Failed to create class ${classNumber}${section}: ${classError.message}`);
            // Continue with user creation even if class creation fails
          }
        }

        // Create new user and assign to the logged-in admin
        const newUser = new User({
          fullName: userData.name,
          email: userData.email,
          classNumber: classNumber || 'Unassigned',
          phone: userData.phone,
          password: hashedPassword,
          role: 'student',
          isActive: true,
          assignedAdmin: adminId,  // Assign to the logged-in admin
          assignedClass: assignedClass ? assignedClass._id : undefined,  // Assign to class if created
          board: admin.board,      // Inherit board from admin
          schoolName: admin.schoolName || ''  // Inherit school name from admin
        });

        await newUser.save();
        createdUsers.push({
          id: newUser._id,
          name: newUser.fullName,
          email: newUser.email,
          classNumber: newUser.classNumber,
          class: assignedClass ? `${assignedClass.classNumber}${assignedClass.section}` : 'Unassigned'
        });

      } catch (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    const classesCreated = createdClasses.size;
    let message = `CSV processed successfully. Created ${createdUsers.length} students.`;
    if (classesCreated > 0) {
      message += ` Created ${classesCreated} new class${classesCreated > 1 ? 'es' : ''}.`;
    }

    res.json({
      message: message,
      createdUsers,
      classesCreated: classesCreated,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('CSV upload error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to process CSV file',
      error: error.message,
      hint: error.message.includes('board') ? 'Make sure your admin account has a board assigned' : 'Please check the CSV format and try again'
    });
  }
});

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
    
    // Build query - no board filtering, show all content
    const query = {
      isActive: true,
      isExclusive: true
    };
    
    // If specific subject is requested
    if (subject && subject !== 'all') {
      if (mongoose.Types.ObjectId.isValid(subject)) {
        query.subject = subject;
      }
    }
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    if (topic && topic.trim()) {
      query.topic = { $regex: topic.trim(), $options: 'i' };
    }
    
    console.log('📋 Content query:', JSON.stringify(query, null, 2));
    
    const contents = await Content.find(query)
      .populate('subject', 'name')
      .sort({ createdAt: -1 });
    
    console.log(`✅ Found ${contents.length} contents (all boards visible)`);
    
    res.json({
      success: true,
      data: contents
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
      .lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('Admin teacher-work-diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to load teacher diaries' });
  }
});

export default router;