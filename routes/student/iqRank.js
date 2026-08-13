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
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', '_id')
      .populate('assignedClass', 'classNumber assignedAdmin');
    if (!student) {
      return res.json({ success: true, data: [] });
    }

    const IQRankQuiz = (await import('../../models/IQRankQuiz.js')).default;
    const {
      quizVisibleToViewer,
      buildQuizViewerFromStudent,
    } = await import('../../utils/quiz-audience.js');

    const viewer = buildQuizViewerFromStudent(student);
    const all = await IQRankQuiz.find({ isActive: true })
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const quizzes = all.filter((q) => quizVisibleToViewer(q, viewer));

    res.json({
      success: true,
      data: quizzes,
      classNumber: viewer.classNumber,
      trialAudience: Boolean(viewer.user && (await import('../../utils/individualAccount.js')).isTrialQuizAudience(viewer.user)),
    });
  } catch (error) {
    console.error('Error fetching quizzes:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch quizzes' });
  }
});

/** Unfinished trial-only quizzes marked promptOnLogin for individual trial users. */
router.get('/trial-login-quizzes', async (req, res) => {
  try {
    const student = await User.findById(req.userId)
      .populate('assignedClass', 'classNumber');
    if (!student) {
      return res.json({ success: true, data: [] });
    }

    const { isTrialQuizAudience } = await import('../../utils/individualAccount.js');
    if (!isTrialQuizAudience(student)) {
      return res.json({ success: true, data: [] });
    }

    const IQRankQuiz = (await import('../../models/IQRankQuiz.js')).default;
    const IQRankQuizResult = (await import('../../models/IQRankQuizResult.js')).default;
    const {
      buildQuizViewerFromStudent,
      quizVisibleToViewer,
    } = await import('../../utils/quiz-audience.js');
    const {
      indiaDateKey,
      isDailyBankQuiz,
    } = await import('../../services/daily-quiz-service.js');
    const DailyQuizLog = (await import('../../models/DailyQuizLog.js')).default;

    const viewer = buildQuizViewerFromStudent(student);
    const quizzes = await IQRankQuiz.find({
      isActive: true,
      $or: [
        { trialOnly: true, promptOnLogin: true },
        { questionBankSource: 'daily-quiz-xlsx', audienceType: 'all_members' },
      ],
    })
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const visible = quizzes.filter((q) => quizVisibleToViewer(q, viewer));
    const results = await IQRankQuizResult.find({
      userId: student._id,
      quizId: { $in: visible.map((q) => q._id) },
    })
      .select('quizId')
      .lean();
    const done = new Set(results.map((r) => String(r.quizId)));

    const todayKey = indiaDateKey();
    const todayLog = await DailyQuizLog.findOne({
      userId: student._id,
      dateKey: todayKey,
      completedAt: { $ne: null },
    })
      .select('_id')
      .lean();

    const pending = visible.filter((q) => {
      if (isDailyBankQuiz(q)) {
        // One daily completion per calendar day
        return !todayLog;
      }
      return !done.has(String(q._id));
    });
    pending.sort((a, b) => Number(isDailyBankQuiz(b)) - Number(isDailyBankQuiz(a)));
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
      .populate('assignedAdmin', '_id')
      .populate('assignedClass', 'classNumber assignedAdmin');
    if (!student) {
      return res.json({ success: true, data: [] });
    }

    const IQRankQuestion = (await import('../../models/IQRankQuestion.js')).default;
    const IQRankQuiz = (await import('../../models/IQRankQuiz.js')).default;

    if (quizId) {
      const {
        quizVisibleToViewer,
        buildQuizViewerFromStudent,
      } = await import('../../utils/quiz-audience.js');

      const quiz = await IQRankQuiz.findById(quizId).populate('subject', 'name').populate('questions');
      if (!quiz || quiz.isActive === false) {
        return res.status(404).json({ success: false, message: 'Quiz not found' });
      }

      const viewer = buildQuizViewerFromStudent(student);
      if (!quizVisibleToViewer(quiz, viewer)) {
        return res.status(403).json({ success: false, message: 'Quiz not available' });
      }

      const {
        isDailyBankQuiz,
        getOrCreateDailyQuestions,
        DAILY_PICK_COUNT,
      } = await import('../../services/daily-quiz-service.js');

      if (isDailyBankQuiz(quiz)) {
        const classNumber =
          viewer.classNumber ||
          quiz.classNumber ||
          student.classNumber ||
          student.assignedClass?.classNumber;
        const { dateKey, questions, log } = await getOrCreateDailyQuestions({
          userId: student._id,
          classNumber,
          quizId: quiz._id,
          count: Number(quiz.dailyPickCount) || DAILY_PICK_COUNT,
        });
        return res.json({
          success: true,
          data: questions,
          questions,
          daily: {
            dateKey,
            completed: Boolean(
              log?.completedAt && !Number.isNaN(new Date(log.completedAt).getTime()),
            ),
            score:
              log?.completedAt && log?.score != null ? Number(log.score) : null,
            correctCount: log?.completedAt ? Number(log.correctCount) || 0 : 0,
            pickCount: questions.length,
          },
          quiz: {
            _id: quiz._id,
            title: quiz.title,
            subject: quiz.subject,
            scheduleType: quiz.scheduleType,
            activityType: quiz.activityType,
            trialOnly: Boolean(quiz.trialOnly),
            questionBankSource: quiz.questionBankSource,
            dailyPickCount: Number(quiz.dailyPickCount) || DAILY_PICK_COUNT,
          },
        });
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
          scheduleType: quiz.scheduleType,
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
    const {
      subjectId: bodySubjectId,
      subject: bodySubject,
      quizId,
      totalQuestions,
      correctAnswers,
      incorrectAnswers,
      unattempted,
      score,
      answers,
    } = req.body;

    let subjectId = bodySubjectId || bodySubject;

    if (totalQuestions === undefined || score === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const student = await User.findById(req.userId).populate('assignedClass', 'classNumber');

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }

    const { isTrialQuizAudience } = await import('../../utils/individualAccount.js');

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
        message: 'No class assigned. Please contact your administrator.',
      });
    }

    const IQRankQuiz = (await import('../../models/IQRankQuiz.js')).default;
    const IQRankQuizResult = (await import('../../models/IQRankQuizResult.js')).default;
    const {
      isDailyBankQuiz,
      markDailyQuizCompleted,
      indiaDateKey,
      DAILY_PICK_COUNT,
    } = await import('../../services/daily-quiz-service.js');
    const DailyQuizLog = (await import('../../models/DailyQuizLog.js')).default;

    let quizDoc = null;
    if (quizId) {
      quizDoc = await IQRankQuiz.findById(quizId).select('subject questionBankSource activityType').lean();
      if (!subjectId && quizDoc?.subject) subjectId = String(quizDoc.subject);
    }

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const isDaily = quizDoc ? isDailyBankQuiz(quizDoc) : false;
    const todayKey = indiaDateKey();

    if (isDaily) {
      const already = await DailyQuizLog.findOne({
        userId: req.userId,
        dateKey: todayKey,
        completedAt: { $ne: null },
      })
        .select('_id score correctCount completedAt')
        .lean();
      if (already) {
        return res.status(409).json({
          success: false,
          code: 'DAILY_QUIZ_ALREADY_COMPLETED',
          message: 'You already completed today’s daily quiz. Come back tomorrow for a new set.',
          data: {
            dateKey: todayKey,
            score: already.score,
            correctCount: already.correctCount,
            completedAt: already.completedAt,
            lockedUntilTomorrow: true,
          },
        });
      }
    }

    const existingResult = isDaily
      ? await IQRankQuizResult.findOne({ userId: req.userId, quizId, dateKey: todayKey })
      : quizId
        ? await IQRankQuizResult.findOne({ userId: req.userId, quizId, dateKey: null })
        : await IQRankQuizResult.findOne({
            userId: req.userId,
            subject: subjectId,
          });

    // Non-daily: keep prior “one result per quiz” behavior (match without dateKey too)
    let legacyResult = existingResult;
    if (!isDaily && quizId && !legacyResult) {
      legacyResult = await IQRankQuizResult.findOne({ userId: req.userId, quizId });
    }

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
      dateKey: isDaily ? todayKey : null,
      completedAt: new Date(),
    };

    let quizResult;
    if (legacyResult) {
      quizResult = await IQRankQuizResult.findByIdAndUpdate(legacyResult._id, resultData, {
        new: true,
      }).populate('subject', 'name');
    } else {
      quizResult = new IQRankQuizResult(resultData);
      await quizResult.save();
      await quizResult.populate('subject', 'name');
    }

    if (isDaily && quizId) {
      try {
        await markDailyQuizCompleted({
          userId: req.userId,
          dateKey: todayKey,
          answers: answers || {},
          correctCount: correctAnswers || 0,
          score,
          quizId,
          classNumber: studentClassNumber,
        });
      } catch (dailyErr) {
        console.warn('[iq-rank-quiz-result] daily log update failed:', dailyErr?.message || dailyErr);
      }
    }

    res.json({
      success: true,
      message: 'Quiz result saved successfully',
      data: quizResult,
      daily: isDaily
        ? {
            dateKey: todayKey,
            lockedUntilTomorrow: true,
            pickCount: Number(totalQuestions) || DAILY_PICK_COUNT,
          }
        : undefined,
    });
  } catch (error) {
    console.error('Error saving quiz result:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save quiz result',
    });
  }
});

