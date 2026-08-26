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
import { activityDayKey } from '../../utils/user-activity.js';
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

router.get('/video-chapter-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const StudentVideoChapterProgress = (
      await import('../../models/StudentVideoChapterProgress.js')
    ).default;
    const rows = await StudentVideoChapterProgress.find({ userId }).lean();
    const bySubject = {};
    for (const row of rows) {
      bySubject[String(row.subjectId)] = row.chapterCompletedAt || {};
    }
    res.json({ success: true, data: bySubject });
  } catch (error) {
    console.error('Get video chapter progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch video chapter progress' });
  }
});

router.post('/video-chapter-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const { subjectId, chapterCompletedAt } = req.body;
    if (!subjectId || !mongoose.Types.ObjectId.isValid(subjectId)) {
      return res.status(400).json({ success: false, message: 'Valid subjectId is required' });
    }
    if (!chapterCompletedAt || typeof chapterCompletedAt !== 'object') {
      return res.status(400).json({ success: false, message: 'chapterCompletedAt object is required' });
    }

    const StudentVideoChapterProgress = (
      await import('../../models/StudentVideoChapterProgress.js')
    ).default;
    const incoming = {};
    for (const [ch, dateVal] of Object.entries(chapterCompletedAt)) {
      const key = String(ch).replace(/\D/g, '') || String(ch);
      if (!key) continue;
      incoming[key] = String(dateVal || '').trim();
    }

    const existing = await StudentVideoChapterProgress.findOne({ userId, subjectId }).lean();
    const merged = { ...(existing?.chapterCompletedAt || {}), ...incoming };

    const row = await StudentVideoChapterProgress.findOneAndUpdate(
      { userId, subjectId },
      { $set: { chapterCompletedAt: merged }, $setOnInsert: { userId, subjectId } },
      { upsert: true, new: true, runValidators: true }
    ).lean();

    res.json({
      success: true,
      message: 'Video chapter progress saved',
      data: { subjectId: String(row.subjectId), chapterCompletedAt: row.chapterCompletedAt },
    });
  } catch (error) {
    console.error('Save video chapter progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to save video chapter progress' });
  }
});

// Save or update learning progress for content
router.post('/content-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const { contentId, completed, progress, timeSpent } = req.body;
    
    if (!contentId) {
      return res.status(400).json({ success: false, message: 'Content ID is required' });
    }
    
    const UserProgress = (await import('../../models/UserProgress.js')).default;
    const Content = (await import('../../models/Content.js')).default;
    
    // Verify content exists
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ success: false, message: 'Content not found' });
    }
    
    // Find or create progress record
    let userProgress = await UserProgress.findOne({
      userId: userId,
      contentId: contentId
    });
    
    if (userProgress) {
      // Update existing progress
      if (completed !== undefined) userProgress.completed = completed;
      if (progress !== undefined) userProgress.progress = Math.min(100, Math.max(0, progress));
      if (timeSpent !== undefined) userProgress.timeSpent = timeSpent;
      userProgress.lastAccessed = new Date();
      await userProgress.save();
    } else {
      // Create new progress record
      userProgress = new UserProgress({
        userId: userId,
        contentId: contentId,
        completed: completed || false,
        progress: progress ? Math.min(100, Math.max(0, progress)) : 0,
        timeSpent: timeSpent || 0,
        lastAccessed: new Date()
      });
      await userProgress.save();
    }
    
    res.json({
      success: true,
      message: 'Learning progress saved successfully',
      data: userProgress
    });
  } catch (error) {
    console.error('Save content progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to save learning progress' });
  }
});

// Get learning progress for a student (for teacher dashboard)
router.get('/learning-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const { subjectId } = req.query;
    
    const UserProgress = (await import('../../models/UserProgress.js')).default;
    const Content = (await import('../../models/Content.js')).default;
    
    // Build query
    const query = { userId: userId, contentId: { $exists: true, $ne: null } };
    
    // If subjectId is provided, filter by subject (must be a valid ObjectId)
    if (subjectId) {
      if (!mongoose.Types.ObjectId.isValid(subjectId)) {
        return res.status(400).json({
          success: false,
          message: 'subjectId must be a valid MongoDB id',
        });
      }
      const contentIds = await Content.find({ subject: subjectId }).select('_id');
      query.contentId = { $in: contentIds.map(c => c._id) };
    }
    
    const progressRecords = await UserProgress.find(query)
      .populate('contentId', 'title type subject')
      .sort({ lastAccessed: -1 });
    
    // Calculate overall progress
    const totalContent = subjectId 
      ? await Content.countDocuments({ subject: subjectId, isActive: true })
      : await Content.countDocuments({ isActive: true });
    
    const completedContent = progressRecords.filter(p => p.completed).length;
    const overallProgress = totalContent > 0 
      ? Math.round((completedContent / totalContent) * 100) 
      : 0;
    
    res.json({
      success: true,
      data: {
        progressRecords,
        overallProgress,
        completedContent,
        totalContent
      }
    });
  } catch (error) {
    console.error('Get learning progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch learning progress' });
  }
});

