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

router.get('/risk-analysis-reports', async (req, res) => {
  try {
    const studentId = req.userId;

    const reports = await RiskAnalysisReport.find({ studentId })
      .sort({ sentAt: -1 })
      .populate('adminId', 'fullName email')
      .select('-analysisData'); // Don't send full analysis data in list

    res.json({
      success: true,
      data: reports
    });
  } catch (error) {
    console.error('Error fetching risk analysis reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch risk analysis reports',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Download Risk Analysis Report PDF
router.get('/risk-analysis-reports/:reportId/download', async (req, res) => {
  try {
    const { reportId } = req.params;
    const studentId = req.userId;

    const report = await RiskAnalysisReport.findById(reportId);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Verify student owns this report
    if (report.studentId.toString() !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Mark as read
    if (!report.isRead) {
      report.isRead = true;
      report.readAt = new Date();
      await report.save();
    }

    const fs = await import('fs');

    if (!fs.existsSync(report.pdfPath)) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found'
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.pdfFilename}"`);
    
    const fileStream = fs.createReadStream(report.pdfPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading risk analysis report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Teacher daily work diary — entries from teachers in this student's school (class match preferred)
router.get('/teacher-work-diary', async (req, res) => {
  try {
    const student = await User.findById(req.userId);
    if (!student || !student.assignedAdmin) {
      return res.json({ success: true, data: [] });
    }
    const classNum =
      student.classNumber && student.classNumber !== 'Unassigned'
        ? String(student.classNumber).trim()
        : null;

    const base = { adminId: student.assignedAdmin, isActive: true };
    let teachers = classNum
      ? await Teacher.find({ ...base, assignedClassIds: classNum }).select('_id').lean()
      : [];
    if (!teachers.length) {
      teachers = await Teacher.find(base).select('_id').lean();
    }
    const teacherIds = teachers.map((t) => t._id);
    if (!teacherIds.length) {
      return res.json({ success: true, data: [] });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '40'), 10) || 40, 100);
    const studentClassOid =
      student.assignedClass && mongoose.Types.ObjectId.isValid(String(student.assignedClass))
        ? new mongoose.Types.ObjectId(String(student.assignedClass))
        : null;
    const diaryFilter = { teacherId: { $in: teacherIds } };
    if (studentClassOid) {
      diaryFilter.$or = [
        { classId: studentClassOid },
        { classId: { $exists: false } },
        { classId: null },
      ];
    }
    const entries = await TeacherWorkDiary.find(diaryFilter)
      .sort({ forDate: -1 })
      .limit(limit)
      .populate('teacherId', 'fullName email')
      .populate('classId', 'classNumber section name')
      .lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('Student teacher-work-diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to load teacher diary' });
  }
});

// Proxy file download for student content URLs (avoids browser CORS issues)


export default router;
