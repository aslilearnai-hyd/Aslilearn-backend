import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import {
  verifyToken,
  verifyTeacher,
  extractTeacherId
} from '../../middleware/auth.js';
import {
  getTeacherDashboardStats,
  testTeacherData
} from '../../controllers/adminController.js';
import {
  createLessonPlan,
  createTestQuestions,
  createClasswork,
  createSchedule,
  createTeacherTool,
  generateContent,
  getGeneratedContent,
  getTeacherToolStats,
  getSubjects,
  getTopics,
  getAvailableContent
} from '../../controllers/aiToolsController.js';
import { getMyWeeklyDigest } from '../../controllers/impactReportController.js';
import Video from '../../models/Video.js';
import Assessment from '../../models/Assessment.js';
import Exam from '../../models/Exam.js';
import User from '../../models/User.js';
import ExamResult from '../../models/ExamResult.js';
import Teacher from '../../models/Teacher.js';
import Content from '../../models/Content.js';
import StudentRemark from '../../models/StudentRemark.js';
import TeacherWorkDiary from '../../models/TeacherWorkDiary.js';
import Subject from '../../models/Subject.js';
import { examVisibleToSchool, getSchoolAdminCalendarEvents, monthBounds } from '../../controllers/calendarController.js';
import {
  getExplicitTeacherSubjectObjectIds,
  subjectIdAllowed,
} from '../../utils/teacherSubjectScope.js';
import {
  resolveSubjectContentIds,
  resolveSubjectContentIdsMany,
  subjectIdAllowedWithSiblings,
  subjectGroupKey,
  extractPlainSubjectNameForContent,
} from '../../utils/resolveSubjectContentIds.js';
import { parseDateKeyToUtc, getTeacherClassesHandler } from './helpers.js';

const router = express.Router();

router.get('/videos', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const videos = await Video.find({ createdBy: teacherId }).sort({ createdAt: -1 });
    res.json({ success: true, data: videos });
  } catch (error) {
    console.error('Get teacher videos error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch videos' });
  }
});

// Removed insecure debug video writer
router.post('/videos-test', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This debug endpoint has been removed. Use POST /api/teacher/videos.',
  });
});

router.post('/videos', async (req, res) => {
  try {
    const teacherId = req.teacherId || req.userId || req.user?._id;
    const { title, description, subject, duration, videoUrl, difficulty } = req.body;
    
    console.log('Creating video with data:', { title, description, subject, duration, videoUrl, difficulty, teacherId });
    console.log('req.adminId:', req.adminId);
    console.log('req.user:', req.user);
    console.log('req.userId:', req.userId);
    console.log('req.teacherId:', req.teacherId);
    console.log('teacherId type:', typeof teacherId);
    console.log('teacherId value:', teacherId);
    
    if (!teacherId) {
      console.error('No teacher ID found in request');
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Convert duration to number (assuming it's in minutes)
    const durationInSeconds = parseInt(duration) * 60;
    console.log('durationInSeconds:', durationInSeconds);
    
    const videoData = {
      title,
      description,
      subjectId: subject, // Use subject as subjectId
      duration: durationInSeconds, // Convert to seconds
      videoUrl: videoUrl || '',
      youtubeUrl: videoUrl || '',
      isYouTubeVideo: !!videoUrl,
      difficulty: difficulty || 'beginner',
      createdBy: new mongoose.Types.ObjectId(teacherId),
      adminId: req.adminId ? new mongoose.Types.ObjectId(req.adminId) : new mongoose.Types.ObjectId(teacherId),
      isPublished: true
    };
    
    console.log('Video data to save:', videoData);
    
    const newVideo = new Video(videoData);

    await newVideo.save();
    console.log('Video created successfully:', newVideo._id);
    res.json({ success: true, data: newVideo });
  } catch (error) {
    console.error('Create teacher video error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to create video', error: error.message });
  }
});

router.get('/assessments', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const assessments = await Assessment.find({ createdBy: teacherId }).sort({ createdAt: -1 });
    res.json({ success: true, data: assessments });
  } catch (error) {
    console.error('Get teacher assessments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch assessments' });
  }
});

router.post('/assessments', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { title, description, subject, questions, timeLimit, difficulty } = req.body;
    
    console.log('Creating assessment with data:', { title, description, subject, questions, timeLimit, difficulty, teacherId });
    console.log('req.adminId:', req.adminId);
    
    const newAssessment = new Assessment({
      title,
      description,
      subjectIds: [subject], // Use subject as subjectIds array
      questions: questions ? JSON.parse(questions) : [],
      duration: parseInt(timeLimit) || 30, // Convert to number
      difficulty: difficulty || 'beginner',
      createdBy: new mongoose.Types.ObjectId(teacherId),
      adminId: req.adminId ? new mongoose.Types.ObjectId(req.adminId) : new mongoose.Types.ObjectId(teacherId),
      isPublished: true
    });

    await newAssessment.save();
    console.log('Assessment created successfully:', newAssessment._id);
    res.json({ success: true, data: newAssessment });
  } catch (error) {
    console.error('Create teacher assessment error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to create assessment', error: error.message });
  }
});


