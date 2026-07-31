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

router.get('/iq-rank-quizzes', async (req, res) => {
  try {
    const student = await User.findById(req.userId).populate('assignedClass', 'classNumber');
    if (!student) {
      return res.json({ success: true, data: [] });
    }

    const { isTrialQuizAudience } = await import('../utils/individualAccount.js');
    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;

    let studentClassNumber = null;
    if (student.assignedClass?.classNumber) {
      studentClassNumber = String(student.assignedClass.classNumber);
    } else if (student.classNumber) {
      studentClassNumber = String(student.classNumber).replace(/^Class\s+/i, '').trim();
    }

    const trialAudience = isTrialQuizAudience(student);
    let quizzes = [];

    if (trialAudience) {
      const trialQuizzes = await IQRankQuiz.find({
        isActive: true,
        trialOnly: true,
      })
        .populate('subject', 'name')
        .sort({ createdAt: -1 })
        .lean();
      quizzes = trialQuizzes;
      if (studentClassNumber && studentClassNumber !== 'Unassigned') {
        const classQuizzes = await IQRankQuiz.find({
          isActive: true,
          trialOnly: { $ne: true },
          classNumber: studentClassNumber,
        })
          .populate('subject', 'name')
          .sort({ createdAt: -1 })
          .lean();
        const seen = new Set(quizzes.map((q) => String(q._id)));
        for (const q of classQuizzes) {
          if (!seen.has(String(q._id))) quizzes.push(q);
        }
      }
    } else if (studentClassNumber && studentClassNumber !== 'Unassigned') {
      quizzes = await IQRankQuiz.find({
        isActive: true,
        trialOnly: { $ne: true },
        classNumber: studentClassNumber,
      })
        .populate('subject', 'name')
        .sort({ createdAt: -1 })
        .lean();
    }

    res.json({
      success: true,
      data: quizzes,
      classNumber: studentClassNumber,
      trialAudience,
    });
  } catch (error) {
    console.error('Error fetching IQ/Rank quizzes:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch quizzes' });
  }
});

/** Unfinished trial-only quizzes marked promptOnLogin for individual trial users. */
router.get('/trial-login-quizzes', async (req, res) => {
  try {
    const student = await User.findById(req.userId);
    if (!student) {
      return res.json({ success: true, data: [] });
    }

    const { isTrialQuizAudience } = await import('../utils/individualAccount.js');
    if (!isTrialQuizAudience(student)) {
      return res.json({ success: true, data: [] });
    }

    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;
    const IQRankQuizResult = (await import('../models/IQRankQuizResult.js')).default;

    const quizzes = await IQRankQuiz.find({
      isActive: true,
      trialOnly: true,
      promptOnLogin: true,
    })
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const results = await IQRankQuizResult.find({
      userId: student._id,
      quizId: { $in: quizzes.map((q) => q._id) },
    })
      .select('quizId')
      .lean();
    const done = new Set(results.map((r) => String(r.quizId)));

    const pending = quizzes.filter((q) => !done.has(String(q._id)));
    res.json({ success: true, data: pending });
  } catch (error) {
    console.error('Error fetching trial login quizzes:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch trial login quizzes' });
  }
});

// Get IQ/Rank Boost questions for student (filtered by class)
router.get('/iq-rank-questions', async (req, res) => {
  try {
    const { classNumber, subject, difficulty, quizId } = req.query;
    
    const student = await User.findById(req.userId)
      .populate('assignedClass', 'classNumber');
    if (!student) {
      return res.json({ success: true, data: [] });
    }

    const { isTrialQuizAudience } = await import('../utils/individualAccount.js');
    const IQRankQuestion = (await import('../models/IQRankQuestion.js')).default;
    const IQRankQuiz = (await import('../models/IQRankQuiz.js')).default;

    if (quizId) {
      const quiz = await IQRankQuiz.findById(quizId).populate('subject', 'name').populate('questions');
      if (!quiz || quiz.isActive === false) {
        return res.status(404).json({ success: false, message: 'Quiz not found' });
      }
      if (quiz.trialOnly && !isTrialQuizAudience(student)) {
        return res.status(403).json({ success: false, message: 'This quiz is for trial users only' });
      }
      if (!quiz.trialOnly) {
        let studentClassNumber = classNumber;
        if (!studentClassNumber) {
          if (student.assignedClass?.classNumber) studentClassNumber = student.assignedClass.classNumber;
          else if (student.classNumber) studentClassNumber = student.classNumber;
        }
        if (
          studentClassNumber &&
          String(quiz.classNumber) !== String(studentClassNumber).replace(/^Class\s+/i, '').trim() &&
          String(quiz.classNumber) !== String(studentClassNumber)
        ) {
          // Individual trial users without matching class can still open trialOnly; block mismatch for school
          if (!student.isIndividualAccount) {
            return res.status(403).json({ success: false, message: 'Quiz not available for your class' });
          }
        }
      }

      let questions = [];
      if (Array.isArray(quiz.questions) && quiz.questions.length > 0) {
        const ids = quiz.questions.map((q) => (q._id ? q._id : q));
        questions = await IQRankQuestion.find({ _id: { $in: ids }, isActive: true }).populate(
          'subject',
          'name',
        );
      } else {
        questions = await IQRankQuestion.find({
          classNumber: quiz.classNumber,
          subject: quiz.subject?._id || quiz.subject,
          isActive: true,
        }).populate('subject', 'name');
      }

      return res.json({
        success: true,
        data: questions,
        questions,
        quiz: {
          _id: quiz._id,
          title: quiz.title,
          subject: quiz.subject,
          trialOnly: Boolean(quiz.trialOnly),
        },
      });
    }

    // Get student's class number - check assignedClass first, then classNumber field
    let studentClassNumber = classNumber;
    if (!studentClassNumber) {
      if (student.assignedClass && student.assignedClass.classNumber) {
        studentClassNumber = student.assignedClass.classNumber;
      } else if (student.classNumber) {
        studentClassNumber = student.classNumber;
      }
    }
    
    if (!studentClassNumber || studentClassNumber === 'Unassigned') {
      return res.json({
        success: true,
        data: [],
        message: 'No class assigned. Please contact your administrator.'
      });
    }

    // Build query - filter by student's class
    const query = {
      classNumber: studentClassNumber.toString(),
      isActive: true
    };

    // Optional filters
    if (subject && subject !== 'all') {
      query.subject = subject;
    }
    if (difficulty && difficulty !== 'all') {
      query.difficulty = difficulty;
    }

    const questions = await IQRankQuestion.find(query)
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: questions,
      questions: questions,
      classNumber: studentClassNumber.toString()
    });
  } catch (error) {
    console.error('Error fetching IQ/Rank questions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch questions'
    });
  }
});

