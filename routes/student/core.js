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

router.get('/weekly-digest', getMyWeeklyDigest);

// Combined dashboard payload (one round trip — user, subjects, content, quizzes)
router.get('/dashboard-bootstrap', async (req, res) => {
  try {
    const { buildStudentDashboardBootstrap } = await import(
      '../services/student-dashboard-bootstrap.js'
    );
    const payload = await buildStudentDashboardBootstrap(req.userId);
    if (!payload.ok) {
      return res.status(payload.status || 500).json({
        success: false,
        message: payload.message || 'Failed to load dashboard',
      });
    }
    return res.json({
      success: true,
      user: payload.user,
      subjects: payload.subjects,
      previewVideos: payload.previewVideos || [],
      contents: payload.contents,
      contentTypeCounts: payload.contentTypeCounts,
      quizzes: payload.quizzes,
      stats: payload.stats,
      studyStreak: payload.studyStreak,
    });
  } catch (error) {
    console.error('dashboard-bootstrap error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
  }
});

// Middleware to validate userId is a valid ObjectId and user is a student
router.use((req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      message: 'User ID not found. Please log in again.'
    });
  }
  
  // Check if userId is a valid MongoDB ObjectId
  if (!mongoose.Types.ObjectId.isValid(req.userId)) {
    console.error('❌ Invalid userId format:', req.userId, 'Type:', typeof req.userId);
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format. Please log in again.'
    });
  }
  
  // Verify user is a student — except content proxy routes used by all roles for PDF iframe/open.
  const pathOnly = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '') || '';
  const isSharedContentProxy =
    pathOnly.endsWith('/content-preview') || pathOnly.endsWith('/content-download');
  if (req.user && req.user.role !== 'student' && !isSharedContentProxy) {
    console.error('❌ Non-student trying to access student routes:', req.user.role);
    return res.status(403).json({
      success: false,
      message: 'Access denied. Student privileges required.'
    });
  }
  
  next();
});



export default router;
