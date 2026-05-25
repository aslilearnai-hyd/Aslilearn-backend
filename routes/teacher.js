import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  verifyToken,
  verifyTeacher,
  extractTeacherId
} from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  getTeacherDashboardStats,
  testTeacherData
} from '../controllers/adminController.js';
import {
  createLessonPlan,
  createTestQuestions,
  createClasswork,
  createSchedule,
  createTeacherTool,
  generateContent,
  getGeneratedContent,
  getSubjects,
  getTopics,
  getAvailableContent
} from '../controllers/aiToolsController.js';
import Video from '../models/Video.js';
import Assessment from '../models/Assessment.js';
import Exam from '../models/Exam.js';
import CalendarEvent from '../models/CalendarEvent.js';
import Event from '../models/Event.js';
import User from '../models/User.js';
import ExamResult from '../models/ExamResult.js';
import Teacher from '../models/Teacher.js';
import Content from '../models/Content.js';
import StudentRemark from '../models/StudentRemark.js';
import TeacherWorkDiary from '../models/TeacherWorkDiary.js';
import { examVisibleToSchool } from '../controllers/calendarController.js';
import {
  getExplicitTeacherSubjectObjectIds,
  subjectIdAllowed,
} from '../utils/teacherSubjectScope.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
} from '../utils/resolveSubjectContentIds.js';
import Subject from '../models/Subject.js';

const router = express.Router();

/** YYYY-MM-DD -> UTC midnight for that calendar day */
function parseDateKeyToUtc(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
}

// Test route without any middleware
router.post('/test-video', async (req, res) => {
  try {
    console.log('=== SIMPLE TEST VIDEO ===');
    console.log('Body:', req.body);
    
    const testVideo = new Video({
      title: 'Simple Test',
      description: 'Test',
      subjectId: 'test',
      duration: 3600,
      videoUrl: 'https://test.com',
      youtubeUrl: 'https://test.com',
      isYouTubeVideo: true,
      difficulty: 'beginner',
      createdBy: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      adminId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      isPublished: true
    });
    
    await testVideo.save();
    res.json({ success: true, message: 'Simple test passed', id: testVideo._id });
  } catch (error) {
    console.error('Simple test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadDir = path.join(__dirname, '../uploads/pdfs');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'pdf-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for PDFs
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Teacher Dashboard Routes (before auth middleware for testing)
router.get('/test', testTeacherData);

// Apply authentication middleware to all routes
router.use(verifyToken);

// AI Tools Routes - Allow both teachers and students (before verifyTeacher)
// Allow both teachers and students to access these endpoints
const allowTeacherOrStudent = (req, res, next) => {
  if (req.user.role === 'teacher' || req.user.role === 'student') {
    if (req.user.role === 'student') {
      req.teacherId = req.userId;
    } else if (req.user.role === 'teacher') {
      req.teacherId = req.userId;
    }
    next();
  } else {
    return res.status(403).json({ success: false, message: 'Access denied. Teacher or Student privileges required.' });
  }
};

router.get('/ai/subjects', allowTeacherOrStudent, getSubjects); // Returns valid subjects for Class 6
router.get('/ai/topics', allowTeacherOrStudent, getTopics); // Returns chapters from planner.json
router.get('/ai/available-content', allowTeacherOrStudent, getAvailableContent); // Returns all available content types for a chapter
router.post('/ai/tool', allowTeacherOrStudent, createTeacherTool); // Uses hardcoded content only
router.post('/ai/generate-content', allowTeacherOrStudent, generateContent); // Generate + persist
router.get('/ai/generated-content', allowTeacherOrStudent, getGeneratedContent); // Fallback latest generated content

// Apply teacher-only middleware for other routes
router.use(verifyTeacher);
router.use(extractTeacherId);

// Teacher Dashboard Routes
router.get('/dashboard', getTeacherDashboardStats);

/** GET /api/teacher/calendar/events?month=yyyy-mm */
router.get('/calendar/events', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({
        success: false,
        message: 'Query param month is required (format yyyy-mm)',
      });
    }

    const teacher = await Teacher.findById(req.teacherId).select('_id adminId');
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    if (!teacher.adminId || !mongoose.Types.ObjectId.isValid(teacher.adminId)) {
      return res.json({ success: true, data: [] });
    }

    const [y, m] = String(month).split('-').map((v) => parseInt(v, 10));
    const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
    const schoolOid = new mongoose.Types.ObjectId(teacher.adminId);

    const examDocs = await Exam.find({
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
      createdByRole: 'super-admin',
      isActive: { $ne: false },
    })
      .populate('targetSchools', 'schoolName fullName name email')
      .populate('schoolId', 'schoolName fullName name email')
      .sort({ startDate: 1 })
      .lean();

    const examEvents = examDocs
      .filter((ex) => examVisibleToSchool(ex, schoolOid))
      .map((ex) => ({
        id: `exam-${ex._id.toString()}`,
        title: ex.title,
        startDate: ex.startDate,
        endDate: ex.endDate,
        eventType: 'exam',
        subject: ex.subject,
        classNumber:
          Array.isArray(ex.assignedClasses) && ex.assignedClasses.length > 0
            ? ex.assignedClasses.map((c) => String(c)).join(', ')
            : ex.classNumber || '',
        room: ex.room || '',
        description: ex.description || '',
      }));

    const legacyEvents = await Event.find({
      createdBy: schoolOid,
      date: { $gte: monthStart, $lte: monthEnd },
    })
      .sort({ date: 1 })
      .lean();

    const adminLegacyEvents = legacyEvents.map((ev) => ({
      id: `admin-event-${ev._id.toString()}`,
      title: ev.name,
      startDate: ev.date,
      endDate: ev.endDate || ev.date,
      eventType: 'admin_event',
      description: ev.description || '',
      room: '',
    }));

    const calendarEvents = await CalendarEvent.find({
      schoolId: schoolOid,
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
    })
      .sort({ startDate: 1 })
      .lean();

    const adminCalendarEvents = calendarEvents.map((ev) => ({
      id: `calendar-event-${ev._id.toString()}`,
      title: ev.title,
      startDate: ev.startDate,
      endDate: ev.endDate,
      eventType: 'admin_event',
      description: ev.description || '',
      room: '',
    }));

    const data = [...examEvents, ...adminLegacyEvents, ...adminCalendarEvents].sort(
      (a, b) => new Date(a.startDate) - new Date(b.startDate)
    );

    res.json({ success: true, data });
  } catch (error) {
    console.error('Teacher calendar events error:', error);
    res.status(500).json({ success: false, message: 'Failed to load calendar events' });
  }
});

// Get teacher's assigned classes
async function getTeacherClassesHandler(req, res) {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER CLASSES ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Get teacher with assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    if (!teacher.assignedClassIds || teacher.assignedClassIds.length === 0) {
      console.log('Teacher has no assigned classes');
      return res.json({ success: true, data: [] });
    }
    
    // Get Class model
    const Class = (await import('../models/Class.js')).default;
    
    // Fetch actual Class documents from database
    const classIdSet = new Set((teacher.assignedClassIds || []).map(String));
    (teacher.assignments || []).forEach((a) => {
      if (a.classId) classIdSet.add(String(a.classId));
    });

    const classDocuments = await Class.find({
      $or: [
        { _id: { $in: [...classIdSet].filter((id) => mongoose.Types.ObjectId.isValid(id)) } },
        { classNumber: { $in: teacher.assignedClassIds || [] } },
      ],
      isActive: true,
    })
    .populate('assignedSubjects', '_id name description code board')
    .select('_id classNumber section description assignedSubjects name');
    
    // Get student counts for each class
    const classObjectIds = classDocuments.map(c => c._id);
    const students = await User.find({ 
      role: 'student',
      assignedClass: { $in: classObjectIds },
      assignedAdmin: teacher.adminId
    })
    .populate('assignedClass', '_id classNumber section')
    .select('fullName email classNumber assignedClass');
    
    // Map classes with student counts
    const classesWithStudents = classDocuments.map(classDoc => {
      const classStudents = students.filter(s => 
        s.assignedClass && s.assignedClass._id.toString() === classDoc._id.toString()
      );
      
      const assignmentSubjects = (teacher.assignments || [])
        .filter((a) => String(a.classId) === String(classDoc._id))
        .map((a) => a.subjectId);

      const subjectsFromClass = classDoc.assignedSubjects || [];
      const subjectMap = new Map();
      subjectsFromClass.forEach((s) => {
        const id = String(s._id || s);
        subjectMap.set(id, {
          id,
          name: s.name || 'Subject',
          description: s.description || '',
        });
      });

      return {
        _id: classDoc._id,
        id: classDoc._id,
        className: classDoc.name || `Class ${classDoc.classNumber}${classDoc.section || ''}`,
        name: classDoc.name || `Class ${classDoc.classNumber}${classDoc.section ? ` - ${classDoc.section}` : ''}`,
        classNumber: classDoc.classNumber,
        section: classDoc.section,
        description: classDoc.description,
        subjects: [...subjectMap.values()],
        subject: [...subjectMap.values()].map((s) => s.name).join(', ') || 'N/A',
        assignmentSubjectIds: assignmentSubjects.map(String),
        studentCount: classStudents.length,
        students: classStudents.map(s => ({
          id: s._id,
          name: s.fullName || s.email,
          email: s.email,
          status: 'active'
        })),
        schedule: 'Not scheduled',
        room: classDoc.name
          ? `Room ${classDoc.classNumber}${classDoc.section || ''}`
          : '—',
      };
    });

    const { getClassScheduleAndRoomMap } = await import('../utils/teacherClassSchedule.js');
    const scheduleMap = await getClassScheduleAndRoomMap(
      teacherId,
      classesWithStudents.map((c) => c._id)
    );
    const classesWithSchedule = classesWithStudents.map((c) => {
      const fromTimetable = scheduleMap.get(String(c._id));
      const fallbackRoom = `Room ${c.classNumber}${c.section || ''}`;
      return {
        ...c,
        schedule: fromTimetable?.schedule || c.schedule,
        room: fromTimetable?.room || fallbackRoom,
      };
    });
    
    console.log(`Found ${classesWithSchedule.length} classes for teacher`);
    res.json({ success: true, data: classesWithSchedule });
  } catch (error) {
    console.error('Error fetching teacher classes:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch classes', error: error.message });
  }
}

