import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import {
  verifyToken,
  verifyTeacher,
  extractTeacherId
} from '../../middleware/auth.js';
import {
  getTeacherDashboardStats,
  testTeacherData
} from '../../controllers/adminController.js';
import {
  createLessonPlan,
  createTestQuestions,
  createClasswork,
  createSchedule,
  createTeacherTool,
  generateContent,
  getGeneratedContent,
  getTeacherToolStats,
  getSubjects,
  getTopics,
  getAvailableContent
} from '../../controllers/aiToolsController.js';
import { getMyWeeklyDigest } from '../../controllers/impactReportController.js';
import Video from '../../models/Video.js';
import Assessment from '../../models/Assessment.js';
import Exam from '../../models/Exam.js';
import User from '../../models/User.js';
import ExamResult from '../../models/ExamResult.js';
import Teacher from '../../models/Teacher.js';
import Content from '../../models/Content.js';
import StudentRemark from '../../models/StudentRemark.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import Subject from '../../models/Subject.js';
import { examVisibleToSchool, getSchoolAdminCalendarEvents, monthBounds } from '../../controllers/calendarController.js';
import {
  getExplicitTeacherSubjectObjectIds,
  subjectIdAllowed,
} from '../../utils/teacherSubjectScope.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
  subjectGroupKey,
  extractPlainSubjectNameForContent,
} from '../../utils/resolveSubjectContentIds.js';
import { parseDateKeyToUtc, getTeacherClassesHandler } from './helpers.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadDir = path.join(__dirname, '../../uploads/pdfs');
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
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

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
    const { geminiService } = await import('../../services/gemini-service.cjs');
    
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


export default router;
