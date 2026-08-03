import express from 'express';
import http from 'http';
import https from 'https';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import Video from '../../models/Video.js';
import Assessment from '../../models/Assessment.js';
import Exam from '../../models/Exam.js';
import Question from '../../models/Question.js';
import Teacher from '../../models/Teacher.js';
import Subject from '../../models/Subject.js';
import Content from '../../models/Content.js';
import StudentRemark from '../../models/StudentRemark.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import GeminiPerformanceReport from '../../models/GeminiPerformanceReport.js';
import { verifyToken } from '../../middleware/auth.js';
import { getMyWeeklyDigest } from '../../controllers/impactReportController.js';
import { getSchoolAdminCalendarEvents, monthBounds } from '../../controllers/calendarController.js';
import { examVisibleToSchool } from '../../utils/exam-visibility.js';
import {
  getStudentExamRanking,
  getAllStudentRankings,
} from '../../controllers/studentRankingController.js';
import geminiService, { generateStudentTool } from '../../services/gemini-service.js';
import { fetchRotatingAiToolData } from '../../services/ai-tool-rotation-service.js';
import {
  buildDeliveryMetadataFromDoc,
  buildRawDataForTool,
  unwrapStoredAiToolContent,
} from '../../utils/build-ai-tool-raw-data.js';
import {
  advancedAnalyticsMockData,
  buildPerQuestionAttemptAnalytics,
  enrichQuestionAnalyticsFromExamQuestions,
  generateAdvancedAnalytics,
} from '../../utils/advancedExamAnalytics.js';
import { normalizeSchoolBoard, resolveUserDisplayBoard } from '../../constants/boards.js';
import { QUESTION_LIST_SORT, ensureExamQuestionDisplayOrders } from '../../utils/exam-question-order.js';
import { dedupeExamResultRows } from '../../utils/dedupe-exam-results.js';
import {
  examMatchesStudentAssignedClass,
  resolveStudentClassNumber,
} from '../../utils/studentClassContent.js';
import { buildAdaptiveLearningPayload } from '../../services/student-adaptive-learning-service.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
  resolveExamQuestionSubjectKey,
} from '../../utils/resolveSubjectContentIds.js';
import { assertAllowedFetchUrl, getContentProxyAllowlist } from '../../utils/url-allowlist.js';
import {
  buildCachedAnalysisResponse,
  cachedHasStaleAiExplanations,
  collectCachedExplanationsByQuestionId,
  getInFlight,
  inFlightKey,
  setInFlight,
  shouldRegenerateCachedReport,
} from '../../utils/examAiAnalysisCache.js';
import {
  escapeRegexClassSuffix,
  plainSubjectName,
  normalizeTopicLabel,
  subjectSlugMatches,
  topicFuzzyMatch,
  parseWeakTopicRowsFromQuery,
  resolveStudentClassDoc,
  resolveStudentSubjectIdsForLibrary,
  resolveStudentClassSubjects,
  resolveStudentContentBoard,
  getStudentAdminId,
} from './helpers.js';


const router = express.Router();

router.get('/quizzes', async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get student with assigned class
    const student = await User.findById(userId)
      .populate('assignedClass', '_id classNumber section')
      .select('-password');
    
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (!student.assignedClass) {
      return res.json({
        success: true,
        data: [],
        message: 'No class assigned. Quizzes will appear here once you are assigned to a class.'
      });
    }
    
    // Find quizzes assigned to student's class
    const quizzes = await Assessment.find({
      assignedClasses: student.assignedClass._id,
      isPublished: true
    })
    .populate('subjectIds', 'name')
    .populate('createdBy', 'fullName email')
    .populate('assignedClasses', 'classNumber section')
    .sort({ createdAt: -1 });
    
    // Format quizzes with attempt information
    const formattedQuizzes = await Promise.all(quizzes.map(async (quiz) => {
      const attempt = quiz.attempts?.find((a) => 
        a.user && a.user.toString() === userId
      );
      
      return {
        _id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        subject: quiz.subjectIds?.[0]?.name || 'Unknown',
        difficulty: quiz.difficulty,
        duration: quiz.duration,
        totalPoints: quiz.totalPoints,
        questionCount: quiz.questions?.length || 0,
        createdAt: quiz.createdAt,
        createdBy: quiz.createdBy,
        hasAttempted: !!attempt,
        bestScore: attempt?.score || null,
        completedAt: attempt?.completedAt || null
      };
    }));
    
    res.json({
      success: true,
      data: formattedQuizzes
    });
  } catch (error) {
    console.error('Get student quizzes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch quizzes', error: error.message });
  }
});

