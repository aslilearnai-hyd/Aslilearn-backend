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

router.post('/homework-submission', async (req, res) => {
  try {
    const { homeworkId, submissionLink, description } = req.body;
    
    if (!homeworkId || !submissionLink) {
      return res.status(400).json({
        success: false,
        message: 'Homework ID and submission link are required'
      });
    }

    // Validate URL format
    try {
      new URL(submissionLink);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format for submission link'
      });
    }

    // Get homework content to verify it exists and get subject
    const Content = (await import('../../models/Content.js')).default;
    const homework = await Content.findById(homeworkId)
      .populate('subject', 'name');
    
    if (!homework) {
      return res.status(404).json({
        success: false,
        message: 'Homework not found'
      });
    }

    if (homework.type !== 'Homework') {
      return res.status(400).json({
        success: false,
        message: 'Content is not a homework assignment'
      });
    }

    // Tenant / class gate — student may only submit homework in their library scope
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects')
      .select('role assignedAdmin assignedClass assignedSubjects board classNumber isIndividualAccount curriculumBoard interestedSubjects iitCategories isAsliPrepExclusive');
    if (!student || student.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Students only' });
    }

    let allowedSubjectIds = [];
    if (student.isIndividualAccount && !student.assignedAdmin) {
      const { resolveIndividualCatalogSubjectIds } = await import(
        '../../utils/individualCatalogSubjects.js'
      );
      allowedSubjectIds = await resolveIndividualCatalogSubjectIds(student);
    } else {
      const classDoc = await resolveStudentClassDoc(student);
      const adminBoard =
        student.assignedAdmin?.board ||
        student.board;
      allowedSubjectIds = await resolveStudentSubjectIdsForLibrary(
        student,
        adminBoard,
        classDoc,
      );
    }

    const hwSubjectId = String(homework.subject?._id || homework.subject || '');
    const allowed = allowedSubjectIds.some((id) => String(id) === hwSubjectId);
    if (!allowed && allowedSubjectIds.length > 0) {
      // Also allow sibling subject ids for the same board content family
      const boardUpper = resolveStudentContentBoard(
        student,
        student.assignedAdmin?.board || student.board,
      );
      const contentIds = await resolveSubjectContentIdsMany(allowedSubjectIds, {
        board: boardUpper,
      });
      if (!contentIds.some((id) => String(id) === hwSubjectId)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this homework assignment',
        });
      }
    } else if (allowedSubjectIds.length === 0 && !student.isIndividualAccount) {
      return res.status(403).json({
        success: false,
        message: 'No subjects assigned. Contact your administrator.',
      });
    }

    const HomeworkSubmission = (await import('../../models/HomeworkSubmission.js')).default;

    // Check if submission already exists
    const existingSubmission = await HomeworkSubmission.findOne({
      homeworkId: homeworkId,
      studentId: req.userId
    });

    const submissionData = {
      homeworkId: homeworkId,
      studentId: req.userId,
      subjectId: homework.subject._id || homework.subject,
      submissionLink: submissionLink.trim(),
      description: description ? description.trim() : '',
      isMarkedAsDone: true,
      submittedAt: new Date()
    };

    let submission;
    if (existingSubmission) {
      // Update existing submission
      submission = await HomeworkSubmission.findByIdAndUpdate(
        existingSubmission._id,
        submissionData,
        { new: true }
      )
        .populate('homeworkId', 'title fileUrl deadline')
        .populate('subjectId', 'name');
    } else {
      // Create new submission
      submission = new HomeworkSubmission(submissionData);
      await submission.save();
      await submission.populate('homeworkId', 'title fileUrl deadline');
      await submission.populate('subjectId', 'name');
    }

    res.json({
      success: true,
      message: 'Homework submitted successfully',
      data: submission
    });
  } catch (error) {
    console.error('Error submitting homework:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit homework'
    });
  }
});

// Get homework submission for a specific homework
router.get('/homework-submission/:homeworkId', async (req, res) => {
  try {
    const { homeworkId } = req.params;

    const HomeworkSubmission = (await import('../../models/HomeworkSubmission.js')).default;

    const submission = await HomeworkSubmission.findOne({
      homeworkId: homeworkId,
      studentId: req.userId
    })
      .populate('homeworkId', 'title fileUrl deadline')
      .populate('subjectId', 'name');

    if (!submission) {
      return res.json({
        success: true,
        data: null,
        message: 'No submission found'
      });
    }

    res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    console.error('Error fetching homework submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch homework submission'
    });
  }
});

// Get all homework submissions for student
router.get('/homework-submissions', async (req, res) => {
  try {
    const HomeworkSubmission = (await import('../../models/HomeworkSubmission.js')).default;

    const submissions = await HomeworkSubmission.find({
      studentId: req.userId
    })
      .populate('homeworkId', 'title fileUrl deadline type')
      .populate('subjectId', 'name')
      .sort({ submittedAt: -1 });

    res.json({
      success: true,
      data: submissions
    });
  } catch (error) {
    console.error('Error fetching homework submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch homework submissions'
    });
  }
});

// Get student's exam results


export default router;
