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

router.get('/students', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER STUDENTS ===');
    console.log('Teacher ID:', teacherId);
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    console.log('Teacher assignedClassIds:', teacher.assignedClassIds);
    console.log('Teacher adminId:', teacher.adminId);
    
    // Get students from teacher's assigned classes AND assigned to the same admin as the teacher
    let students = [];
    if (teacher.assignedClassIds && teacher.assignedClassIds.length > 0) {
      // Get Class model
      const Class = (await import('../../models/Class.js')).default;
      
      // First, get the Class documents to find their ObjectIds
      const classDocuments = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } }
        ],
        isActive: true
      }).select('_id classNumber section');

      const classObjectIds = classDocuments.map(c => c._id);
      console.log('Found class ObjectIds:', classObjectIds);
      
      // Get students assigned to these classes by assignedClass ObjectId
      students = await User.find({ 
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId  // Filter by teacher's admin
      })
      .populate('assignedClass', '_id classNumber section')
      .select('-password')
      .sort({ createdAt: -1 });
      
      console.log(`Found ${students.length} students for teacher`);
    }
    
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('Get teacher students error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch students' });
  }
});

router.get('/students/performance', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    // Get students from teacher's assigned classes AND assigned to the same admin as the teacher
    let students = [];
    if (teacher.assignedClassIds && teacher.assignedClassIds.length > 0) {
      // First, get the Class documents to find their ObjectIds
      const Class = (await import('../../models/Class.js')).default;
      const classDocs = await Class.find({
        $or: [
          { _id: { $in: teacher.assignedClassIds } },
          { classNumber: { $in: teacher.assignedClassIds } }
        ],
        isActive: true
      }).select('_id classNumber section');

      const classObjectIds = classDocs.map(c => c._id);
      
      // Get students assigned to these classes by assignedClass ObjectId
      students = await User.find({ 
        role: 'student',
        assignedClass: { $in: classObjectIds },
        assignedAdmin: teacher.adminId  // Filter by teacher's admin
      })
      .populate({
        path: 'assignedClass',
        select: '_id name classNumber section description assignedSubjects',
        populate: {
          path: 'assignedSubjects',
          select: '_id name'
        }
      })
      .select('-password')
      .sort({ createdAt: -1 });
    }

    // Get student IDs
    const studentIds = students.map(s => s._id);

    // Import ExamResult model
    const ExamResult = (await import('../../models/ExamResult.js')).default;

    // Get recent exam results for all students (latest result per exam)
    // Populate examId to get subject information
    const Exam = (await import('../../models/Exam.js')).default;
    const examResults = await ExamResult.find({ 
      userId: { $in: studentIds }
    })
    .populate('examId', 'subject title')
    .sort({ completedAt: -1 });

    // Group exam results by student
    const performanceMap = new Map();
    examResults.forEach(result => {
      const userId = result.userId.toString();
      if (!performanceMap.has(userId)) {
        performanceMap.set(userId, {
          recentExam: null,
          recentMarks: null,
          recentPercentage: null,
          totalExams: 0,
          averageMarks: 0
        });
      }
      const perf = performanceMap.get(userId);
      perf.totalExams += 1;
      
      // Set the most recent exam result
      if (!perf.recentExam || new Date(result.completedAt) > new Date(perf.recentExam.completedAt)) {
        perf.recentExam = result;
        perf.recentMarks = result.obtainedMarks;
        perf.recentPercentage = result.percentage;
      }
    });

    // Calculate average marks and average percentage for each student
    const marksByStudent = {};
    const percentagesByStudent = {};
    examResults.forEach(result => {
      const userId = result.userId.toString();
      if (!marksByStudent[userId]) marksByStudent[userId] = [];
      if (!percentagesByStudent[userId]) percentagesByStudent[userId] = [];
      marksByStudent[userId].push(result.obtainedMarks);
      if (result.percentage !== null && result.percentage !== undefined) {
        percentagesByStudent[userId].push(result.percentage);
      }
    });

    Object.keys(marksByStudent).forEach(userId => {
      const marks = marksByStudent[userId];
      const percentages = percentagesByStudent[userId] || [];
      const perf = performanceMap.get(userId);
      if (perf) {
        perf.averageMarks = marks.reduce((a, b) => a + b, 0) / marks.length;
        perf.averagePercentage = percentages.length > 0 
          ? percentages.reduce((a, b) => a + b, 0) / percentages.length 
          : null;
      }
    });

    // Calculate overall progress for each student (same as student dashboard)
    // Overall progress = average of all subject progress (combining exam and learning path progress)
    const Subject = (await import('../../models/Subject.js')).default;
    const Content = (await import('../../models/Content.js')).default;
    const UserProgress = (await import('../../models/UserProgress.js')).default;
    
    const studentsWithPerformance = await Promise.all(students.map(async (student) => {
      // Calculate daily average watch time from logged-in session time
      let dailyAverageWatchTime = 0; // in minutes
      try {
        const UserSession = (await import('../../models/UserSession.js')).default;
        
        // Get all session records for this student
        const sessionRecords = await UserSession.find({
          userId: student._id,
          duration: { $gt: 0 }
        }).select('duration date').sort({ date: 1 });

        if (sessionRecords.length > 0) {
          // Group by date and calculate total time per day
          const dailySessionTime = new Map();
          
          sessionRecords.forEach(record => {
            const dateKey = record.date || new Date(record.createdAt).toISOString().split('T')[0];
            const timeInMinutes = record.duration || 0;
            
            if (!dailySessionTime.has(dateKey)) {
              dailySessionTime.set(dateKey, 0);
            }
            dailySessionTime.set(dateKey, dailySessionTime.get(dateKey) + timeInMinutes);
          });

          // Calculate average across all days
          if (dailySessionTime.size > 0) {
            const totalMinutes = Array.from(dailySessionTime.values()).reduce((sum, minutes) => sum + minutes, 0);
            dailyAverageWatchTime = Math.round((totalMinutes / dailySessionTime.size) * 10) / 10; // Round to 1 decimal place
          }
        }
      } catch (error) {
        console.error(`Error calculating daily average watch time for student ${student._id}:`, error);
      }
      const perf = performanceMap.get(student._id.toString()) || {
        recentExam: null,
        recentMarks: null,
        recentPercentage: null,
        totalExams: 0,
        averageMarks: 0
      };
      
      // Get student's board
      let studentBoard = student.board;
      if (!studentBoard && student.assignedAdmin) {
        const admin = await User.findById(student.assignedAdmin).select('board');
        if (admin && admin.board) {
          studentBoard = admin.board;
        }
      }
      
      // Subjects assigned to the student's class only (no whole-board fallback).
      let subjectsList = [];
      if (student.assignedClass && student.assignedClass.assignedSubjects) {
        subjectsList = student.assignedClass.assignedSubjects;
      }
      
      // Calculate exam progress per subject
      const examProgressBySubject = new Map();
      const studentExamResults = examResults.filter(r => r.userId.toString() === student._id.toString());
      
      studentExamResults.forEach(result => {
        // Get subject from examId if populated, or from examTitle parsing
        let subjectId = null;
        if (result.examId && result.examId.subject) {
          subjectId = result.examId.subject.toString();
        }
        
        if (subjectId && result.percentage !== null && result.percentage !== undefined) {
          if (!examProgressBySubject.has(subjectId)) {
            examProgressBySubject.set(subjectId, []);
          }
          examProgressBySubject.get(subjectId).push(result.percentage);
        }
      });
      
      // Calculate average exam progress per subject
      const examProgressMap = new Map();
      examProgressBySubject.forEach((percentages, subjectId) => {
        const avgProgress = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
        examProgressMap.set(subjectId, Math.round(avgProgress));
      });
      
      // Calculate learning path progress per subject (from UserProgress and Content)
      const learningPathProgressMap = new Map();
      if (studentBoard && subjectsList.length > 0) {
        for (const subject of subjectsList) {
          const subjectId = subject._id ? subject._id.toString() : subject.toString();
          try {
            // Get total content count for this subject
            const totalContent = await Content.countDocuments({
              subject: subjectId,
              board: studentBoard.toUpperCase(),
              isActive: true,
              isExclusive: true
            });
            
            if (totalContent > 0) {
              // Get all content IDs for this subject
              const contentIds = await Content.find({
                subject: subjectId,
                board: studentBoard.toUpperCase(),
                isActive: true,
                isExclusive: true
              }).select('_id');
              
              const contentIdArray = contentIds.map(c => c._id);
              
              if (contentIdArray.length > 0) {
                // Get completed content count from UserProgress (using contentId)
                const completedProgress = await UserProgress.countDocuments({
                  userId: student._id,
                  contentId: { $in: contentIdArray },
                  completed: true
                });
                
                // Also count content with progress > 0 (partially completed)
                const totalProgressRecords = await UserProgress.countDocuments({
                  userId: student._id,
                  contentId: { $in: contentIdArray },
                  progress: { $gt: 0 }
                });
                
                // Calculate progress: completed content + partial progress
                const progress = totalContent > 0 
                  ? Math.round(((completedProgress + (totalProgressRecords - completedProgress) * 0.5) / totalContent) * 100)
                  : 0;
                
                if (progress > 0) {
                  learningPathProgressMap.set(subjectId, progress);
                }
              }
            }
          } catch (error) {
            console.error(`Error calculating learning path progress for subject ${subjectId}:`, error);
          }
        }
      }
      
      // Merge exam and learning path progress (same logic as student dashboard)
      const mergedProgress = new Map();
      
      // Add exam-based progress
      examProgressMap.forEach((progress, subjectId) => {
        const subject = subjectsList.find(s => (s._id || s).toString() === subjectId);
        const subjectName = subject?.name || 'Subject';
        mergedProgress.set(subjectId, {
          progress: progress,
          name: subjectName
        });
      });
      
      // Merge with learning path progress (average if both exist)
      learningPathProgressMap.forEach((progress, subjectId) => {
        const subject = subjectsList.find(s => (s._id || s).toString() === subjectId);
        const subjectName = subject?.name || 'Subject';
        
        if (mergedProgress.has(subjectId)) {
          // Average if both exist
          const existing = mergedProgress.get(subjectId);
          mergedProgress.set(subjectId, {
            ...existing,
            progress: Math.round((existing.progress + progress) / 2)
          });
        } else {
          // Add new entry
          mergedProgress.set(subjectId, {
            progress: progress,
            name: subjectName
          });
        }
      });
      
      // Get overall progress from database (saved by student dashboard)
      // If not available, calculate as average of all subject progress
      let overallProgress = student.overallProgress || 0;
      
      // If student has saved overall progress, use it; otherwise calculate
      if (!student.overallProgress || student.overallProgress === 0) {
        const subjectProgressValues = Array.from(mergedProgress.values()).map(s => s.progress);
        overallProgress = subjectProgressValues.length > 0
          ? Math.round(subjectProgressValues.reduce((sum, p) => sum + p, 0) / subjectProgressValues.length)
          : 0;
      }
      
      // Calculate learning progress (content completion) separately
      let learningProgress = 0;
      if (studentBoard && subjectsList.length > 0) {
        try {
          // Get total content for all student's subjects
          const allContentIds = [];
          for (const subject of subjectsList) {
            const subjectId = subject._id ? subject._id.toString() : subject.toString();
            const contentIds = await Content.find({
              subject: subjectId,
              board: studentBoard.toUpperCase(),
              isActive: true,
              isExclusive: true
            }).select('_id');
            allContentIds.push(...contentIds.map(c => c._id));
          }
          
          if (allContentIds.length > 0) {
            const completedContent = await UserProgress.countDocuments({
              userId: student._id,
              contentId: { $in: allContentIds },
              completed: true
            });
            learningProgress = Math.round((completedContent / allContentIds.length) * 100);
          }
        } catch (error) {
          console.error(`Error calculating learning progress for student ${student._id}:`, error);
        }
      }
      
      // Ensure all performance metrics are calculated from database
      const performanceData = {
        recentExamTitle: perf.recentExam?.examTitle || null,
        recentMarks: perf.recentMarks || null,
        recentPercentage: perf.recentPercentage || null,
        // Exams taken - from database exam results
        totalExams: perf.totalExams || 0,
        averageMarks: perf.averageMarks ? Math.round(perf.averageMarks * 100) / 100 : 0,
        // Average score - calculated from all exam percentages in database
        averagePercentage: perf.averagePercentage !== null && perf.averagePercentage !== undefined
          ? Math.round(perf.averagePercentage * 100) / 100
          : null,
        // Overall progress - calculated from exam and learning path progress in database
        overallProgress: overallProgress || 0,
        // Learning progress - content completion progress from database
        learningProgress: learningProgress || 0,
        // Daily average watch time - calculated from UserProgress records in database
        dailyAverageWatchTime: dailyAverageWatchTime || 0
      };
      
      return {
        ...student.toObject(),
        performance: performanceData
      };
    }));
    
    res.json({ success: true, data: studentsWithPerformance });
  } catch (error) {
    console.error('Get students performance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch students performance' });
  }
});

