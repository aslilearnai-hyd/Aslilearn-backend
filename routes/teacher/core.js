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

// Teacher Dashboard Routes
router.get('/dashboard', getTeacherDashboardStats);

/** GET /api/teacher/me — profile details for Settings */
router.get('/me', async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.teacherId)
      .populate('subjects', 'name displayName')
      .select('-password')
      .lean();
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    let schoolName = teacher.schoolName || teacher.school || '';
    let schoolLogo = '';
    if (teacher.adminId) {
      const admin = await User.findById(teacher.adminId)
        .select('schoolName schoolLogo')
        .lean();
      if (admin) {
        schoolName = admin.schoolName || schoolName;
        schoolLogo = admin.schoolLogo || '';
      }
    }

    return res.json({
      success: true,
      data: {
        id: teacher._id,
        fullName: teacher.fullName || '',
        email: teacher.email || '',
        phone: teacher.phone || '',
        department: teacher.department || '',
        qualifications: teacher.qualifications || '',
        schoolName,
        schoolLogo,
        subjects: Array.isArray(teacher.subjects) ? teacher.subjects : [],
        isActive: teacher.isActive !== false,
      },
    });
  } catch (error) {
    console.error('Failed to fetch teacher profile:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

/** PATCH /api/teacher/me — update editable teacher details */
router.patch('/me', async (req, res) => {
  try {
    const allowed = ['fullName', 'phone', 'department', 'qualifications'];
    const updates = {};
    for (const key of allowed) {
      if (key in (req.body || {})) {
        updates[key] = String(req.body[key] ?? '').trim();
      }
    }

    if (updates.fullName !== undefined && updates.fullName.length < 2) {
      return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters' });
    }
    if (updates.phone !== undefined && updates.phone && !/^\d{7,15}$/.test(updates.phone.replace(/\D/g, ''))) {
      return res.status(400).json({ success: false, message: 'Enter a valid phone number' });
    }
    if (updates.phone !== undefined) {
      updates.phone = updates.phone.replace(/\D/g, '').slice(0, 15);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const teacher = await Teacher.findByIdAndUpdate(
      req.teacherId,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate('subjects', 'name displayName')
      .select('-password');

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    return res.json({
      success: true,
      message: 'Profile updated',
      data: {
        id: teacher._id,
        fullName: teacher.fullName,
        email: teacher.email,
        phone: teacher.phone || '',
        department: teacher.department || '',
        qualifications: teacher.qualifications || '',
        subjects: teacher.subjects || [],
      },
    });
  } catch (error) {
    console.error('Failed to update teacher profile:', error);
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

/** POST /api/teacher/change-password */
router.post('/change-password', async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters',
      });
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirmation do not match',
      });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from the current password',
      });
    }

    const teacher = await Teacher.findById(req.teacherId).select('+password');
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    if (!teacher.password) {
      return res.status(400).json({ success: false, message: 'Password change is not available for this account' });
    }

    const valid = await bcrypt.compare(currentPassword, teacher.password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    teacher.password = await bcrypt.hash(newPassword, 12);
    await teacher.save();

    return res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Failed to change teacher password:', error);
    return res.status(500).json({ success: false, message: 'Failed to change password' });
  }
});

/** GET /api/teacher/calendar/events?month=yyyy-mm */

export default router;