router.get('/classes', getTeacherClassesHandler);
router.get('/my-classes', getTeacherClassesHandler);

// Get teacher's assigned subjects
router.get('/subjects', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER SUBJECTS ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Get teacher with populated subjects (active only)
    const teacher = await Teacher.findById(teacherId).populate({
      path: 'subjects',
      match: { isActive: true },
      select: '_id name description code board',
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    const subjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    if (subjectIds.length === 0) {
      console.log('Teacher has no subjects on profile');
      return res.json({ success: true, data: [] });
    }

    // Get Subject model to ensure we have full subject data
    const Subject = (await import('../models/Subject.js')).default;

    // Fetch subject details from database
    const subjects = await Subject.find({
      _id: { $in: subjectIds },
      isActive: true
    })
    .sort({ name: 1 })
    .select('_id name description code board');
    
    console.log(`Found ${subjects.length} subjects for teacher`);
    res.json({ 
      success: true, 
      data: subjects.map(subj => ({
        _id: subj._id.toString(),
        id: subj._id.toString(),
        name: subj.name,
        description: subj.description || '',
        code: subj.code || '',
        board: subj.board || ''
      }))
    });
  } catch (error) {
    console.error('Error fetching teacher subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects', error: error.message });
  }
});

// Get subjects for a specific class (shows teacher's assigned subjects)
// This route must be defined before other routes that might match
router.get('/classes/:classNumber/subjects', async (req, res) => {
  try {
    const { classNumber } = req.params;
    // Decode the classNumber in case it was URL encoded
    const decodedClassNumber = decodeURIComponent(classNumber);
    const teacherId = req.teacherId;
    
    console.log('=== FETCHING SUBJECTS FOR CLASS ===');
    console.log('Raw classNumber from params:', classNumber);
    console.log('Decoded classNumber:', decodedClassNumber);
    console.log('Teacher ID:', teacherId);
    
    // Validate classNumber
    if (!decodedClassNumber || decodedClassNumber.trim() === '' || decodedClassNumber === '-9') {
      console.error('Invalid classNumber:', decodedClassNumber);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid class number provided' 
      });
    }
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Get teacher with populated subjects
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    console.log('Teacher found:', teacher.email);
    console.log('Teacher subjects (raw):', teacher.subjects);
    console.log('Teacher subjects length:', teacher.subjects?.length || 0);
    
    // Get Class model to verify teacher is assigned to this class
    const Class = (await import('../models/Class.js')).default;
    
    // Find classes with this classNumber that the teacher is assigned to
    const allClassesWithNumber = await Class.find({
      classNumber: decodedClassNumber,
      isActive: true
    })
    .select('_id classNumber section');
    
    // Filter to only classes the teacher is assigned to
    const classes = allClassesWithNumber.filter(classDoc => {
      const classIdStr = classDoc._id.toString();
      const classNumberStr = classDoc.classNumber;
      
      return (teacher.assignedClassIds || []).some(assignedId => {
        const assignedIdStr = String(assignedId);
        // Match by ObjectId
        if (assignedIdStr === classIdStr) {
          return true;
        }
        // Match by classNumber (for backward compatibility)
        if (assignedIdStr === classNumberStr) {
          return true;
        }
        return false;
      });
    });
    
    console.log(`Found ${classes.length} classes with classNumber ${decodedClassNumber} assigned to teacher`);
    
    if (classes.length === 0) {
      console.log('No classes found for teacher');
      return res.json({
        success: true,
        subjects: [],
        message: 'No classes found for this class number'
      });
    }

    // Subjects actually on these class rows (matches what students see / prep content)
    const subjectIdSet = new Set();
    for (const classDoc of classes) {
      const full = await Class.findById(classDoc._id)
        .select('assignedSubjects')
        .populate('assignedSubjects', '_id');
      for (const sub of full?.assignedSubjects || []) {
        const raw = sub._id != null ? sub._id : sub;
        const str = raw.toString();
        if (mongoose.Types.ObjectId.isValid(str)) subjectIdSet.add(str);
      }
    }

    let subjectIds = [...subjectIdSet].map((id) => new mongoose.Types.ObjectId(id));
    const explicitIds = getExplicitTeacherSubjectObjectIds(teacher);
    const explicitStr = new Set(explicitIds.map((id) => id.toString()));

    // Only subjects both on the class and explicitly assigned on the teacher profile
    if (subjectIds.length > 0) {
      subjectIds = subjectIds.filter((id) => explicitStr.has(id.toString()));
    } else {
      // Class row has no subjects — fall back to teacher profile subjects only
      subjectIds = explicitIds;
    }

    if (subjectIds.length === 0) {
      console.log('No subjects for this class or teacher scope');
      return res.json({
        success: true,
        subjects: [],
        message: 'No subjects on this class yet. Please contact your administrator.',
      });
    }

    // Get Subject model to fetch full details
    const Subject = (await import('../models/Subject.js')).default;

    console.log('Subject IDs to fetch for class:', subjectIds);

    // Fetch subject details from database
    const subjects = await Subject.find({
      _id: { $in: subjectIds },
      isActive: true
    })
    .sort({ name: 1 })
    .select('_id name description code board');
    
    console.log(`Fetched ${subjects.length} subjects assigned to teacher`);
    subjects.forEach(subj => {
      console.log(`  - ${subj.name} (${subj._id})`);
    });
    
    if (subjects.length === 0) {
      console.log('Warning: Subject IDs exist but no active subjects found in database');
      return res.json({
        success: true,
        subjects: [],
        message: 'No active subjects found. Please contact your administrator.'
      });
    }
    
    res.json({
      success: true,
      subjects: subjects.map(subj => ({
        _id: subj._id.toString(),
        name: subj.name,
        description: subj.description || '',
        code: subj.code || '',
        board: subj.board || ''
      }))
    });
  } catch (error) {
    console.error('Error fetching subjects for class:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects', error: error.message });
  }
});

