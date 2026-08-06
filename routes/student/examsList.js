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
import { examVisibleToSchool, examMatchesAdminBoard, examVisibleToStudent, getExamWindowStatus } from '../../utils/exam-visibility.js';
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
import {
  loadExamQuestionBankForResults,
  toPlainExamResultForApi,
} from '../../utils/exam-result-questions.js';

export { loadExamQuestionBankForResults, toPlainExamResultForApi };
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
import { signQuestionMediaFields } from '../../utils/upload-access.js';
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

/** Exam windows can run several hours; keep signed figure URLs valid for the session. */
const EXAM_FIGURE_SIGN_TTL_SEC = 8 * 60 * 60;


const router = express.Router();

async function hydrateExamQuestions(examDoc, { hideAnswers = false } = {}) {
  const examId = examDoc?._id;
  if (!examId) return examDoc;

  // Source of truth is Question.exam; fallback to Exam.questions to preserve legacy behavior
  let linkedQuestions = await Question.find({ exam: examId, isActive: { $ne: false } })
    .sort(QUESTION_LIST_SORT)
    .lean();

  if (!linkedQuestions.length && Array.isArray(examDoc.questions) && examDoc.questions.length > 0) {
    linkedQuestions = await Question.find({
      _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
      isActive: { $ne: false }
    })
      .sort(QUESTION_LIST_SORT)
      .lean();
  }

  // Legacy fallback: some exams may have embedded question objects stored
  // directly in Exam.questions instead of Question documents.
  if (!linkedQuestions.length && Array.isArray(examDoc.questions) && examDoc.questions.length > 0) {
    const embeddedQuestions = examDoc.questions
      .filter((q) => q && typeof q === 'object')
      .filter((q) => q.questionText || q.questionImage || q.questionType || q.options)
      .map((q, index) => ({
        _id: q._id || `embedded-${examId}-${index}`,
        questionText: q.questionText || '',
        questionImage: q.questionImage || undefined,
        questionType: q.questionType || 'mcq',
        options: Array.isArray(q.options) ? q.options : [],
        correctAnswer: q.correctAnswer,
        marks: Number(q.marks) || 1,
        negativeMarks: Number(q.negativeMarks) || 0,
        explanation: q.explanation || undefined,
        subject: String(q.subject || 'maths').toLowerCase(),
        sectionHeading: String(q.sectionHeading || '').trim(),
        displayOrder: Number(q.displayOrder) > 0 ? Number(q.displayOrder) : index + 1,
        exam: examId,
      }));
    if (embeddedQuestions.length > 0) {
      linkedQuestions = embeddedQuestions;
    }
  }

  let normalizedQuestions = Array.isArray(linkedQuestions) ? linkedQuestions : [];
  const normalizedTotalMarks = normalizedQuestions.reduce((sum, q) => sum + (Number(q?.marks) || 0), 0);

  // When a student is about to take the exam, never ship the answer key to the
  // browser. The server re-grades submissions in POST /exam-results, so the
  // correct answers / explanations / per-option isCorrect flags are stripped
  // here. They are returned again after submission via the graded result.
  if (hideAnswers) {
    normalizedQuestions = normalizedQuestions.map((q) => {
      const { correctAnswer, explanation, ...rest } = q || {};
      const safeOptions = Array.isArray(rest.options)
        ? rest.options.map((opt) => {
            if (opt && typeof opt === 'object') {
              const { isCorrect, ...optRest } = opt;
              return optRest;
            }
            return opt;
          })
        : rest.options;
      return { ...rest, options: safeOptions };
    });
  }

  // Signed URLs so figures load without cookie/Bearer (web API host + mobile Image).
  normalizedQuestions = normalizedQuestions.map((q) =>
    signQuestionMediaFields(q, EXAM_FIGURE_SIGN_TTL_SEC)
  );

  return {
    ...examDoc,
    questions: normalizedQuestions,
    totalQuestions:
      normalizedQuestions.length > 0
        ? normalizedQuestions.length
        : Number(examDoc.totalQuestions) || 0,
    totalMarks:
      normalizedQuestions.length > 0
        ? normalizedTotalMarks
        : Number(examDoc.totalMarks) || 0
  };
}

const canStudentAccessExam = (exam, studentAdminId, studentBoard) => {
  return examVisibleToStudent(exam, studentAdminId, studentBoard);
};

