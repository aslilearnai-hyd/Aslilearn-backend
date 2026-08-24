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
import { examVisibleToSchool, examMatchesAdminBoard, examVisibleToStudent, examVisibleToIndividualStudent, isPastExamPracticeForIndividual, isOwnedGeneratedPracticeExam, getExamWindowStatus } from '../../utils/exam-visibility.js';
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
import { QUESTION_LIST_SORT, ensureExamQuestionDisplayOrders, shuffleQuestionsForStudent } from '../../utils/exam-question-order.js';
import ExamAttemptDraft, { MAX_EXAM_RESUMES } from '../../models/ExamAttemptDraft.js';
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
  createOwnedPracticeExam,
  extractGeneratedPracticeQuestions,
} from '../../services/generated-practice-exam-service.js';
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

router.post('/exams/generate-personal', async (req, res) => {
  try {
    const { getStudentSchoolProgramContext } = await import('../../utils/schoolProgram.js');
    const programCtx = await getStudentSchoolProgramContext(req.userId);
    if (!programCtx?.isIndividualAccount) {
      return res.status(403).json({ success: false, message: 'Generate Exam is available to individual student accounts only.' });
    }

    const board = String(req.body?.board || '').trim().toUpperCase();
    const subject = String(req.body?.subject || '').trim();
    const topic = String(req.body?.topic || '').trim();
    const questionCount = Number(req.body?.questionCount);
    if (!['CBSE', 'IIT'].includes(board)) {
      return res.status(400).json({ success: false, message: 'Choose CBSE or IIT.' });
    }
    if (!subject || !topic || ![10, 15, 20].includes(questionCount)) {
      return res.status(400).json({ success: false, message: 'Choose subject, topic, and 10, 15, or 20 questions.' });
    }

    const classNumber = String(
      resolveStudentClassNumber(programCtx.studentDoc || programCtx.userDoc || programCtx) ||
      req.body?.classNumber || ''
    ).replace(/^class\s*/i, '').trim();
    if (!classNumber) {
      return res.status(400).json({ success: false, message: 'Your class is not configured.' });
    }
    const classLabel = `Class ${classNumber}`;
    const tools = ['worksheet-mcq-generator', 'smart-qa-practice-generator', 'mock-test-builder'];
    const collected = [];
    const sources = [];
    const seenSourceRecords = new Set();
    for (const toolName of tools) {
      let variantLimit = 1;
      for (let variantIndex = 0; variantIndex < variantLimit; variantIndex += 1) {
        const { doc, totalCandidates } = await fetchRotatingAiToolData({
          classLabel,
          subject,
          topic,
          subtopic: '',
          toolName,
          board,
          strictToolMatch: true,
          cursorScope: `${req.userId}:exam-builder:${toolName}`,
          fastDelivery: true,
        });
        variantLimit = Math.min(5, Math.max(1, Number(totalCandidates) || 1));
        if (!doc) break;
        const sourceId = String(doc._id || doc.id || `${toolName}:${variantIndex}`);
        if (seenSourceRecords.has(sourceId)) continue;
        seenSourceRecords.add(sourceId);
        const content = String(doc.generatedContent || doc.content || '').trim();
        const rawData = buildRawDataForTool(toolName, content, buildDeliveryMetadataFromDoc(doc));
        const parsed = extractGeneratedPracticeQuestions(rawData, content);
        if (parsed.questions.length) {
          collected.push(...parsed.questions);
          sources.push(toolName);
        }
      }
    }

    const seen = new Set();
    const unique = collected.filter((question) => {
      const key = String(question.questionText || '').toLowerCase().replace(/\W+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort(() => Math.random() - 0.5);
    if (unique.length < questionCount) {
      return res.status(409).json({
        success: false,
        code: 'INSUFFICIENT_SAVED_QUESTIONS',
        message: `Only ${unique.length} scored questions are available for this selection. Choose fewer questions or try another topic.`,
        availableQuestionCount: unique.length,
      });
    }

    const exam = await createOwnedPracticeExam({
      userId: req.userId,
      board,
      classNumber,
      subject,
      topic,
      duration: Math.max(15, questionCount * 2),
      questions: unique.slice(0, questionCount),
    });
    return res.status(201).json({
      success: true,
      data: {
        examId: String(exam._id),
        title: exam.title,
        questionCount: exam.totalQuestions,
        sources,
      },
    });
  } catch (error) {
    console.error('[GENERATE_PERSONAL_EXAM]', error);
    return res.status(500).json({ success: false, message: 'Could not build the exam from saved question records.' });
  }
});

async function hydrateExamQuestions(examDoc, { hideAnswers = false, shuffleForUserId = null } = {}) {
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

  // Per-student jumble: different order for each student, stable for the same student
  // (so autosave/resume keeps the same sequence). Admin/super-admin paper stays canonical.
  if (hideAnswers && shuffleForUserId) {
    normalizedQuestions = shuffleQuestionsForStudent(normalizedQuestions, {
      examId,
      userId: shuffleForUserId,
    });
  }

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
        : Number(examDoc.totalMarks) || 0,
    questionsShuffledForStudent: Boolean(hideAnswers && shuffleForUserId),
  };
}

const canStudentAccessExam = (exam, student, studentAdminId, studentBoard) => {
  if (student?.isIndividualAccount) {
    return examVisibleToIndividualStudent(exam, student);
  }
  return examVisibleToStudent(exam, studentAdminId, studentBoard);
};

/** Attach in-progress draft flags so clients can show "Resume Exam". */
async function attachInProgressDraftFlags(exams, userId) {
  const list = Array.isArray(exams) ? exams : [];
  if (!list.length || !userId) {
    return list.map((exam) => ({ ...exam, hasInProgressDraft: false }));
  }

  const examIds = list.map((exam) => exam?._id).filter(Boolean);
  if (!examIds.length) {
    return list.map((exam) => ({ ...exam, hasInProgressDraft: false }));
  }

  const drafts = await ExamAttemptDraft.find({
    userId,
    examId: { $in: examIds },
    status: 'in_progress',
  })
    .select('examId remainingSeconds lastSavedAt currentQuestionIndex resumeCount')
    .lean();

  const draftByExamId = new Map(drafts.map((d) => [String(d.examId), d]));

  return list.map((exam) => {
    const draft = draftByExamId.get(String(exam._id));
    if (!draft) {
      return {
        ...exam,
        hasInProgressDraft: false,
        maxResumes: MAX_EXAM_RESUMES,
      };
    }

    const windowStatus = getExamWindowStatus(exam, { purpose: 'start' });
    const resumeCount = Math.max(0, Number(draft.resumeCount) || 0);
    const resumeLimitReached = resumeCount >= MAX_EXAM_RESUMES;
    const windowOpen = Boolean(windowStatus.ok);
    const canResumeExam = windowOpen && !resumeLimitReached;
    const forceSubmitDraft = !canResumeExam;

    return {
      ...exam,
      hasInProgressDraft: true,
      canResumeExam,
      forceSubmitDraft,
      draftRemainingSeconds: Math.max(0, Number(draft.remainingSeconds) || 0),
      draftLastSavedAt: draft.lastSavedAt || null,
      draftCurrentQuestionIndex: Math.max(0, Number(draft.currentQuestionIndex) || 0),
      resumeCount,
      maxResumes: MAX_EXAM_RESUMES,
      resumesRemaining: Math.max(0, MAX_EXAM_RESUMES - resumeCount),
      resumeLimitReached,
      examWindowOpen: windowOpen,
      examWindowMessage: windowOpen ? null : windowStatus.message,
    };
  });
}

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
      isActive: true,
      $or: [
        { createdByRole: 'super-admin' },
        { createdByRole: 'student', practiceOwnerUserId: req.userId },
      ],
    };

    console.log('📋 Student exams base query:', JSON.stringify(query, null, 2));

    const exams = await Exam.find(query)
      .populate('createdBy', 'fullName email')
      .populate('targetSchools', 'schoolName fullName email')
      .sort({ createdAt: -1 })
      .lean();

    const hydratedExams = await Promise.all(
      exams.map((exam) =>
        hydrateExamQuestions(exam, {
          hideAnswers: true,
          shuffleForUserId: req.userId,
        })
      )
    );

    // Only show exams that:
    // 1) student is allowed to access by school + board targeting
    // 2) match assigned class
    // Empty question banks still appear (Upcoming / schedule awareness);
    // start/detail endpoints refuse until questions are uploaded.
    const publishedExams = hydratedExams.filter((exam) => {
      if (!canStudentAccessExam(exam, student, studentAdminId, studentBoardOrAdmin)) return false;
      if (!examMatchesStudentAssignedClass(exam, studentClassNumber)) return false;
      return true;
    }).map((exam) => {
      const b2cPastPractice = isPastExamPracticeForIndividual(exam, student);
      return b2cPastPractice
        ? { ...exam, examType: 'practice', b2cPastPractice: true }
        : exam;
    });

    const boardLog =
      typeof studentBoardOrAdmin === 'object'
        ? studentBoardOrAdmin.board || 'scope'
        : studentBoardOrAdmin || 'unset';
    console.log(
      `✅ Found ${publishedExams.length} accessible exams for class ${studentClassNumber || 'unset'} board ${boardLog} (from ${hydratedExams.length} total)`
    );

    const examsWithDraftFlags = await attachInProgressDraftFlags(publishedExams, req.userId);

    res.json({
      success: true,
      data: examsWithDraftFlags
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
      isActive: true,
      $or: [
        { createdByRole: 'super-admin' },
        { createdByRole: 'student', practiceOwnerUserId: req.userId },
      ],
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
    if (!canStudentAccessExam(exam, student, studentAdminId, studentBoardOrAdmin)) {
      return res.status(403).json({
        success: false,
        message: student.isIndividualAccount
          ? 'This practice exam is not available for your class or learning track.'
          : 'This exam is not assigned to your school.',
      });
    }
    if (!examMatchesStudentAssignedClass(exam, studentClassNumber)) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not assigned to your class.'
      });
    }

    const b2cPastPractice = isPastExamPracticeForIndividual(exam, student);
    const ownedPractice = isOwnedGeneratedPracticeExam(exam, req.userId);
    const windowStatus = b2cPastPractice || ownedPractice ? { ok: true } : getExamWindowStatus(exam);
    let forceSubmitExam = false;
    if (!windowStatus.ok) {
      const existingDraft = await ExamAttemptDraft.findOne({
        examId,
        userId: req.userId,
        status: 'in_progress',
      })
        .select('_id resumeCount')
        .lean();
      // After end time: block new attempts, but allow one load so saved progress can be submitted.
      if (!existingDraft) {
        return res.status(403).json({
          success: false,
          message: windowStatus.message,
        });
      }
      forceSubmitExam = true;
    }

    const hydratedExam = await hydrateExamQuestions(exam, {
      hideAnswers: true,
      shuffleForUserId: req.userId,
    });

    if (!Array.isArray(hydratedExam?.questions) || hydratedExam.questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Exam is not available yet. Questions have not been uploaded.'
      });
    }

    const [examWithDraftFlag] = await attachInProgressDraftFlags([hydratedExam], req.userId);

    res.json({
      success: true,
      data: {
        ...examWithDraftFlag,
        forceSubmitExam,
        examWindowMessage: windowStatus.ok ? null : windowStatus.message,
      },
    });
  } catch (error) {
    console.error('Error fetching exam:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exam' });
  }
});

// Get Asli Prep Exclusive Content (filtered by board and class assigned subjects)


export default router;
