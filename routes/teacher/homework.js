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

router.post('/homework', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    const { title, description, subject, classNumber, topic, date, fileUrl, deadline, board } = req.body;
    
    console.log('📝 Teacher uploading homework:', { title, subject, classNumber, date, deadline, teacherId });
    
    if (!title || !subject || !fileUrl || !date || !deadline) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: title, subject, fileUrl, date, and deadline are required' 
      });
    }
    
    // Get teacher to verify assigned subjects
    const teacher = await Teacher.findById(teacherId).populate('subjects');
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    const librarySubjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    const subjectId = new mongoose.Types.ObjectId(subject);
    const { getTeacherSchoolProgramContext } = await import('../../utils/schoolProgram.js');
    const { boardsForSchoolContentScope } = await import('../../constants/boards.js');
    const programCtx = await getTeacherSchoolProgramContext(teacherId);
    const contentBoards = boardsForSchoolContentScope({
      board: programCtx.adminBoard || teacher.board,
      curriculumBoard: programCtx.curriculumBoard,
      isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
      iitCategories: programCtx.iitCategories,
    });
    const boardResolveOpts =
      contentBoards.length > 0 ? { boards: contentBoards } : {};

    const allowed = await subjectIdAllowedWithSiblings(subjectId, librarySubjectIds, boardResolveOpts);
    if (!allowed) {
      return res.status(403).json({ 
        success: false, 
        message: 'You can only upload homework for your assigned subjects' 
      });
    }
    
    const subjectDoc = await Subject.findById(subject);
    if (!subjectDoc) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }
    
    const homeworkData = {
      title: title.trim(),
      description: description?.trim() || undefined,
      type: 'Homework',
      board: board || subjectDoc.board || 'ASLI_EXCLUSIVE_SCHOOLS',
      subject: subjectId,
      topic: topic?.trim() || undefined,
      date: new Date(date),
      deadline: new Date(deadline),
      fileUrl: fileUrl.trim(),
      isExclusive: false, // Teacher-created homework is not exclusive
      createdBy: 'teacher',
      teacherId: new mongoose.Types.ObjectId(teacherId)
    };
    
    // Add classNumber if provided
    if (classNumber && classNumber.trim()) {
      homeworkData.classNumber = classNumber.trim();
    }
    
    const homework = new Content(homeworkData);
    await homework.save();
    
    console.log('✅ Homework uploaded successfully by teacher:', {
      id: homework._id,
      title: homework.title,
      subject: homework.subject,
      teacherId: teacherId
    });
    
    res.json({ 
      success: true, 
      data: homework, 
      message: 'Homework uploaded successfully' 
    });
  } catch (error) {
    console.error('Teacher homework upload error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload homework', 
      error: error.message 
    });
  }
});


router.get('/homework-submissions', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    // Get students from teacher's assigned classes
    let studentIds = [];
    if (teacher.assignedClassIds && teacher.assignedClassIds.length > 0) {
      const Class = (await import('../../models/Class.js')).default;
      const classDocs = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } }
        ],
        isActive: true
      }).select('_id classNumber section');

      const classObjectIds = classDocs.map(c => c._id);
      
      const students = await User.find({ 
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId
      }).select('_id');
      
      studentIds = students.map(s => s._id);
    }
    
    if (studentIds.length === 0) {
      return res.json({ success: true, data: { homeworks: [], students: [] } });
    }
    
    // Get all homework submissions for these students
    const HomeworkSubmission = (await import('../../models/HomeworkSubmission.js')).default;
    const Content = (await import('../../models/Content.js')).default;
    
    const submissions = await HomeworkSubmission.find({
      studentId: { $in: studentIds }
    })
    .populate('homeworkId', 'title description deadline fileUrl subject classNumber topic board date createdAt')
    .populate('studentId', 'fullName name email')
    .populate('subjectId', 'name')
    .sort({ submittedAt: -1 });
    
    // Group by homework
    const homeworkMap = new Map();
    submissions.forEach(sub => {
      const homeworkId = sub.homeworkId._id.toString();
      if (!homeworkMap.has(homeworkId)) {
        homeworkMap.set(homeworkId, {
          homework: sub.homeworkId,
          submissions: []
        });
      }
      homeworkMap.get(homeworkId).submissions.push(sub);
    });
    
    // Group by student
    const studentMap = new Map();
    submissions.forEach(sub => {
      const studentId = sub.studentId._id.toString();
      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          student: sub.studentId,
          submissions: []
        });
      }
      studentMap.get(studentId).submissions.push(sub);
    });
    
    const librarySubjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    const { getTeacherSchoolProgramContext } = await import('../../utils/schoolProgram.js');
    const { boardsForSchoolContentScope } = await import('../../constants/boards.js');
    const programCtx = await getTeacherSchoolProgramContext(teacherId);
    const contentBoards = boardsForSchoolContentScope({
      board: programCtx.adminBoard || teacher.board,
      curriculumBoard: programCtx.curriculumBoard,
      isAsliPrepExclusive: programCtx.isAsliPrepExclusive,
      iitCategories: programCtx.iitCategories,
    });
    const boardResolveOpts =
      contentBoards.length > 0 ? { boards: contentBoards } : {};
    const contentSubjectIds = await resolveSubjectContentIdsMany(librarySubjectIds, boardResolveOpts);
    const allHomeworks = await Content.find({
      type: 'Homework',
      subject: { $in: contentSubjectIds },
      isActive: true
    })
    .populate('subject', 'name')
    .select('title description deadline fileUrl subject classNumber topic board date createdAt isActive')
    .sort({ createdAt: -1 });
    
    // Include homeworks with no submissions yet
    allHomeworks.forEach(hw => {
      const hwId = hw._id.toString();
      if (!homeworkMap.has(hwId)) {
        homeworkMap.set(hwId, {
          homework: hw,
          submissions: []
        });
      }
    });
    
    res.json({
      success: true,
      data: {
        homeworks: Array.from(homeworkMap.values()),
        students: Array.from(studentMap.values())
      }
    });
  } catch (error) {
    console.error('Get homework submissions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch homework submissions' });
  }
});


export default router;