router.get('/students/:studentId/performance', async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacherId = req.teacherId;
    
    // Get teacher's assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    // Verify student is in teacher's assigned classes AND assigned to the same admin as the teacher
    const student = await User.findOne({ 
      _id: studentId,
      role: 'student',
      classNumber: { $in: teacher.assignedClassIds || [] },
      assignedAdmin: teacher.adminId  // Filter by teacher's admin
    });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not assigned to this teacher' });
    }

    // Import ExamResult model
    const ExamResult = (await import('../../models/ExamResult.js')).default;

    // Get student's exam results (using userId, not studentId)
    const examResults = await ExamResult.find({ userId: studentId }).sort({ completedAt: -1 });
    
    res.json({ success: true, data: examResults });
  } catch (error) {
    console.error('Get student performance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch student performance' });
  }
});


router.post('/students/progress-ai-insights', async (req, res) => {
  try {
    const { summary } = req.body || {};
    if (!summary || typeof summary !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'summary object is required',
      });
    }

    const { buildTeacherProgressInsights } = await import(
      '../../services/teacher-progress-insights-service.js'
    );
    const insights = buildTeacherProgressInsights(summary);

    res.json({ success: true, data: { insights, source: 'analytics' } });
  } catch (error) {
    console.error('Progress insights route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate progress insights',
      error: error.message,
    });
  }
});

