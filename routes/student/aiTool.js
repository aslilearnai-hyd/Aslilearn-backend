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

router.post('/ai/tool', async (req, res) => {
  try {
    const { toolType, gradeLevel, subject, topic, board, ...params } = req.body;
    const userId = req.userId;

    const {
      getStudentSchoolProgramContext,
      validateAiToolBoardAccess,
      resolveAiToolClassNumberFromRequest,
    } = await import('../utils/schoolProgram.js');
    const programCtx = await getStudentSchoolProgramContext(userId);
    const boardCheck = validateAiToolBoardAccess(programCtx.isAsliPrepExclusive, {
      board,
      gradeLevel,
    });
    if (!boardCheck.ok) {
      return res.status(403).json({ success: false, message: boardCheck.message });
    }

    if (!toolType) {
      return res.status(400).json({
        success: false,
        message: 'Tool type is required'
      });
    }

    // Match super-admin storage: always Class N (legacy IIT-6 rows still found via board-aware filters).
    const classNumber = resolveAiToolClassNumberFromRequest({ board, gradeLevel });
    if (classNumber == null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid class. Please select a valid class.',
      });
    }

    // Validate required fields
    if (!classNumber || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Class and subject are required.'
      });
    }
    
    // For tools that require topic, validate it
    const toolsRequiringTopic = [
      'smart-study-guide-generator',
      'concept-breakdown-explainer',
      'smart-qa-practice-generator',
      'chapter-summary-creator',
      'key-points-formula-extractor',
      'quick-assignment-builder'
    ];
    
    if (toolsRequiringTopic.includes(toolType) && !topic) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required for this tool type.'
      });
    }

    const subTopicNormalized = String(params.subTopic || params.subtopic || '').trim().replace(/\s+/g, ' ');
    const { isWholeChapterSubtopic } = await import('../utils/questionComposition.js');
    if (isWholeChapterSubtopic(subTopicNormalized)) {
      params.chapterScope = true;
      params.subTopic = '';
      params.subtopic = '';
    }

    const { resolveValidCurriculumSubject, resolveClassDisplay } = await import(
      '../utils/curriculum-subject-validation.js'
    );
    const { normalizedSubject, validSubjectsList } = resolveValidCurriculumSubject(subject, {
      classNumber,
      board,
    });

    if (!normalizedSubject) {
      return res.status(400).json({
        success: false,
        message: `Invalid subject. Valid subjects are: ${validSubjectsList.join(', ')}`
      });
    }
    
    {
      const { validateAiToolSubjectForTool } = await import('../utils/ai-tool-subject-rules.js');
      const subjectError = validateAiToolSubjectForTool(toolType, normalizedSubject || subject);
      if (subjectError) {
        return res.status(400).json({
          success: false,
          message: subjectError,
        });
      }
    }

    // Use normalized subject for processing
    const finalSubject = normalizedSubject;
    const { classNum, classDisplay } = resolveClassDisplay(classNumber);

    // For tools where topic is optional, pass empty string if not provided
    const topicForFetch = (toolType === 'personalized-revision-planner' || toolType === 'chapter-summary-creator') ? (topic || '') : topic;

    const parsePositiveInt = (value) => {
      const num = Number.parseInt(String(value ?? ''), 10);
      return Number.isFinite(num) && num > 0 ? num : null;
    };

    const trimTextQuestions = (content, maxQuestions) => {
      if (!maxQuestions) return content;
      const lines = String(content || '').split(/\r?\n/);
      const questionStartRegex = /^\s*(?:Q(?:uestion)?\s*\d+[\).:\-]|(?:\d+)[\).]\s+)/i;
      const starts = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (questionStartRegex.test(lines[i] || '')) starts.push(i);
      }
      if (starts.length <= maxQuestions) return content;
      const cutoffLine = starts[maxQuestions];
      return lines.slice(0, cutoffLine).join('\n').trim();
    };

    const limitQuestionsInJson = (parsed, maxQuestions) => {
      if (!maxQuestions || parsed == null) return parsed;
      if (Array.isArray(parsed)) return parsed.slice(0, maxQuestions);
      if (Array.isArray(parsed.questions)) return { ...parsed, questions: parsed.questions.slice(0, maxQuestions) };
      if (Array.isArray(parsed.mcqs)) return { ...parsed, mcqs: parsed.mcqs.slice(0, maxQuestions) };
      if (Array.isArray(parsed.items)) return { ...parsed, items: parsed.items.slice(0, maxQuestions) };
      return parsed;
    };

    const applyQuestionLimitToContent = (activeToolType, content, requestedCount) => {
      const limitedToolTypes = new Set([
        'mock-test-builder',
        'worksheet-mcq-generator',
      ]);
      if (!limitedToolTypes.has(String(activeToolType || ''))) return String(content || '');
      const maxQuestions = parsePositiveInt(requestedCount);
      if (!maxQuestions) return String(content || '');
      const text = String(content || '').trim();
      if (!text) return text;
      try {
        const parsed = JSON.parse(text);
        const trimmed = limitQuestionsInJson(parsed, maxQuestions);
        return JSON.stringify(trimmed, null, 2);
      } catch {
        return trimTextQuestions(text, maxQuestions);
      }
    };

    const {
      validateDashboardAiToolDoc,
      DASHBOARD_INCOMPLETE_CODE,
      DASHBOARD_INCOMPLETE_USER_MESSAGE,
      DASHBOARD_WRONG_TOOL_CODE,
      DASHBOARD_WRONG_TOOL_USER_MESSAGE,
    } = await import('../services/ai-tool-dashboard-validation.js');

    // Priority 1: Super Admin AI Tool Data (exact class+subject+topic+subtopic) with rotation.
    const lookupBoard =
      String(req.body.board || '').trim() || programCtx.curriculumBoard || 'CBSE';

    const { normalizeTopicProductCategory } = await import('../utils/ai-tool-topic-taxonomy.js');
    const studentProductCategory =
      normalizeTopicProductCategory(
        params.productCategory ?? req.body.productCategory ?? '',
      ) ?? '';

    const { doc: adminDoc, matchType, totalCandidates, selectedIndex } = await fetchRotatingAiToolData({
      classLabel: classDisplay,
      subject: finalSubject,
      topic: String(topicForFetch || '').trim().replace(/\s+/g, ' '),
      subtopic: subTopicNormalized,
      toolName: toolType,
      board: lookupBoard,
      productCategory: studentProductCategory || undefined,
      preferLatest: false,
      strictToolMatch: true,
      cursorScope: String(userId || ''),
      validator: async (doc) => {
        const { storyPassageRecordLanguageValid } = await import('../utils/story-passage-subject.js');
        if (!validateDashboardAiToolDoc(toolType, doc).valid) return false;
        return storyPassageRecordLanguageValid(toolType, finalSubject, doc);
      },
    });
    if (adminDoc) {
      const contentGate = validateDashboardAiToolDoc(toolType, adminDoc);
      const originalContent = String(adminDoc.generatedContent || adminDoc.content || '').trim();
      if (!contentGate.valid) {
        const isWrongTool = contentGate.code === DASHBOARD_WRONG_TOOL_CODE;
        return res.status(404).json({
          success: false,
          code: contentGate.code || DASHBOARD_INCOMPLETE_CODE,
          message:
            contentGate.message ||
            (isWrongTool ? DASHBOARD_WRONG_TOOL_USER_MESSAGE : DASHBOARD_INCOMPLETE_USER_MESSAGE),
          missingSections: contentGate.missingSections || [],
        });
      }

      const content = applyQuestionLimitToContent(
        toolType,
        originalContent,
        params.questionCount ?? req.body?.questionCount,
      );
      const builtRaw = buildRawDataForTool(toolType, content, buildDeliveryMetadataFromDoc(adminDoc));
      const delivered = unwrapStoredAiToolContent(content, builtRaw);
      return res.json({
        success: true,
        data: {
          content: delivered.content,
          ...(delivered.rawData ? { rawData: delivered.rawData } : {}),
          toolType,
          metadata: {
            classNumber: classNum,
            subject: finalSubject,
            topic: topicForFetch || '',
            subTopic: subTopicNormalized,
            ...params,
            generatedAt: new Date(),
            userId,
            source: 'super-admin-ai-tool-data',
            sourceLabel: 'Super Admin AI Tool Data',
            matchType,
            totalCandidates,
            selectedIndex,
          },
        },
      });
    }
    
    return res.status(404).json({
      success: false,
      code: 'AI_TOOL_DATA_NOT_FOUND',
      message:
        'No matching AI Tool Data found for the selected class, subject, topic, and sub topic. Please ask Super Admin to add this mapping in AI Tool Generations.',
    });
  } catch (error) {
    console.error(`Create student tool (${req.body.toolType}) error:`, error);
    res.status(500).json({
      success: false,
      message: error.message || `Failed to fetch content for ${req.body.toolType || 'tool'}`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get Risk Analysis Reports for Student


export default router;
