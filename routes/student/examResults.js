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
import { examVisibleToSchool, examVisibleToStudent, getExamWindowStatus } from '../../utils/exam-visibility.js';
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
  buildExamQuestionSnapshot,
  loadExamQuestionBankForResults,
  resolveQuestionsForExamResult,
  toPlainExamResultForApi,
} from '../../utils/exam-result-questions.js';
import { signQuestionMediaFields } from '../../utils/upload-access.js';
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
import ExamAttemptDraft, { MAX_EXAM_RESUMES } from '../../models/ExamAttemptDraft.js';


const router = express.Router();

function draftAnswersToObject(answers) {
  if (!answers) return {};
  if (answers instanceof Map) return Object.fromEntries(answers.entries());
  if (typeof answers === 'object') return { ...answers };
  return {};
}

function draftTimingsToObject(timings) {
  if (!timings) return {};
  if (timings instanceof Map) return Object.fromEntries(timings.entries());
  if (typeof timings === 'object') return { ...timings };
  return {};
}

function serializeDraft(doc) {
  if (!doc) return null;
  const plain =
    typeof doc.toObject === 'function' ? doc.toObject({ flattenMaps: true }) : doc;
  const resumeCount = Math.max(0, Number(plain.resumeCount) || 0);
  return {
    examId: String(plain.examId),
    userId: String(plain.userId),
    answers: draftAnswersToObject(plain.answers),
    flaggedQuestions: Array.isArray(plain.flaggedQuestions) ? plain.flaggedQuestions : [],
    questionTimings: draftTimingsToObject(plain.questionTimings),
    currentQuestionIndex: Number(plain.currentQuestionIndex) || 0,
    remainingSeconds: Math.max(0, Number(plain.remainingSeconds) || 0),
    durationSeconds: Math.max(1, Number(plain.durationSeconds) || 1),
    resumeCount,
    maxResumes: MAX_EXAM_RESUMES,
    resumesRemaining: Math.max(0, MAX_EXAM_RESUMES - resumeCount),
    startedAt: plain.startedAt,
    lastSavedAt: plain.lastSavedAt,
    lastResumedAt: plain.lastResumedAt || null,
    status: plain.status || 'in_progress',
  };
}

/** Load in-progress draft (answers + frozen remaining timer) for resume after power loss. */
router.get('/exams/:examId/attempt-draft', async (req, res) => {
  try {
    const { examId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }

    const ExamResult = (await import('../../models/ExamResult.js')).default;
    const examDoc = await Exam.findById(examId)
      .select('maxAttempts isActive createdByRole startDate endDate duration')
      .lean();
    if (!examDoc || examDoc.isActive === false) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const maxAttempts = Math.max(1, Number(examDoc.maxAttempts) || 1);
    const priorCount = await ExamResult.countDocuments({ userId: req.userId, examId });
    if (priorCount >= maxAttempts) {
      await ExamAttemptDraft.deleteOne({ examId, userId: req.userId });
      return res.json({ success: true, data: null, message: 'Maximum attempts already used' });
    }

    const draft = await ExamAttemptDraft.findOne({
      examId,
      userId: req.userId,
      status: 'in_progress',
    });

    if (!draft) {
      return res.json({ success: true, data: null, maxResumes: MAX_EXAM_RESUMES });
    }

    // After admin end time: no resume / continue — return draft once for forced submit.
    const windowStatus = getExamWindowStatus(examDoc, { purpose: 'start' });
    if (!windowStatus.ok) {
      const ended = /ended/i.test(String(windowStatus.message || ''));
      return res.json({
        success: true,
        data: serializeDraft(draft),
        resumed: false,
        examEnded: ended,
        forceSubmit: true,
        message: ended
          ? 'Exam window has ended. Your saved answers will be submitted.'
          : windowStatus.message,
      });
    }

    const currentResumeCount = Math.max(0, Number(draft.resumeCount) || 0);
    if (currentResumeCount >= MAX_EXAM_RESUMES) {
      return res.json({
        success: true,
        data: serializeDraft(draft),
        resumed: false,
        resumeLimitReached: true,
        forceSubmit: true,
        maxResumes: MAX_EXAM_RESUMES,
        message: `Resume limit (${MAX_EXAM_RESUMES}) reached. Your saved answers will be submitted.`,
      });
    }

    // Count this reopen as one resume — skip brand-new same-session loads / Strict Mode remounts.
    const lastResumedMs = draft.lastResumedAt ? new Date(draft.lastResumedAt).getTime() : 0;
    const anchorMs = new Date(
      draft.lastResumedAt || draft.lastSavedAt || draft.startedAt || 0,
    ).getTime();
    const nowMs = Date.now();
    const ageMs = Number.isFinite(anchorMs) ? nowMs - anchorMs : Number.POSITIVE_INFINITY;
    const shouldCountResume =
      (ageMs > 20000 || currentResumeCount > 0) &&
      (!Number.isFinite(lastResumedMs) || nowMs - lastResumedMs > 15000);
    if (shouldCountResume) {
      draft.resumeCount = currentResumeCount + 1;
      draft.lastResumedAt = new Date();
      await draft.save();
    }

    return res.json({
      success: true,
      data: serializeDraft(draft),
      resumed: true,
      maxResumes: MAX_EXAM_RESUMES,
    });
  } catch (error) {
    console.error('GET attempt-draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to load exam draft' });
  }
});

/**
 * Autosave in-progress answers + remaining timer.
 * remainingSeconds is frozen at this value while the student is offline (PC off / closed).
 */