// Other AI Tools Routes (teacher-only)
router.post('/ai/lesson-plan', createLessonPlan);
router.post('/ai/test-questions', createTestQuestions);
router.post('/ai/classwork', createClasswork);
router.post('/ai/schedule', createSchedule);

// Grading endpoint
router.post('/grade-work', upload.single('file'), async (req, res) => {
  try {
    const { rubric, studentWork } = req.body;
    const file = req.file;
    
    if (!studentWork && !file) {
      return res.status(400).json({ success: false, message: 'Student work or file is required' });
    }

    // Import shared LLM service (LM Studio / OpenAI-compatible)
    const { geminiService } = await import('../services/gemini-service.cjs');
    
    // Extract text from file if uploaded
    let workText = studentWork || '';
    if (file) {
      // For text files, use the buffer directly
      if (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt')) {
        workText = file.buffer.toString('utf-8');
      } else if (file.mimetype === 'application/pdf') {
        // For PDFs, we'll need to extract text (simplified - in production use pdf-parse or similar)
        workText = '[PDF file uploaded - content extraction would be implemented here]';
      } else if (file.mimetype.startsWith('image/')) {
        // For images, convert to base64 and use model vision if available
        const imageBase64 = file.buffer.toString('base64');
        
        // Use LLM service to extract text from image
        const context = 'Extract all text from this image. If this is student work (essay, assignment, answer), provide the complete text content.';
        
        try {
          workText = await geminiService.analyzeImage(imageBase64, context);
        } catch (error) {
          console.error('Image analysis error:', error);
          workText = '[Image uploaded - text extraction failed. Please provide text manually.]';
        }
      } else {
        workText = '[File uploaded - text extraction would be implemented for this file type]';
      }
    }

    // Build grading prompt
    let gradingPrompt = `You are an expert teacher and grader. Your task is to grade student work and provide detailed feedback.

`;
    
    if (rubric && rubric.trim()) {
      gradingPrompt += `Grading Rubric/Criteria:
${rubric}

`;
    } else {
      gradingPrompt += `Use standard academic grading criteria focusing on:
- Content accuracy and understanding
- Clarity and organization
- Grammar and writing quality
- Completeness of response

`;
    }
    
    gradingPrompt += `Student Work to Grade:
${workText}

Please provide:
1. **Overall Grade/Score** (e.g., 85/100 or A-)
2. **Strengths** - What the student did well
3. **Areas for Improvement** - Specific areas that need work
4. **Detailed Feedback** - Point-by-point comments
5. **Suggestions** - How the student can improve

Format your response clearly with sections and bullet points.`;

    // Generate grading using LLM
        const gradingResult = await geminiService.generateResponse(gradingPrompt, {}, []);
    
    res.json({
      success: true,
      grading: gradingResult
    });
  } catch (error) {
    console.error('Grading error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to grade work', 
      error: error.message 
    });
  }
});

// Teacher Content Management Routes
router.get('/videos', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const videos = await Video.find({ createdBy: teacherId }).sort({ createdAt: -1 });
    res.json({ success: true, data: videos });
  } catch (error) {
    console.error('Get teacher videos error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch videos' });
  }
});

// Test endpoint without middleware
router.post('/videos-test', async (req, res) => {
  try {
    console.log('=== VIDEO TEST ENDPOINT ===');
    console.log('Raw request body:', req.body);
    console.log('Headers:', req.headers);
    
    const { title, description, subject, duration, videoUrl, difficulty } = req.body;
    
    // Simple test video creation
    const testVideo = new Video({
      title: title || 'Test Video',
      description: description || 'Test Description',
      subjectId: subject || 'test',
      duration: parseInt(duration) * 60 || 3600,
      videoUrl: videoUrl || 'https://test.com',
      youtubeUrl: videoUrl || 'https://test.com',
      isYouTubeVideo: true,
      difficulty: 'beginner',
      createdBy: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'), // Test ObjectId
      adminId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'), // Test ObjectId
      isPublished: true
    });
    
    console.log('Test video object:', testVideo);
    await testVideo.save();
    console.log('Test video saved successfully:', testVideo._id);
    
    res.json({ success: true, message: 'Test video created', data: testVideo });
  } catch (error) {
    console.error('=== TEST VIDEO ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error stack:', error.stack);
    console.error('Full error:', error);
    res.status(500).json({ success: false, message: 'Test failed', error: error.message, details: error });
  }
});

router.post('/videos', async (req, res) => {
  try {
    const teacherId = req.teacherId || req.userId || req.user?._id;
    const { title, description, subject, duration, videoUrl, difficulty } = req.body;
    
    console.log('Creating video with data:', { title, description, subject, duration, videoUrl, difficulty, teacherId });
    console.log('req.adminId:', req.adminId);
    console.log('req.user:', req.user);
    console.log('req.userId:', req.userId);
    console.log('req.teacherId:', req.teacherId);
    console.log('teacherId type:', typeof teacherId);
    console.log('teacherId value:', teacherId);
    
    if (!teacherId) {
      console.error('No teacher ID found in request');
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Convert duration to number (assuming it's in minutes)
    const durationInSeconds = parseInt(duration) * 60;
    console.log('durationInSeconds:', durationInSeconds);
    
    const videoData = {
      title,
      description,
      subjectId: subject, // Use subject as subjectId
      duration: durationInSeconds, // Convert to seconds
      videoUrl: videoUrl || '',
      youtubeUrl: videoUrl || '',
      isYouTubeVideo: !!videoUrl,
      difficulty: difficulty || 'beginner',
      createdBy: new mongoose.Types.ObjectId(teacherId),
      adminId: req.adminId ? new mongoose.Types.ObjectId(req.adminId) : new mongoose.Types.ObjectId(teacherId),
      isPublished: true
    };
    
    console.log('Video data to save:', videoData);
    
    const newVideo = new Video(videoData);

    await newVideo.save();
    console.log('Video created successfully:', newVideo._id);
    res.json({ success: true, data: newVideo });
  } catch (error) {
    console.error('Create teacher video error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to create video', error: error.message });
  }
});

router.get('/assessments', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const assessments = await Assessment.find({ createdBy: teacherId }).sort({ createdAt: -1 });
    res.json({ success: true, data: assessments });
  } catch (error) {
    console.error('Get teacher assessments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assessments' });
  }
});

