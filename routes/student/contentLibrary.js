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

router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic, class: classParam, surface } = req.query;
    
    console.log('📚 Fetching Asli Prep content for student:', req.userId);
    console.log('Query params:', { subject, type, topic, surface });

    const { getStudentSchoolProgramContext, applySchoolProgramContentFilters, isAllowedContentType } =
      await import('../../utils/schoolProgram.js');
    const { boardsForSchoolContentScope } = await import('../../constants/boards.js');
    const programCtx = {
      ...(await getStudentSchoolProgramContext(req.userId)),
      surface,
    };

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
      const eduOtt =
        String(surface || '').toLowerCase() === 'eduott' ||
        String(surface || '').toLowerCase() === 'edu-ott';
      return res.json({
        success: true,
        data: [],
        message: eduOtt
          ? 'EduOTT IIT videos are available only for Asli Prep schools with IIT EduOTT enabled. Board videos are in Learning Paths.'
          : 'This content type is not available for your school program.',
        meta: {
          reason: 'not_asli_prep',
          isAsliPrepExclusive: false,
          iitCategories: [],
        },
      });
    }
    
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board curriculumBoard isAsliPrepExclusive iitCategories')
      .populate('assignedClass', 'classNumber section assignedSubjects');
    
    if (!student) {
      console.log('❌ Student not found');
      return res.json({
        success: true,
        data: []
      });
    }
    
    console.log('📚 Resolving subjects: class assignedSubjects ∪ board+class matches (incl. ASLI exclusive)');

    const studentClassDoc = await resolveStudentClassDoc(student);
    const adminBoard =
      student.assignedAdmin?.board ||
      (await User.findById(student.assignedAdmin).select('board').lean())?.board ||
      student.board;

    let librarySubjectIds = await resolveStudentSubjectIdsForLibrary(
      student,
      adminBoard,
      studentClassDoc
    );

    // Individual students: class may not be linked to a school Class doc — use signup class/board
    if (librarySubjectIds.length === 0 && student.isIndividualAccount) {
      const { resolveIndividualCatalogSubjectIds } = await import(
        '../../utils/individualCatalogSubjects.js'
      );
      librarySubjectIds = await resolveIndividualCatalogSubjectIds(student);
    }

    const {
      normalizeClassNumberLabel,
      resolveStudentClassNumber,
      filterContentsForStudentClass,
    } = await import('../../utils/studentClassContent.js');
    const studentClassNumber = resolveStudentClassNumber(student, studentClassDoc);

    // IIT EduOTT videos sit on IIT-board subjects — merge them only for EduOTT / unscoped
    // library fetches. Learning Paths must not pull IIT Maths_6 siblings into board subjects.
    const { isLearningPathSurface } = await import('../../utils/schoolProgram.js');
    const lpSurface = isLearningPathSurface(surface);
    if (
      !lpSurface &&
      programCtx.isAsliPrepExclusive &&
      Array.isArray(programCtx.iitCategories) &&
      programCtx.iitCategories.some((c) => String(c || '').trim())
    ) {
      const { mergeIitCatalogSubjectsIntoLibraryIds } = await import(
        '../../utils/iitCatalogSubjects.js'
      );
      librarySubjectIds = await mergeIitCatalogSubjectsIntoLibraryIds(
        librarySubjectIds,
        studentClassNumber || student.classNumber,
        { iitCategories: programCtx.iitCategories },
      );
    }

    const { filterToActiveCatalogSubjectIds, buildActiveSubjectIdSet, filterContentRowsForActiveCatalog } =
      await import('../../utils/activeCatalog.js');
    librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

    if (librarySubjectIds.length === 0) {
      console.log('❌ No subjects resolved for student class');
      return res.json({
        success: true,
        data: [],
        message:
          'No subjects available for your class yet. Ask your administrator to assign subjects or confirm your class.',
        meta: {
          reason: 'no_subjects',
          isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
          iitCategories: programCtx.iitCategories || [],
        },
      });
    }

    const boardUpper = resolveStudentContentBoard(student, adminBoard);
    const schoolBoards = boardsForSchoolContentScope({
      board: adminBoard,
      curriculumBoard: programCtx.curriculumBoard || boardUpper,
      isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
      iitCategories: programCtx.iitCategories,
      excludeIitBoard: lpSurface,
    });
    const siblingBoardOpts = schoolBoards.length
      ? { boards: schoolBoards }
      : { board: boardUpper };

    const contentSubjectIds = await resolveSubjectContentIdsMany(
      librarySubjectIds,
      siblingBoardOpts,
    );
    const activeIdSet = buildActiveSubjectIdSet(contentSubjectIds);

    console.log(
      `📚 Library subjects: ${librarySubjectIds.length}, content query ids (incl. siblings): ${contentSubjectIds.length}, boards: ${schoolBoards.join(',') || boardUpper}`
    );

    // Build query — include content on MATHS_6 when student has clean MATHS assigned.
    const query = {
      subject: { $in: contentSubjectIds },
      isActive: true,
    };

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(subject)) {
      const allowed = await subjectIdAllowedWithSiblings(
        subject,
        librarySubjectIds,
        siblingBoardOpts,
      );
      if (allowed) {
        const resolved = await resolveSubjectContentIds(subject, siblingBoardOpts);
        query.subject = { $in: resolved };
      } else {
        console.log('⚠️ Requested subject not in class assigned subjects');
        return res.json({ success: true, data: [] });
      }
    }
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    if (topic && topic.trim()) {
      query.topic = { $regex: topic.trim(), $options: 'i' };
    }

    console.log('📋 Content query:', JSON.stringify(query, null, 2));

    let contents = await Content.find(query)
      .populate('subject', 'name isActive board classNumber productCategory')
      .sort({ createdAt: -1 })
      .lean();

    contents = filterContentRowsForActiveCatalog(contents, activeIdSet);

    contents = applySchoolProgramContentFilters(contents, programCtx);

    if (!studentClassNumber) {
      return res.json({
        success: true,
        data: [],
        message:
          'No class assigned. Content will appear once your administrator assigns you to a class.',
        meta: {
          reason: 'no_class',
          isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
          iitCategories: programCtx.iitCategories || [],
        },
      });
    }

    contents = filterContentsForStudentClass(
      contents,
      studentClassNumber,
      librarySubjectIds
    );

    if (classParam && classParam !== 'all' && String(classParam).trim() !== '') {
      const want = normalizeClassNumberLabel(classParam);
      if (want && want !== studentClassNumber) {
        contents = [];
      }
    }

    const subjectPlain = subject;
    if (
      subjectPlain &&
      subjectPlain !== 'all' &&
      String(subjectPlain).trim() !== '' &&
      !mongoose.Types.ObjectId.isValid(subjectPlain)
    ) {
      const want = String(subjectPlain).trim().toLowerCase();
      contents = contents.filter(
        (c) => plainSubjectName(c.subject?.name || '').toLowerCase() === want
      );
    }

    console.log(`✅ Found ${contents.length} contents for student's class subjects (after class/subject filters)`);

    const { enrichContentDurations } = await import('../../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    const { dedupeLibraryContents } = await import('../../utils/dedupeLibraryContents.js');
    contents = dedupeLibraryContents(contents);

    const eduOtt =
      String(surface || '').toLowerCase() === 'eduott' ||
      String(surface || '').toLowerCase() === 'edu-ott';
    let emptyMessage = '';
    let emptyReason = '';
    if (contents.length === 0 && eduOtt) {
      const hasIitTracks =
        Array.isArray(programCtx.iitCategories) &&
        programCtx.iitCategories.some((c) => String(c || '').trim());
      if (!programCtx.isAsliPrepExclusive) {
        emptyReason = 'not_asli_prep';
        emptyMessage =
          'EduOTT IIT videos are available only for Asli Prep schools. Board videos are in Learning Paths.';
      } else if (!hasIitTracks) {
        emptyReason = 'iit_eduott_off';
        emptyMessage =
          'IIT EduOTT is turned off for your school. Ask your admin to enable IIT EduOTT (Alpha / Beta / Gamma), or open Learning Paths for board videos.';
      } else {
        emptyReason = 'no_iit_videos_for_class';
        emptyMessage =
          'No IIT videos for your class and assigned tracks yet. Board videos stay in Learning Paths.';
      }
    }

    res.json({
      success: true,
      data: contents,
      ...(emptyMessage ? { message: emptyMessage } : {}),
      meta: {
        isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
        iitCategories: programCtx.iitCategories || [],
        studentClassNumber,
        librarySubjectCount: librarySubjectIds.length,
        ...(emptyReason ? { reason: emptyReason } : {}),
      },
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

// AI-style adaptive learning: weak topics from performance + real DB content only
router.get('/adaptive-learning', async (req, res) => {
  try {
    const data = await buildAdaptiveLearningPayload(req.userId);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('❌ adaptive-learning error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to build adaptive learning recommendations',
    });
  }
});

// Platform library content for subjects the student struggled with (exam report)
router.get('/weak-subject-content', async (req, res) => {
  try {
    const subjectsRaw = req.query.subjects;
    const weakQueryNames =
      typeof subjectsRaw === 'string'
        ? subjectsRaw
            .split(',')
            .map((s) => String(s).trim().toLowerCase())
            .filter(Boolean)
        : [];

    const topicsRaw = req.query.topics;
    const weakQueryTopics =
      typeof topicsRaw === 'string'
        ? topicsRaw
            .split(',')
            .map((s) => String(s).trim().toLowerCase())
            .filter(Boolean)
        : [];

    const topicRowsRaw = req.query.topicRows;
    let weakTopicRows = parseWeakTopicRowsFromQuery(
      typeof topicRowsRaw === 'string' ? topicRowsRaw : '',
    );
    if (weakTopicRows.length === 0 && weakQueryTopics.length > 0) {
      weakTopicRows = weakQueryTopics.map((topic) => ({ subject: '', topic }));
    }

    const emptyPayload = () => ({
      success: true,
      data: {
        Video: [],
        TextBook: [],
        Workbook: [],
        Material: [],
      },
      weakSubjects: weakQueryNames.map((n) =>
        n ? `${n.charAt(0).toUpperCase()}${n.slice(1)}` : ''
      ),
    });

    if (weakQueryNames.length === 0) {
      return res.json({
        ...emptyPayload(),
        weakSubjects: [],
      });
    }

    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const studentClassDoc = await resolveStudentClassDoc(student);
    const adminBoard =
      student.assignedAdmin?.board ||
      (await User.findById(student.assignedAdmin).select('board').lean())?.board ||
      student.board;

    const librarySubjectIds = await resolveStudentSubjectIdsForLibrary(
      student,
      adminBoard,
      studentClassDoc
    );

    if (!librarySubjectIds.length) {
      return res.json(emptyPayload());
    }

    const boardUpper = resolveStudentContentBoard(student, adminBoard);
    const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, {
      board: boardUpper,
    });

    const CONTENT_TYPES = ['Video', 'TextBook', 'Workbook', 'Material'];

    let contents = await Content.find({
      subject: { $in: contentSubjectIds },
      isActive: true,
      type: { $in: CONTENT_TYPES },
    })
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const matchesWeakSubject = (doc) => {
      const plain = plainSubjectName(doc.subject?.name || '').toLowerCase().trim();
      if (!plain) return false;
      return weakQueryNames.some((w) => {
        if (!w) return false;
        return plain.includes(w) || w.includes(plain);
      });
    };

    const matchesWeakTopicForDoc = (doc) => {
      const plain = plainSubjectName(doc.subject?.name || '').toLowerCase().trim();
      const searchable = [doc.topic, doc.title, doc.description].filter(Boolean).join(' ');
      return weakTopicRows.some((row) => {
        if (row.subject && !subjectSlugMatches(plain, row.subject)) return false;
        return topicFuzzyMatch(searchable, row.topic);
      });
    };

    const strictTopicFilter = weakTopicRows.length > 0;
    let filtered = contents.filter((doc) => {
      if (!matchesWeakSubject(doc)) return false;
      if (!strictTopicFilter) {
        doc._topicMatch = false;
        return true;
      }
      const topicOk = matchesWeakTopicForDoc(doc);
      doc._topicMatch = topicOk;
      return topicOk;
    });

    const { resolveStudentClassNumber, filterContentsForStudentClass } = await import(
      '../utils/studentClassContent.js'
    );
    const weakStudentClassNumber = resolveStudentClassNumber(student, studentClassDoc);
    filtered = filterContentsForStudentClass(
      filtered,
      weakStudentClassNumber,
      librarySubjectIds
    );

    filtered.sort((a, b) => {
      const aMatch = a._topicMatch ? 1 : 0;
      const bMatch = b._topicMatch ? 1 : 0;
      return bMatch - aMatch;
    });

    const mapRow = (c) => ({
      _id: String(c._id),
      title: c.title || '',
      description: c.description || '',
      fileUrl:
        c.fileUrl || (Array.isArray(c.fileUrls) && c.fileUrls.length ? c.fileUrls[0] : '') || '',
      thumbnailUrl: c.thumbnailUrl || '',
      topic: c.topic || '',
      subject: {
        _id: String(c.subject?._id || ''),
        name: c.subject?.name || '',
      },
    });

    const data = {
      Video: [],
      TextBook: [],
      Workbook: [],
      Material: [],
    };

    for (const t of CONTENT_TYPES) {
      const forType = filtered.filter((c) => c.type === t).slice(0, 3);
      data[t] = forType.map(mapRow);
    }

    res.json({
      success: true,
      data,
      weakSubjects: weakQueryNames.map((n) =>
        n ? `${n.charAt(0).toUpperCase()}${n.slice(1)}` : ''
      ),
    });
  } catch (error) {
    console.error('❌ Error fetching weak-subject content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch weak-subject content',
      error: error.message,
    });
  }
});

/**
 * List IQ Rank quizzes for the student.
 * - School students: class-matched quizzes excluding trialOnly
 * - Individual trial users: trialOnly quizzes (+ class-matched non-trial if they have a class)
 */


export default router;