// Save IQ/Rank Boost quiz result
router.post('/iq-rank-quiz-result', async (req, res) => {
  try {
    const { subjectId, quizId, totalQuestions, correctAnswers, incorrectAnswers, unattempted, score, answers } = req.body;
    
    if (!subjectId || totalQuestions === undefined || score === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const student = await User.findById(req.userId)
      .populate('assignedClass', 'classNumber');
    
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const { isTrialQuizAudience } = await import('../utils/individualAccount.js');

    // Get student's class number
    let studentClassNumber = null;
    if (student.assignedClass && student.assignedClass.classNumber) {
      studentClassNumber = student.assignedClass.classNumber;
    } else if (student.classNumber) {
      studentClassNumber = student.classNumber;
    }

    if ((!studentClassNumber || studentClassNumber === 'Unassigned') && isTrialQuizAudience(student)) {
      studentClassNumber = 'trial';
    }

    if (!studentClassNumber || studentClassNumber === 'Unassigned') {
      return res.status(400).json({
        success: false,
        message: 'No class assigned. Please contact your administrator.'
      });
    }

    const IQRankQuizResult = (await import('../models/IQRankQuizResult.js')).default;

    const existingResult = quizId
      ? await IQRankQuizResult.findOne({ userId: req.userId, quizId })
      : await IQRankQuizResult.findOne({
          userId: req.userId,
          subject: subjectId
        });

    const resultData = {
      userId: req.userId,
      quizId: quizId || undefined,
      subject: subjectId,
      classNumber: studentClassNumber.toString(),
      totalQuestions,
      correctAnswers: correctAnswers || 0,
      incorrectAnswers: incorrectAnswers || 0,
      unattempted: unattempted || 0,
      score,
      answers: answers || {},
      completedAt: new Date()
    };

    let quizResult;
    if (existingResult) {
      // Update existing result
      quizResult = await IQRankQuizResult.findByIdAndUpdate(
        existingResult._id,
        resultData,
        { new: true }
      ).populate('subject', 'name');
    } else {
      // Create new result
      quizResult = new IQRankQuizResult(resultData);
      await quizResult.save();
      await quizResult.populate('subject', 'name');
    }

    res.json({
      success: true,
      message: 'Quiz result saved successfully',
      data: quizResult
    });
  } catch (error) {
    console.error('Error saving quiz result:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save quiz result'
    });
  }
});

// Get IQ/Rank Boost quiz results for student (grouped by subject)
router.get('/iq-rank-quiz-results', async (req, res) => {
  try {
    const IQRankQuizResult = (await import('../models/IQRankQuizResult.js')).default;

    const results = await IQRankQuizResult.find({
      userId: req.userId
    })
      .populate('subject', 'name')
      .sort({ completedAt: -1 });

    // Group results by subject (get latest result per subject)
    const subjectResults = new Map();
    results.forEach((result) => {
      const subjectId = result.subject._id.toString();
      if (!subjectResults.has(subjectId)) {
        subjectResults.set(subjectId, {
          subjectId: subjectId,
          subjectName: result.subject.name,
          score: result.score,
          totalQuestions: result.totalQuestions,
          correctAnswers: result.correctAnswers,
          completedAt: result.completedAt
        });
      }
    });

    res.json({
      success: true,
      data: Array.from(subjectResults.values())
    });
  } catch (error) {
    console.error('Error fetching quiz results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quiz results'
    });
  }
});

// Submit homework


export default router;