router.post('/assessments', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { title, description, subject, questions, timeLimit, difficulty } = req.body;
    
    console.log('Creating assessment with data:', { title, description, subject, questions, timeLimit, difficulty, teacherId });
    console.log('req.adminId:', req.adminId);
    
    const newAssessment = new Assessment({
      title,
      description,
      subjectIds: [subject], // Use subject as subjectIds array
      questions: questions ? JSON.parse(questions) : [],
      duration: parseInt(timeLimit) || 30, // Convert to number
      difficulty: difficulty || 'beginner',
      createdBy: new mongoose.Types.ObjectId(teacherId),
      adminId: req.adminId ? new mongoose.Types.ObjectId(req.adminId) : new mongoose.Types.ObjectId(teacherId),
      isPublished: true
    });

    await newAssessment.save();
    console.log('Assessment created successfully:', newAssessment._id);
    res.json({ success: true, data: newAssessment });
  } catch (error) {
    console.error('Create teacher assessment error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to create assessment', error: error.message });
  }
});

// Teacher Homework Upload Route
router.post('/homework', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { title, description, subject, classNumber, topic, date, fileUrl, deadline, board } = req.body;
    
    console.log('📝 Teacher uploading homework:', { title, subject, classNumber, date, deadline, teacherId });
    
    if (!title || !subject || !fileUrl || !date || !deadline) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: title, subject, fileUrl, date, and deadline are required' 
      });
    }
    
    // Get teacher to verify assigned subjects
    const teacher = await Teacher.findById(teacherId).populate('subjects');
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    const librarySubjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    const subjectId = new mongoose.Types.ObjectId(subject);
    const teacherBoardUpper = teacher.board ? String(teacher.board).toUpperCase() : undefined;

    const allowed = await subjectIdAllowedWithSiblings(subjectId, librarySubjectIds, {
      board: teacherBoardUpper,
    });
    if (!allowed) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only upload homework for your assigned subjects' 
      });
    }
    
    const subjectDoc = await Subject.findById(subject);
    if (!subjectDoc) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    const homeworkData = {
      title: title.trim(),
      description: description?.trim() || undefined,
      type: 'Homework',
      board: board || subjectDoc.board || 'ASLI_EXCLUSIVE_SCHOOLS',
      subject: subjectId,
      topic: topic?.trim() || undefined,
      date: new Date(date),
      deadline: new Date(deadline),
      fileUrl: fileUrl.trim(),
      isExclusive: false, // Teacher-created homework is not exclusive
      createdBy: 'teacher',
      teacherId: new mongoose.Types.ObjectId(teacherId)
    };
    
    // Add classNumber if provided
    if (classNumber && classNumber.trim()) {
      homeworkData.classNumber = classNumber.trim();
    }
    
    const homework = new Content(homeworkData);
    await homework.save();
    
    console.log('✅ Homework uploaded successfully by teacher:', {
      id: homework._id,
      title: homework.title,
      subject: homework.subject,
      teacherId: teacherId
    });
    
    res.json({ 
      success: true, 
      data: homework, 
      message: 'Homework uploaded successfully' 
    });
  } catch (error) {
    console.error('Teacher homework upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload homework', 
      error: error.message 
    });
  }
});

// Teacher Student Management Routes
router.get('/students', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER STUDENTS ===');
    console.log('Teacher ID:', teacherId);
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    console.log('Teacher assignedClassIds:', teacher.assignedClassIds);
    console.log('Teacher adminId:', teacher.adminId);
    
    // Get students from teacher's assigned classes AND assigned to the same admin as the teacher
    let students = [];
    if (teacher.assignedClassIds && teacher.assignedClassIds.length > 0) {
      // Get Class model
      const Class = (await import('../models/Class.js')).default;
      
      // First, get the Class documents to find their ObjectIds
      const classDocuments = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } }
        ],
        isActive: true
      }).select('_id classNumber section');

      const classObjectIds = classDocuments.map(c => c._id);
      console.log('Found class ObjectIds:', classObjectIds);
      
      // Get students assigned to these classes by assignedClass ObjectId
      students = await User.find({ 
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId  // Filter by teacher's admin
      })
      .populate('assignedClass', '_id classNumber section')
      .select('-password')
      .sort({ createdAt: -1 });
      
      console.log(`Found ${students.length} students for teacher`);
    }
    
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('Get teacher students error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch students' });
  }
});

// All remarks for students in teacher's classes (must be before /students/:studentId/*)
router.get('/students/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    let studentIds = [];
    if (teacher.assignedClassIds?.length) {
      const Class = (await import('../models/Class.js')).default;
      const classDocs = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } },
        ],
        isActive: true,
      }).select('_id');
      const classObjectIds = classDocs.map((c) => c._id);
      const students = await User.find({
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId,
      }).select('_id');
      studentIds = students.map((s) => s._id);
    }

    const remarkQuery =
      studentIds.length > 0
        ? {
            $or: [
              { studentId: { $in: studentIds } },
              { teacherId: teacher._id },
            ],
          }
        : { teacherId: teacher._id };

    const remarks = await StudentRemark.find(remarkQuery)
      .populate('studentId', 'fullName email')
      .populate('teacherId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({ success: true, data: remarks });
  } catch (error) {
    console.error('Get class student remarks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student remarks',
      error: error.message,
    });
  }
});

