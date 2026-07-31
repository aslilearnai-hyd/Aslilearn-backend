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

router.get('/calendar/events', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({
        success: false,
        message: 'Query param month is required (format yyyy-mm)',
      });
    }

    const teacher = await Teacher.findById(req.teacherId).select('_id adminId');
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    if (!teacher.adminId || !mongoose.Types.ObjectId.isValid(teacher.adminId)) {
      return res.json({ success: true, data: [] });
    }

    const bounds = monthBounds(String(month));
    if (!bounds) {
      return res.status(400).json({ success: false, message: 'Invalid month' });
    }
    const { monthStart, monthEnd } = bounds;
    const schoolOid = new mongoose.Types.ObjectId(teacher.adminId);

    const examDocs = await Exam.find({
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
      createdByRole: 'super-admin',
      isActive: { $ne: false },
    })
      .populate('targetSchools', 'schoolName fullName name email')
      .populate('schoolId', 'schoolName fullName name email')
      .sort({ startDate: 1 })
      .lean();

    const examEvents = examDocs
      .filter((ex) => examVisibleToSchool(ex, schoolOid))
      .map((ex) => ({
        id: `exam-${ex._id.toString()}`,
        title: ex.title,
        startDate: ex.startDate,
        endDate: ex.endDate,
        eventType: 'exam',
        subject: ex.subject,
        classNumber:
          Array.isArray(ex.assignedClasses) && ex.assignedClasses.length > 0
            ? ex.assignedClasses.map((c) => String(c)).join(', ')
            : ex.classNumber || '',
        room: ex.room || '',
        description: ex.description || '',
      }));

    const adminSchoolEvents = await getSchoolAdminCalendarEvents(schoolOid, String(month));

    const data = [...examEvents, ...adminSchoolEvents].sort(
      (a, b) => new Date(a.startDate) - new Date(b.startDate)
    );

    res.json({ success: true, data });
  } catch (error) {
    console.error('Teacher calendar events error:', error);
    res.status(500).json({ success: false, message: 'Failed to load calendar events' });
  }
});

export default router;
