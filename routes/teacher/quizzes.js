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
    const Class = (await import('../../models/Class.js')).default;
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

/** Platform Quiz for teachers is retired — Super Admin quizzes go to students/trial only. */
router.get('/platform-quizzes', async (_req, res) => {
  return res.json({ success: true, data: [] });
});

router.get('/platform-quizzes/:quizId/questions', async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Teacher quizzes have been removed. Quizzes are available to students and trial members only.',
  });
});

router.post('/platform-quizzes/:quizId/result', async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Teacher quizzes have been removed.',
  });
});

export default router;