// Get all students with their recent performance
router.get('/students/performance', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    // Get students from teacher's assigned classes AND assigned to the same admin as the teacher
    let students = [];
    if (teacher.assignedClassIds && teacher.assignedClassIds.length > 0) {
      // First, get the Class documents to find their ObjectIds
      const Class = (await import('../models/Class.js')).default;
      const classDocs = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } }
        ],
        isActive: true
      }).select('_id classNumber section');

      const classObjectIds = classDocs.map(c => c._id);
      
      // Get students assigned to these classes by assignedClass ObjectId
      students = await User.find({ 
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId  // Filter by teacher's admin
      })
      .populate({
        path: 'assignedClass',
        select: '_id name classNumber section description assignedSubjects',
        populate: {
          path: 'assignedSubjects',
          select: '_id name'
        }
      })
      .select('-password')
      .sort({ createdAt: -1 });
    }

    // Get student IDs
    const studentIds = students.map(s => s._id);

    // Import ExamResult model
    const ExamResult = (await import('../models/ExamResult.js')).default;

    // Get recent exam results for all students (latest result per exam)
    // Populate examId to get subject information
    const Exam = (await import('../models/Exam.js')).default;
    const examResults = await ExamResult.find({ 
      userId: { $in: studentIds }
    })
    .populate('examId', 'subject title')
    .sort({ completedAt: -1 });

    // Group exam results by student
    const performanceMap = new Map();
    examResults.forEach(result => {
      const userId = result.userId.toString();
      if (!performanceMap.has(userId)) {
        performanceMap.set(userId, {
          recentExam: null,
          recentMarks: null,
          recentPercentage: null,
          totalExams: 0,
          averageMarks: 0
        });
      }
      const perf = performanceMap.get(userId);
      perf.totalExams += 1;
      
      // Set the most recent exam result
      if (!perf.recentExam || new Date(result.completedAt) > new Date(perf.recentExam.completedAt)) {
        perf.recentExam = result;
        perf.recentMarks = result.obtainedMarks;
        perf.recentPercentage = result.percentage;
      }
    });

    // Calculate average marks and average percentage for each student
    const marksByStudent = {};
    const percentagesByStudent = {};
    examResults.forEach(result => {
      const userId = result.userId.toString();
      if (!marksByStudent[userId]) marksByStudent[userId] = [];
      if (!percentagesByStudent[userId]) percentagesByStudent[userId] = [];
      marksByStudent[userId].push(result.obtainedMarks);
      if (result.percentage !== null && result.percentage !== undefined) {
        percentagesByStudent[userId].push(result.percentage);
      }
    });

    Object.keys(marksByStudent).forEach(userId => {
      const marks = marksByStudent[userId];
      const percentages = percentagesByStudent[userId] || [];
      const perf = performanceMap.get(userId);
      if (perf) {
        perf.averageMarks = marks.reduce((a, b) => a + b, 0) / marks.length;
        perf.averagePercentage = percentages.length > 0 
          ? percentages.reduce((a, b) => a + b, 0) / percentages.length 
          : null;
      }
    });

    // Calculate overall progress for each student (same as student dashboard)
    // Overall progress = average of all subject progress (combining exam and learning path progress)
    const Subject = (await import('../models/Subject.js')).default;
    const Content = (await import('../models/Content.js')).default;
    const UserProgress = (await import('../models/UserProgress.js')).default;
    
    const studentsWithPerformance = await Promise.all(students.map(async (student) => {
      // Calculate daily average watch time from logged-in session time
      let dailyAverageWatchTime = 0; // in minutes
      try {
        const UserSession = (await import('../models/UserSession.js')).default;
        
        // Get all session records for this student
        const sessionRecords = await UserSession.find({
          userId: student._id,
          duration: { $gt: 0 }
        }).select('duration date').sort({ date: 1 });

        if (sessionRecords.length > 0) {
          // Group by date and calculate total time per day
          const dailySessionTime = new Map();
          
          sessionRecords.forEach(record => {
            const dateKey = record.date || new Date(record.createdAt).toISOString().split('T')[0];
            const timeInMinutes = record.duration || 0;
            
            if (!dailySessionTime.has(dateKey)) {
              dailySessionTime.set(dateKey, 0);
            }
            dailySessionTime.set(dateKey, dailySessionTime.get(dateKey) + timeInMinutes);
          });

          // Calculate average across all days
          if (dailySessionTime.size > 0) {
            const totalMinutes = Array.from(dailySessionTime.values()).reduce((sum, minutes) => sum + minutes, 0);
            dailyAverageWatchTime = Math.round((totalMinutes / dailySessionTime.size) * 10) / 10; // Round to 1 decimal place
            console.log(`⏱️ Calculated watch time for student ${student.fullName || student.name}: ${dailyAverageWatchTime} min (${dailySessionTime.size} days)`);
          } else {
            console.log(`⏱️ No session data found for student ${student.fullName || student.name}`);
          }
        } else {
          console.log(`⏱️ No session records found for student ${student.fullName || student.name}`);
        }
      } catch (error) {
        console.error(`Error calculating daily average watch time for student ${student._id}:`, error);
      }
      const perf = performanceMap.get(student._id.toString()) || {
        recentExam: null,
        recentMarks: null,
        recentPercentage: null,
        totalExams: 0,
        averageMarks: 0
      };
      
      // Get student's board
      let studentBoard = student.board;
      if (!studentBoard && student.assignedAdmin) {
        const admin = await User.findById(student.assignedAdmin).select('board');
        if (admin && admin.board) {
          studentBoard = admin.board;
        }
      }
      
      // Get subjects assigned to student's class
      let subjectsList = [];
      if (student.assignedClass && student.assignedClass.assignedSubjects) {
        subjectsList = student.assignedClass.assignedSubjects;
      } else if (studentBoard) {
        // Fallback: get all subjects for student's board
        subjectsList = await Subject.find({ 
          board: studentBoard, 
          isActive: true 
        }).select('_id name');
      }
      
      // Calculate exam progress per subject
      const examProgressBySubject = new Map();
      const studentExamResults = examResults.filter(r => r.userId.toString() === student._id.toString());
      
      studentExamResults.forEach(result => {
        // Get subject from examId if populated, or from examTitle parsing
        let subjectId = null;
        if (result.examId && result.examId.subject) {
          subjectId = result.examId.subject.toString();
        }
        
        if (subjectId && result.percentage !== null && result.percentage !== undefined) {
          if (!examProgressBySubject.has(subjectId)) {
            examProgressBySubject.set(subjectId, []);
          }
          examProgressBySubject.get(subjectId).push(result.percentage);
        }
      });
      
      // Calculate average exam progress per subject
      const examProgressMap = new Map();
      examProgressBySubject.forEach((percentages, subjectId) => {
        const avgProgress = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
        examProgressMap.set(subjectId, Math.round(avgProgress));
      });
      
      // Calculate learning path progress per subject (from UserProgress and Content)
      const learningPathProgressMap = new Map();
      if (studentBoard && subjectsList.length > 0) {
        for (const subject of subjectsList) {
          const subjectId = subject._id ? subject._id.toString() : subject.toString();
          try {
            // Get total content count for this subject
            const totalContent = await Content.countDocuments({
              subject: subjectId,
              board: studentBoard.toUpperCase(),
              isActive: true,
              isExclusive: true
            });
            
            if (totalContent > 0) {
              // Get all content IDs for this subject
              const contentIds = await Content.find({
                subject: subjectId,
                board: studentBoard.toUpperCase(),
                isActive: true,
                isExclusive: true
              }).select('_id');
              
              const contentIdArray = contentIds.map(c => c._id);
              
              if (contentIdArray.length > 0) {
                // Get completed content count from UserProgress (using contentId)
                const completedProgress = await UserProgress.countDocuments({
                  userId: student._id,
                  contentId: { $in: contentIdArray },
                  completed: true
                });
                
                // Also count content with progress > 0 (partially completed)
                const totalProgressRecords = await UserProgress.countDocuments({
                  userId: student._id,
                  contentId: { $in: contentIdArray },
                  progress: { $gt: 0 }
                });
                
                // Calculate progress: completed content + partial progress
                const progress = totalContent > 0 
                  ? Math.round(((completedProgress + (totalProgressRecords - completedProgress) * 0.5) / totalContent) * 100)
                  : 0;
                
                if (progress > 0) {
                  learningPathProgressMap.set(subjectId, progress);
                }
              }
            }
          } catch (error) {
            console.error(`Error calculating learning path progress for subject ${subjectId}:`, error);
          }
        }
      }
      
      // Merge exam and learning path progress (same logic as student dashboard)
      const mergedProgress = new Map();
      
      // Add exam-based progress
      examProgressMap.forEach((progress, subjectId) => {
        const subject = subjectsList.find(s => (s._id || s).toString() === subjectId);
        const subjectName = subject?.name || 'Subject';
        mergedProgress.set(subjectId, {
          progress: progress,
          name: subjectName
        });
      });
      
      // Merge with learning path progress (average if both exist)
      learningPathProgressMap.forEach((progress, subjectId) => {
        const subject = subjectsList.find(s => (s._id || s).toString() === subjectId);
        const subjectName = subject?.name || 'Subject';
        
        if (mergedProgress.has(subjectId)) {
          // Average if both exist
          const existing = mergedProgress.get(subjectId);
          mergedProgress.set(subjectId, {
            ...existing,
            progress: Math.round((existing.progress + progress) / 2)
          });
        } else {
          // Add new entry
          mergedProgress.set(subjectId, {
            progress: progress,
            name: subjectName
          });
        }
      });
      
      // Get overall progress from database (saved by student dashboard)
      // If not available, calculate as average of all subject progress
      let overallProgress = student.overallProgress || 0;
      
      // If student has saved overall progress, use it; otherwise calculate
      if (!student.overallProgress || student.overallProgress === 0) {
        const subjectProgressValues = Array.from(mergedProgress.values()).map(s => s.progress);
        overallProgress = subjectProgressValues.length > 0
          ? Math.round(subjectProgressValues.reduce((sum, p) => sum + p, 0) / subjectProgressValues.length)
          : 0;
      }
      
      // Calculate learning progress (content completion) separately
      let learningProgress = 0;
      if (studentBoard && subjectsList.length > 0) {
        try {
          // Get total content for all student's subjects
          const allContentIds = [];
          for (const subject of subjectsList) {
            const subjectId = subject._id ? subject._id.toString() : subject.toString();
            const contentIds = await Content.find({
              subject: subjectId,
              board: studentBoard.toUpperCase(),
              isActive: true,
              isExclusive: true
            }).select('_id');
            allContentIds.push(...contentIds.map(c => c._id));
          }
          
          if (allContentIds.length > 0) {
            const completedContent = await UserProgress.countDocuments({
              userId: student._id,
              contentId: { $in: allContentIds },
              completed: true
            });
            learningProgress = Math.round((completedContent / allContentIds.length) * 100);
          }
        } catch (error) {
          console.error(`Error calculating learning progress for student ${student._id}:`, error);
        }
      }
      
      // Ensure all performance metrics are calculated from database
      const performanceData = {
        recentExamTitle: perf.recentExam?.examTitle || null,
        recentMarks: perf.recentMarks || null,
        recentPercentage: perf.recentPercentage || null,
        // Exams taken - from database exam results
        totalExams: perf.totalExams || 0,
        averageMarks: perf.averageMarks ? Math.round(perf.averageMarks * 100) / 100 : 0,
        // Average score - calculated from all exam percentages in database
        averagePercentage: perf.averagePercentage !== null && perf.averagePercentage !== undefined
          ? Math.round(perf.averagePercentage * 100) / 100
          : null,
        // Overall progress - calculated from exam and learning path progress in database
        overallProgress: overallProgress || 0,
        // Learning progress - content completion progress from database
        learningProgress: learningProgress || 0,
        // Daily average watch time - calculated from UserProgress records in database
        dailyAverageWatchTime: dailyAverageWatchTime || 0
      };
      
      return {
        ...student.toObject(),
        performance: performanceData
      };
    }));
    
    res.json({ success: true, data: studentsWithPerformance });
  } catch (error) {
    console.error('Get students performance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch students performance' });
  }
});

