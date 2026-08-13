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
import { generateAiToolLiveFallback } from '../../services/ai-tool-live-fallback.js';
import {
  buildDeliveryMetadataFromDoc,
  buildRawDataForTool,
  unwrapStoredAiToolContent,
} from '../../utils/build-ai-tool-raw-data.js';
import {
  applyHomeworkDurationToDelivery,
  parseHomeworkDurationMinutes,
} from '../../utils/homework-duration.js';
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
    } = await import('../../utils/schoolProgram.js');
    const programCtx = await getStudentSchoolProgramContext(userId);

    if (programCtx?.isIndividualAccount) {
      const { resolveIndividualAccess } = await import('../../utils/individualAccount.js');
      const studentDoc = programCtx.studentDoc || programCtx.userDoc || null;
      const access = resolveIndividualAccess(studentDoc || programCtx);
      if (access.paymentRequired) {
        return res.status(402).json({
          success: false,
          code: 'PAYMENT_REQUIRED',
          message:
            'Your free trial has ended. Please subscribe to continue using AI tools.',
          trialUsage: access.trialUsage || null,
        });
      }
      const allowedTools = Array.isArray(access.trialAllowedAiTools)
        ? access.trialAllowedAiTools
        : Array.isArray(programCtx.trialAllowedAiTools)
          ? programCtx.trialAllowedAiTools
          : [];
      if (allowedTools.length > 0 && toolType && !allowedTools.includes(String(toolType).trim())) {
        return res.status(403).json({
          success: false,
          code: 'TRIAL_TOOL_RESTRICTED',
          message:
            'This AI tool is not included in your trial. Contact support or wait for Super Admin to unlock it.',
        });
      }
      try {
        const { consumeTrialGeneration } = await import('../../utils/trialUsageLimits.js');
        await consumeTrialGeneration(userId, 'student');
      } catch (limitErr) {
        const { trialLimitHttpPayload } = await import('../../utils/trialUsageLimits.js');
        return res.status(limitErr.statusCode || 429).json(trialLimitHttpPayload(limitErr));
      }
    }

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
    const { isWholeChapterSubtopic } = await import('../../utils/questionComposition.js');
    const wholeChapter = isWholeChapterSubtopic(subTopicNormalized);
    if (wholeChapter) {
      params.chapterScope = true;
      params.subTopic = '';
      params.subtopic = '';
    }

    const { resolveValidCurriculumSubject, resolveClassDisplay } = await import(
      '../../utils/curriculum-subject-validation.js'
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
    
    // Subject/tool pairing rules are not delivery gates — serve saved content for any subject.
    // (UI still lists curriculum subjects; Super Admin data may use broader labels.)

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

    // Deliver stored AI Tool Data as-is (no section / language delivery gates).
    const lookupBoard =
      String(req.body.board || '').trim() || programCtx.curriculumBoard || 'CBSE';

    const { normalizeTopicProductCategory } = await import('../../utils/ai-tool-topic-taxonomy.js');
    const studentProductCategory =
      normalizeTopicProductCategory(
        params.productCategory ?? req.body.productCategory ?? '',
      ) ?? '';

    const subtopicForLookup = wholeChapter ? '' : subTopicNormalized;

    const { doc: adminDoc, matchType, totalCandidates, selectedIndex } = await fetchRotatingAiToolData({
      classLabel: classDisplay,
      subject: finalSubject,
      topic: String(topicForFetch || '').trim().replace(/\s+/g, ' '),
      subtopic: subtopicForLookup,
      toolName: toolType,
      board: lookupBoard,
      productCategory: studentProductCategory || undefined,
      preferLatest: false,
      strictToolMatch: true,
      cursorScope: String(userId || ''),
      fastDelivery: true,
    });
    if (adminDoc) {
      const metadataForRaw = buildDeliveryMetadataFromDoc(adminDoc);
      let originalContent = String(adminDoc.generatedContent || adminDoc.content || '').trim();
      let content = applyQuestionLimitToContent(
        toolType,
        originalContent,
        params.questionCount ?? req.body?.questionCount,
      );
      const builtRaw = buildRawDataForTool(toolType, content, metadataForRaw);
      if (!String(content || '').trim() && builtRaw && typeof builtRaw === 'object') {
        content = JSON.stringify(builtRaw);
      }
      if (String(content || '').trim() || builtRaw) {
        const delivered = unwrapStoredAiToolContent(content, builtRaw);
        const outContent =
          String(delivered.content || '').trim() ||
          (delivered.rawData ? JSON.stringify(delivered.rawData) : content);
        if (String(outContent || '').trim()) {
          const durationMinutes = parseHomeworkDurationMinutes(
            params.duration ?? req.body?.duration,
          );
          const withDuration = applyHomeworkDurationToDelivery(
            toolType,
            { content: outContent, rawData: delivered.rawData || builtRaw },
            durationMinutes,
          );
          return res.json({
            success: true,
            data: {
              content: withDuration.content,
              ...(withDuration.rawData ? { rawData: withDuration.rawData } : {}),
              toolType,
              metadata: {
                classNumber: classNum,
                subject: finalSubject,
                topic: topicForFetch || '',
                subTopic: subtopicForLookup,
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
      }
    }

    const liveMiss = await generateAiToolLiveFallback({
      toolType,
      board: lookupBoard,
      classDisplay,
      subject: finalSubject,
      topic: topicForFetch || '',
      subtopic: subtopicForLookup,
      userId,
      role: 'student',
      extraParams: {
        questionCount: params.questionCount ?? req.body?.questionCount,
        duration: params.duration ?? req.body?.duration,
        productCategory: studentProductCategory || undefined,
        uniqueSeed:
          String(req.body.uniqueSeed || params.uniqueSeed || '').trim() ||
          `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        generationVariant:
          Number(req.body.generationVariant || params.generationVariant) ||
          undefined,
      },
    });
    if (liveMiss.ok) {
      const durationMinutes = parseHomeworkDurationMinutes(
        params.duration ?? req.body?.duration,
      );
      const withDuration = applyHomeworkDurationToDelivery(
        toolType,
        { content: liveMiss.content, rawData: liveMiss.rawData },
        durationMinutes,
      );
      return res.json({
        success: true,
        data: {
          content: withDuration.content,
          ...(withDuration.rawData ? { rawData: withDuration.rawData } : {}),
          toolType,
          metadata: {
            classNumber: classNum,
            subject: finalSubject,
            topic: topicForFetch || '',
            subTopic: subtopicForLookup,
            ...params,
            generatedAt: new Date(),
            userId,
            ...liveMiss.metadata,
          },
        },
      });
    }
    
    // Same treatment as the teacher dashboard: name the chapters that are ready
    // rather than telling a student to go and ask the Super Admin.
    const { listTopicsWithContent, buildNoContentMessage } = await import(
      '../../services/ai-tool-availability.js'
    );
    const { getToolDisplayTitle } = await import('../../config/aiToolTemplates.js');

    const availableTopics = await listTopicsWithContent({
      classDisplay,
      subject: finalSubject,
      toolName: toolType,
    });

    return res.status(404).json({
      success: false,
      code: 'AI_TOOL_DATA_NOT_FOUND',
      availableTopics,
      message: buildNoContentMessage({
        toolLabel: getToolDisplayTitle(toolType) || String(toolType || '').replace(/-/g, ' '),
        classDisplay,
        subject: finalSubject,
        topic: topicForFetch,
        subtopic: subtopicForLookup,
        availableTopics,
      }),
    });
  } catch (error) {
    console.error(`Create student tool (${req.body.toolType}) error:`, error);
    const raw = String(error?.message || '');
    const isLookupTimeout = /exceeded time limit|multiplanner|timed?\s*out/i.test(raw);
    res.status(isLookupTimeout ? 404 : 500).json({
      success: false,
      code: isLookupTimeout ? 'AI_TOOL_DATA_NOT_FOUND' : undefined,
      message: isLookupTimeout
        ? 'Saved content is taking too long to load. Please try Generate again.'
        : raw || `Failed to fetch content for ${req.body.toolType || 'tool'}`,
      error: process.env.NODE_ENV === 'development' ? raw : undefined,
    });
  }
});

// Get Risk Analysis Reports for Student


export default router;