// Save overall progress for student (calculated from dashboard)
router.post('/overall-progress', async (req, res) => {
  try {
    const userId = req.userId;
    const { overallProgress } = req.body;
    
    if (overallProgress === undefined || overallProgress === null) {
      return res.status(400).json({ success: false, message: 'Overall progress is required' });
    }
    
    // Validate progress value
    const progressValue = Math.min(100, Math.max(0, Math.round(overallProgress)));
    
    // Update user's overall progress
    const user = await User.findByIdAndUpdate(
      userId,
      {
        overallProgress: progressValue,
        overallProgressUpdatedAt: new Date()
      },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({
      success: true,
      message: 'Overall progress saved successfully',
      data: {
        overallProgress: user.overallProgress,
        updatedAt: user.overallProgressUpdatedAt
      }
    });
  } catch (error) {
    console.error('Save overall progress error:', error);
    res.status(500).json({ success: false, message: 'Failed to save overall progress' });
  }
});

const MAX_SESSION_MINUTES_PER_DAY = 12 * 60;

function capSessionMinutesPerDay(minutes) {
  const n = Math.round(Number(minutes) || 0);
  return Math.min(MAX_SESSION_MINUTES_PER_DAY, Math.max(0, n));
}

function sanitizeSessionMinutesPerDay(minutes) {
  const n = Math.round(Number(minutes) || 0);
  // Legacy web tracking could turn an orphaned tab into exactly the 12-hour
  // safety cap. Treat that sentinel as corrupt rather than real study time.
  if (n >= MAX_SESSION_MINUTES_PER_DAY) return 0;
  return Math.max(0, n);
}

/** Calendar date YYYY-MM-DD (server local timezone). */
function getCalendarDateKey(date = new Date()) {
  return activityDayKey(date);
}

// Save login session time (logged-in time)
router.post('/session-time', async (req, res) => {
  try {
    const userId = req.userId;
    const { date, totalMinutes } = req.body;
    
    if (!date || totalMinutes === undefined) {
      return res.status(400).json({ success: false, message: 'Date and totalMinutes are required' });
    }
    
    const UserSession = (await import('../../models/UserSession.js')).default;
    
    // Ensure date is in YYYY-MM-DD format
    const dateKey = date.includes('T') ? date.split('T')[0] : date;
    
    // Find or create session record for this date
    let session = await UserSession.findOne({
      userId: userId,
      date: dateKey
    });
    
    if (session) {
      // Update existing session - use maximum duration (in case of multiple updates)
      const newDuration = sanitizeSessionMinutesPerDay(totalMinutes);
      const existingDuration = Number(session.duration) || 0;
      if (existingDuration >= MAX_SESSION_MINUTES_PER_DAY || newDuration > existingDuration) {
        session.duration = newDuration;
        session.endTime = new Date();
        // Mark duration dirty so pre-save does not overwrite with endTime - startTime.
        session.markModified('duration');
        await session.save();
      }
    } else {
      // Create new session record
      const startOfDay = new Date(`${dateKey}T00:00:00`);
      
      session = new UserSession({
        userId: userId,
        date: dateKey,
        startTime: startOfDay,
        endTime: new Date(),
        duration: sanitizeSessionMinutesPerDay(totalMinutes),
      });
      await session.save();
    }
    
    res.json({
      success: true,
      message: 'Session time saved successfully',
      data: session
    });
  } catch (error) {
    console.error('Save session time error:', error);
    res.status(500).json({ success: false, message: 'Failed to save session time' });
  }
});

// Get user's session time data (weekly study time)
router.get('/session-time', async (req, res) => {
  try {
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    
    const UserSession = (await import('../../models/UserSession.js')).default;
    
    // Get session records for the last 7 days
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const sessions = await UserSession.find({
      userId: userId,
      date: { $gte: getCalendarDateKey(sevenDaysAgo) }
    }).sort({ date: 1 });
    
    // Format weekly data by day (cap each day to avoid inflated totals)
    const durationByDate = new Map();
    sessions.forEach((session) => {
      const duration = sanitizeSessionMinutesPerDay(session?.duration || 0);
      durationByDate.set(session.date, Math.max(durationByDate.get(session.date) || 0, duration));
    });
    const weeklyData = {};
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = getCalendarDateKey(date);
      weeklyData[dateKey] = durationByDate.get(dateKey) || 0;
    }

    const weeklyTotal = Object.values(weeklyData).reduce((sum, mins) => sum + mins, 0);

    // Get today's session
    const todayKey = getCalendarDateKey(today);
    const todayTotal = sanitizeSessionMinutesPerDay(weeklyData[todayKey] || 0);
    
    res.json({
      success: true,
      data: {
        today: todayTotal,
        thisWeek: weeklyTotal,
        weeklyData: weeklyData,
        sessions: sessions
      }
    });
  } catch (error) {
    console.error('Get session time error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch session time' });
  }
});

// Student AI Tools Route - Uses hardcoded content (same as teacher tools)


export default router;
