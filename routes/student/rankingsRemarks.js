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
import { prepareLearningPathSubjects } from '../../utils/learningPathSubjects.js';


const router = express.Router();

router.get('/rankings', getAllStudentRankings);
router.get('/exams/:examId/ranking', getStudentExamRanking);

// Get student's remarks from teachers
router.get('/remarks', async (req, res) => {
  try {
    const studentId = req.userId;
    
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    // Get all remarks for this student
    const remarks = await StudentRemark.find({ studentId })
      .populate('teacherId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: remarks
    });
  } catch (error) {
    console.error('Get student remarks error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch remarks',
      error: error.message 
    });
  }
});

// Get student's subjects via class → subject links (no name-suffix matching)
async function getStudentSubjectsHandler(req, res) {
  try {
    // Get student with assigned admin and assignedClass
    const student = await User.findById(req.userId)
      .populate('assignedAdmin', 'board')
      .populate('assignedClass', 'classNumber section assignedSubjects')
      .select('-password');
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Individual (B2C) students have no school admin — resolve catalog by class + board + interests
    if (!student.assignedAdmin && student.isIndividualAccount) {
      const { resolveIndividualCatalogSubjectDocs } = await import(
        '../../utils/individualCatalogSubjects.js'
      );
      const { filterToActiveCatalogSubjectIds } = await import('../../utils/activeCatalog.js');
      let subjectDocs = await resolveIndividualCatalogSubjectDocs(student);
      let subjectIdList = subjectDocs.map((s) => s._id);
      try {
        const {
          getStudentSchoolProgramContext,
          resolveIitCategoriesForContentBrowse,
        } = await import('../../utils/schoolProgram.js');
        const programCtx = await getStudentSchoolProgramContext(student._id || req.userId);
        const iitCategories = resolveIitCategoriesForContentBrowse(programCtx);
        if (programCtx.isAsliPrepExclusive && iitCategories.length) {
          const { mergeIitCatalogSubjectsIntoLibraryIds } = await import(
            '../../utils/iitCatalogSubjects.js'
          );
          subjectIdList = await mergeIitCatalogSubjectsIntoLibraryIds(
            subjectIdList,
            student.classNumber,
            { iitCategories },
          );
          const activeIds = await filterToActiveCatalogSubjectIds(subjectIdList);
          subjectDocs = await Subject.find({
            _id: { $in: activeIds },
            isActive: true,
            name: { $not: /__deleted__/ },
          })
            .select('_id name description board code productCategory classNumber')
            .lean();
        } else {
          const activeIds = await filterToActiveCatalogSubjectIds(subjectIdList);
          const activeSet = new Set(activeIds.map((id) => String(id)));
          subjectDocs = subjectDocs.filter((s) => activeSet.has(String(s._id)));
        }
      } catch {
        const activeIds = await filterToActiveCatalogSubjectIds(subjectIdList);
        const activeSet = new Set(activeIds.map((id) => String(id)));
        subjectDocs = subjectDocs.filter((s) => activeSet.has(String(s._id)));
      }

      const boardUpper = resolveStudentContentBoard(student, student.board || student.curriculumBoard);
      let siblingBoardOpts = { board: boardUpper };
      try {
        const {
          getStudentSchoolProgramContext,
          resolveIitCategoriesForContentBrowse,
        } = await import('../../utils/schoolProgram.js');
        const { boardsForSchoolContentScope } = await import('../../constants/boards.js');
        const programCtx = await getStudentSchoolProgramContext(student._id || req.userId);
        const iitCategories = resolveIitCategoriesForContentBrowse(programCtx);
        const boards = boardsForSchoolContentScope({
          board: student.board,
          curriculumBoard: student.curriculumBoard || boardUpper,
          isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
          iitCategories,
          excludeIitBoard: false,
        });
        if (boards.length) siblingBoardOpts = { boards };
      } catch {
        /* keep boardUpper */
      }

      const formattedSubjects = await Promise.all(
        subjectDocs.map(async (subject) => {
          const contentSubjectIds = await resolveSubjectContentIds(subject._id, siblingBoardOpts);
          const contentCount = await Content.countDocuments({
            subject: { $in: contentSubjectIds },
            isActive: true,
          });
          return {
            _id: subject._id,
            id: String(subject._id),
            name: subject.name,
            description: subject.description || '',
            board: subject.board,
            productCategory: subject.productCategory || '',
            classNumber: subject.classNumber || '',
            code: subject.code || '',
            teachers: [],
            teacherCount: 0,
            contentCount,
          };
        }),
      );

      const learningPathSubjects = prepareLearningPathSubjects(formattedSubjects);
      return res.json({
        success: true,
        subjects: learningPathSubjects,
        data: learningPathSubjects,
        message:
          learningPathSubjects.length === 0
            ? 'No curriculum subjects found for your class yet. Confirm class and board on signup, or try again later.'
            : undefined,
      });
    }
    
    if (!student.assignedAdmin) {
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message: 'No admin assigned. Please contact your administrator.'
      });
    }
    
    // Get admin's board to filter subjects
    const admin = await User.findById(student.assignedAdmin);
    if (!admin) {
      console.error('Admin not found for student:', student.email);
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message: 'Admin not found. Please contact your administrator.'
      });
    }
    
    const adminBoard = admin.board || student.board;
    
    if (!adminBoard) {
      console.error('No board assigned to admin:', admin.email);
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message: 'No board assigned to admin. Please contact your administrator.'
      });
    }
    
    const studentClassDoc = await resolveStudentClassDoc(student);
    let subjectIdList = await resolveStudentSubjectIdsForLibrary(
      student,
      studentClassDoc
    );

    // Merge IIT catalog subjects so Learning Paths can nest Mathematics IIT under Mathematics
    // (same browse fallback as school admin / trial when tracks are unset).
    try {
      const {
        getStudentSchoolProgramContext,
        resolveIitCategoriesForContentBrowse,
      } = await import('../../utils/schoolProgram.js');
      const programCtx = await getStudentSchoolProgramContext(student._id || req.userId);
      const iitCategories = resolveIitCategoriesForContentBrowse(programCtx);
      if (programCtx.isAsliPrepExclusive && iitCategories.length) {
        const { resolveStudentClassNumber } = await import('../../utils/studentClassContent.js');
        const classNum =
          resolveStudentClassNumber(student, studentClassDoc) || student.classNumber;
        const { mergeIitCatalogSubjectsIntoLibraryIds } = await import(
          '../../utils/iitCatalogSubjects.js'
        );
        subjectIdList = await mergeIitCatalogSubjectsIntoLibraryIds(
          subjectIdList,
          classNum,
          { iitCategories },
        );
      }
    } catch (mergeErr) {
      console.warn('IIT subject merge for learning paths skipped:', mergeErr?.message || mergeErr);
    }

    if (subjectIdList.length === 0) {
      console.log('📚 No subjects resolved for student class/browse.');
      return res.json({
        success: true,
        subjects: [],
        data: [],
        message:
          'No subjects available for your class yet. Ask your administrator to assign subjects or confirm your class.',
      });
    }

    const { filterToActiveCatalogSubjectIds } = await import('../../utils/activeCatalog.js');
    const activeSubjectIdList = await filterToActiveCatalogSubjectIds(subjectIdList);

    const subjects = await Subject.find({
      _id: { $in: activeSubjectIdList },
      isActive: true,
      name: { $not: /__deleted__/ },
    })
      .sort({ name: 1 })
      .select('_id name description board code productCategory classNumber')
      .lean();

    const boardUpper = resolveStudentContentBoard(student, adminBoard);
    let schoolBoards = [boardUpper];
    try {
      const {
        getStudentSchoolProgramContext,
        resolveIitCategoriesForContentBrowse,
      } = await import('../../utils/schoolProgram.js');
      const { boardsForSchoolContentScope } = await import('../../constants/boards.js');
      const programCtx = await getStudentSchoolProgramContext(student._id || req.userId);
      const iitCategories = resolveIitCategoriesForContentBrowse(programCtx);
      schoolBoards = boardsForSchoolContentScope({
        board: adminBoard,
        curriculumBoard: programCtx.curriculumBoard || boardUpper,
        isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
        iitCategories,
        excludeIitBoard: false,
      });
      if (!schoolBoards.length) schoolBoards = [boardUpper];
    } catch {
      /* keep boardUpper */
    }

    console.log(`📚 Returning ${subjects.length} active catalog subjects after class + board merge`);
    
    // Get teachers assigned to this admin who teach these subjects
    const Teacher = (await import('../../models/Teacher.js')).default;
    const teachers = await Teacher.find({
      adminId: student.assignedAdmin,
      subjects: { $in: subjects.map(s => s._id) },
      isActive: true
    })
    .select('_id subjects fullName email phone department qualifications')
    .lean();
    
    console.log(`Found ${teachers.length} teachers teaching subjects for admin ${student.assignedAdmin}`);
    
    // Build map of subject to teachers
    const subjectTeachersMap = new Map();
    teachers.forEach(teacher => {
      if (teacher.subjects && Array.isArray(teacher.subjects)) {
        teacher.subjects.forEach((subjId) => {
          const subjIdStr = subjId.toString();
          if (!subjectTeachersMap.has(subjIdStr)) {
            subjectTeachersMap.set(subjIdStr, []);
          }
          subjectTeachersMap.get(subjIdStr).push({
            _id: teacher._id,
            name: teacher.fullName || 'Unknown Teacher',
            email: teacher.email || '',
            phone: teacher.phone || '',
            department: teacher.department || '',
            qualifications: teacher.qualifications || ''
          });
        });
      }
    });
    
    console.log('Subject-Teacher mapping:', Array.from(subjectTeachersMap.entries()).map(([subjId, teachers]) => ({
      subjectId: subjId,
      teachers: teachers.map((t) => t.name)
    })));
    
    const siblingBoardOpts =
      schoolBoards.length > 1 ? { boards: schoolBoards } : { board: boardUpper };

    // Format subjects with teacher information + content counts (sibling subject ids)
    const formattedSubjects = await Promise.all(
      subjects.map(async (subject) => {
        const subjectIdStr = subject._id.toString();
        const assignedTeachers = subjectTeachersMap.get(subjectIdStr) || [];
        const contentSubjectIds = await resolveSubjectContentIds(subject._id, siblingBoardOpts);
        const contentCount = await Content.countDocuments({
          subject: { $in: contentSubjectIds },
          isActive: true,
        });

        return {
          _id: subject._id,
          id: subjectIdStr,
          name: subject.name,
          description: subject.description || '',
          board: subject.board,
          productCategory: subject.productCategory || '',
          classNumber: subject.classNumber || '',
          code: subject.code || '',
          teachers: assignedTeachers,
          teacherCount: assignedTeachers.length,
          contentCount,
        };
      })
    );
    
    // Merge BIO/Biology + IIT siblings into one card (IIT shows as subheading in the UI)
    const learningPathSubjects = prepareLearningPathSubjects(formattedSubjects);

    console.log(`✅ Returning ${learningPathSubjects.length} learning-path subjects (from ${formattedSubjects.length} raw)`);
    console.log('Sample subject with teachers:', learningPathSubjects[0] ? {
      name: learningPathSubjects[0].name,
      teacherCount: learningPathSubjects[0].teacherCount,
      teachers: learningPathSubjects[0].teachers
    } : 'none');
    
    res.json({
      success: true,
      subjects: learningPathSubjects,
      data: learningPathSubjects
    });
  } catch (error) {
    console.error('Error fetching student subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects' });
  }
}

router.get('/subjects', getStudentSubjectsHandler);
router.get('/my-subjects', getStudentSubjectsHandler);

// Get assigned quizzes for student


export default router;