// Get class statistics for teacher (for mobile app Class Dashboard)
router.get('/class-stats', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING CLASS STATS ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }

    // Get teacher
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    if (!teacher.assignedClassIds || teacher.assignedClassIds.length === 0) {
      return res.json({ 
        success: true, 
        data: {
          totalStudents: 0,
          totalClasses: 0,
          averageAttendance: 0,
          averagePerformance: 0
        }
      });
    }

    // Get Class model
    const Class = (await import('../../models/Class.js')).default;
    
    // Fetch class documents — scoped to this teacher's school only
    const assignedIds = (teacher.assignedClassIds || []).map(String).filter(Boolean);
    const objectIds = assignedIds.filter(
      (id) => mongoose.Types.ObjectId.isValid(id) && String(id).length === 24
    );
    const classNumbers = assignedIds.filter(
      (id) => !(mongoose.Types.ObjectId.isValid(id) && String(id).length === 24)
    );
    const classOr = [];
    if (objectIds.length) classOr.push({ _id: { $in: objectIds } });
    if (classNumbers.length) classOr.push({ classNumber: { $in: classNumbers } });

    const classDocuments =
      classOr.length > 0
        ? await Class.find({
            ...(teacher.adminId ? { assignedAdmin: teacher.adminId } : {}),
            isActive: true,
            $or: classOr,
          })
        : [];

    const classObjectIds = classDocuments.map((c) => c._id);
    const resolvedClassNumbers = [
      ...new Set(
        classDocuments.map((c) => String(c.classNumber || '').trim()).filter(Boolean)
      ),
    ];

    const studentOr = [];
    if (classObjectIds.length) {
      studentOr.push({ assignedClass: { $in: classObjectIds } });
    }
    if (resolvedClassNumbers.length && teacher.adminId) {
      studentOr.push({
        assignedAdmin: teacher.adminId,
        classNumber: { $in: resolvedClassNumbers },
        $or: [{ assignedClass: null }, { assignedClass: { $exists: false } }],
      });
    }

    // Get students for these classes
    const students =
      studentOr.length > 0
        ? await User.find({
            role: 'student',
            ...(teacher.adminId ? { assignedAdmin: teacher.adminId } : {}),
            $or: studentOr,
          })
        : [];

    // Get exam results for performance calculation
    const ExamResult = (await import('../../models/ExamResult.js')).default;
    const examResults = await ExamResult.find({
      userId: { $in: students.map(s => s._id) }
    });

    // Calculate average performance
    let averagePerformance = 0;
    if (examResults.length > 0) {
      const totalPercentage = examResults.reduce((sum, result) => sum + (result.percentage || 0), 0);
      averagePerformance = Math.round(totalPercentage / examResults.length);
    }

    res.json({
      success: true,
      data: {
        totalStudents: students.length,
        totalClasses: classDocuments.length,
        averageAttendance: 85, // Placeholder - implement attendance tracking
        averagePerformance: averagePerformance
      }
    });
  } catch (error) {
    console.error('Get class stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch class stats', error: error.message });
  }
});



export default router;