router.put('/exams/:examId/attempt-draft', async (req, res) => {
  try {
    const { examId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }

    const examDoc = await Exam.findById(examId).lean();
    if (!examDoc || examDoc.isActive === false || examDoc.createdByRole !== 'super-admin') {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const existing = await ExamAttemptDraft.findOne({ examId, userId: req.userId }).lean();
    // New draft = starting an attempt — must be inside the exam window (no resume after end).
    // Existing draft autosave may use submit grace so an open session can still save.
    const windowStatus = getExamWindowStatus(examDoc, {
      purpose: existing ? 'submit' : 'start',
    });
    if (!windowStatus.ok) {
      return res.status(403).json({ success: false, message: windowStatus.message });
    }

    if (existing && Math.max(0, Number(existing.resumeCount) || 0) >= MAX_EXAM_RESUMES) {
      // Allow final autosave only if client is force-submitting; otherwise block continue.
      if (req.body?.allowAfterResumeLimit !== true) {
        return res.status(403).json({
          success: false,
          resumeLimitReached: true,
          maxResumes: MAX_EXAM_RESUMES,
          message: `Resume limit (${MAX_EXAM_RESUMES}) reached. Please submit your exam.`,
        });
      }
    }

    const ExamResult = (await import('../../models/ExamResult.js')).default;
    const maxAttempts = Math.max(1, Number(examDoc.maxAttempts) || 1);
    const priorCount = await ExamResult.countDocuments({ userId: req.userId, examId });
    if (priorCount >= maxAttempts) {
      await ExamAttemptDraft.deleteOne({ examId, userId: req.userId });
      return res.status(403).json({
        success: false,
        message: `Maximum attempts (${maxAttempts}) reached for this exam.`,
      });
    }

    const body = req.body || {};
    const incomingAnswers =
      body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
        ? body.answers
        : {};
    const incomingTimings =
      body.questionTimings && typeof body.questionTimings === 'object' && !Array.isArray(body.questionTimings)
        ? body.questionTimings
        : {};
    const flaggedQuestions = Array.isArray(body.flaggedQuestions)
      ? body.flaggedQuestions.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
      : [];
    const durationSeconds = Math.max(
      60,
      Number(body.durationSeconds) || Math.round((Number(examDoc.duration) || 30) * 60),
    );
    let remainingSeconds = Number(body.remainingSeconds);
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
      remainingSeconds = durationSeconds;
    }
    remainingSeconds = Math.min(durationSeconds, Math.floor(remainingSeconds));
    const currentQuestionIndex = Math.max(0, Math.floor(Number(body.currentQuestionIndex) || 0));

    const existingAnswers = draftAnswersToObject(existing?.answers);
    const existingTimings = draftTimingsToObject(existing?.questionTimings);
    const incomingAnswerCount = Object.keys(incomingAnswers).length;
    const existingAnswerCount = Object.keys(existingAnswers).length;

    // Never wipe a non-empty answer map with {} (common race on resume before client refs sync).
    const answers =
      incomingAnswerCount > 0 || existingAnswerCount === 0 || body.allowEmptyAnswers === true
        ? incomingAnswers
        : existingAnswers;
    const questionTimings =
      Object.keys(incomingTimings).length > 0 || Object.keys(existingTimings).length === 0
        ? incomingTimings
        : existingTimings;

    const now = new Date();
    const answersMap = new Map(
      Object.entries(answers).map(([key, value]) => [String(key), value]),
    );
    const timingsMap = new Map(
      Object.entries(questionTimings).map(([key, value]) => [String(key), Number(value) || 0]),
    );

    const draft = await ExamAttemptDraft.findOneAndUpdate(
      { examId, userId: req.userId },
      {
        $set: {
          answers: answersMap,
          questionTimings: timingsMap,
          flaggedQuestions,
          remainingSeconds,
          durationSeconds,
          currentQuestionIndex,
          lastSavedAt: now,
          status: 'in_progress',
        },
        $setOnInsert: {
          examId,
          userId: req.userId,
          startedAt: now,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.json({
      success: true,
      data: serializeDraft(draft),
      message: 'Progress saved',
    });
  } catch (error) {
    console.error('PUT attempt-draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to save exam progress' });
  }
});

router.get('/exam-results', async (req, res) => {
  try {
    console.log('📋 Fetching exam results for student:', req.userId);
    console.log('📋 Request user:', req.user);
    
    if (!req.userId) {
      console.error('❌ req.userId is not set');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Convert userId to ObjectId to ensure proper matching
    const mongoose = (await import('mongoose')).default;
    const userId = mongoose.Types.ObjectId.isValid(req.userId) 
      ? new mongoose.Types.ObjectId(req.userId) 
      : req.userId;

    const ExamResult = (await import('../../models/ExamResult.js')).default;

    // Do NOT populate examId: if the Exam doc was removed, populate() sets examId to null
    // and the client loses the id (breaks Attempted Exams / rankings). examTitle is on the row.
    // Omit questionSnapshot here — review endpoint loads it when needed (keeps list light).
    const results = await ExamResult.find({ userId: userId })
      .select('-questionSnapshot')
      .sort({ completedAt: -1 });

    const normalizedResults = results.map((row) => {
      const correct = Number(row?.correctAnswers || 0);
      const wrong = Number(row?.wrongAnswers || 0);
      const unattempted = Number(row?.unattempted || 0);
      const total = Number(row?.totalQuestions || 0) || (correct + wrong + unattempted);
      const derivedPercentage = total > 0
        ? Math.round((correct / total) * 10000) / 100
        : 0;

      const plain = typeof row?.toObject === 'function'
        ? row.toObject({ flattenMaps: true })
        : row;

      const rawExamId = plain.examId;
      const examIdStr =
        rawExamId != null
          ? typeof rawExamId === 'object' && rawExamId._id != null
            ? String(rawExamId._id)
            : String(rawExamId)
          : null;

      return {
        ...plain,
        examId: examIdStr,
        attemptNumber: Number(plain.attemptNumber) >= 1 ? Number(plain.attemptNumber) : 1,
        percentage: derivedPercentage,
      };
    });

    const normalizedResultsDeduped = dedupeExamResultRows(normalizedResults);
    if (normalizedResultsDeduped.length !== normalizedResults.length) {
      console.log(
        `📋 Deduped exam results: ${normalizedResults.length} → ${normalizedResultsDeduped.length} rows for student ${req.userId}`
      );
    }

    console.log(`✅ Found ${results.length} exam results for student ${req.userId}`);
    console.log(`📋 Returning ${normalizedResultsDeduped.length} result rows (after dedupe)`);
    console.log(`📋 Query filter used: { userId: ${userId} }`);

    // Normalize userId on each row for logging only. Do NOT drop rows here: `find({ userId })`
    // already scopes data; comparing with String(userId) vs populated refs produced false
    // mismatches (e.g. "[object Object]") and returned an empty list to the client.
    const expectedUserIdStr = String(userId);
    const toResultUserIdStr = (r) => {
      const v = r?.userId;
      if (v == null || v === '') return '';
      if (typeof v === 'string' || typeof v === 'number') return String(v);
      if (typeof v === 'object') {
        if (v._id != null) return String(v._id);
        if (v.$oid != null) return String(v.$oid);
        if (typeof v.toHexString === 'function') return v.toHexString();
      }
      try {
        const s = v?.toString?.() ?? String(v);
        return s === '[object Object]' ? '' : s;
      } catch {
        return '';
      }
    };
    const mismatched = normalizedResultsDeduped.filter(
      (r) => toResultUserIdStr(r) !== expectedUserIdStr
    );
    if (mismatched.length > 0) {
      console.error(
        `⚠️ WARNING: ${mismatched.length} exam result row(s) have unexpected userId shape vs query; still returning all rows from find({ userId }). Sample:`,
        mismatched.slice(0, 2).map((r) => ({ stored: toResultUserIdStr(r), expected: expectedUserIdStr }))
      );
    }

    // Log first result structure for debugging
    if (normalizedResultsDeduped.length > 0) {
      console.log('📋 Sample result structure:', {
        examId: normalizedResultsDeduped[0].examId,
        userId: normalizedResultsDeduped[0].userId?.toString?.() || String(normalizedResultsDeduped[0].userId),
        examTitle: normalizedResultsDeduped[0].examTitle,
        percentage: normalizedResultsDeduped[0].percentage,
      });
    }
    
    res.json({
      success: true,
      data: normalizedResultsDeduped
    });
  } catch (error) {
    console.error('❌ Error fetching exam results:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch exam results',
      error: error.message 
    });
  }
});

// AI-powered detailed exam analysis for a student's result
router.post('/exam-results/ai-analysis', async (req, res) => {
  try {
    const { result, examTitle } = req.body || {};
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    if (!result || typeof result !== 'object') {
      return res.status(400).json({ success: false, message: 'result payload is required' });
    }

    const examIdRaw = result.examId;
    const examIdStr =
      examIdRaw && typeof examIdRaw === 'object' && examIdRaw._id
        ? String(examIdRaw._id)
        : String(examIdRaw || '');
    if (!examIdStr || !mongoose.Types.ObjectId.isValid(examIdStr)) {
      return res.status(400).json({
        success: false,
        message: 'A valid result.examId is required for the Gemini Performance Report.',
      });
    }
    const examObjectId = new mongoose.Types.ObjectId(examIdStr);

    const ExamResultModel = (await import('../../models/ExamResult.js')).default;
    let savedExamResult = null;
    const resultDocId = result._id || result.resultId;
    if (resultDocId && mongoose.Types.ObjectId.isValid(String(resultDocId))) {
      savedExamResult = await ExamResultModel.findOne({
        _id: resultDocId,
        userId: req.userId,
      }).lean();
    }
    if (!savedExamResult && examIdStr) {
      const attemptNum = Number(result.attemptNumber);
      const baseQuery = { userId: req.userId, examId: examIdStr };
      if (Number.isFinite(attemptNum) && attemptNum >= 1) {
        savedExamResult = await ExamResultModel.findOne({
          ...baseQuery,
          attemptNumber: attemptNum,
        }).lean();
      }
      if (!savedExamResult) {
        savedExamResult = await ExamResultModel.findOne(baseQuery)
          .sort({ completedAt: -1 })
          .lean();
      }
    }
    const scoreSource = savedExamResult
      ? {
          correctAnswers: Number(savedExamResult.correctAnswers ?? 0),
          wrongAnswers: Number(savedExamResult.wrongAnswers ?? 0),
          unattempted: Number(savedExamResult.unattempted ?? 0),
          obtainedMarks: Number(savedExamResult.obtainedMarks ?? 0),
          percentage: Number(savedExamResult.percentage ?? 0),
          totalQuestions: Number(savedExamResult.totalQuestions ?? 0),
        }
      : result;

    const cachedReport = await GeminiPerformanceReport.findOne({
      studentId: req.userId,
      examId: examObjectId,
    }).lean();

    if (cachedReport?.fullAnalysis && typeof cachedReport.fullAnalysis === 'object') {
      const cachedAnalysis = { ...cachedReport.fullAnalysis };
      const cachedSummary = String(cachedAnalysis.summary || '');
      if (
        /live ai could not finish \((expected|unexpected|json|syntaxerror)/i.test(cachedSummary) ||
        /line \d+ column \d+/i.test(cachedSummary)
      ) {
        cachedAnalysis.summary = cachedSummary.replace(
          /Live AI could not finish \([\s\S]*?\)\.\s*/i,
          'Live AI returned an invalid response format, so this report was rebuilt from your attempt data only. '
        );
      }
      if (
        !shouldRegenerateCachedReport(cachedReport, scoreSource) &&
        !cachedHasStaleAiExplanations(cachedAnalysis)
      ) {
        return res.json(buildCachedAnalysisResponse(cachedReport, cachedAnalysis));
      }
      if (cachedHasStaleAiExplanations(cachedAnalysis)) {
        console.warn('[exam-results/ai-analysis] Dropping cache with legacy AI explanations; rebuilding offline.', {
          studentId: String(req.userId),
          examId: String(examObjectId),
        });
      }
      console.warn('[exam-results/ai-analysis] Score or corrupt summary changed; regenerating once.', {
        studentId: String(req.userId),
        examId: String(examObjectId),
      });
      await GeminiPerformanceReport.deleteOne({ _id: cachedReport._id }).catch((e) => {
        console.warn('[exam-results/ai-analysis] Failed to remove stale cache:', e?.message || e);
      });
    }

    const flightKey = inFlightKey(req.userId, examIdStr);
    const inflightPayload = getInFlight(flightKey);
    if (inflightPayload) {
      return res.json(await inflightPayload);
    }

    const generationWork = (async () => {
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section');
    const studentClassDoc = await resolveStudentClassDoc(student);
    const { subjects: _recSubjects, librarySubjectIds: recLibrarySubjectIds, studentClassNumber: studentClassNumberForRecs, filterContentsForStudentClass } =
      await resolveStudentClassSubjects(student);
    const resolvedBoard = String(student?.board || student?.assignedAdmin?.board || 'ASLI_EXCLUSIVE_SCHOOLS')
      .trim()
      .toUpperCase();
    const classNumber = String(
      studentClassNumberForRecs || student?.classNumber || student?.assignedClass?.classNumber || ''
    ).trim();
    const studentDisplayNameRaw = String(student?.fullName || student?.name || '').trim().split(/\s+/)[0] || '';
    const studentDisplayName =
      studentDisplayNameRaw.length >= 2 && studentDisplayNameRaw.length <= 40 ? studentDisplayNameRaw : '';

    const subjectScore = result.subjectWiseScore && typeof result.subjectWiseScore === 'object'
      ? result.subjectWiseScore
      : {};
    let subjectEntries = Object.entries(subjectScore)
      .map(([subject, score]) => {
        const total = Number(score?.total || 0);
        const correct = Number(score?.correct || 0);
        const marks = Number(score?.marks || 0);
        const percentage = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
        return { subject: String(subject).toLowerCase(), total, correct, marks, percentage };
      })
      .filter((x) => x.total > 0);

    let weakSubjects = subjectEntries
      .filter((x) => x.percentage < 70)
      .sort((a, b) => a.percentage - b.percentage)
      .map((x) => x.subject);

    const subjectAliases = {
      maths: ['maths', 'math', 'mathematics'],
      physics: ['physics'],
      chemistry: ['chemistry'],
      biology: ['biology', 'bio'],
    };

    const recommendationSubjects = weakSubjects.length > 0
      ? weakSubjects
      : subjectEntries.slice(0, 2).map((x) => x.subject);

    const weakPatterns = recommendationSubjects.flatMap((subject) =>
      (subjectAliases[subject] || [subject]).map((alias) => ({ name: new RegExp(`^${alias}$`, 'i') }))
    );

    let videoRecommendations = [];
    if (weakPatterns.length > 0) {
      const subjectDocs = await Subject.find({
        isActive: true,
        $and: [
          { $or: weakPatterns },
          { $or: [{ board: resolvedBoard }, { board: { $exists: false } }, { board: null }] },
        ],
      }).select('_id name').lean();

      const subjectIds = subjectDocs.map((s) => s._id).filter(Boolean);
      const subjectNames = subjectDocs.map((s) => String(s.name || '').trim()).filter(Boolean);
      const subjectNameRegex = subjectNames.length > 0
        ? new RegExp(subjectNames.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
        : null;
      const studentAdminId = student?.assignedAdmin?._id || student?.assignedAdmin || null;

      const contentConditions = [];
      if (subjectIds.length > 0) {
        contentConditions.push({ subject: { $in: subjectIds } });
      }
      if (subjectNameRegex) {
        contentConditions.push({ title: { $regex: subjectNameRegex } });
        contentConditions.push({ topic: { $regex: subjectNameRegex } });
      }

      let contentVideos = await Content.find({
        isActive: true,
        type: 'Video',
        ...(contentConditions.length > 0 ? { $or: contentConditions } : {}),
      })
        .populate('subject', 'name')
        .sort({ createdAt: -1 })
        .limit(14)
        .lean();

      if (studentClassNumberForRecs) {
        contentVideos = filterContentsForStudentClass(
          contentVideos,
          studentClassNumberForRecs,
          recLibrarySubjectIds
        );
      }

      const teacherVideoConditions = [];
      if (subjectIds.length > 0) {
        teacherVideoConditions.push({ subjectId: { $in: subjectIds.map((id) => String(id)) } });
      }
      if (subjectNames.length > 0) {
        teacherVideoConditions.push({ subjectId: { $in: subjectNames } });
      }
      if (subjectNameRegex) {
        teacherVideoConditions.push({ title: { $regex: subjectNameRegex } });
        teacherVideoConditions.push({ topic: { $regex: subjectNameRegex } });
      }

      const teacherVideos = await Video.find({
        isPublished: true,
        isActive: true,
        ...(studentAdminId ? { adminId: studentAdminId } : {}),
        ...(teacherVideoConditions.length > 0 ? { $or: teacherVideoConditions } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(14)
        .lean();

      const subjectIdByName = new Map(
        subjectDocs.map((s) => [String(s.name || '').trim().toLowerCase(), String(s._id)])
      );

      const merged = [
        ...contentVideos.map((v) => ({
          title: v.title || 'Video',
          subject: String(v.subject?.name || ''),
          subjectId: v.subject?._id ? String(v.subject._id) : '',
          topic: String(v.topic || ''),
          url: v.fileUrl || (Array.isArray(v.fileUrls) ? v.fileUrls[0] : ''),
          type: 'video',
        })),
        ...teacherVideos.map((v) => {
          const subjectKey = String(v.subjectId || '').trim();
          const looksLikeObjectId = /^[a-f\d]{24}$/i.test(subjectKey);
          return {
            title: v.title || 'Video',
            subject: looksLikeObjectId
              ? String(subjectDocs.find((s) => String(s._id) === subjectKey)?.name || subjectKey)
              : subjectKey,
            subjectId: looksLikeObjectId
              ? subjectKey
              : subjectIdByName.get(subjectKey.toLowerCase()) || '',
            topic: String(v.topic || ''),
            url: v.youtubeUrl || v.videoUrl || '',
            type: 'video',
          };
        }),
      ].filter((v) => !!v.url);

      const dedup = new Map();
      merged.forEach((v) => {
        const key = `${String(v.url).trim()}::${String(v.title).trim()}`;
        if (!dedup.has(key)) dedup.set(key, v);
      });
      videoRecommendations = Array.from(dedup.values()).slice(0, 10);
    }

    // Prefer exam chapter / subtopic focus cards over generic book/video titles.
    // Built after questionAttemptDetails exist — patched onto recommendations later.

    const safeResult = {
      examId: examIdStr,
      examTitle: String(examTitle || result.examTitle || ''),
      totalQuestions: Number(result.totalQuestions || 0),
      correctAnswers: Number(result.correctAnswers || 0),
      wrongAnswers: Number(result.wrongAnswers || 0),
      unattempted: Number(result.unattempted || 0),
      totalMarks: Number(result.totalMarks || 0),
      obtainedMarks: Number(result.obtainedMarks || 0),
      percentage: Number(result.percentage || 0),
      timeTaken: Number(result.timeTaken || 0),
      subjectScore: subjectEntries,
      weakSubjects,
      classNumber: classNumber || 'unknown',
      board: resolvedBoard,
    };

    // Prefer saved ExamResult (authoritative grading) over client payload.
    let answerMap = normalizeAnswersMap(result.answers);
    if (savedExamResult) {
      const savedAnswers = normalizeAnswersMap(savedExamResult.answers);
      if (Object.keys(savedAnswers).length > 0) {
        answerMap = savedAnswers;
      }
      safeResult.correctAnswers = Number(savedExamResult.correctAnswers ?? safeResult.correctAnswers);
      safeResult.wrongAnswers = Number(savedExamResult.wrongAnswers ?? safeResult.wrongAnswers);
      safeResult.unattempted = Number(savedExamResult.unattempted ?? safeResult.unattempted);
      safeResult.totalMarks = Number(savedExamResult.totalMarks ?? safeResult.totalMarks);
      safeResult.obtainedMarks = Number(savedExamResult.obtainedMarks ?? safeResult.obtainedMarks);
      safeResult.percentage = Number(savedExamResult.percentage ?? safeResult.percentage);
      safeResult.totalQuestions = Number(savedExamResult.totalQuestions ?? safeResult.totalQuestions);
      safeResult.timeTaken = Number(savedExamResult.timeTaken ?? safeResult.timeTaken);
      const savedSubject =
        savedExamResult.subjectWiseScore instanceof Map
          ? Object.fromEntries(savedExamResult.subjectWiseScore)
          : savedExamResult.subjectWiseScore;
      if (savedSubject && typeof savedSubject === 'object') {
        subjectEntries = subjectEntriesFromWiseScore(savedSubject);
        weakSubjects = subjectEntries
          .filter((x) => x.percentage < 70)
          .sort((a, b) => a.percentage - b.percentage)
          .map((x) => x.subject);
        safeResult.subjectScore = subjectEntries;
        safeResult.weakSubjects = weakSubjects;
      }
    }

    const examQuestions = await resolveQuestionsForExamResult(savedExamResult || safeResult, safeResult.examId);
    const examDocForGrading = examIdStr
      ? await Exam.findById(examIdStr).select('subject title').lean()
      : null;

    const shorten = (value, max = 280) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > max ? `${text.slice(0, max - 3)}...` : text;
    };

    const meaningfulChapterLabel = (raw) => {
      const s = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!s) return '';
      const lower = s.toLowerCase();
      const meaningless = new Set([
        'general',
        'unknown',
        'n/a',
        'na',
        'misc',
        'miscellaneous',
        'chapter',
        'unit',
        'default',
        'other',
        'none',
        'maths',
        'math',
        'mathematics',
        'physics',
        'chemistry',
        'biology',
        'science',
        'core concepts',
      ]);
      if (meaningless.has(lower)) return '';
      if (/^(maths?|mathematics|physics|chemistry|biology|science)\s+fundamentals$/i.test(lower)) {
        return '';
      }
      // Pure numbers / option values mistaken for topics ("222 444")
      if (/^\d+(\s+\d+)*$/.test(lower)) return '';
      if ((lower.match(/\d/g) || []).length >= (lower.match(/[a-z]/g) || []).length) return '';
      // Stem fragments mistaken for chapter names
      if (
        /\b(directions?|instruction|read the following|each of the following|four choices|choose the correct|answer the following|which of the following|what is the|how many|find the|calculate|greatest among|least among|select the correct)\b/i.test(
          lower
        )
      ) {
        return '';
      }
      if (/^(following|among|greatest|least|given|below|above|correct|option|choose|select|which|what|find)\b/i.test(lower)) {
        return '';
      }
      if (s.length > 48 || /\?/.test(s) || s.split(/\s+/).length > 8) return '';
      return s;
    };

    const analyticsByQuestionId = buildAnalyticsByQuestionId(savedExamResult);

    const questionAttemptDetails = examQuestions.map((q, index) => {
      const questionId = String(q._id);
      const userAnswer = lookupUserAnswerFromMap(answerMap, q, index);
      const analyticsRow =
        analyticsByQuestionId.get(questionId) ||
        analyticsByQuestionId.get(`q-${index}`);
      const normalizedCorrect = Array.isArray(q.correctAnswer)
        ? q.correctAnswer.map((item) => extractAnswerText(item))
        : extractAnswerText(q.correctAnswer);
      const normalizedUser = Array.isArray(userAnswer)
        ? userAnswer.map((item) => extractAnswerText(item))
        : extractAnswerText(userAnswer);
      const hasAnswer = !(
        userAnswer === undefined ||
        userAnswer === null ||
        userAnswer === '' ||
        (Array.isArray(userAnswer) && userAnswer.length === 0)
      );
      const isCorrect = analyticsRow
        ? String(analyticsRow.status || '').toLowerCase() === 'correct'
        : isAnswerCorrect(q, userAnswer);
      const rawChapter = String(analyticsRow?.chapter || q.chapter || '').trim();
      const rawTopic = String(analyticsRow?.topic || q.topic || q.unit || '').trim();
      const rawSection = String(q.sectionHeading || q.section || '').trim();
      return {
        index: index + 1,
        questionId,
        subject: String(q.subject || 'general').toLowerCase(),
        chapter: meaningfulChapterLabel(rawChapter) || meaningfulChapterLabel(rawTopic),
        topic: meaningfulChapterLabel(rawTopic) || meaningfulChapterLabel(rawChapter),
        sectionHeading: meaningfulChapterLabel(rawSection),
        questionType: q.questionType,
        questionText: shorten(q.questionText || ''),
        hasImage: Boolean(q.questionImage),
        marks: Number(q.marks || 0),
        negativeMarks: Number(q.negativeMarks || 0),
        userAnswer: normalizedUser,
        correctAnswer: normalizedCorrect,
        hasAnswer,
        isCorrect,
        explanation: shorten(q.explanation || '', 180),
      };
    });

    const formatAnswer = (value) => {
      if (Array.isArray(value)) {
        const items = value.map((v) => String(v || '').trim()).filter(Boolean);
        return items.length ? items.join(', ') : 'not answered';
      }
      const text = String(value || '').trim();
      return text || 'not answered';
    };

    const inferTopicFromQuestion = (q) => {
      const chapterOk = meaningfulChapterLabel(q?.chapter);
      if (chapterOk) return chapterOk;
      const topicOk = meaningfulChapterLabel(q?.topic);
      if (topicOk) return topicOk;
      const sectionOk = meaningfulChapterLabel(q?.sectionHeading);
      if (sectionOk) return sectionOk;

      const text = String(q?.questionText || '')
        .replace(/^directions?\s*[:.\-–—]?\s*/i, '')
        .replace(/^each of the following[^.!?]{0,120}[.!?]\s*/i, '')
        .replace(/^read the following[^.!?]{0,120}[.!?]\s*/i, '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (!text) return 'Core concepts';
      if (
        /\b(directions?|each of the following|four choices|read the following)\b/.test(text) &&
        text.length < 80
      ) {
        return 'Core concepts';
      }

      const topicPatterns = [
        { topic: 'Rational Numbers', regex: /\brational numbers?\b|\bterminating decimals?\b|\bnon[- ]terminating\b|\badditive inverse\b|\bmultiplicative inverse\b/ },
        { topic: 'Comparing Numbers', regex: /\bgreatest among\b|\bleast among\b|\bwhich is (?:the )?(?:greatest|least|largest|smallest)\b|\bcompare (?:the )?(?:fractions?|numbers?|decimals?)\b/ },
        { topic: 'Fractions and Decimals', regex: /\bfractions?\b|\bdecimals?\b|\bnumerator\b|\bdenominator\b/ },
        { topic: 'Arithmetic Progression', regex: /\barithmetic progression\b|\ba\.?p\.?\b/ },
        { topic: 'Quadrilateral Properties', regex: /\bquadrilateral\b|\bparallelogram\b|\brhombus\b|\btrapez/ },
        { topic: 'Polygon Angles', regex: /\bpolygon\b|\binterior angles?\b|\bexterior angles?\b/ },
        { topic: 'Ratio and Proportion', regex: /\bratios?\b|\bproportions?\b/ },
        { topic: 'Linear Equations', regex: /\blinear equations?\b|\bsolve for\b|\bequation\b/ },
        { topic: 'Probability', regex: /\bprobability\b|\bchance\b|\boutcomes?\b/ },
        { topic: 'Force and Laws of Motion', regex: /\bnet force\b|\bforces?\b|\bnewton\b|\baccelerat/ },
        { topic: 'Motion and Kinematics', regex: /\bmotion\b|\bvelocity\b|\bacceleration\b|\bdisplacement\b/ },
        { topic: 'Pressure and Hydraulics', regex: /\bhydraulic\b|\bpiston\b|\bpascal\b|\bpressure\b/ },
        { topic: 'Atomic Structure', regex: /\batomic numbers?\b|\bmass numbers?\b|\bneutrons?\b|\bprotons?\b|\belectrons?\b|\batoms?\b/ },
        { topic: 'Electricity and Circuits', regex: /\bohm\b|\bcurrent\b|\bvoltage\b|\bresistance\b|\bcircuits?\b/ },
        { topic: 'Hybridization', regex: /\bhybridization\b|\bhybrid orbital\b|\bsp\s*3\b|\bsp\s*2\b|\bsp\s*hybrid\b|\bdsp\s*[23]\b/ },
        { topic: 'Oxidation States', regex: /\boxidation states?\b|\boxidation numbers?\b/ },
        {
          topic: 'Molar Mass and Stoichiometry',
          regex: /\bmolar mass\b|\bmolecular mass\b|\bmolarity\b|\bstoichiometry\b|\bmoles?\b|\bmol\b/,
        },
        { topic: 'Acids, Bases and Salts', regex: /\bacids?\b|\bbases?\b|\bsalts?\b|\bph\b/ },
        { topic: 'Carbon Compounds', regex: /\bcarbon\b|\bhydrocarbons?\b|\borganic\b/ },
        { topic: 'Cell Structure', regex: /\bcell membrane\b|\bcytoplasm\b|\bnucleus\b|\borganelles?\b/ },
        { topic: 'Life Processes', regex: /\bphotosynthesis\b|\brespiration\b|\bexcretion\b|\bnutrition\b/ },
        { topic: 'Heredity and Evolution', regex: /\bheredity\b|\bevolution\b|\bgenes?\b|\bdna\b/ },
      ];

      const matched = topicPatterns.find((item) => item.regex.test(text));
      if (matched) return matched.topic;

      // Do NOT invent topics from random stem keywords ("222 444", "Greatest Among").
      const subject = String(q.subject || '').trim();
      if (subject && !/^(general|unknown)$/i.test(subject)) {
        return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} fundamentals`;
      }
      return 'Core concepts';
    };

    const insightStemLead = (_q) => '';

    const insightUnitLead = (q) => {
      const ch = meaningfulChapterLabel(q?.chapter) || meaningfulChapterLabel(q?.topic);
      return ch ? `Syllabus unit “${ch}”: ` : '';
    };

    const buildPersonalizedPracticeTask = (q, status) => {
      const topic = inferTopicFromQuestion(q);
      const subject = String(q.subject || 'subject').toLowerCase();
      const type = String(q.questionType || 'mcq').toUpperCase();
      const greet = studentDisplayName ? `${studentDisplayName}, ` : '';

      if (status === 'correct') {
        return `${greet}After this paper, take 2 harder ${subject} ${type}s on “${topic}” (not from memory of Q${q.index}) and write one “rule I used” line per solution.`;
      }
      if (status === 'unattempted') {
        return `${greet}Timed set: four ${subject} ${type}s on “${topic}” (75–90s each), Q${q.index}-style stems first, then mixed; no solutions until all four are attempted.`;
      }
      return `${greet}Redo the reasoning for Q${q.index} on paper, then five ${subject} ${type}s on “${topic}” split 3+2 with a short note after each wrong turn on what fooled you.`;
    };

    const buildGapLine = (q, status) => {
      const topic = inferTopicFromQuestion(q);
      const subject = String(q.subject || 'subject').toLowerCase();
      const type = String(q.questionType || 'mcq').toLowerCase();
      const greet = studentDisplayName ? `${studentDisplayName}, ` : '';
      const stemFrag = insightStemLead(q);
      const unitFrag = insightUnitLead(q);

      if (status === 'correct') {
        return `${greet}${stemFrag}${unitFrag}You got Q${q.index} right—a clean ${subject} ${type} execution on “${topic}” under this exam’s conditions.`;
      }
      if (status === 'unattempted') {
        if (type === 'integer') {
          return `${greet}${stemFrag}${unitFrag}Q${q.index} stayed blank: a numeric “${topic}” ${subject} item—often a formula or setup confidence gap before the first attempt.`;
        }
        if (type === 'multiple') {
          return `${greet}${stemFrag}${unitFrag}Q${q.index} stayed blank on a multi-select “${topic}” ${subject} item—often option-filtering hesitation.`;
        }
        return `${greet}${stemFrag}${unitFrag}Q${q.index} stayed blank on “${topic}” (${subject} ${type})—likely time boxing or first-attempt avoidance.`;
      }
      return `${greet}${stemFrag}${unitFrag}Q${q.index} (“${topic}”, ${subject} ${type})—your working did not match the keyed ${type} path for this stem.`;
    };

    const buildFixStrategyLine = (q, status, explanationLine) => {
      const topic = inferTopicFromQuestion(q);
      const subject = String(q.subject || 'subject').toLowerCase();
      const type = String(q.questionType || 'mcq').toLowerCase();
      const ch = meaningfulChapterLabel(q?.chapter);
      const unitFrag = ch ? `Open notes for “${ch}” plus ` : '';

      if (status === 'correct') {
        return `${unitFrag}stretch with one unseen ${subject} ${type} on “${topic}”: solve cold, then compare your steps to the official method. ${explanationLine}`;
      }
      if (status === 'unattempted') {
        if (type === 'integer') {
          return `${unitFrag}for “${topic}”, use three lines only—given → formula → one calculation—in 75–90s before allowing yourself to skip. ${explanationLine}`;
        }
        if (type === 'multiple') {
          return `${unitFrag}for “${topic}”, eliminate obviously wrong ${subject} options first, then verify the last two against the stem wording. ${explanationLine}`;
        }
        return `${unitFrag}for “${topic}”, force a first-pass commit on Q${q.index}-style stems in 60–90s (keyword → method → option), then review. ${explanationLine}`;
      }
      return `${unitFrag}rewrite Q${q.index} as a numbered step flow (${subject}, ${type}), add one checkpoint where you usually mis-read the stem, then re-check units/signs. ${explanationLine}`;
    };

    const buildDerivedFocusAreas = (attempts) => {
      const grouped = new Map();
      attempts.forEach((q) => {
        if (q.isCorrect) return;
        const subject = String(q.subject || 'general').toLowerCase();
        const topic = inferTopicFromQuestion(q);
        const key = `${subject}::${normalizeTopicLabel(topic)}`;
        if (!grouped.has(key)) {
          grouped.set(key, { subject, topic, count: 0, unattempted: 0, wrong: 0, indexes: [] });
        }
        const row = grouped.get(key);
        row.count += 1;
        if (q.hasAnswer) row.wrong += 1;
        else row.unattempted += 1;
        if (row.indexes.length < 3) row.indexes.push(q.index);
      });

      return Array.from(grouped.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)
        .map((x) => ({
          subject: x.subject,
          topic: x.topic,
          issue: x.topic,
          whatToDo:
            x.indexes.length > 0
              ? `Wrong · Q${x.indexes.join(', Q')} · review working`
              : `Review ${x.topic} and practise 8–10 similar questions.`,
          priority: x.count >= 2 ? 'high' : 'medium',
        }));
    };

    const buildQuestionInsight = (q) => {
      const status = q.isCorrect
        ? 'correct'
        : q.hasAnswer
          ? 'wrong'
          : 'unattempted';
      const userAnswerText = formatAnswer(q.userAnswer);
      const correctAnswerText = formatAnswer(q.correctAnswer);
      const topic = inferTopicFromQuestion(q);
      const explanationHint = String(q.explanation || '').trim();
      const explanationLine = explanationHint
        ? `Review explanation hint: "${explanationHint}".`
        : 'Use the provided solution/explanation to build your correction notes.';

      const bankSolution = explanationHint;

      if (status === 'correct') {
        return {
          index: q.index,
          questionId: q.questionId,
          subject: q.subject || 'general',
          topic,
          questionType: q.questionType || 'mcq',
          status,
          conceptGap: buildGapLine(q, status),
          fixStrategy: buildFixStrategyLine(q, status, explanationLine),
          practiceTask: buildPersonalizedPracticeTask(q, status),
          geminiExplanation: bankSolution,
          priority: 'low',
        };
      }

      if (status === 'unattempted') {
        return {
          index: q.index,
          questionId: q.questionId,
          subject: q.subject || 'general',
          topic,
          questionType: q.questionType || 'mcq',
          status,
          conceptGap: buildGapLine(q, status),
          fixStrategy: buildFixStrategyLine(q, status, explanationLine),
          practiceTask: buildPersonalizedPracticeTask(q, status),
          geminiExplanation: bankSolution,
          priority: 'medium',
        };
      }

      return {
        index: q.index,
        questionId: q.questionId,
        subject: q.subject || 'general',
        topic,
        questionType: q.questionType || 'mcq',
        status,
        conceptGap: `${buildGapLine(q, status)} Selected "${userAnswerText}" but expected "${correctAnswerText}".`,
        fixStrategy: buildFixStrategyLine(q, status, explanationLine),
        practiceTask: buildPersonalizedPracticeTask(q, status),
        geminiExplanation: bankSolution,
        priority: 'high',
      };
    };

    const fallbackQuestionInsights = questionAttemptDetails.map(buildQuestionInsight);

    // Only re-grade when there is no saved ExamResult — saved rows are authoritative.
    if (examQuestions.length > 0 && !savedExamResult) {
      const graded = gradeExamAttemptFromBank(examQuestions, answerMap, examDocForGrading);
      safeResult.correctAnswers = graded.correctAnswers;
      safeResult.wrongAnswers = graded.wrongAnswers;
      safeResult.unattempted = graded.unattempted;
      safeResult.totalMarks = graded.totalMarks;
      safeResult.obtainedMarks = graded.obtainedMarks;
      safeResult.totalQuestions = graded.totalQuestions;
      safeResult.percentage = graded.percentage;
      subjectEntries = subjectEntriesFromWiseScore(graded.subjectWiseScore);
      weakSubjects = subjectEntries
        .filter((x) => x.percentage < 70)
        .sort((a, b) => a.percentage - b.percentage)
        .map((x) => x.subject);
      safeResult.subjectScore = subjectEntries;
      safeResult.weakSubjects = weakSubjects;
    }

    const weakTopicsList = (() => {
      const grouped = new Map();
      questionAttemptDetails.forEach((q) => {
        if (q.isCorrect) return;
        const subject = String(q.subject || 'general').toLowerCase();
        const topic =
          meaningfulChapterLabel(String(q.chapter || '').trim()) ||
          inferTopicFromQuestion(q);
        const topicNorm = normalizeTopicLabel(topic);
        if (!topicNorm) return;
        const key = `${subject}::${topicNorm}`;
        if (!grouped.has(key)) {
          grouped.set(key, { subject, topic, count: 0 });
        }
        grouped.get(key).count += 1;
      });
      return Array.from(grouped.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map(({ subject, topic }) => ({ subject, topic }));
    })();

    // Lead recommendations with chapter/subtopic names from this exam (not textbook titles).
    if (weakTopicsList.length > 0) {
      const chapterRecs = weakTopicsList.slice(0, 6).map((row) => ({
        title: row.topic,
        subject: row.subject,
        topic: row.topic,
        subjectId: '',
        url: '',
        type: 'chapter-focus',
        why: `Focus chapter from this exam — revise “${row.topic}” then practise similar questions.`,
      }));
      const existing = Array.isArray(videoRecommendations) ? videoRecommendations : [];
      const seen = new Set(chapterRecs.map((r) => `${r.subject}::${String(r.topic).toLowerCase()}`));
      const rest = existing.filter((v) => {
        const key = `${String(v.subject || '').toLowerCase()}::${String(v.topic || v.title || '').toLowerCase()}`;
        return !seen.has(key);
      });
      videoRecommendations = [...chapterRecs, ...rest].slice(0, 10);
    }

    const formatExamClock = (seconds) => {
      const s = Number(seconds) || 0;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = s % 60;
      return h > 0 ? `${h}h ${m}m ${r}s` : `${m}m ${r}s`;
    };

    /** Rich analysis — rule-based summary; per-question Gemini explanations attached separately */
    const buildDeepOfflineExamAnalysis = async (reasonNote = '') => {
      const attempted = (safeResult.correctAnswers || 0) + (safeResult.wrongAnswers || 0);
      const totalQ =
        Number(safeResult.totalQuestions) || attempted + (safeResult.unattempted || 0) || 1;
      const pct = Number(safeResult.percentage || 0);
      const skipRate = totalQ > 0 ? ((safeResult.unattempted || 0) / totalQ) * 100 : 0;
      const wrongRate = totalQ > 0 ? ((safeResult.wrongAnswers || 0) / totalQ) * 100 : 0;
      const completionPct = totalQ > 0 ? (attempted / totalQ) * 100 : 0;
      const acc = attempted > 0 ? ((safeResult.correctAnswers || 0) / attempted) * 100 : 0;
      const avgSecPerPaperQ = totalQ > 0 ? Math.round((safeResult.timeTaken || 0) / totalQ) : 0;
      const avgSecPerAttempted =
        attempted > 0 ? Math.round((safeResult.timeTaken || 0) / attempted) : 0;
      const paceSec =
        avgSecPerAttempted > 0 ? avgSecPerAttempted : avgSecPerPaperQ > 0 ? avgSecPerPaperQ : 0;

      const topicBuckets = new Map();
      questionAttemptDetails.forEach((q) => {
        if (q.isCorrect) return;
        const topic = inferTopicFromQuestion(q);
        const key = `${String(q.subject || 'general').toLowerCase()} — ${topic}`;
        topicBuckets.set(key, (topicBuckets.get(key) || 0) + 1);
      });
      const topGaps = [...topicBuckets.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

      const subjectBreakdown = subjectEntries.length
        ? subjectEntries
            .map((s) => {
              const label = String(s.subject || '').charAt(0).toUpperCase() + String(s.subject || '').slice(1);
              return `${label}: ${s.correct}/${s.total} correct (${s.percentage}%), ${s.marks} marks`;
            })
            .join(' · ')
        : 'Subject split not available for this result payload.';

      const pacingHint =
        paceSec <= 0
          ? ''
          : paceSec < 40
            ? 'Time per question you actually attempted looks quite low—check for rushing; use a minimum thinking budget (about 60–90s) before locking an option on similar stems.'
            : paceSec > 150
              ? 'Time per attempted question looks high—practice marking rough items and returning, and cap first-pass time so you touch more items.'
              : 'Pacing on attempted questions looks moderate—pair it with fewer skips to lift overall score.';

      const skipInsight =
        skipRate >= 25
          ? `Skipping ${skipRate.toFixed(1)}% of the paper is a major score cap. Treat every skip like a wrong answer: schedule a 20‑minute block to solve only skipped topics before the next mock.`
          : skipRate >= 12
            ? `Skip rate is ${skipRate.toFixed(1)}%—not extreme, but each skip is lost opportunity; aim to attempt first, then mark for review.`
            : `Skip rate is ${skipRate.toFixed(1)}%—good attempt coverage; focus accuracy on wrong answers.`;

      const wrongInsight =
        wrongRate >= 35
          ? `Wrong answers account for ${wrongRate.toFixed(1)}% of the paper—prioritize error log: for each wrong, write one line on the concept trap and one correct rule.`
          : `Wrong answers: ${safeResult.wrongAnswers}—pair each with its explanation and redo without looking, then one variation question.`;

      const gapLines =
        topGaps.length > 0
          ? `Concept pressure points (wrong or skipped, grouped): ${topGaps.map(([k, c]) => `${k} (${c})`).join('; ')}.`
          : 'No per-question detail was available to cluster topics—use subject cards and the question list below.';

      const introNote = reasonNote ? `${String(reasonNote).trim()}\n\n` : '';

      const greetLead = studentDisplayName ? `${studentDisplayName}, ` : '';
      const scoreYou = studentDisplayName ? 'you' : 'You';
      const timeLineExtra =
        attempted < totalQ && paceSec > 0 && avgSecPerPaperQ > 0
          ? ` (~${paceSec}s average on ${attempted} questions you attempted; ~${avgSecPerPaperQ}s if time is spread across all ${totalQ})`
          : paceSec > 0
            ? ` (~${paceSec}s per question on average)`
            : '';
      const marksPct =
        (safeResult.totalMarks || 0) > 0
          ? ((safeResult.obtainedMarks || 0) / (safeResult.totalMarks || 1)) * 100
          : pct;
      const summary = [
        `${introNote}${greetLead}${scoreYou} scored ${safeResult.obtainedMarks} / ${safeResult.totalMarks} marks on this attempt (${marksPct.toFixed(1)}% of total marks).`,
        `Attempt pattern: ${attempted} of ${totalQ} questions touched (${completionPct.toFixed(1)}% completion): ${safeResult.correctAnswers} correct, ${safeResult.wrongAnswers} wrong, ${safeResult.unattempted} skipped.`,
        `When you did attempt a question, accuracy was ${acc.toFixed(1)}% (${safeResult.correctAnswers} correct out of ${attempted} attempted). That means ${
          acc < 50
            ? 'most of your losses are conceptual or reading errors—slow down on stems and verify units/conditions.'
            : acc < 75
              ? 'you have a workable hit rate but inconsistent reasoning—drill mixed sets on weak chapters.'
              : 'your reasoning is often sound—reduce skips and careless slips to convert attempts into marks.'
        }`,
        `Subject snapshot: ${subjectBreakdown}`,
        skipInsight,
        wrongInsight,
        gapLines,
        `Time: ${formatExamClock(safeResult.timeTaken || 0)} total${timeLineExtra}. ${pacingHint}`,
        'Use the per-question cards below for gap/fix/practice lines. Repeat this exam blueprint weekly: revise → short drill → timed mixed set.',
      ]
        .filter(Boolean)
        .join('\n\n');

      const strongSubs = subjectEntries.filter((s) => s.percentage >= 72);
      const strengths =
        strongSubs.length > 0
          ? strongSubs.map(
              (s) =>
                `${String(s.subject).charAt(0).toUpperCase() + String(s.subject).slice(1)} at ${s.percentage}% accuracy (${s.correct}/${s.total})—use as confidence anchor while fixing weaker areas.`,
            )
          : pct >= 55
            ? ['Solid overall percentage—tighten weak topics and completion to move into the next band.']
            : [
                'You generated a full attempt record—treat this as a precise diagnostic: every number below is actionable.',
                attempted > 0
                  ? `You still converted ${safeResult.correctAnswers} items correctly—protect that habit while expanding coverage.`
                  : null,
              ].filter(Boolean);

      const rootCauses = [
        skipRate >= 18 &&
          `High incomplete rate (${skipRate.toFixed(1)}% skipped)—often topic gaps, time boxing, or exam anxiety.`,
        safeResult.wrongAnswers > 0 &&
          `${safeResult.wrongAnswers} incorrect responses—review whether errors are conceptual, calculation, or option-reading.`,
        weakSubjects.length > 0 &&
          `Relative weakness in: ${weakSubjects.join(', ')}—needs targeted revision plus spaced repetition.`,
        acc < 60 && attempted > 0 && `Low accuracy (${acc.toFixed(1)}%) on attempted items—quality of attempts needs focus over speed.`,
        completionPct < 85 && `Completion at ${completionPct.toFixed(1)}%—leaving items blank caps score before accuracy can help.`,
      ].filter(Boolean);

      const riskScore = Math.min(
        0.95,
        Math.max(
          0.12,
          (weakSubjects.length >= 2 ? 0.32 : weakSubjects.length === 1 ? 0.2 : 0.1) +
            (skipRate / 100) * 0.38 +
            (wrongRate / 100) * 0.22 +
            (pct < 35 ? 0.18 : pct < 50 ? 0.08 : 0),
        ),
      );
      const riskLevel = riskScore >= 0.62 ? 'high' : riskScore >= 0.38 ? 'medium' : 'low';

      const nextPred = Math.max(28, Math.min(92, Math.round(pct + (100 - completionPct) * 0.12 + (72 - acc) * 0.08)));

      const derivedFocus = buildDerivedFocusAreas(questionAttemptDetails);

      // Vidya Performance Report + question analysis: offline only (exam bank explanations).
      fallbackQuestionInsights.forEach((insight, i) => {
        const qDetail = questionAttemptDetails[i];
        insight.geminiExplanation = String(qDetail?.explanation || '').trim();
      });

      return {
        riskLevel,
        riskScore,
        riskScoreMethod: 'rule-based',
        riskScoreMethodLabel: 'Calculated from your weak subjects, skip-rate and accuracy on this attempt — not a predicted future grade.',
        summary,
        strengths,
        rootCauses: rootCauses.length ? rootCauses : ['Mixed performance across the paper—use question-level insights to prioritize.'],
        predictions: {
          nextExamPrediction: nextPred,
          confidence: 0.55,
          confidenceMethod: 'rule-based',
          confidenceMethodLabel: 'A rule-based estimate from your last attempt, not a model-trained prediction.',
          trend: pct >= 60 ? 'stable' : 'improving',
        },
        interventions: [
          {
            priority: 'high',
            action: 'Error log + redo loop',
            reasoning: `You have ${safeResult.wrongAnswers} wrong and ${safeResult.unattempted} skipped—each needs a written fix and one redo.`,
            expectedImpact: 'Students who run a daily error-log + redo loop on AsliLearn typically report 8–18% score lifts in 2–3 weeks. Your result will depend on consistency.',
            impactSource: 'observed-trend',
          },
          {
            priority: 'high',
            action: 'Topic cluster drill',
            reasoning:
              topGaps.length > 0
                ? `Focus first on: ${topGaps.slice(0, 2).map(([k]) => k).join('; ')}.`
                : 'Use subject weak areas from the breakdown above.',
            expectedImpact: 'Tends to clear recurring wrong patterns before the next mock when done over 2 weeks.',
            impactSource: 'qualitative',
          },
          {
            priority: 'medium',
            action: 'Timed mixed mini-mock',
            reasoning: `Rebuild stamina at ~${paceSec > 0 ? Math.min(120, Math.max(45, paceSec)) : 75}s per attempted question with ${Math.min(15, totalQ)} mixed items.`,
            expectedImpact: 'Helps lift completion without collapsing accuracy.',
            impactSource: 'qualitative',
          },
          {
            priority: 'medium',
            action: 'Video + practice pairing',
            reasoning: 'Watch one short concept video, then solve 8–12 questions on the same idea the same day.',
            expectedImpact: 'Pairing typically transfers concepts faster than passive revision.',
            impactSource: 'qualitative',
          },
        ],
        methodologyNote:
          'Risk Score and Next Score are estimates from your last exam attempt only, using a rule-based formula. They are not predictions trained on millions of students. Use them as a guide, not a guarantee.',
        focusAreas: derivedFocus.length ? derivedFocus : weakSubjects.map((subject) => ({
          subject,
          issue: 'Lower performance in this subject block',
          whatToDo: 'Revise core theory, then 20 mixed questions with review of every mistake.',
          priority: 'high',
        })),
        actionPlan: {
          today: [
            `List top ${Math.min(5, topGaps.length || 3)} gap topics from wrong/skipped questions and watch one refresher each.`,
            `Redo ${Math.min(5, safeResult.wrongAnswers || 3)} wrong questions without notes, then check answers.`,
            'Note time taken per question on redos to calibrate pacing.',
          ],
          thisWeek: [
            `Three sessions × 30–40 min: mixed questions with ≥${Math.min(20, totalQ)} items focusing on weak subjects.`,
            'One full timed section at exam pace; mark uncertain items and return only if time permits.',
            'Maintain a one-page formula / concept sheet for weakest subject only.',
          ],
          beforeNextExam: [
            'One full mock under exam rules; score and rebuild a 1-page “mistake themes” list.',
            'Sleep and light review only on the last day—no new heavy topics.',
            'Revisit only the top 10 error themes from this attempt.',
          ],
        },
        recommendedAiTools: [
          {
            toolType: 'smart-qa-practice-generator',
            why: 'Targets weak topics with fresh questions.',
            howToUse: 'Pick your weakest subject and generate 15–20 items after each revision block.',
          },
          {
            toolType: 'concept-breakdown-explainer',
            why: 'Rebuild theory where wrong/skipped clusters appear.',
            howToUse: 'Run it on each top gap topic from the list above.',
          },
          {
            toolType: 'personalized-revision-planner',
            why: 'Spreads revision across days instead of cramming.',
            howToUse: 'Set plan for 7 days leading to next test.',
          },
        ],
        videoRecommendations,
        questionInsights: fallbackQuestionInsights,
        motivation:
          'Deep, consistent practice beats intensity spikes—small daily wins compound into a much stronger next attempt.',
      };
    };

    let aiParsed = await buildDeepOfflineExamAnalysis('');
    const geminiRawResponse = '';

    if (!aiParsed || typeof aiParsed !== 'object') {
      aiParsed = {};
    }
    if (!['high', 'medium', 'low'].includes(String(aiParsed.riskLevel || '').toLowerCase())) {
      aiParsed.riskLevel = weakSubjects.length >= 2 ? 'high' : weakSubjects.length === 1 ? 'medium' : 'low';
    }
    if (!Number.isFinite(Number(aiParsed.riskScore))) {
      aiParsed.riskScore = weakSubjects.length >= 2 ? 0.72 : weakSubjects.length === 1 ? 0.5 : 0.28;
    } else {
      aiParsed.riskScore = Math.max(0, Math.min(1, Number(aiParsed.riskScore)));
    }
    if (!aiParsed.predictions || typeof aiParsed.predictions !== 'object') {
      aiParsed.predictions = {
        nextExamPrediction: Math.max(25, Math.min(95, Math.round(Number(safeResult.percentage || 0) + 8))),
        confidence: 0.62,
        confidenceMethod: 'rule-based',
        confidenceMethodLabel: 'A rule-based estimate from your last attempt, not a model-trained prediction.',
        trend: 'stable',
      };
    } else if (!aiParsed.predictions.confidenceMethod) {
      aiParsed.predictions.confidenceMethod = 'model-based';
      aiParsed.predictions.confidenceMethodLabel = 'AI-generated estimate based on your performance patterns; not trained on a large student dataset.';
    }
    if (!aiParsed.riskScoreMethod) {
      aiParsed.riskScoreMethod = 'model-based';
      aiParsed.riskScoreMethodLabel = 'AI-generated estimate based on your performance patterns; intended as a guide, not a guarantee.';
    }
    if (!aiParsed.methodologyNote) {
      aiParsed.methodologyNote =
        'Risk Score, Next Score and impact figures are estimates from your last exam attempt and AI analysis. They are guides, not guarantees, and will improve as more attempts are recorded.';
    }
    if (!Array.isArray(aiParsed.rootCauses)) {
      aiParsed.rootCauses = [
        'Inconsistent subject performance across this exam',
        'Concept-level mistakes in weak questions',
        'Time/decision pressure on hard questions',
      ];
    }
    if (!Array.isArray(aiParsed.interventions)) {
      aiParsed.interventions = [
        {
          priority: 'high',
          action: 'Daily weak-topic correction loop',
          reasoning: 'Addresses repeated mistakes and improves consistency.',
          expectedImpact: 'Improved exam score trajectory over upcoming attempts.',
        },
      ];
    }
    if (!aiParsed.actionPlan || typeof aiParsed.actionPlan !== 'object') {
      aiParsed.actionPlan = {
        today: ['Review your top 3 mistakes and rewrite the correct method.'],
        thisWeek: ['Practice weak-topic questions daily and revise key formulas.'],
        beforeNextExam: ['Take one timed mock and analyze every incorrect question.'],
      };
    }

    const derivedFocusAreas = buildDerivedFocusAreas(questionAttemptDetails);
    if (!Array.isArray(aiParsed.focusAreas) || aiParsed.focusAreas.length === 0) {
      aiParsed.focusAreas = derivedFocusAreas;
    } else {
      const cleanedFocusAreas = aiParsed.focusAreas
        .map((item) => {
          const subject = String(item?.subject || '').toLowerCase() || 'general';
          const topicRaw = String(item?.topic || '').trim();
          const issueRaw = String(item?.issue || '').trim();
          const topic =
            meaningfulChapterLabel(topicRaw) ||
            meaningfulChapterLabel(issueRaw.replace(/^low accuracy\/confidence in\s+/i, '').replace(/\s*\(skips detected\)\.?$/i, '')) ||
            '';
          const issue = topic || issueRaw;
          return {
            subject,
            topic: topic || issue,
            issue,
            whatToDo: String(item?.whatToDo || '').trim(),
            priority: ['high', 'medium', 'low'].includes(String(item?.priority || '').toLowerCase())
              ? String(item.priority).toLowerCase()
              : 'medium',
          };
        })
        .filter((item) => item.issue || item.whatToDo);

      const mostlyGeneric =
        cleanedFocusAreas.length === 0 ||
        cleanedFocusAreas.every((item) => {
          const blob = `${item.subject} ${item.issue} ${item.whatToDo}`.toLowerCase();
          return item.subject === 'general' || blob.includes('general') || blob.includes('this topic');
        });

      aiParsed.focusAreas = mostlyGeneric ? derivedFocusAreas : cleanedFocusAreas;
    }

    if (!Array.isArray(aiParsed.videoRecommendations) || aiParsed.videoRecommendations.length === 0) {
      aiParsed.videoRecommendations = videoRecommendations.slice(0, 8).map((v) => ({
        ...v,
        why: v.why || `Recommended to improve ${v.subject || 'this'} understanding.`,
      }));
    } else {
      // Keep chapter-focus rows first even when AI returns generic video titles.
      const chapterFirst = (videoRecommendations || []).filter((v) => v?.type === 'chapter-focus');
      if (chapterFirst.length > 0) {
        const seen = new Set(chapterFirst.map((v) => String(v.title || '').toLowerCase()));
        const rest = (aiParsed.videoRecommendations || []).filter(
          (v) => !seen.has(String(v?.title || '').toLowerCase()),
        );
        aiParsed.videoRecommendations = [...chapterFirst, ...rest].slice(0, 8);
      }
    }
    const genericPatterns = [
      /concept application or option selection error/i,
      /question skipped due to low confidence or time pressure/i,
      /solved correctly; preserve this approach/i,
      /re-solve step by step and note the concept trigger/i,
      /practice 5 targeted questions from this concept/i,
      /practice 2 similar questions/i,
    ];
    const isTooGeneric = (item = {}) => {
      const combined = `${item.conceptGap || ''} ${item.fixStrategy || ''} ${item.practiceTask || ''}`.trim();
      if (!combined) return true;
      if (/chapter\s*['"]general['"]|for chapter\s*['"]general['"]|syllabus unit\s*['"]general['"]/i.test(combined)) {
        return true;
      }
      return genericPatterns.some((pattern) => pattern.test(combined));
    };

    const aiInsights = Array.isArray(aiParsed.questionInsights) ? aiParsed.questionInsights : [];
    if (aiInsights.length === 0) {
      aiParsed.questionInsights = fallbackQuestionInsights;
    } else {
      const aiByKey = new Map();
      aiInsights.forEach((item, idx) => {
        const key = item?.questionId ? `id:${String(item.questionId)}` : `idx:${Number(item?.index || idx + 1)}`;
        aiByKey.set(key, item || {});
      });

      aiParsed.questionInsights = questionAttemptDetails.map((q) => {
        const fallback = buildQuestionInsight(q);
        const aiItem =
          aiByKey.get(`id:${q.questionId}`) ||
          aiByKey.get(`idx:${q.index}`) ||
          {};

        if (isTooGeneric(aiItem)) {
          return fallback;
        }

        return {
          ...fallback,
          ...aiItem,
          index: q.index,
          questionId: q.questionId,
          subject: q.subject || aiItem.subject || 'general',
          topic: fallback.topic || meaningfulChapterLabel(aiItem.topic) || '',
          questionType: q.questionType || aiItem.questionType || 'mcq',
          // Keep factual status from saved result (avoid model status hallucinations).
          status: fallback.status,
          conceptGap: String(aiItem.conceptGap || fallback.conceptGap),
          fixStrategy: String(aiItem.fixStrategy || fallback.fixStrategy),
          practiceTask: String(aiItem.practiceTask || fallback.practiceTask),
          geminiExplanation: String(fallback.geminiExplanation || aiItem.geminiExplanation || ''),
          priority: ['high', 'medium', 'low'].includes(String(aiItem.priority || '').toLowerCase())
            ? String(aiItem.priority).toLowerCase()
            : fallback.priority,
        };
      });
    }

    const persistMeta = {
      analysisSchemaVersion: 2,
      weakSubjects,
      weakTopics: weakTopicsList,
      classNumber: classNumber || 'unknown',
      board: resolvedBoard,
      scoreSnapshot: {
        correctAnswers: safeResult.correctAnswers,
        wrongAnswers: safeResult.wrongAnswers,
        unattempted: safeResult.unattempted,
        obtainedMarks: safeResult.obtainedMarks,
        percentage: safeResult.percentage,
      },
    };
    const attemptedQs = (safeResult.correctAnswers || 0) + (safeResult.wrongAnswers || 0);
    const totalQForPace = Number(safeResult.totalQuestions) || 0;
    const avgSecPerPaperQPersist =
      totalQForPace > 0 ? Math.round((safeResult.timeTaken || 0) / totalQForPace) : 0;
    const avgSecPerAttemptedPersist =
      attemptedQs > 0 ? Math.round((safeResult.timeTaken || 0) / attemptedQs) : 0;
    const paceSecPersist =
      avgSecPerAttemptedPersist > 0 ? avgSecPerAttemptedPersist : avgSecPerPaperQPersist;
    const paceNote =
      paceSecPersist <= 0
        ? 'Pacing could not be inferred from timing data.'
        : attemptedQs > 0 && attemptedQs < totalQForPace && avgSecPerPaperQPersist > 0
          ? paceSecPersist < 40
            ? `Very fast pace on questions you attempted (~${paceSecPersist}s each); ~${avgSecPerPaperQPersist}s if clock time is averaged across all ${totalQForPace} items—watch for rushing on attempts.`
            : paceSecPersist > 150
              ? `Slow pace on attempted items (~${paceSecPersist}s each); paper-wide average ~${avgSecPerPaperQPersist}s—practice time-boxing and touching more items first.`
              : `Moderate pace on attempts (~${paceSecPersist}s each); paper-wide ~${avgSecPerPaperQPersist}s—balance speed with fewer skips.`
          : paceSecPersist < 40
            ? 'Very fast average pace on attempts—check for rushing versus intentional speed.'
            : paceSecPersist > 150
              ? 'Slow average pace—practice time-boxing and attempt-more-first strategy.'
              : 'Moderate average pace—balance with accuracy goals.';

    const reportPayload = {
      studentId: req.userId,
      examId: examObjectId,
      examName: String(examTitle || safeResult.examTitle || '').trim(),
      totalQuestions: safeResult.totalQuestions,
      attemptedQuestions: attemptedQs,
      correctAnswers: safeResult.correctAnswers,
      wrongAnswers: safeResult.wrongAnswers,
      unattempted: safeResult.unattempted,
      totalMarks: safeResult.totalMarks,
      obtainedMarks: safeResult.obtainedMarks,
      percentage: safeResult.percentage,
      overallSummary: String(aiParsed.summary || ''),
      subjectAnalysis: {
        breakdown: safeResult.subjectScore,
        videoRecommendations: aiParsed.videoRecommendations,
      },
      weakAreas: Array.isArray(aiParsed.focusAreas) ? aiParsed.focusAreas : [],
      strongAreas: Array.isArray(aiParsed.strengths) ? aiParsed.strengths : [],
      conceptualGaps: {
        rootCauses: aiParsed.rootCauses,
        focusAreas: aiParsed.focusAreas,
      },
      recommendations: Array.isArray(aiParsed.interventions) ? aiParsed.interventions : [],
      timeManagementInsights: {
        totalTimeSeconds: safeResult.timeTaken || 0,
        avgSecondsPerQuestion: paceSecPersist,
        note: paceNote,
      },
      nextExamStrategy: {
        predictions: aiParsed.predictions,
        actionPlan: aiParsed.actionPlan,
        recommendedAiTools: aiParsed.recommendedAiTools,
      },
      finalSummary: String(aiParsed.motivation || ''),
      geminiRawResponse: geminiRawResponse.slice(0, 500000),
      fullAnalysis: aiParsed,
      meta: persistMeta,
      generatedBy: 'offline',
    };

    const concurrent = await GeminiPerformanceReport.findOne({
      studentId: req.userId,
      examId: examObjectId,
    }).lean();
    if (concurrent?.fullAnalysis && typeof concurrent.fullAnalysis === 'object') {
      const sm = concurrent.meta && typeof concurrent.meta === 'object' ? concurrent.meta : {};
      const concurrentInsights = Array.isArray(concurrent.fullAnalysis.questionInsights)
        ? concurrent.fullAnalysis.questionInsights
        : [];
      const concurrentSchemaOk = Number(sm.analysisSchemaVersion) >= 2;
      if (concurrentSchemaOk) {
        return {
          success: true,
          data: {
            analysis: concurrent.fullAnalysis,
            meta: {
              weakSubjects: Array.isArray(sm.weakSubjects) ? sm.weakSubjects : [],
              weakTopics: Array.isArray(sm.weakTopics) ? sm.weakTopics : [],
              classNumber: String(sm.classNumber || ''),
              board: String(sm.board || ''),
              generatedAt: (concurrent.createdAt || concurrent.updatedAt || new Date()).toISOString(),
              cached: true,
            },
          },
        };
      }
    }

    try {
      await GeminiPerformanceReport.create(reportPayload);
    } catch (persistErr) {
      if (persistErr?.code === 11000) {
        const winner = await GeminiPerformanceReport.findOne({
          studentId: req.userId,
          examId: examObjectId,
        }).lean();
        if (winner?.fullAnalysis) {
          const wm = winner.meta && typeof winner.meta === 'object' ? winner.meta : {};
          return {
            success: true,
            data: {
              analysis: winner.fullAnalysis,
              meta: {
                weakSubjects: Array.isArray(wm.weakSubjects) ? wm.weakSubjects : [],
                weakTopics: Array.isArray(wm.weakTopics) ? wm.weakTopics : [],
                classNumber: String(wm.classNumber || ''),
                board: String(wm.board || ''),
                generatedAt: (winner.createdAt || winner.updatedAt || new Date()).toISOString(),
                cached: true,
              },
            },
          };
        }
      }
      console.error('[exam-results/ai-analysis] Failed to persist report:', persistErr);
    }

    return {
      success: true,
      data: {
        analysis: aiParsed,
        meta: {
          generatedAt: new Date().toISOString(),
          weakSubjects,
          weakTopics: weakTopicsList,
          classNumber,
          board: resolvedBoard,
          cached: false,
        },
      },
    };
    })();

    setInFlight(flightKey, generationWork);
    return res.json(await generationWork);
  } catch (error) {
    console.error('AI exam analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI exam analysis',
      error: error.message,
    });
  }
});

// Get full review payload for an attempted exam (includes correct answers).
router.get('/exam-results/:examId/review', async (req, res) => {
  try {
    const { examId } = req.params;
    const resultId = req.query?.resultId ? String(req.query.resultId).trim() : '';
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId is required' });
    }

    const mongooseLib = (await import('mongoose')).default;
    const ExamResult = (await import('../../models/ExamResult.js')).default;
    let latestResult = null;

    const examIdFilter = mongooseLib.Types.ObjectId.isValid(examId)
      ? new mongooseLib.Types.ObjectId(examId)
      : examId;
    const leanOpts = { flattenMaps: true };

    if (resultId && mongooseLib.Types.ObjectId.isValid(resultId)) {
      latestResult = await ExamResult.findOne({
        _id: resultId,
        userId: req.userId,
        examId: examIdFilter,
      }).lean(leanOpts);
    }
    if (!latestResult) {
      latestResult = await ExamResult.findOne({
        userId: req.userId,
        examId: examIdFilter,
      })
        .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
        .lean(leanOpts);
    }

    if (!latestResult) {
      return res.status(404).json({ success: false, message: 'No attempted result found for this exam' });
    }

    const examDoc = await Exam.findById(examId).lean();
    const questions = await resolveQuestionsForExamResult(latestResult, examId);

    return res.json({
      success: true,
      data: {
        result: toPlainExamResultForApi(latestResult),
        exam: examDoc
          ? {
              _id: examDoc._id,
              title: examDoc.title,
              totalQuestions: examDoc.totalQuestions,
              totalMarks: examDoc.totalMarks,
            }
          : {
              _id: examId,
              title: latestResult.examTitle || 'Exam',
              totalQuestions: latestResult.totalQuestions,
              totalMarks: latestResult.totalMarks,
            },
        questions,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching exam review payload:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch exam review payload',
      error: error.message,
    });
  }
});

// Extract the comparable text of a stored correctAnswer value, handling the
// legacy shapes we've seen in the DB: plain string, number, option-object
// `{ text }`, or `{ label }`.
function extractAnswerText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    return String(value.text ?? value.label ?? value._id ?? '');
  }
  return String(value);
}

function buildOptionMeta(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  return options.map((opt, index) => {
    const text = extractAnswerText(opt).trim();
    const textNorm = text.toLowerCase();
    const id = String(opt?._id || '').trim();
    return {
      index,
      letter: String.fromCharCode(65 + index),
      text,
      textNorm,
      id,
    };
  });
}

function resolveAnswerToken(question, value) {
  const raw = extractAnswerText(value).trim();
  if (!raw) return '';
  const rawNorm = raw.toLowerCase();

  if (question?.questionType === 'integer') {
    return rawNorm;
  }

  const optionMeta = buildOptionMeta(question);
  if (!optionMeta.length) return rawNorm;

  // Numeric answer token: support both 0-based and 1-based legacy formats.
  if (/^-?\d+$/.test(rawNorm)) {
    const n = parseInt(rawNorm, 10);
    if (n >= 0 && n < optionMeta.length) return optionMeta[n].textNorm;
    if (n >= 1 && n <= optionMeta.length) return optionMeta[n - 1].textNorm;
  }

  // Letter token: A/B/C/D.
  if (/^[a-z]$/i.test(rawNorm)) {
    const byLetter = optionMeta.find((o) => o.letter.toLowerCase() === rawNorm);
    if (byLetter) return byLetter.textNorm;
  }

  // Option-A / option1 style token.
  const optionMatch = rawNorm.match(/^option\s*([a-z0-9])$/);
  if (optionMatch) {
    const token = optionMatch[1];
    if (/^\d$/.test(token)) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= optionMeta.length) return optionMeta[n - 1].textNorm;
      if (n >= 0 && n < optionMeta.length) return optionMeta[n].textNorm;
    }
    if (/^[a-z]$/.test(token)) {
      const byLetter = optionMeta.find((o) => o.letter.toLowerCase() === token);
      if (byLetter) return byLetter.textNorm;
    }
  }

  // Match by option id.
  const byId = optionMeta.find((o) => o.id && o.id === raw);
  if (byId) return byId.textNorm;

  // Match by normalized option text.
  const byText = optionMeta.find((o) => o.textNorm && o.textNorm === rawNorm);
  if (byText) return byText.textNorm;

  return rawNorm;
}

function resolveAnswerList(question, value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => resolveAnswerToken(question, item))
    .filter(Boolean);
}

function normalizeAnswersMap(answers) {
  if (!answers) return {};
  if (answers instanceof Map) {
    return Object.fromEntries(Array.from(answers.entries()).map(([k, v]) => [String(k), v]));
  }
  if (typeof answers === 'object' && !Array.isArray(answers)) {
    return Object.fromEntries(Object.entries(answers).map(([k, v]) => [String(k), v]));
  }
  return {};
}

/** Resolve stored answer for a question (handles _id / index / legacy key shapes). */
function lookupUserAnswerFromMap(answerMap, question, index) {
  const map = answerMap && typeof answerMap === 'object' ? answerMap : {};
  const id = String(question?._id ?? '').trim();
  const candidates = [
    id,
    id ? id.toLowerCase() : '',
    `q-${index}`,
    String(index),
    String(index + 1),
    question?.id != null ? String(question.id) : '',
  ].filter(Boolean);
  for (const key of candidates) {
    if (map[key] !== undefined && map[key] !== null && map[key] !== '') {
      return map[key];
    }
  }
  return undefined;
}

function buildAnalyticsByQuestionId(savedExamResult) {
  const byId = new Map();
  if (!savedExamResult || !Array.isArray(savedExamResult.questionAnalytics)) {
    return byId;
  }
  savedExamResult.questionAnalytics.forEach((row, idx) => {
    const qid = String(row?.questionId || `q-${idx}`).trim();
    if (qid) byId.set(qid, row);
    byId.set(`q-${idx}`, row);
    if (Number.isFinite(Number(row?.index))) {
      byId.set(`q-${Number(row.index)}`, row);
    }
  });
  return byId;
}

function subjectEntriesFromWiseScore(subjectWiseScore) {
  return Object.entries(subjectWiseScore || {})
    .map(([subject, score]) => {
      const total = Number(score?.total || 0);
      const correct = Number(score?.correct || 0);
      const marks = Number(score?.marks || 0);
      const percentage = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
      return { subject: String(subject).toLowerCase(), total, correct, marks, percentage };
    })
    .filter((x) => x.total > 0);
}

/** Server-side grading for analysis — matches POST /exam-results logic. */
function gradeExamAttemptFromBank(questions, answerMap, examDoc = null) {
  const subjectWiseScore = {};
  let correctAnswers = 0;
  let wrongAnswers = 0;
  let obtainedMarks = 0;
  let totalMarks = 0;

  (questions || []).forEach((q, index) => {
    const userAnswer = lookupUserAnswerFromMap(answerMap, q, index);
    const marks = Number(q.marks) || 0;
    const negativeMarks = Number(q.negativeMarks) || 0;
    totalMarks += marks;
    const subjectKey = resolveExamQuestionSubjectKey(q, examDoc);
    if (!subjectWiseScore[subjectKey]) {
      subjectWiseScore[subjectKey] = { correct: 0, total: 0, marks: 0 };
    }
    subjectWiseScore[subjectKey].total += 1;

    if (isAnswerCorrect(q, userAnswer)) {
      correctAnswers += 1;
      obtainedMarks += marks;
      subjectWiseScore[subjectKey].correct += 1;
      subjectWiseScore[subjectKey].marks += marks;
    } else if (userAnswer !== undefined && userAnswer !== null && userAnswer !== '') {
      wrongAnswers += 1;
      obtainedMarks -= negativeMarks;
    }
  });

  const totalQuestions = (questions || []).length;
  const unattempted = Math.max(0, totalQuestions - correctAnswers - wrongAnswers);
  const percentage =
    totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 10000) / 100 : 0;

  return {
    correctAnswers,
    wrongAnswers,
    unattempted,
    obtainedMarks,
    totalMarks,
    totalQuestions,
    percentage,
    subjectWiseScore,
  };
}

// Single source of truth for "is this user answer correct for this question".
// Mirrors the client's previous checkAnswer so existing exams grade identically.
function isAnswerCorrect(question, userAnswer) {
  if (userAnswer === undefined || userAnswer === null || userAnswer === '') {
    return false;
  }

  if (question.questionType === 'integer') {
    const userResolved = resolveAnswerToken(question, userAnswer);
    const correctResolved = resolveAnswerToken(question, question.correctAnswer);
    const userNum = Number(userResolved);
    const correctNum = Number(correctResolved);
    if (Number.isFinite(userNum) && Number.isFinite(correctNum)) {
      return userNum === correctNum;
    }
    return userResolved === correctResolved;
  }

  if (
    question.questionType === 'mcq' ||
    question.questionType === 'assertion_reason' ||
    question.questionType === 'match_following'
  ) {
    const correctText = resolveAnswerToken(question, question.correctAnswer);
    const userText = resolveAnswerToken(question, userAnswer);
    return !!correctText && userText === correctText;
  }

  if (question.questionType === 'multiple') {
    const correctList = resolveAnswerList(question, question.correctAnswer);
    const userList = resolveAnswerList(question, userAnswer);
    if (correctList.length !== userList.length) return false;
    const userSet = new Set(userList);
    return correctList.every((a) => userSet.has(a));
  }

  return false;
}

// Save exam results (server-authoritative grading).
router.post('/exam-results', async (req, res) => {
  try {
    const { examId, examTitle, timeTaken, answers, questionTimings } = req.body || {};

    console.log('📋 Saving exam result for student:', req.userId);
    console.log('📋 Exam ID:', examId);

    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId is required' });
    }

    // Get student's assigned admin, class, and curriculum board for analytics bucketing.
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories')
      .populate('assignedClass', 'classNumber section');
    if (!student) {
      return res.status(400).json({ success: false, message: 'Student not found' });
    }

    const examDoc = await Exam.findById(examId).lean();
    if (!examDoc || examDoc.isActive === false || examDoc.createdByRole !== 'super-admin') {
      return res.status(404).json({
        success: false,
        message: 'Exam not found or is no longer available.',
      });
    }

    const studentAdminId = student.assignedAdmin?._id || student.assignedAdmin;
    const studentBoardOrAdmin =
      student.assignedAdmin && typeof student.assignedAdmin === 'object'
        ? student.assignedAdmin
        : student.assignedAdmin?.board || student.board || '';
    if (!examVisibleToStudent(examDoc, studentAdminId, studentBoardOrAdmin)) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not assigned to your school.',
      });
    }

    const studentClassNumber = resolveStudentClassNumber(student, student.assignedClass);
    if (!examMatchesStudentAssignedClass(examDoc, studentClassNumber)) {
      return res.status(403).json({
        success: false,
        message: 'This exam is not assigned to your class.',
      });
    }

    const windowStatus = getExamWindowStatus(examDoc, { purpose: 'submit' });
    if (!windowStatus.ok) {
      return res.status(403).json({
        success: false,
        message: windowStatus.message,
      });
    }

    const displayBoard = resolveUserDisplayBoard(student, student.assignedAdmin);
    const resolvedBoard = displayBoard
      ? String(displayBoard).trim().toUpperCase()
      : String(student.board || student.assignedAdmin?.board || 'ASLI_EXCLUSIVE_SCHOOLS')
          .trim()
          .toUpperCase();

    // Load the real questions from the DB and grade against THEM — never trust
    // client-supplied correctAnswers / obtainedMarks / percentage. The student
    // could have crafted the request in DevTools.
    const questions = await Question.find({ exam: examId, isActive: { $ne: false } })
      .sort(QUESTION_LIST_SORT)
      .lean();
    let effectiveQuestions = Array.isArray(questions) ? questions : [];

    if (!effectiveQuestions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
      effectiveQuestions = await Question.find({
        _id: { $in: examDoc.questions.map((q) => q?._id || q).filter(Boolean) },
        isActive: { $ne: false }
      })
        .sort(QUESTION_LIST_SORT)
        .lean();
    }

    if (!effectiveQuestions.length && Array.isArray(examDoc?.questions) && examDoc.questions.length > 0) {
      effectiveQuestions = examDoc.questions
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
          subject: resolveExamQuestionSubjectKey(q, examDoc),
          chapter: String(q.chapter || q.topic || q.chapterName || '').trim(),
          exam: examId,
        }));
    }

    if (!effectiveQuestions.length) {
      return res.status(400).json({
        success: false,
        message: 'Exam has no questions available for grading.',
      });
    }

    const answerMap = (answers && typeof answers === 'object') ? answers : {};

    let correctAnswers = 0;
    let wrongAnswers = 0;
    let obtainedMarks = 0;
    let totalMarks = 0;
    const subjectWiseScore = {};

    effectiveQuestions.forEach((q, index) => {
      const userAnswer = lookupUserAnswerFromMap(answerMap, q, index);
      const marks = Number(q.marks) || 0;
      const negativeMarks = Number(q.negativeMarks) || 0;
      totalMarks += marks;
      const subjectKey = resolveExamQuestionSubjectKey(q, examDoc);
      const subjectBucket =
        subjectWiseScore[subjectKey] ||
        (subjectWiseScore[subjectKey] = { correct: 0, total: 0, marks: 0 });
      subjectBucket.total += 1;

      if (isAnswerCorrect(q, userAnswer)) {
        correctAnswers += 1;
        obtainedMarks += marks;
        subjectBucket.correct += 1;
        subjectBucket.marks += marks;
      } else if (userAnswer !== undefined && userAnswer !== null && userAnswer !== '') {
        wrongAnswers += 1;
        obtainedMarks -= negativeMarks;
      }
    });

    const totalQuestions = effectiveQuestions.length;
    const unattempted = Math.max(0, totalQuestions - correctAnswers - wrongAnswers);
    // Student-facing percentage should be based on all questions:
    // correct answers out of total questions (including unattempted).
    const percentage = totalQuestions > 0
      ? Math.round((correctAnswers / totalQuestions) * 10000) / 100
      : 0;
    const perQuestionAnalytics = buildPerQuestionAttemptAnalytics({
      questions: effectiveQuestions,
      answers: answerMap,
      questionTimings,
      isAnswerCorrect,
    });

    const ExamResult = (await import('../../models/ExamResult.js')).default;
    const maxAttempts = Math.max(1, Number(examDoc?.maxAttempts) || 1);
    const priorCount = await ExamResult.countDocuments({
      userId: req.userId,
      examId,
    });
    if (priorCount >= maxAttempts) {
      // Likely a retry after a slow/timeout save that already succeeded — return
      // the latest attempt as success so the student is not stuck on a false 403.
      const existing = await ExamResult.findOne({ userId: req.userId, examId })
        .sort({ attemptNumber: -1, completedAt: -1 })
        .lean();
      if (existing) {
        try {
          await ExamAttemptDraft.deleteOne({ examId, userId: req.userId });
        } catch {
          /* ignore */
        }
        const plainResult = toPlainExamResultForApi(existing);
        return res.status(200).json({
          success: true,
          message: 'Result already saved',
          alreadySaved: true,
          data: {
            ...plainResult,
            questions: effectiveQuestions.map((q) => signQuestionMediaFields(q, 8 * 60 * 60)),
          },
        });
      }
      return res.status(403).json({
        success: false,
        message: `Maximum attempts (${maxAttempts}) reached for this exam.`,
      });
    }
    const attemptNumber = priorCount + 1;

    const resultData = {
      examId,
      userId: req.userId,
      adminId: student.assignedAdmin?._id || student.assignedAdmin || null,
      board: normalizeSchoolBoard(resolvedBoard),
      examTitle: examTitle || examDoc?.title || '',
      totalQuestions,
      correctAnswers,
      wrongAnswers,
      unattempted,
      totalMarks,
      obtainedMarks,
      percentage,
      timeTaken: Number(timeTaken) || 0,
      subjectWiseScore,
      answers: answerMap,
      questionAnalytics: perQuestionAnalytics,
      // Freeze the paper with this attempt — survives exam/question deletion.
      questionSnapshot: buildExamQuestionSnapshot(effectiveQuestions, examDoc),
      completedAt: new Date(),
      attemptNumber,
    };

    let examResult;
    try {
      examResult = await ExamResult.create(resultData);
    } catch (createErr) {
      if (createErr?.code === 11000) {
        // Concurrent double-submit: treat the existing row as success (idempotent).
        const existing = await ExamResult.findOne({
          userId: req.userId,
          examId,
          attemptNumber,
        }).lean();
        if (existing) {
          examResult = existing;
        } else {
          const latest = await ExamResult.findOne({ userId: req.userId, examId })
            .sort({ attemptNumber: -1, completedAt: -1 })
            .lean();
          if (latest) {
            examResult = latest;
          } else {
            return res.status(409).json({
              success: false,
              message:
                'Your previous submit is still processing. Please wait a moment and check Attempted Exams before trying again.',
            });
          }
        }
      } else if (createErr?.name === 'ValidationError') {
        console.error('❌ ExamResult validation failed:', createErr.message);
        return res.status(400).json({
          success: false,
          message: createErr.message || 'Invalid exam result data',
        });
      } else {
        throw createErr;
      }
    }

    // Race guard: if two submits slipped past countDocuments, drop the excess NEW row only.
    const createdFresh = examResult && typeof examResult.toObject === 'function';
    if (createdFresh) {
      const finalCount = await ExamResult.countDocuments({ userId: req.userId, examId });
      if (finalCount > maxAttempts) {
        await ExamResult.deleteOne({ _id: examResult._id });
        return res.status(403).json({
          success: false,
          message: `Maximum attempts (${maxAttempts}) reached for this exam.`,
        });
      }
    }

    try {
      const { createPostExamPrompt } = await import('../../services/vidya-student/post-exam-trigger-service.js');
      const weakTopics = perQuestionAnalytics
        .filter((q) => q.status === 'wrong' || q.status === 'not_answered')
        .map((q) => ({
          chapter: String(q.chapter || q.topic || '').trim(),
          subject: String(q.subject || '').trim(),
          topic: String(q.topic || '').trim(),
        }));
      const weakSubjectsFromScore = Object.entries(subjectWiseScore || {})
        .map(([subject, bucket]) => {
          const total = Number(bucket?.total) || 0;
          const correct = Number(bucket?.correct) || 0;
          if (total === 0) return null;
          const pct = Math.round((correct / total) * 100);
          return pct < 70 ? subject : null;
        })
        .filter(Boolean);
      await createPostExamPrompt({
        studentId: req.userId,
        examId,
        examResultId: examResult._id,
        examTitle: examTitle || examDoc?.title || 'Exam',
        obtainedMarks,
        totalMarks,
        percentage,
        correctAnswers,
        totalQuestions,
        weakTopics,
        weakSubjects: weakSubjectsFromScore,
      });
    } catch (proactiveErr) {
      console.warn('Post-exam Vidya proactive trigger failed (non-fatal):', proactiveErr.message);
    }

    console.log('✅ Exam result saved (server-graded)');
    console.log('📋 Scored:', {
      examId: examResult.examId?.toString(),
      userId: examResult.userId?.toString(),
      correct: correctAnswers,
      wrong: wrongAnswers,
      obtainedMarks,
      totalMarks,
      percentage,
    });

    try {
      await ExamAttemptDraft.deleteOne({ examId, userId: req.userId });
    } catch (draftErr) {
      console.warn('Failed to clear exam attempt draft after submit:', draftErr?.message || draftErr);
    }

    const plainResult =
      typeof examResult.toObject === 'function'
        ? examResult.toObject({ flattenMaps: true })
        : toPlainExamResultForApi(examResult);

    // Return the full result AND the graded questions (with correctAnswer /
    // explanation) so the client can render the post-submission review UI
    // without needing a separate request.
    res.status(201).json({
      success: true,
      message: 'Result saved successfully',
      data: {
        ...plainResult,
        questions: effectiveQuestions.map((q) => signQuestionMediaFields(q, 8 * 60 * 60)),
      },
    });
  } catch (error) {
    console.error('❌ Failed to save exam result:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to save result',
      error: error.message,
    });
  }
});

router.get('/exam/:examId/advanced-analytics', async (req, res) => {
  try {
    const { examId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam id' });
    }

    const ExamResult = (await import('../../models/ExamResult.js')).default;
    const { resultId } = req.query;
    let latestResult = null;

    if (resultId && mongoose.Types.ObjectId.isValid(String(resultId))) {
      latestResult = await ExamResult.findOne({
        _id: resultId,
        userId: req.userId,
        examId,
      }).lean();
    }

    if (!latestResult) {
      latestResult = await ExamResult.findOne({
        userId: req.userId,
        examId,
      })
        .sort({ completedAt: -1 })
        .lean();
    }

    if (!latestResult) {
      return res.status(404).json({
        success: false,
        message: 'No completed result found for this exam.',
      });
    }

    const examQuestions = await resolveQuestionsForExamResult(latestResult, examId);

    const questionAnalytics =
      Array.isArray(latestResult.questionAnalytics) && latestResult.questionAnalytics.length > 0
        ? enrichQuestionAnalyticsFromExamQuestions(
            latestResult.questionAnalytics.map((item, index) => ({
              ...item,
              questionId: String(item.questionId || ''),
              index: Number(item.index ?? index),
              subject: String(item.subject || 'unknown').toLowerCase(),
              chapter: String(item.chapter || 'General'),
            })),
            examQuestions
          )
        : buildPerQuestionAttemptAnalytics({
            questions: examQuestions,
            answers: latestResult.answers || {},
            questionTimings: latestResult.questionTimings || {},
            isAnswerCorrect,
          });

    const advanced = generateAdvancedAnalytics({
      examResult: latestResult,
      questionAnalytics,
    });

    res.json({
      success: true,
      data: advanced,
      sampleMockData: req.query.includeMock === 'true' ? advancedAnalyticsMockData : undefined,
    });
  } catch (error) {
    console.error('Advanced analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate advanced analytics',
      error: error.message,
    });
  }
});

// Student Ranking Routes


export default router;