// Get student's exams (respect school targeting)
router.get('/exams', async (req, res) => {
  try {
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories')
      .populate('assignedClass', 'classNumber section');

    if (!student) {
      return res.json({
        success: true,
        data: []
      });
    }

    const studentClassNumber = resolveStudentClassNumber(student, student.assignedClass);
    const studentAdminId = student.assignedAdmin?._id || student.assignedAdmin;
    const studentBoardOrAdmin =
      student.assignedAdmin && typeof student.assignedAdmin === 'object'
        ? student.assignedAdmin
        : student.assignedAdmin?.board || student.board || '';

    // Keep exam discovery broad at DB level, then enforce school + board + class.
    const query = {
      createdByRole: 'super-admin',
      isActive: true
    };

    console.log('📋 Student exams base query:', JSON.stringify(query, null, 2));

    const exams = await Exam.find(query)
      .populate('createdBy', 'fullName email')
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ createdAt: -1 })
      .lean();

    const hydratedExams = await Promise.all(
      exams.map((exam) => hydrateExamQuestions(exam, { hideAnswers: true }))
    );

    // Only show exams that:
    // 1) student is allowed to access by school + board targeting
    // 2) match assigned class
    // Empty question banks still appear (Upcoming / schedule awareness);
    // start/detail endpoints refuse until questions are uploaded.
    const publishedExams = hydratedExams.filter((exam) => {
      if (!canStudentAccessExam(exam, studentAdminId, studentBoardOrAdmin)) return false;
      if (!examMatchesStudentAssignedClass(exam, studentClassNumber)) return false;
      return true;
    });

    const boardLog =
      typeof studentBoardOrAdmin === 'object'
        ? studentBoardOrAdmin.board || 'scope'
        : studentBoardOrAdmin || 'unset';
    console.log(
      `✅ Found ${publishedExams.length} accessible exams for class ${studentClassNumber || 'unset'} board ${boardLog} (from ${hydratedExams.length} total)`
    );
    
    res.json({
      success: true,
      data: publishedExams
    });
  } catch (error) {
    console.error('Error fetching student exams:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exams' });
  }
});

// Get student's teachers (filtered by assigned admin)
router.get('/teachers', getStudentAdminId, async (req, res) => {
  try {
    const teachers = await Teacher.find({ 
      adminId: req.studentAdminId,
      isActive: true 
    }).populate('createdBy', 'fullName email');
    
    res.json({
      success: true,
      data: teachers
    });
  } catch (error) {
    console.error('Error fetching student teachers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers' });
  }
});

// Get specific exam with questions (respect school targeting)
router.get('/exams/:examId', async (req, res) => {
  try {
    const { examId } = req.params;
    
    const student = await User.findById(req.userId)
      .populate('assignedClass', 'classNumber section')
      .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories');
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }
    
    const exam = await Exam.findOne({ 
      _id: examId,
      createdByRole: 'super-admin',
      isActive: true 
    }).lean();
    
    if (!exam) {
      return res.status(404).json({ 
        success: false, 
        message: 'Exam not found or access denied' 
      });
    }

    const studentClassNumber = resolveStudentClassNumber(student, student.assignedClass);
    const studentAdminId = student.assignedAdmin?._id || student.assignedAdmin;
    const studentBoardOrAdmin =
      student.assignedAdmin && typeof student.assignedAdmin === 'object'
        ? student.assignedAdmin
        : student.assignedAdmin?.board || student.board || '';
    if (!canStudentAccessExam(exam, studentAdminId, studentBoardOrAdmin)) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not assigned to your school.'
      });
    }
    if (!examMatchesStudentAssignedClass(exam, studentClassNumber)) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not assigned to your class.'
      });
    }

    const windowStatus = getExamWindowStatus(exam);
    if (!windowStatus.ok) {
      return res.status(403).json({
        success: false,
        message: windowStatus.message,
      });
    }

    const hydratedExam = await hydrateExamQuestions(exam, { hideAnswers: true });

    if (!Array.isArray(hydratedExam?.questions) || hydratedExam.questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Exam is not available yet. Questions have not been uploaded.'
      });
    }

    res.json({
      success: true,
      data: hydratedExam
    });
  } catch (error) {
    console.error('Error fetching exam:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam' });
  }
});

// Get Asli Prep Exclusive Content (filtered by board and class assigned subjects)


export default router;
