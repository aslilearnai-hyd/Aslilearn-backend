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
  removeDuplicates
} from '../controllers/superAdminController.js';
import {
  getAllBoards,
  getBoardDashboard,
  createSubject,
  getSubjectsByBoard,
  deleteSubject,
  uploadContent,
  getContentByBoard,
  deleteContent,
  getBoardAnalytics,
  initializeBoards,
  getAllClasses
} from '../controllers/boardController.js';
import {
  createExam,
  getAllExams,
  getExamsByBoard,
  updateExam,
  deleteExam,
  addQuestion
} from '../controllers/superAdminExamController.js';

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
    'application/vnd.oasis.opendocument.presentation'
  ];
  
  // Video types
  const videoMimes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/x-matroska'
  ];
  
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
  
  if (contentType === 'TextBook' || contentType === 'Workbook' || contentType === 'Material' || contentType === 'Homework') {
    if (documentMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only document files (PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX) are allowed for this content type!'), false);
    }
  } else if (contentType === 'Video') {
    if (videoMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files (MP4, MPEG, MOV, AVI, WEBM, MKV) are allowed!'), false);
    }
  } else if (contentType === 'Audio') {
    if (audioMimes.includes(file.mimetype)) {
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

// Public routes
router.post('/login', superAdminLogin);

// Protected routes - require super admin authentication
router.use(verifyToken);
router.use(verifySuperAdmin);

// Dashboard
router.get('/dashboard/stats', getDashboardStats);
router.get('/analytics', getAnalytics);
router.get('/analytics/realtime', getRealTimeAnalytics);

// Admin Management
router.get('/admins', getAllAdmins);
router.get('/admins/:adminId/analytics', getAdminAnalytics);
router.post('/admins', createAdmin);
router.put('/admins/:id', updateAdmin);
router.delete('/admins/:id', deleteAdmin);
router.post('/migrate-boards', migrateAllBoards); // Migration endpoint
router.post('/remove-duplicates', removeDuplicates); // Deduplication endpoint

// User Management (Global)
router.get('/users', getAllUsers);
router.post('/users', createUser);

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
router.get('/boards/:boardCode/dashboard', getBoardDashboard);
router.get('/boards/:boardCode/analytics', getBoardAnalytics);

// Subject Management (Super Admin only)
router.post('/subjects', createSubject);
router.get('/subjects', async (req, res) => {
  try {
    const Subject = (await import('../models/Subject.js')).default;
    const subjects = await Subject.find({ isActive: true })
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
router.delete('/content/:contentId', deleteContent);

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
    const { geminiService } = await import('../services/gemini-service.cjs');

    // Get subject details
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    // Generate prompt for Gemini
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

    console.log('🤖 Generating questions with Gemini API...');
    const geminiResponse = await geminiService.generateStructuredContent(prompt, 'json');

    // Parse the JSON response from Gemini
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
      console.error('Error parsing Gemini response:', parseError);
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

    // Save questions to database
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
    }

    console.log(`✅ Successfully generated and saved ${savedQuestions.length} questions`);

    res.json({
      success: true,
      message: `Successfully generated ${savedQuestions.length} questions`,
      data: {
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

// Exam Management (Super Admin only)
// Note: Order matters - specific routes before parameterized ones
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
    res.json({ success: true, data: exam });
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
    const questions = await Question.find({ exam: req.params.examId }).sort({ createdAt: -1 });
    console.log(`✅ Found ${questions.length} questions`);
    res.json({ success: true, data: questions });
  } catch (error) {
    console.error('❌ Get questions error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch questions', error: error.message });
  }
});
router.post('/exams/:examId/questions', addQuestion);

// Debug: Log when routes are registered
console.log('✅ Super Admin exam routes registered:', {
  'POST /exams': 'createExam',
  'GET /exams': 'getAllExams',
  'GET /boards/:boardCode/exams': 'getExamsByBoard',
  'PUT /exams/:examId': 'updateExam',
  'DELETE /exams/:examId': 'deleteExam',
  'POST /exams/:examId/questions': 'addQuestion'
});

export default router;