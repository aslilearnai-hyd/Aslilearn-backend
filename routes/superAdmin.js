import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  verifyToken,
  verifySuperAdmin,
  authorizeRoles
} from '../middleware/auth.js';
import {
  superAdminLogin,
  getDashboardStats,
  getAllAdmins,
  getAdminAnalytics,
  getAdminSchoolDetail,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  getAllUsers,
  createUser,
  getAllTeachers,
  createTeacher,
  getAllCourses,
  createCourse,
  getAnalytics,
  getRealTimeAnalytics,
  getSubscriptions,
  exportData,
  migrateAllBoards,
  removeDuplicates,
  importSubjectsFromContent,
  deleteRemainingSubjects,
  analyzeStudentRiskSuperAdmin,
  downloadAndSendRiskAnalysisPDF,
  downloadRiskAnalysisPDF
} from '../controllers/superAdminController.js';
import {
  listAiToolChildren,
  listAiToolRecords,
  getAiToolGenerationById,
  exportAiToolGenerationsBundle,
  getAiToolGenerationsMeta,
} from '../controllers/aiToolGenerationsController.js';
import {
  getAllBoards,
  getBoardDashboard,
  createSubject,
  updateSubject,
  getSubjectsByBoard,
  deleteSubject,
  uploadContent,
  getContentByBoard,
  updateContent,
  deleteContent,
  deleteAllContent,
  getBoardAnalytics,
  getBoardExportData,
  initializeBoards,
  getAllClasses
} from '../controllers/boardController.js';
import {
  createExam,
  getAllExams,
  getExamsByBoard,
  updateExam,
  deleteExam,
  addQuestion,
  bulkUploadExams,
  bulkUploadQuestions,
  normalizeExamClassFields
} from '../controllers/superAdminExamController.js';
import { getCalendarEvents, createCalendarEvent } from '../controllers/calendarController.js';
import { VALID_SCHOOL_BOARDS } from '../constants/boards.js';

const router = express.Router();

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for content file uploads
const contentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/content');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'content-' + uniqueSuffix + ext);
  }
});

// File filter based on content type
const contentFileFilter = (req, file, cb) => {
  const contentType = req.body.contentType || req.query.contentType;
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  
  // Document types (TextBook, Workbook, Material)
  const documentMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/octet-stream'
  ];
  const documentExts = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp'];
  
  // Video types
  const videoMimes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/x-matroska'
  ];
  const videoExts = ['.mp4', '.mpeg', '.mpg', '.mov', '.avi', '.webm', '.mkv'];
  
  // Audio types
  const audioMimes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/ogg',
    'audio/aac',
    'audio/webm',
    'audio/x-m4a'
  ];
  const audioExts = ['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.weba'];
  
  if (contentType === 'TextBook' || contentType === 'Workbook' || contentType === 'Material' || contentType === 'Homework') {
    if (documentMimes.includes(file.mimetype) || documentExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only document files (PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX) are allowed for this content type!'), false);
    }
  } else if (contentType === 'Video') {
    if (videoMimes.includes(file.mimetype) || videoExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (MP4, MPEG, MOV, AVI, WEBM, MKV) are allowed!'), false);
    }
  } else if (contentType === 'Audio') {
    if (audioMimes.includes(file.mimetype) || audioExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files (MP3, WAV, OGG, AAC, M4A) are allowed!'), false);
    }
  } else {
    cb(new Error('Invalid content type!'), false);
  }
};

const contentUpload = multer({
  storage: contentStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: contentFileFilter
});

// Configure multer for thumbnail image uploads
const thumbnailStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/content/thumbnails');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'thumbnail-' + uniqueSuffix + ext);
  }
});

const thumbnailUpload = multer({
  storage: thumbnailStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Configure multer for spreadsheet uploads (memory storage).
// Accepts .csv, .xlsx, .xls — the controller auto-detects format from the
// file's magic bytes. Uploading .xlsx is preferred because Excel's plain CSV
// export drops non-Windows-1252 characters (θ, π, √, ≤, ≥, Δ).
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit (xlsx tends to be bigger than csv)
  },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const allowedExt = name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls');
    const allowedMime = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream', // browsers sometimes send this for .xlsx
    ].includes(file.mimetype);

    if (allowedExt || allowedMime) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV, XLSX, or XLS files are allowed'), false);
    }
  }
});