/** Today’s daily-quiz lock status + previous completed days. */
router.get('/daily-quiz-status', async (req, res) => {
  try {
    const { getDailyQuizStatusForUser } = await import('../../services/daily-quiz-service.js');
    const data = await getDailyQuizStatusForUser(req.userId, {
      limit: Number(req.query.limit) || 14,
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching daily quiz status:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch daily quiz status' });
  }
});

/** Full review payload for one completed daily quiz day. */
router.get('/daily-quiz-result/:dateKey', async (req, res) => {
  try {
    const dateKey = String(req.params.dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ success: false, message: 'Invalid date key' });
    }

    const DailyQuizLog = (await import('../../models/DailyQuizLog.js')).default;
    const IQRankQuestion = (await import('../../models/IQRankQuestion.js')).default;

    const log = await DailyQuizLog.findOne({
      userId: req.userId,
      dateKey,
      completedAt: { $ne: null },
    }).lean();

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'No saved daily quiz result for that day',
      });
    }

    const ids = Array.isArray(log.questionIds) ? log.questionIds : [];
    const questionsRaw = ids.length
      ? await IQRankQuestion.find({ _id: { $in: ids } })
          .select('questionText options correctAnswer explanation difficulty subject')
          .populate('subject', 'name')
          .lean()
      : [];

    const order = new Map(ids.map((id, i) => [String(id), i]));
    questionsRaw.sort(
      (a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
    );

    const answersMap =
      log.answers instanceof Map
        ? Object.fromEntries(log.answers.entries())
        : log.answers && typeof log.answers === 'object'
          ? { ...log.answers }
          : {};

    const questions = questionsRaw.map((q) => {
      const qid = String(q._id);
      const userAnswer = answersMap[qid] != null ? String(answersMap[qid]) : '';
      const correctAnswer = String(q.correctAnswer || '');
      const options = Array.isArray(q.options)
        ? q.options.map((opt) => {
            if (opt && typeof opt === 'object') {
              return {
                text: String(opt.text || ''),
                isCorrect: Boolean(opt.isCorrect) || String(opt.text || '') === correctAnswer,
              };
            }
            return {
              text: String(opt || ''),
              isCorrect: String(opt || '') === correctAnswer,
            };
          })
        : [];
      return {
        _id: qid,
        questionText: q.questionText || '',
        options,
        correctAnswer,
        explanation: q.explanation || '',
        difficulty: q.difficulty || 'medium',
        userAnswer,
        isCorrect: Boolean(userAnswer) && userAnswer === correctAnswer,
        isAnswered: Boolean(userAnswer),
      };
    });

    const total = questions.length || Number(log.questionIds?.length) || 5;
    const correct = Number(log.correctCount) || questions.filter((q) => q.isCorrect).length;
    const answered = questions.filter((q) => q.isAnswered).length;

    res.json({
      success: true,
      data: {
        dateKey: log.dateKey,
        score: log.score == null ? null : Number(log.score),
        correctCount: correct,
        incorrectCount: Math.max(0, answered - correct),
        unattempted: Math.max(0, total - answered),
        totalQuestions: total,
        completedAt: log.completedAt,
        questions,
      },
    });
  } catch (error) {
    console.error('Error fetching daily quiz result:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch daily quiz result' });
  }
});

// Get IQ/Rank Boost quiz results for student (grouped by subject)
router.get('/iq-rank-quiz-results', async (req, res) => {
  try {
    const IQRankQuizResult = (await import('../../models/IQRankQuizResult.js')).default;

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