router.get('/students/:studentId/performance', async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacherId = req.teacherId;
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    // Verify student is in teacher's assigned classes AND assigned to the same admin as the teacher
    const student = await User.findOne({ 
      _id: studentId,
      role: 'student',
      classNumber: { $in: teacher.assignedClassIds || [] },
      assignedAdmin: teacher.adminId  // Filter by teacher's admin
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not assigned to this teacher' });
    }

    // Import ExamResult model
    const ExamResult = (await import('../models/ExamResult.js')).default;

    // Get student's exam results (using userId, not studentId)
    const examResults = await ExamResult.find({ userId: studentId }).sort({ completedAt: -1 });
    
    res.json({ success: true, data: examResults });
  } catch (error) {
    console.error('Get student performance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch student performance' });
  }
});

// Get Asli Prep content for teacher's assigned subjects
router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic } = req.query;
    const teacherId = req.teacherId;
    
    console.log('📚 Fetching Asli Prep content for teacher:', teacherId);
    console.log('Query params:', { subject, type, topic });

    const { getTeacherSchoolProgramContext, applySchoolProgramContentFilters, isAllowedContentType } =
      await import('../utils/schoolProgram.js');
    const programCtx = await getTeacherSchoolProgramContext(teacherId);

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      return res.json({ success: true, data: [] });
    }
    
    // Get teacher with assigned subjects
    const teacher = await Teacher.findById(teacherId).populate('subjects');
    
    if (!teacher) {
      console.log('❌ Teacher not found');
      return res.json({
        success: true,
        data: []
      });
    }
    
    let librarySubjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    const { filterToActiveCatalogSubjectIds, buildActiveSubjectIdSet, filterContentRowsForActiveCatalog } =
      await import('../utils/activeCatalog.js');
    librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

    if (librarySubjectIds.length === 0) {
      console.log('❌ Teacher has no active catalog subjects on profile');
      return res.json({
        success: true,
        data: []
      });
    }

    const teacherBoard = teacher.board ? String(teacher.board).toUpperCase() : undefined;
    const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, {
      board: teacherBoard,
    });
    const activeIdSet = buildActiveSubjectIdSet(contentSubjectIds);

    console.log(
      `📋 Teacher library subjects: ${librarySubjectIds.length}, content ids (incl. siblings): ${contentSubjectIds.length}`
    );

    const query = {
      subject: { $in: contentSubjectIds },
      isActive: true,
    };

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(subject)) {
      const allowed = await subjectIdAllowedWithSiblings(subject, librarySubjectIds, {
        board: teacherBoard,
      });
      if (allowed) {
        const resolved = await resolveSubjectContentIds(subject, { board: teacherBoard });
        query.subject = { $in: resolved };
      } else {
        console.log('⚠️ Requested subject not in teacher subject scope');
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
      .populate('subject', 'name isActive board')
      .sort({ createdAt: -1 })
      .lean();

    contents = filterContentRowsForActiveCatalog(contents, activeIdSet);

    contents = applySchoolProgramContentFilters(contents, programCtx);

    console.log(`✅ Found ${contents.length} active catalog contents for teacher`);

    const { enrichContentDurations } = await import('../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    res.json({
      success: true,
      data: contents,
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content for teacher:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

// Student Remarks Routes
// Add remark for a student
router.post('/students/:studentId/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { studentId } = req.params;
    const { remark, subject, isPositive } = req.body;

    if (!remark || remark.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Remark is required' });
    }

    // Verify student exists and is assigned to this teacher
    const student = await User.findById(studentId);
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Verify teacher exists
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    // Create new remark
    const newRemark = new StudentRemark({
      studentId,
      teacherId,
      remark: remark.trim(),
      subject: subject || null,
      isPositive: isPositive !== undefined ? isPositive : true
    });

    await newRemark.save();

    // Populate teacher info for response
    await newRemark.populate('teacherId', 'fullName email');
    if (subject) {
      await newRemark.populate('subject', 'name');
    }

    res.json({
      success: true,
      message: 'Remark added successfully',
      data: newRemark
    });
  } catch (error) {
    console.error('Add student remark error:', error);
    res.status(500).json({ success: false, message: 'Failed to add remark', error: error.message });
  }
});

// Get homework submissions for teacher's students
router.get('/homework-submissions', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    // Get students from teacher's assigned classes
    let studentIds = [];
    if (teacher.assignedClassIds && teacher.assignedClassIds.length > 0) {
      const Class = (await import('../models/Class.js')).default;
      const classDocs = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } }
        ],
        isActive: true
      }).select('_id classNumber section');

      const classObjectIds = classDocs.map(c => c._id);
      
      const students = await User.find({ 
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId
      }).select('_id');
      
      studentIds = students.map(s => s._id);
    }
    
    if (studentIds.length === 0) {
      return res.json({ success: true, data: { homeworks: [], students: [] } });
    }
    
    // Get all homework submissions for these students
    const HomeworkSubmission = (await import('../models/HomeworkSubmission.js')).default;
    const Content = (await import('../models/Content.js')).default;
    
    const submissions = await HomeworkSubmission.find({
      studentId: { $in: studentIds }
    })
    .populate('homeworkId', 'title description deadline fileUrl subject classNumber topic board date createdAt')
    .populate('studentId', 'fullName name email')
    .populate('subjectId', 'name')
    .sort({ submittedAt: -1 });
    
    // Group by homework
    const homeworkMap = new Map();
    submissions.forEach(sub => {
      const homeworkId = sub.homeworkId._id.toString();
      if (!homeworkMap.has(homeworkId)) {
        homeworkMap.set(homeworkId, {
          homework: sub.homeworkId,
          submissions: []
        });
      }
      homeworkMap.get(homeworkId).submissions.push(sub);
    });
    
    // Group by student
    const studentMap = new Map();
    submissions.forEach(sub => {
      const studentId = sub.studentId._id.toString();
      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          student: sub.studentId,
          submissions: []
        });
      }
      studentMap.get(studentId).submissions.push(sub);
    });
    
    const librarySubjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    const teacherBoardUpper = teacher.board ? String(teacher.board).toUpperCase() : undefined;
    const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, {
      board: teacherBoardUpper,
    });
    const allHomeworks = await Content.find({
      type: 'Homework',
      subject: { $in: contentSubjectIds },
      isActive: true
    })
    .populate('subject', 'name')
    .select('title description deadline fileUrl subject classNumber topic board date createdAt isActive')
    .sort({ createdAt: -1 });
    
    // Include homeworks with no submissions yet
    allHomeworks.forEach(hw => {
      const hwId = hw._id.toString();
      if (!homeworkMap.has(hwId)) {
        homeworkMap.set(hwId, {
          homework: hw,
          submissions: []
        });
      }
    });
    
    res.json({
      success: true,
      data: {
        homeworks: Array.from(homeworkMap.values()),
        students: Array.from(studentMap.values())
      }
    });
  } catch (error) {
    console.error('Get homework submissions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch homework submissions' });
  }
});

