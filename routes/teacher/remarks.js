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

router.get('/students/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    let studentIds = [];
    if (teacher.assignedClassIds?.length) {
      const Class = (await import('../../models/Class.js')).default;
      const classDocs = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } },
        ],
        isActive: true,
      }).select('_id');
      const classObjectIds = classDocs.map((c) => c._id);
      const students = await User.find({
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId,
      }).select('_id');
      studentIds = students.map((s) => s._id);
    }

    const remarkQuery =
      studentIds.length > 0
        ? {
            $or: [
              { studentId: { $in: studentIds } },
              { teacherId: teacher._id },
            ],
          }
        : { teacherId: teacher._id };

    const remarks = await StudentRemark.find(remarkQuery)
      .populate('studentId', 'fullName email')
      .populate('teacherId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({ success: true, data: remarks });
  } catch (error) {
    console.error('Get class student remarks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student remarks',
      error: error.message,
    });
  }
});


router.post('/students/:studentId/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { studentId } = req.params;
    const { remark, subject, isPositive } = req.body;

    if (!remark || typeof remark !== 'string' || remark.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Remark is required and cannot be empty' });
    }

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    // Tenant + class assignment check (prevent cross-school / cross-class IDOR)
    const Class = (await import('../../models/Class.js')).default;
    const classDocs = teacher.assignedClassIds?.length
      ? await Class.find({
          $or: [
            { _id: { $in: teacher.assignedClassIds } },
            { classNumber: { $in: teacher.assignedClassIds } },
          ],
          isActive: true,
        }).select('_id classNumber')
      : [];
    const classObjectIds = classDocs.map((c) => c._id);
    const classNumbers = classDocs.map((c) => c.classNumber).filter((n) => n != null);

    const student = await User.findOne({
      _id: studentId,
      role: 'student',
      assignedAdmin: teacher.adminId,
      $or: [
        ...(classObjectIds.length ? [{ assignedClass: { $in: classObjectIds } }] : []),
        ...(classNumbers.length ? [{ classNumber: { $in: classNumbers } }] : []),
        ...(teacher.assignedClassIds?.length
          ? [{ classNumber: { $in: teacher.assignedClassIds } }]
          : []),
      ],
    });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or not assigned to this teacher',
      });
    }

    // Create new remark
    const newRemark = new StudentRemark({
      studentId,
      teacherId,
      remark: remark.trim(),
      subject: subject || null,
      isPositive: isPositive !== undefined ? isPositive : true
    });

    await newRemark.save();

    // Populate teacher info for response
    await newRemark.populate('teacherId', 'fullName email');
    if (subject) {
      await newRemark.populate('subject', 'name');
    }

    res.json({
      success: true,
      message: 'Remark added successfully',
      data: newRemark
    });
  } catch (error) {
    console.error('Add student remark error:', error);
    res.status(500).json({ success: false, message: 'Failed to add remark', error: error.message });
  }
});


router.get('/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER REMARKS ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }

    // Get all remarks created by this teacher
    const remarks = await StudentRemark.find({ teacherId })
      .populate('studentId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    console.log(`Found ${remarks.length} remarks by teacher`);
    res.json({
      success: true,
      data: remarks
    });
  } catch (error) {
    console.error('Get teacher remarks error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch remarks', error: error.message });
  }
});


router.get('/students/:studentId/remarks', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { studentId } = req.params;

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const Class = (await import('../../models/Class.js')).default;
    const classDocs = teacher.assignedClassIds?.length
      ? await Class.find({
          $or: [
            { _id: { $in: teacher.assignedClassIds } },
            { classNumber: { $in: teacher.assignedClassIds } },
          ],
          isActive: true,
        }).select('_id classNumber')
      : [];
    const classObjectIds = classDocs.map((c) => c._id);
    const classNumbers = classDocs.map((c) => c.classNumber).filter((n) => n != null);

    const student = await User.findOne({
      _id: studentId,
      role: 'student',
      assignedAdmin: teacher.adminId,
      $or: [
        ...(classObjectIds.length ? [{ assignedClass: { $in: classObjectIds } }] : []),
        ...(classNumbers.length ? [{ classNumber: { $in: classNumbers } }] : []),
        ...(teacher.assignedClassIds?.length
          ? [{ classNumber: { $in: teacher.assignedClassIds } }]
          : []),
      ],
    });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found or not assigned to this teacher',
      });
    }

    // Remarks for this student within the same school only (teacher list filtered by tenant teachers)
    const schoolTeacherIds = await Teacher.find({ adminId: teacher.adminId }).select('_id');
    const remarks = await StudentRemark.find({
      studentId,
      teacherId: { $in: schoolTeacherIds.map((t) => t._id) },
    })
      .populate('teacherId', 'fullName email')
      .populate('subject', 'name')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: remarks
    });
  } catch (error) {
    console.error('Get student remarks error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch remarks', error: error.message });
  }
});

// Update a remark
router.put('/remarks/:remarkId', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { remarkId } = req.params;
    const { remark, isPositive } = req.body;

    if (!remark || typeof remark !== 'string' || remark.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Remark is required and cannot be empty' });
    }

    // Find remark and verify ownership
    const existingRemark = await StudentRemark.findById(remarkId);
    if (!existingRemark) {
      return res.status(404).json({ success: false, message: 'Remark not found' });
    }

    if (existingRemark.teacherId.toString() !== teacherId) {
      return res.status(403).json({ success: false, message: 'You can only edit your own remarks' });
    }

    // Update remark
    existingRemark.remark = remark.trim();
    if (isPositive !== undefined) {
      existingRemark.isPositive = isPositive;
    }
    existingRemark.updatedAt = new Date();

    await existingRemark.save();

    // Populate for response
    await existingRemark.populate('teacherId', 'fullName email');
    if (existingRemark.subject) {
      await existingRemark.populate('subject', 'name');
    }

    res.json({
      success: true,
      message: 'Remark updated successfully',
      data: existingRemark
    });
  } catch (error) {
    console.error('Update student remark error:', error);
    res.status(500).json({ success: false, message: 'Failed to update remark', error: error.message });
  }
});

// Delete a remark
router.delete('/remarks/:remarkId', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { remarkId } = req.params;

    // Find remark and verify ownership
    const remark = await StudentRemark.findById(remarkId);
    if (!remark) {
      return res.status(404).json({ success: false, message: 'Remark not found' });
    }

    if (remark.teacherId.toString() !== teacherId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own remarks' });
    }

    await StudentRemark.findByIdAndDelete(remarkId);

    res.json({
      success: true,
      message: 'Remark deleted successfully'
    });
  } catch (error) {
    console.error('Delete student remark error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete remark', error: error.message });
  }
});



export default router;