// Configure multer for exam question image uploads.
const questionImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/questions');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `question-${uniqueSuffix}${ext || '.png'}`);
  }
});

const questionImageUpload = multer({
  storage: questionImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (String(file.mimetype || '').startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Configure multer for school logo uploads.
const schoolLogoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/schools/logos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `school-logo-${uniqueSuffix}${ext || '.png'}`);
  }
});

const schoolLogoUpload = multer({
  storage: schoolLogoStorage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB limit
  fileFilter: (req, file, cb) => {
    if (String(file.mimetype || '').startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

const schoolPhotoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads/schools/photos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `school-photo-${uniqueSuffix}${ext || '.png'}`);
  }
});

const schoolPhotoUpload = multer({
  storage: schoolPhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (String(file.mimetype || '').startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Public routes
router.post('/login', superAdminLogin);

// Protected routes - require super admin authentication
router.use(verifyToken);
router.use(verifySuperAdmin);

// School calendar (before generic /:param routes)
router.get('/calendar/events', getCalendarEvents);
router.post('/calendar/events', createCalendarEvent);

// Dashboard
router.get('/dashboard/stats', getDashboardStats);
router.get('/analytics', getAnalytics);
router.get('/analytics/realtime', getRealTimeAnalytics);

// AI tool generations (teacher tools — persisted for hierarchy + PDF export)
router.get('/ai-tool-generations/meta', getAiToolGenerationsMeta);
router.get('/ai-tool-generations/children', listAiToolChildren);
router.get('/ai-tool-generations/records', listAiToolRecords);
router.get('/ai-tool-generations/export-bundle', exportAiToolGenerationsBundle);
router.get('/ai-tool-generations/document/:id', getAiToolGenerationById);

// Admin Management
router.get('/admins', getAllAdmins);
router.get('/admins/:adminId/analytics', getAdminAnalytics);
router.get('/admins/:adminId/school-detail', getAdminSchoolDetail);
router.post('/admins/upload-logo', (req, res, next) => {
  schoolLogoUpload.single('logo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 3MB.'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Logo upload error'
      });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo file provided'
      });
    }

    const logoUrl = `/uploads/schools/logos/${req.file.filename}`;
    res.json({
      success: true,
      logoUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to upload school logo',
      error: error.message
    });
  }
});
router.post('/admins/upload-school-photo', (req, res, next) => {
  schoolPhotoUpload.single('photo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 5MB.'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Photo upload error'
      });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No photo file provided'
      });
    }

    const photoUrl = `/uploads/schools/photos/${req.file.filename}`;
    res.json({
      success: true,
      photoUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to upload school photo',
      error: error.message
    });
  }
});
router.post('/admins', createAdmin);
router.put('/admins/:id', updateAdmin);
router.delete('/admins/:id', deleteAdmin);
router.post('/migrate-boards', migrateAllBoards); // Migration endpoint
router.post('/remove-duplicates', removeDuplicates); // Deduplication endpoint
router.post('/import-subjects-from-content', importSubjectsFromContent); // Import subjects from content
router.post('/delete-remaining-subjects', deleteRemainingSubjects); // Delete subjects with wrong board or inactive

// User Management (Global)
router.get('/users', getAllUsers);
router.post('/users', createUser);

// AI Student Risk Analysis (Super Admin - can analyze any student)
router.post('/ai/student-risk-analysis', analyzeStudentRiskSuperAdmin);
router.post('/ai/student-risk-analysis/download-send', downloadAndSendRiskAnalysisPDF);
router.get('/reports/download/:reportId', downloadRiskAnalysisPDF);
console.log('✅ Super Admin AI Risk Analysis routes registered:');
console.log('   POST /api/super-admin/ai/student-risk-analysis');
console.log('   POST /api/super-admin/ai/student-risk-analysis/download-send');
console.log('   GET /api/super-admin/reports/download/:reportId');

// Teacher Management (Global)
router.get('/teachers', getAllTeachers);
router.post('/teachers', createTeacher);

