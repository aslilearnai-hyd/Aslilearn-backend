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

router.get('/work-diary', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { from, to, limit = '60' } = req.query;
    const q = { teacherId: new mongoose.Types.ObjectId(teacherId) };
    if (from && to) {
      const f = parseDateKeyToUtc(String(from));
      const t = parseDateKeyToUtc(String(to));
      if (f && t) q.forDate = { $gte: f, $lte: t };
    }
    const entries = await TeacherWorkDiary.find(q)
      .sort({ forDate: -1 })
      .limit(Math.min(Number(limit) || 60, 200))
      .populate('classId', 'classNumber section name')
      .lean();
    res.json({ success: true, data: entries });
  } catch (error) {
    console.error('Get work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch diary' });
  }
});

router.post('/work-diary', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { date, content, title, classId } = req.body;
    if (!date || !content || String(content).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'date and content are required' });
    }
    if (!classId || !mongoose.Types.ObjectId.isValid(String(classId))) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }
    const forDate = parseDateKeyToUtc(String(date));
    if (!forDate) {
      return res.status(400).json({ success: false, message: 'Invalid date (use YYYY-MM-DD)' });
    }
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const classOid = new mongoose.Types.ObjectId(String(classId));
    const Class = (await import('../../models/Class.js')).default;
    const classDoc = await Class.findOne({
      _id: classOid,
      isActive: true,
    }).select('_id classNumber section name');
    if (!classDoc) {
      return res.status(400).json({ success: false, message: 'Invalid class' });
    }
    const classDisplay = (() => {
      const section = classDoc.section?.trim();
      if (classDoc.classNumber) {
        return section ? `Class ${classDoc.classNumber} - ${section}` : `Class ${classDoc.classNumber}`;
      }
      return classDoc.name || 'Class';
    })();
    const assignedIds = new Set((teacher.assignedClassIds || []).map(String));
    const assignedByAssignment = (teacher.assignments || []).some(
      (a) => String(a.classId) === String(classOid)
    );
    const allowed =
      assignedByAssignment ||
      assignedIds.has(String(classOid)) ||
      assignedIds.has(String(classDoc.classNumber));
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Class not assigned to you' });
    }

    const tid = new mongoose.Types.ObjectId(teacherId);
    const existing = await TeacherWorkDiary.findOne({ teacherId: tid, forDate, classId: classOid });
    if (existing) {
      existing.content = String(content).trim();
      existing.title = title != null ? String(title).trim() : existing.title;
      existing.classDisplay = classDisplay;
      await existing.save();
      return res.json({ success: true, data: existing, message: 'Diary updated for this date' });
    }
    const doc = new TeacherWorkDiary({
      teacherId: tid,
      adminId: teacher.adminId,
      classId: classOid,
      classDisplay,
      forDate,
      title: title != null ? String(title).trim() : '',
      content: String(content).trim(),
    });
    await doc.save();
    res.status(201).json({ success: true, data: doc, message: 'Diary saved' });
  } catch (error) {
    console.error('Post work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to save diary' });
  }
});

router.put('/work-diary/:id', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { id } = req.params;
    const { content, title, date } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const tid = new mongoose.Types.ObjectId(teacherId);
    const entry = await TeacherWorkDiary.findOne({ _id: id, teacherId: tid });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    if (content != null) entry.content = String(content).trim();
    if (title != null) entry.title = String(title).trim();
    if (date) {
      const nd = parseDateKeyToUtc(String(date));
      if (nd) entry.forDate = nd;
    }
    await entry.save();
    res.json({ success: true, data: entry });
  } catch (error) {
    console.error('Put work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to update diary' });
  }
});

router.delete('/work-diary/:id', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const tid = new mongoose.Types.ObjectId(teacherId);
    const result = await TeacherWorkDiary.findOneAndDelete({ _id: id, teacherId: tid });
    if (!result) return res.status(404).json({ success: false, message: 'Entry not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    console.error('Delete work diary error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete' });
  }
});

export default router;
