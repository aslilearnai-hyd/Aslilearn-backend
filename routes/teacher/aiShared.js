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


const allowTeacherOrStudent = (req, res, next) => {
  if (req.user.role === 'teacher' || req.user.role === 'student') {
    if (req.user.role === 'student') {
      req.teacherId = req.userId;
    } else if (req.user.role === 'teacher') {
      req.teacherId = req.userId;
    }
    next();
  } else {
    return res.status(403).json({ success: false, message: 'Access denied. Teacher or Student privileges required.' });
  }
};

router.get('/ai/subjects', allowTeacherOrStudent, getSubjects); // Returns valid subjects for Class 6
router.get('/ai/topics', allowTeacherOrStudent, getTopics); // Returns chapters from planner.json
router.get('/ai/available-content', allowTeacherOrStudent, getAvailableContent); // Returns all available content types for a chapter
router.post('/ai/tool', allowTeacherOrStudent, createTeacherTool); // Uses hardcoded content only
router.post('/ai/generate-content', allowTeacherOrStudent, generateContent); // Generate + persist
router.get('/ai/generated-content', allowTeacherOrStudent, getGeneratedContent); // Fallback latest generated content
router.get('/ai/tool-stats', allowTeacherOrStudent, getTeacherToolStats);
router.get('/weekly-digest', allowTeacherOrStudent, getMyWeeklyDigest);


export default router;
