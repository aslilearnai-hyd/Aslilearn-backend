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

router.get('/attendance', async (req, res) => {
  try {
    const AttendanceRecord = (await import('../../models/AttendanceRecord.js')).default;
    const teacherId = req.teacherId;
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    let students = [];
    if (teacher.assignedClassIds?.length) {
      const Class = (await import('../../models/Class.js')).default;
      const classDocuments = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } },
        ],
        isActive: true,
      }).select('_id');
      const classObjectIds = classDocuments.map((c) => c._id);
      students = await User.find({
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId,
      })
        .select('_id fullName classNumber rollNo')
        .sort({ fullName: 1 })
        .lean();
    }

    const historyDocs = await AttendanceRecord.find({ teacherId })
      .sort({ date: -1, createdAt: -1 })
      .limit(60)
      .select('date presentCount absentCount lateCount classId createdAt')
      .lean();

    const history = historyDocs.map((h) => ({
      date: h.date,
      createdAt: h.createdAt,
      present: h.presentCount,
      absent: h.absentCount,
      late: h.lateCount,
      classId: h.classId,
    }));

    res.json({
      success: true,
      data: {
        students: students.map((s) => ({
          _id: s._id,
          id: s._id,
          fullName: s.fullName,
          name: s.fullName,
          rollNo: s.rollNo || '',
          status: 'present',
        })),
        history,
      },
    });
  } catch (error) {
    console.error('Get teacher attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to load attendance' });
  }
});

router.post('/attendance', async (req, res) => {
  try {
    const AttendanceRecord = (await import('../../models/AttendanceRecord.js')).default;
    const teacherId = req.teacherId;
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const body = req.body || {};
    const date =
      (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date.trim())
        ? body.date.trim()
        : new Date().toISOString().slice(0, 10));

    let classId = body.classId || null;
    if (classId && !mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ success: false, message: 'Invalid classId' });
    }

    /** Normalize both mobile shapes into { studentId, status } */
    const { collectAttendanceEntries, summarizeAttendanceCounts } = await import(
      '../../utils/attendance-helpers.js'
    );
    const rawEntries = collectAttendanceEntries(body);

    if (rawEntries.length === 0) {
      return res.status(400).json({ success: false, message: 'No attendance entries provided' });
    }

    const studentIds = [...new Set(rawEntries.map((e) => e.studentId))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    if (studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid student ids' });
    }

    // Tenant + class scope: only students under this teacher's admin (and classes when assigned)
    const allowedFilter = {
      _id: { $in: studentIds },
      role: 'student',
      assignedAdmin: teacher.adminId,
    };
    if (teacher.assignedClassIds?.length) {
      const Class = (await import('../../models/Class.js')).default;
      const classDocuments = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } },
        ],
        isActive: true,
      }).select('_id');
      allowedFilter.assignedClass = { $in: classDocuments.map((c) => c._id) };
    }
    const allowedStudents = await User.find(allowedFilter).select('_id').lean();
    const allowedSet = new Set(allowedStudents.map((s) => String(s._id)));
    const entries = rawEntries
      .filter((e) => allowedSet.has(e.studentId))
      .map((e) => ({
        studentId: new mongoose.Types.ObjectId(e.studentId),
        status: e.status,
      }));

    if (entries.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'No students in your classes matched this attendance request',
      });
    }

    const { presentCount, absentCount, lateCount } = summarizeAttendanceCounts(entries);

    const filter = {
      teacherId,
      date,
      classId: classId ? new mongoose.Types.ObjectId(classId) : null,
    };

    const record = await AttendanceRecord.findOneAndUpdate(
      filter,
      {
        $set: {
          teacherId,
          adminId: teacher.adminId,
          classId: classId ? new mongoose.Types.ObjectId(classId) : null,
          date,
          entries,
          presentCount,
          absentCount,
          lateCount,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({
      success: true,
      message: 'Attendance saved',
      data: {
        id: record._id,
        date: record.date,
        present: presentCount,
        absent: absentCount,
        late: lateCount,
      },
    });
  } catch (error) {
    console.error('Post teacher attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to save attendance' });
  }
});


export default router;