router.get('/asli-prep-content', async (req, res) => {
  try {
    const { subject, type, topic, surface } = req.query;
    const teacherId = req.teacherId;
    
    console.log('📚 Fetching Asli Prep content for teacher:', teacherId);
    console.log('Query params:', { subject, type, topic, surface });

    const {
      getTeacherSchoolProgramContext,
      applySchoolProgramContentFilters,
      isAllowedContentType,
      isEduOttSurface,
      resolveIitCategoriesForContentBrowse,
    } = await import('../../utils/schoolProgram.js');
    const baseProgramCtx = await getTeacherSchoolProgramContext(teacherId);
    const iitCategoriesForBrowse = resolveIitCategoriesForContentBrowse(baseProgramCtx);
    const programCtx = {
      ...baseProgramCtx,
      iitCategories: iitCategoriesForBrowse,
      surface,
    };

    const eduOtt = isEduOttSurface(surface);

    if (type && type !== 'all' && !isAllowedContentType(type, programCtx.isAsliPrepExclusive)) {
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

    if (eduOtt && !programCtx.isAsliPrepExclusive) {
      return res.json({
        success: true,
        data: [],
        message:
          'EduOTT IIT videos are available only for Asli Prep schools with IIT EduOTT enabled. Board videos are in Learning Paths.',
        meta: {
          reason: 'not_asli_prep',
          isAsliPrepExclusive: false,
          iitCategories: [],
        },
      });
    }
    
    // Get teacher with assigned subjects
    const teacher = await Teacher.findById(teacherId).populate('subjects');
    
    if (!teacher) {
      console.log('❌ Teacher not found');
      return res.json({
        success: true,
        data: []
      });
    }
    
    let librarySubjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    if (librarySubjectIds.length === 0 && teacher.isIndividualAccount) {
      const { resolveIndividualCatalogSubjectIds } = await import(
        '../../utils/individualCatalogSubjects.js'
      );
      librarySubjectIds = await resolveIndividualCatalogSubjectIds(teacher);
    }

    // IIT materials nest under board subjects in Learning Paths (same as students).
    // EduOTT and Learning Paths both need IIT catalog subject ids.
    if (
      programCtx.isAsliPrepExclusive &&
      Array.isArray(programCtx.iitCategories) &&
      programCtx.iitCategories.some((c) => String(c || '').trim())
    ) {
      const { mergeIitCatalogSubjectsForClasses } = await import(
        '../../utils/iitCatalogSubjects.js'
      );
      const { normalizeClassNumberLabel } = await import('../../utils/studentClassContent.js');
      const classNums = [];
      for (const s of teacher.subjects || []) {
        const cn =
          normalizeClassNumberLabel(s?.classNumber) ||
          String(s?.name || '').match(/_(\d+)$/)?.[1] ||
          '';
        if (cn) classNums.push(cn);
      }
      librarySubjectIds = await mergeIitCatalogSubjectsForClasses(
        librarySubjectIds,
        classNums,
        { iitCategories: programCtx.iitCategories },
      );
    }

    const { filterToActiveCatalogSubjectIds, buildActiveSubjectIdSet, filterContentRowsForActiveCatalog } =
      await import('../../utils/activeCatalog.js');
    librarySubjectIds = await filterToActiveCatalogSubjectIds(librarySubjectIds);

    if (librarySubjectIds.length === 0) {
      console.log('❌ Teacher has no active catalog subjects on profile');
      return res.json({
        success: true,
        data: [],
        message: eduOtt
          ? 'No IIT subjects available yet for your school tracks.'
          : 'No subjects assigned on your teacher profile.',
        meta: {
          reason: 'no_subjects',
          isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
          iitCategories: programCtx.iitCategories || [],
        },
      });
    }

    // Resolve siblings across this school's boards (stored + curriculum + IIT).
    // Asli Prep teachers store ASLI hub board while content often sits on curriculum / IIT subjects.
    const { boardsForSchoolContentScope } = await import('../../constants/boards.js');
    const contentBoards = boardsForSchoolContentScope({
      board: programCtx.adminBoard || teacher.board,
      curriculumBoard: programCtx.curriculumBoard,
      isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
      iitCategories: programCtx.iitCategories,
      excludeIitBoard: false,
    });
    const boardResolveOpts =
      contentBoards.length > 0 ? { boards: contentBoards } : {};

    const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, boardResolveOpts);
    const activeIdSet = buildActiveSubjectIdSet(contentSubjectIds);

    console.log(
      `📋 Teacher library subjects: ${librarySubjectIds.length}, content ids (incl. siblings): ${contentSubjectIds.length}, boards: ${contentBoards.join(',') || 'any'}`
    );

    const query = {
      subject: { $in: contentSubjectIds },
      isActive: true,
    };

    if (subject && subject !== 'all' && mongoose.Types.ObjectId.isValid(subject)) {
      const allowed = await subjectIdAllowedWithSiblings(subject, librarySubjectIds, boardResolveOpts);
      if (allowed) {
        const resolved = await resolveSubjectContentIds(subject, boardResolveOpts);
        query.subject = { $in: resolved };
      } else {
        console.log('⚠️ Requested subject not in teacher subject scope');
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

    if (teacher.isIndividualAccount) {
      const { resolveStudentClassNumber, filterContentsForStudentClass } = await import(
        '../../utils/studentClassContent.js'
      );
      const classNum = resolveStudentClassNumber(teacher, null);
      if (classNum) {
        contents = filterContentsForStudentClass(contents, classNum, librarySubjectIds);
      }
    }

    console.log(`✅ Found ${contents.length} active catalog contents for teacher`);

    const { enrichContentDurations } = await import('../../utils/enrichContentDurations.js');
    contents = await enrichContentDurations(contents);

    const { dedupeLibraryContents } = await import('../../utils/dedupeLibraryContents.js');
    contents = dedupeLibraryContents(contents);

    res.json({
      success: true,
      data: contents,
      meta: {
        isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
        iitCategories: programCtx.iitCategories || [],
        surface: surface || null,
        count: contents.length,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching Asli Prep content for teacher:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch content', error: error.message });
  }
});

// Student Remarks Routes

export default router;