// Course Management (Global)
router.get('/courses', getAllCourses);
router.post('/courses', createCourse);

// Analytics & Reports
router.get('/subscriptions', getSubscriptions);
router.get('/export', exportData);

// Board Management Routes
router.get('/boards', getAllBoards);
router.get('/boards/analytics/comparison', getBoardAnalytics); // Must come before parameterized routes
router.get('/boards/export', getBoardExportData); // Export detailed data
router.get('/boards/:boardCode/dashboard', getBoardDashboard);
router.get('/boards/:boardCode/analytics', getBoardAnalytics);

// Subject Management (Super Admin only)
router.post('/subjects', createSubject);
router.put('/subjects/:subjectId', updateSubject);
router.get('/subjects', async (req, res) => {
  try {
    const Subject = (await import('../models/Subject.js')).default;
    const subjects = await Subject.find({
      board: { $in: VALID_SCHOOL_BOARDS },
      isActive: true
    })
      .sort({ name: 1 });
    res.json({
      success: true,
      data: subjects
    });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subjects'
    });
  }
});
router.get('/boards/:board/subjects', getSubjectsByBoard);
router.delete('/subjects/:subjectId', deleteSubject);

// Class Management (Super Admin only)
router.get('/classes', getAllClasses);

// Content Management (Super Admin only - Asli Prep Exclusive)
// File upload endpoint for content
router.post('/content/upload-file', (req, res, next) => {
  contentUpload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          success: false,
          message: 'File too large. Maximum size is 100MB.' 
        });
      }
      return res.status(400).json({ 
        success: false,
        message: err.message || 'File upload error'
      });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file provided' 
      });
    }

    const fileUrl = `/uploads/content/${req.file.filename}`;
    console.log('Content file uploaded successfully:', fileUrl);
    
    res.json({ 
      success: true,
      fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Failed to upload content file:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to upload file',
      error: error.message 
    });
  }
});

// Thumbnail image upload endpoint for content
router.post('/content/upload-thumbnail', (req, res, next) => {
  thumbnailUpload.single('thumbnail')(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          success: false,
          message: 'File too large. Maximum size is 5MB.' 
        });
      }
      return res.status(400).json({ 
        success: false,
        message: err.message || 'File upload error'
      });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file provided' 
      });
    }

    const thumbnailUrl = `/uploads/content/thumbnails/${req.file.filename}`;
    console.log('Thumbnail uploaded successfully:', thumbnailUrl);
    
    res.json({ 
      success: true,
      thumbnailUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Failed to upload thumbnail:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to upload thumbnail',
      error: error.message 
    });
  }
});

router.post('/content', uploadContent);
router.get('/boards/:board/content', getContentByBoard);
router.put('/content/:contentId', updateContent);
router.delete('/content/:contentId', deleteContent);
router.delete('/content', deleteAllContent); // Bulk delete all content

// Question image upload endpoint for super-admin exam management.
router.post('/upload-question-image', (req, res, next) => {
  questionImageUpload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 5MB.'
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error'
      });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/questions/${req.file.filename}`;
    res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
});

// IQ/Rank Boost Activities Routes
router.post('/iq-rank-activities/generate-questions', async (req, res) => {
  try {
    const { classNumber, numberOfQuestions, difficulty, subjectId } = req.body;

    if (!classNumber || !numberOfQuestions || !difficulty || !subjectId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: classNumber, numberOfQuestions, difficulty, subjectId'
      });
    }

    // Import required models
    const Subject = (await import('../models/Subject.js')).default;
    const IQRankQuestion = (await import('../models/IQRankQuestion.js')).default;
    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;
    const { geminiService } = await import('../services/gemini-service.cjs');

    // Get subject details
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    // Generate prompt for LLM
    const prompt = `Generate exactly ${numberOfQuestions} multiple-choice questions (MCQ) for:
- Class Level: Class ${classNumber}
- Subject: ${subject.name}
- Difficulty Level: ${difficulty}