// Get all remarks created by this teacher (for mobile app)
router.get('/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER REMARKS ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }

    // Get all remarks created by this teacher
    const remarks = await StudentRemark.find({ teacherId })
      .populate('studentId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    console.log(`Found ${remarks.length} remarks by teacher`);
    res.json({
      success: true,
      data: remarks
    });
  } catch (error) {
    console.error('Get teacher remarks error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch remarks', error: error.message });
  }
});

// Data-driven areas-for-improvement (exams, usage, progress, homework, remarks — no Gemini)
router.post('/students/progress-ai-insights', async (req, res) => {
  try {
    const { summary } = req.body || {};
    if (!summary || typeof summary !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'summary object is required',
      });
    }

    const { buildTeacherProgressInsights } = await import(
      '../services/teacher-progress-insights-service.js'
    );
    const insights = buildTeacherProgressInsights(summary);

    res.json({ success: true, data: { insights, source: 'analytics' } });
  } catch (error) {
    console.error('Progress insights route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate progress insights',
      error: error.message,
    });
  }
});

// Get class statistics for teacher (for mobile app Class Dashboard)
router.get('/class-stats', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING CLASS STATS ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }

    // Get teacher
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    if (!teacher.assignedClassIds || teacher.assignedClassIds.length === 0) {
      return res.json({ 
        success: true, 
        data: {
          totalStudents: 0,
          totalClasses: 0,
          averageAttendance: 0,
          averagePerformance: 0
        }
      });
    }

    // Get Class model
    const Class = (await import('../models/Class.js')).default;
    
    // Fetch class documents
    const classDocuments = await Class.find({
      $or: [
        { _id: { $in: teacher.assignedClassIds } },
        { classNumber: { $in: teacher.assignedClassIds } }
      ],
      isActive: true
    });

    const classObjectIds = classDocuments.map(c => c._id);
    
    // Get students for these classes
    const students = await User.find({ 
      role: 'student',
      assignedClass: { $in: classObjectIds },
      assignedAdmin: teacher.adminId
    });

    // Get exam results for performance calculation
    const ExamResult = (await import('../models/ExamResult.js')).default;
    const examResults = await ExamResult.find({
      userId: { $in: students.map(s => s._id) }
    });

    // Calculate average performance
    let averagePerformance = 0;
    if (examResults.length > 0) {
      const totalPercentage = examResults.reduce((sum, result) => sum + (result.percentage || 0), 0);
      averagePerformance = Math.round(totalPercentage / examResults.length);
    }

    res.json({
      success: true,
      data: {
        totalStudents: students.length,
        totalClasses: classDocuments.length,
        averageAttendance: 85, // Placeholder - implement attendance tracking
        averagePerformance: averagePerformance
      }
    });
  } catch (error) {
    console.error('Get class stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch class stats', error: error.message });
  }
});

// Get all remarks for a student
router.get('/students/:studentId/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { studentId } = req.params;

    // Verify student exists
    const student = await User.findById(studentId);
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Get all remarks for this student (by any teacher, or filter by current teacher)
    const remarks = await StudentRemark.find({ studentId })
      .populate('teacherId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: remarks
    });
  } catch (error) {
    console.error('Get student remarks error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch remarks', error: error.message });
  }
});

// Update a remark
router.put('/remarks/:remarkId', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { remarkId } = req.params;
    const { remark, isPositive } = req.body;

    if (!remark || remark.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Remark is required' });
    }

    // Find remark and verify ownership
    const existingRemark = await StudentRemark.findById(remarkId);
    if (!existingRemark) {
      return res.status(404).json({ success: false, message: 'Remark not found' });
    }

    if (existingRemark.teacherId.toString() !== teacherId) {
      return res.status(403).json({ success: false, message: 'You can only edit your own remarks' });
    }

    // Update remark
    existingRemark.remark = remark.trim();
    if (isPositive !== undefined) {
      existingRemark.isPositive = isPositive;
    }
    existingRemark.updatedAt = new Date();

    await existingRemark.save();

    // Populate for response
    await existingRemark.populate('teacherId', 'fullName email');
    if (existingRemark.subject) {
      await existingRemark.populate('subject', 'name');
    }

    res.json({
      success: true,
      message: 'Remark updated successfully',
      data: existingRemark
    });
  } catch (error) {
    console.error('Update student remark error:', error);
    res.status(500).json({ success: false, message: 'Failed to update remark', error: error.message });
  }
});

// Delete a remark
router.delete('/remarks/:remarkId', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { remarkId } = req.params;

    // Find remark and verify ownership
    const remark = await StudentRemark.findById(remarkId);
    if (!remark) {
      return res.status(404).json({ success: false, message: 'Remark not found' });
    }

    if (remark.teacherId.toString() !== teacherId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own remarks' });
    }

    await StudentRemark.findByIdAndDelete(remarkId);

    res.json({
      success: true,
      message: 'Remark deleted successfully'
    });
  } catch (error) {
    console.error('Delete student remark error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete remark', error: error.message });
  }
});