// Get specific quiz by ID for student
router.get('/quizzes/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const userId = req.userId;
    
    // Get student with assigned class
    const student = await User.findById(userId)
      .populate('assignedClass', '_id classNumber section')
      .select('-password');
    
    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    
    if (!student.assignedClass) {
      return res.status(403).json({ 
        success: false, 
        message: 'No class assigned. Please contact your administrator.' 
      });
    }
    
    // Find quiz assigned to student's class
    const quiz = await Assessment.findOne({
      _id: quizId,
      assignedClasses: student.assignedClass._id,
      isPublished: true
    })
    .populate('subjectIds', 'name')
    .populate('createdBy', 'fullName email')
    .select('-attempts'); // Don't send attempts to prevent cheating
    
    if (!quiz) {
      return res.status(404).json({ 
        success: false, 
        message: 'Quiz not found or you do not have access to it' 
      });
    }
    
    res.json({
      success: true,
      data: quiz
    });
  } catch (error) {
    console.error('Get quiz by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch quiz' });
  }
});

// Submit quiz attempt
router.post('/quizzes/:quizId/submit', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers, timeTaken } = req.body;
    const userId = req.userId;

    const student = await User.findById(userId)
      .populate('assignedClass', '_id classNumber section')
      .select('-password');

    if (!student || student.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (!student.assignedClass) {
      return res.status(403).json({
        success: false,
        message: 'No class assigned. Please contact your administrator.',
      });
    }

    // Same access gate as GET /quizzes/:quizId — prevents submitting unassigned quizzes
    const quiz = await Assessment.findOne({
      _id: quizId,
      assignedClasses: student.assignedClass._id,
      isPublished: true,
    });
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found or you do not have access to it',
      });
    }

    const { gradeAssessmentAttempt } = await import('../../utils/grade-assessment.js');
    const graded = gradeAssessmentAttempt(quiz, answers);
    if (!graded.graded && (!quiz.questions || quiz.questions.length === 0) && quiz.isDriveQuiz) {
      // Drive-only quizzes have no server answer key — record attempt without trusting client score
      graded.score = null;
      graded.message = 'Drive quiz recorded without numeric score';
    }
    
    // Remove existing attempt if any
    if (quiz.attempts) {
      quiz.attempts = quiz.attempts.filter(
        (attempt) => {
          const attemptUserId = attempt.user ? (attempt.user.toString ? attempt.user.toString() : String(attempt.user)) : null;
          return attemptUserId !== userId;
        }
      );
    } else {
      quiz.attempts = [];
    }
    
    // Add new attempt — score is server-computed (never from client body.score)
    quiz.attempts.push({
      user: userId,
      score: graded.score,
      answers: answers,
      completedAt: new Date(),
      timeTaken: timeTaken,
    });
    
    await quiz.save();
    
    res.json({
      success: true,
      message: 'Quiz submitted successfully',
      data: {
        score: graded.score,
        totalPoints: graded.totalPoints || quiz.totalPoints,
        graded: graded.graded,
      }
    });
  } catch (error) {
    console.error('Submit quiz error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit quiz' });
  }
});

// Video chapter unlock dates (Today's Tasks — one chapter per day after all modules complete)


export default router;