IMPORTANT: You MUST return ONLY valid JSON in the following exact format (no markdown, no code blocks, just pure JSON):
{
  "questions": [
    {
      "questionText": "Question text here",
      "options": [
        {"text": "Option A text", "isCorrect": true},
        {"text": "Option B text", "isCorrect": false},
        {"text": "Option C text", "isCorrect": false},
        {"text": "Option D text", "isCorrect": false}
      ],
      "correctAnswer": "Option A text",
      "explanation": "Explanation of why the correct answer is right"
    }
  ]
}

Requirements:
1. Generate exactly ${numberOfQuestions} questions
2. All questions must be multiple-choice with exactly 4 options (A, B, C, D)
3. Each question must have exactly ONE correct answer
4. Questions should be appropriate for Class ${classNumber} level
5. Difficulty should match: ${difficulty}
6. Questions should cover various topics within ${subject.name}
7. Include clear explanations for each correct answer
8. Return ONLY the JSON object, no additional text before or after`;

    console.log('🤖 Generating questions with local LLM...');
    const geminiResponse = await geminiService.generateStructuredContent(prompt, 'json');

    // Parse the JSON response from LLM
    let questionsData;
    try {
      // Try to extract JSON from the response (in case it's wrapped in markdown)
      let jsonText = geminiResponse.trim();
      
      // Remove markdown code blocks if present
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/g, '');
      }

      questionsData = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Error parsing LLM response:', parseError);
      console.error('Raw response:', geminiResponse);
      return res.status(500).json({
        success: false,
        message: 'Failed to parse AI response. Please try again.',
        error: parseError.message
      });
    }

    if (!questionsData.questions || !Array.isArray(questionsData.questions)) {
      return res.status(500).json({
        success: false,
        message: 'Invalid response format from AI'
      });
    }

    // Create a new quiz first
    const quizTitle = `${subject.name} - Class ${classNumber} - ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} - ${new Date().toLocaleDateString()}`;
    const newQuiz = new IQRankQuiz({
      title: quizTitle,
      description: `IQ/Rank Boost Quiz for ${subject.name} - Class ${classNumber} (${difficulty} difficulty)`,
      subject: subjectId,
      classNumber: classNumber.toString(),
      board: subject.board || 'ASLI_EXCLUSIVE_SCHOOLS',
      difficulty: difficulty,
      questions: [],
      totalQuestions: questionsData.questions.length,
      isActive: true,
      generatedBy: 'super-admin'
    });
    await newQuiz.save();

    // Save questions to database and associate with quiz
    const savedQuestions = [];
    for (const q of questionsData.questions) {
      // Ensure options array has correct format
      const options = q.options.map((opt, index) => ({
        text: typeof opt === 'string' ? opt : opt.text,
        isCorrect: typeof opt === 'string' 
          ? (opt === q.correctAnswer || index === 0) 
          : (opt.isCorrect || opt.text === q.correctAnswer)
      }));

      // Find correct answer index if it's a string
      let correctAnswer = q.correctAnswer;
      if (typeof q.correctAnswer === 'string') {
        const correctIndex = options.findIndex(opt => 
          opt.text === q.correctAnswer || opt.isCorrect
        );
        if (correctIndex !== -1) {
          correctAnswer = options[correctIndex].text;
        }
      }

      const question = new IQRankQuestion({
        questionText: q.questionText || q.question,
        questionType: 'mcq',
        options: options,
        correctAnswer: correctAnswer,
        explanation: q.explanation || '',
        difficulty: difficulty,
        subject: subjectId,
        classNumber: classNumber.toString(),
        board: subject.board || null,
        points: 1,
        isActive: true,
        generatedBy: 'super-admin'
      });

      await question.save();
      await question.populate('subject', 'name');
      savedQuestions.push(question);
      
      // Add question to quiz
      newQuiz.questions.push(question._id);
    }

    // Update quiz with all question IDs
    await newQuiz.save();
    await newQuiz.populate('subject', 'name');
    await newQuiz.populate('questions');

    console.log(`✅ Successfully generated and saved ${savedQuestions.length} questions in quiz: ${newQuiz._id}`);

    res.json({
      success: true,
      message: `Successfully generated ${savedQuestions.length} questions and created a new quiz`,
      data: {
        quiz: newQuiz,
        questions: savedQuestions,
        count: savedQuestions.length
      }
    });
  } catch (error) {
    console.error('Error generating questions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate questions',
      error: error.message
    });
  }
});

// Get IQ/Rank questions for a class
router.get('/iq-rank-activities/questions', async (req, res) => {
  try {
    const { classNumber, subject, difficulty } = req.query;
    const IQRankQuestion = (await import('../models/IQRankQuestion.js')).default;

    const query = { isActive: true };
    if (classNumber) query.classNumber = classNumber;
    if (subject) query.subject = subject;
    if (difficulty) query.difficulty = difficulty;

    const questions = await IQRankQuestion.find(query)
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch questions'
    });
  }
});

/** Map IQRankQuiz documents to the shape expected by super-admin IQ/Rank Boost Activities UI */
function mapQuizToActivity(quiz) {
  const q = quiz.toObject ? quiz.toObject() : { ...quiz };
  const totalQ = q.totalQuestions != null ? q.totalQuestions : (Array.isArray(q.questions) ? q.questions.length : 0);
  return {
    _id: q._id,
    title: q.title,
    description: q.description || '',
    type: q.activityType || 'quiz',
    difficulty: q.difficulty,
    points: q.points != null ? q.points : totalQ * 10,
    duration: q.durationMinutes != null ? q.durationMinutes : 30,
    subject: q.subject,
    board: q.board,
    classNumber: q.classNumber,
    questions: totalQ,
    isActive: q.isActive !== false,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    participants: undefined,
    averageScore: undefined,
    completionRate: undefined
  };
}

// IQ/Rank Boost Activities CRUD (backed by IQRankQuiz — same resource as AI-generated quizzes)
router.get('/iq-rank-activities', async (req, res) => {
  try {
    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;
    const list = await IQRankQuiz.find({})
      .populate('subject', 'name')
      .sort({ createdAt: -1 });
    const data = list.map(mapQuizToActivity);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error listing IQ/Rank activities:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list activities'
    });
  }
});

router.post('/iq-rank-activities', async (req, res) => {
  try {
    const mongoose = (await import('mongoose')).default;
    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;
    const {
      title,
      description,
      type: activityType,
      difficulty,
      points,
      duration,
      subject,
      classNumber,
      questions: questionCount,
      isActive
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }
    if (!subject || !mongoose.Types.ObjectId.isValid(subject)) {
      return res.status(400).json({ success: false, message: 'Valid subject is required' });
    }
    if (classNumber === undefined || classNumber === null || String(classNumber).trim() === '') {
      return res.status(400).json({ success: false, message: 'Class number is required' });
    }
    if (!difficulty || !['easy', 'medium', 'hard', 'expert'].includes(difficulty)) {
      return res.status(400).json({ success: false, message: 'Valid difficulty is required' });
    }

    const quiz = new IQRankQuiz({
      title: String(title).trim(),
      description: description != null ? String(description).trim() : '',
      subject,
      classNumber: String(classNumber).trim(),
      board: 'ASLI_EXCLUSIVE_SCHOOLS',
      difficulty,
      questions: [],
      totalQuestions: Math.max(0, parseInt(String(questionCount), 10) || 0),
      isActive: isActive !== false,
      activityType: activityType && ['iq-test', 'rank-boost', 'challenge', 'quiz'].includes(activityType)
        ? activityType
        : 'quiz',
      points: points != null ? Number(points) : 100,
      durationMinutes: duration != null ? Number(duration) : 30,
      generatedBy: 'super-admin'
    });
    await quiz.save();
    await quiz.populate('subject', 'name');
    res.status(201).json({ success: true, data: mapQuizToActivity(quiz) });
  } catch (error) {
    console.error('Error creating IQ/Rank activity:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create activity'
    });
  }
});

router.put('/iq-rank-activities/:id', async (req, res) => {
  try {
    const mongoose = (await import('mongoose')).default;
    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid activity id' });
    }

    const {
      title,
      description,
      type: activityType,
      difficulty,
      points,
      duration,
      subject,
      classNumber,
      questions: questionCount,
      isActive
    } = req.body;

    const update = {};
    if (title != null) update.title = String(title).trim();
    if (description != null) update.description = String(description).trim();
    if (activityType && ['iq-test', 'rank-boost', 'challenge', 'quiz'].includes(activityType)) {
      update.activityType = activityType;
    }
    if (difficulty && ['easy', 'medium', 'hard', 'expert'].includes(difficulty)) {
      update.difficulty = difficulty;
    }
    if (points != null) update.points = Number(points);
    if (duration != null) update.durationMinutes = Number(duration);
    if (subject && mongoose.Types.ObjectId.isValid(subject)) update.subject = subject;
    if (classNumber != null) update.classNumber = String(classNumber).trim();
    if (questionCount != null) update.totalQuestions = Math.max(0, parseInt(String(questionCount), 10) || 0);
    if (isActive != null) update.isActive = Boolean(isActive);

    const quiz = await IQRankQuiz.findByIdAndUpdate(id, { $set: update }, { new: true })
      .populate('subject', 'name');
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }
    res.json({ success: true, data: mapQuizToActivity(quiz) });
  } catch (error) {
    console.error('Error updating IQ/Rank activity:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update activity'
    });
  }
});

router.delete('/iq-rank-activities/:id', async (req, res) => {
  try {
    const mongoose = (await import('mongoose')).default;
    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;
    const IQRankQuestion = (await import('../models/IQRankQuestion.js')).default;
    const IQRankQuizResult = (await import('../models/IQRankQuizResult.js')).default;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid activity id' });
    }

    const quiz = await IQRankQuiz.findById(id);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Activity not found' });
    }

    if (quiz.questions && quiz.questions.length > 0) {
      await IQRankQuestion.deleteMany({ _id: { $in: quiz.questions } });
    }
    await IQRankQuizResult.deleteMany({ quizId: quiz._id });
    await IQRankQuiz.findByIdAndDelete(id);

    res.json({ success: true, message: 'Activity deleted' });
  } catch (error) {
    console.error('Error deleting IQ/Rank activity:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete activity'
    });
  }
});

// Exam Management (Super Admin only)
// Note: Order matters - specific routes before parameterized ones
router.post('/exams/bulk-upload', csvUpload.single('file'), bulkUploadExams);
router.post('/exams', createExam);
router.get('/exams', getAllExams);
router.get('/boards/:boardCode/exams', getExamsByBoard);
router.get('/exams/:examId', async (req, res) => {
  try {
    console.log('📋 Fetching exam by ID:', req.params.examId);
    const Exam = (await import('../models/Exam.js')).default;
    const exam = await Exam.findById(req.params.examId).populate('questions');
    if (!exam) {
      console.log('❌ Exam not found:', req.params.examId);
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }
    console.log('✅ Exam found:', exam.title, 'Questions:', exam.questions?.length || 0);
    res.json({ success: true, data: normalizeExamClassFields(exam) });
  } catch (error) {
    console.error('❌ Get exam error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch exam', error: error.message });
  }
});
router.put('/exams/:examId', updateExam);
router.delete('/exams/:examId', deleteExam);
router.get('/exams/:examId/questions', async (req, res) => {
  try {
    console.log('📋 Fetching questions for exam:', req.params.examId);
    const Question = (await import('../models/Question.js')).default;
    const questions = await Question.find({ exam: req.params.examId }).sort({ createdAt: 1, _id: 1 });
    console.log(`✅ Found ${questions.length} questions`);
    res.json({ success: true, data: questions });
  } catch (error) {
    console.error('❌ Get questions error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch questions', error: error.message });
  }
});
router.post('/exams/:examId/questions', addQuestion);
router.post('/exams/:examId/questions/bulk-upload', csvUpload.single('file'), bulkUploadQuestions);

// Debug: Log when routes are registered
console.log('✅ Super Admin exam routes registered:', {
  'POST /exams/bulk-upload': 'bulkUploadExams',
  'POST /exams': 'createExam',
  'GET /exams': 'getAllExams',
  'GET /boards/:boardCode/exams': 'getExamsByBoard',
  'PUT /exams/:examId': 'updateExam',
  'DELETE /exams/:examId': 'deleteExam',
  'POST /exams/:examId/questions': 'addQuestion',
  'POST /exams/:examId/questions/bulk-upload': 'bulkUploadQuestions'
});

export default router;