// Quiz Management Routes
router.post('/quizzes', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { title, description, subject, duration, difficulty, questions, assignedClasses } = req.body;
    
    if (!title || !subject || !questions || !Array.isArray(questions)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title, subject, and questions are required' 
      });
    }

    if (questions.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'At least one question is required' 
      });
    }

    // Validate and clean questions
    const validatedQuestions = questions.map((q, index) => {
      if (!q.question) {
        throw new Error(`Question ${index + 1} is missing the 'question' field`);
      }
      if (!q.options || !Array.isArray(q.options) || q.options.length === 0) {
        throw new Error(`Question ${index + 1} is missing valid options`);
      }
      if (!q.correctAnswer) {
        throw new Error(`Question ${index + 1} is missing the 'correctAnswer' field`);
      }
      return {
        question: String(q.question),
        type: q.type || 'multiple-choice',
        options: q.options.map(opt => String(opt)),
        correctAnswer: q.correctAnswer,
        explanation: q.explanation ? String(q.explanation) : '',
        points: Number(q.points) || 1
      };
    });

    // Calculate total points
    const totalPoints = validatedQuestions.reduce((sum, q) => sum + (q.points || 1), 0);
    
    // Map difficulty values to match Assessment model enum
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate',
      'hard': 'advanced',
      'beginner': 'beginner',
      'intermediate': 'intermediate',
      'advanced': 'advanced'
    };
    const mappedDifficulty = difficultyMap[difficulty?.toLowerCase()] || 'beginner';
    
    // Convert assignedClasses to ObjectIds if they're strings
    let assignedClassesIds = [];
    if (assignedClasses && Array.isArray(assignedClasses)) {
      assignedClassesIds = assignedClasses.map(classId => {
        if (mongoose.Types.ObjectId.isValid(classId)) {
          return new mongoose.Types.ObjectId(classId);
        }
        return classId;
      });
    }

    const newQuiz = new Assessment({
      title,
      description: description || '',
      questions: validatedQuestions,
      subjectIds: [String(subject)], // Ensure subject is a string
      difficulty: mappedDifficulty,
      duration: duration || 60,
      totalPoints,
      createdBy: new mongoose.Types.ObjectId(teacherId),
      adminId: req.adminId ? new mongoose.Types.ObjectId(req.adminId) : new mongoose.Types.ObjectId(teacherId),
      isPublished: true,
      assignedClasses: assignedClassesIds
    });
    
    console.log('Creating quiz with:', {
      title,
      subjectIds: [String(subject)],
      questionsCount: validatedQuestions.length,
      assignedClassesCount: assignedClassesIds.length,
      firstQuestion: validatedQuestions[0] ? {
        question: validatedQuestions[0].question.substring(0, 50),
        optionsCount: validatedQuestions[0].options.length,
        hasCorrectAnswer: !!validatedQuestions[0].correctAnswer
      } : null
    });

    await newQuiz.save();
    res.status(201).json({ success: true, data: newQuiz });
  } catch (error) {
    console.error('Failed to create quiz:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      body: req.body
    });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create quiz', 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Assign quiz to classes
router.post('/quizzes/:quizId/assign', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { quizId } = req.params;
    const { classIds } = req.body;

    if (!classIds || !Array.isArray(classIds)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class IDs array is required' 
      });
    }

    // Find quiz and verify ownership
    const quiz = await Assessment.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz not found' });
    }

    if (quiz.createdBy && quiz.createdBy.toString() !== teacherId) {
      return res.status(403).json({ success: false, message: 'You can only assign your own quizzes' });
    }

    // Verify all class IDs are valid
    const Class = (await import('../models/Class.js')).default;
    const classes = await Class.find({ 
      _id: { $in: classIds },
      isActive: true
    });

    if (classes.length !== classIds.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'One or more class IDs are invalid' 
      });
    }

    // Update quiz with assigned classes
    quiz.assignedClasses = classIds.map(id => new mongoose.Types.ObjectId(id));
    await quiz.save();

    res.json({
      success: true,
      message: `Quiz assigned to ${classIds.length} class(es) successfully`,
      data: quiz
    });
  } catch (error) {
    console.error('Failed to assign quiz:', error);
    res.status(500).json({ success: false, message: 'Failed to assign quiz', error: error.message });
  }
});

// --- Teacher work diary (daily log — visible to assigned students & school admin via other routes) ---
router.get('/work-diary', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { from, to, limit = '60' } = req.query;
    const q = { teacherId: new mongoose.Types.ObjectId(teacherId) };
    if (from && to) {
      const f = parseDateKeyToUtc(String(from));
      const t = parseDateKeyToUtc(String(to));
      if (f && t) q.forDate = { $gte: f, $lte: t };
    }
    const entries = await TeacherWorkDiary.find(q)
      .sort({ forDate: -1 })
      .limit(Math.min(Number(limit) || 60, 200))
      .populate('classId', 'classNumber section name')
      .lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('Get work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch diary' });
  }
});

router.post('/work-diary', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { date, content, title, classId } = req.body;
    if (!date || !content || String(content).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'date and content are required' });
    }
    if (!classId || !mongoose.Types.ObjectId.isValid(String(classId))) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }
    const forDate = parseDateKeyToUtc(String(date));
    if (!forDate) {
      return res.status(400).json({ success: false, message: 'Invalid date (use YYYY-MM-DD)' });
    }
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const classOid = new mongoose.Types.ObjectId(String(classId));
    const Class = (await import('../models/Class.js')).default;
    const classDoc = await Class.findOne({
      _id: classOid,
      isActive: true,
    }).select('_id classNumber section name');
    if (!classDoc) {
      return res.status(400).json({ success: false, message: 'Invalid class' });
    }
    const classDisplay = (() => {
      const section = classDoc.section?.trim();
      if (classDoc.classNumber) {
        return section ? `Class ${classDoc.classNumber} - ${section}` : `Class ${classDoc.classNumber}`;
      }
      return classDoc.name || 'Class';
    })();
    const assignedIds = new Set((teacher.assignedClassIds || []).map(String));
    const assignedByAssignment = (teacher.assignments || []).some(
      (a) => String(a.classId) === String(classOid)
    );
    const allowed =
      assignedByAssignment ||
      assignedIds.has(String(classOid)) ||
      assignedIds.has(String(classDoc.classNumber));
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Class not assigned to you' });
    }

    const tid = new mongoose.Types.ObjectId(teacherId);
    const existing = await TeacherWorkDiary.findOne({ teacherId: tid, forDate, classId: classOid });
    if (existing) {
      existing.content = String(content).trim();
      existing.title = title != null ? String(title).trim() : existing.title;
      existing.classDisplay = classDisplay;
      await existing.save();
      return res.json({ success: true, data: existing, message: 'Diary updated for this date' });
    }
    const doc = new TeacherWorkDiary({
      teacherId: tid,
      adminId: teacher.adminId,
      classId: classOid,
      classDisplay,
      forDate,
      title: title != null ? String(title).trim() : '',
      content: String(content).trim(),
    });
    await doc.save();
    res.status(201).json({ success: true, data: doc, message: 'Diary saved' });
  } catch (error) {
    console.error('Post work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to save diary' });
  }
});

router.put('/work-diary/:id', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { id } = req.params;
    const { content, title, date } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const tid = new mongoose.Types.ObjectId(teacherId);
    const entry = await TeacherWorkDiary.findOne({ _id: id, teacherId: tid });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    if (content != null) entry.content = String(content).trim();
    if (title != null) entry.title = String(title).trim();
    if (date) {
      const nd = parseDateKeyToUtc(String(date));
      if (nd) entry.forDate = nd;
    }
    await entry.save();
    res.json({ success: true, data: entry });
  } catch (error) {
    console.error('Put work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to update diary' });
  }
});

router.delete('/work-diary/:id', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const tid = new mongoose.Types.ObjectId(teacherId);
    const result = await TeacherWorkDiary.findOneAndDelete({ _id: id, teacherId: tid });
    if (!result) return res.status(404).json({ success: false, message: 'Entry not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    console.error('Delete work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete' });
  }
});

export default router;
