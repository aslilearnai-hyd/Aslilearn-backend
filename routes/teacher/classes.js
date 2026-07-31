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


router.get('/classes', getTeacherClassesHandler);
router.get('/my-classes', getTeacherClassesHandler);

router.get('/subjects', async (req, res) => {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER SUBJECTS ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Get teacher with populated subjects (active only)
    const teacher = await Teacher.findById(teacherId).populate({
      path: 'subjects',
      match: { isActive: true },
      select: '_id name description code board',
    });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    let subjectIds = getExplicitTeacherSubjectObjectIds(teacher);
    // Individual (B2C) teachers have interestedSubjects + class, not admin-assigned Subject refs
    if (subjectIds.length === 0 && teacher.isIndividualAccount) {
      const { resolveIndividualCatalogSubjectIds } = await import(
        '../../utils/individualCatalogSubjects.js'
      );
      subjectIds = await resolveIndividualCatalogSubjectIds(teacher);
      console.log(
        `Individual teacher catalog subjects resolved: ${subjectIds.length} (class=${teacher.classNumber})`,
      );
    }
    if (subjectIds.length === 0) {
      console.log('Teacher has no subjects on profile');
      return res.json({ success: true, data: [] });
    }

    // Get Subject model to ensure we have full subject data
    const Subject = (await import('../../models/Subject.js')).default;

    // Fetch subject details from database
    const subjects = await Subject.find({
      _id: { $in: subjectIds },
      isActive: true
    })
    .sort({ name: 1 })
    .select('_id name description code board');
    
    console.log(`Found ${subjects.length} subjects for teacher`);

    const groupedSubjects = new Map();
    for (const subj of subjects) {
      const key = subjectGroupKey(subj.name);
      const id = subj._id.toString();
      if (!groupedSubjects.has(key)) {
        groupedSubjects.set(key, { subj, ids: [id] });
        continue;
      }
      groupedSubjects.get(key).ids.push(id);
    }

    res.json({
      success: true,
      data: Array.from(groupedSubjects.values()).map(({ subj, ids }) => ({
        _id: ids[0],
        id: ids[0],
        name: extractPlainSubjectNameForContent(subj.name) || subj.name,
        description: subj.description || '',
        code: subj.code || '',
        board: subj.board || '',
        mergedSubjectIds: ids,
      })),
    });
  } catch (error) {
    console.error('Error fetching teacher subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects', error: error.message });
  }
});

// Get subjects for a specific class (shows teacher's assigned subjects)
// This route must be defined before other routes that might match
router.get('/classes/:classNumber/subjects', async (req, res) => {
  try {
    const { classNumber } = req.params;
    // Decode the classNumber in case it was URL encoded
    const decodedClassNumber = decodeURIComponent(classNumber);
    const teacherId = req.teacherId;
    
    console.log('=== FETCHING SUBJECTS FOR CLASS ===');
    console.log('Raw classNumber from params:', classNumber);
    console.log('Decoded classNumber:', decodedClassNumber);
    console.log('Teacher ID:', teacherId);
    
    // Validate classNumber
    if (!decodedClassNumber || decodedClassNumber.trim() === '' || decodedClassNumber === '-9') {
      console.error('Invalid classNumber:', decodedClassNumber);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid class number provided' 
      });
    }
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Get teacher with populated subjects
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    console.log('Teacher found:', teacher.email);
    console.log('Teacher subjects (raw):', teacher.subjects);
    console.log('Teacher subjects length:', teacher.subjects?.length || 0);
    
    // Get Class model to verify teacher is assigned to this class
    const Class = (await import('../../models/Class.js')).default;
    
    // Find classes with this classNumber that the teacher is assigned to
    const allClassesWithNumber = await Class.find({
      classNumber: decodedClassNumber,
      isActive: true
    })
    .select('_id classNumber section');
    
    // Filter to only classes the teacher is assigned to
    const classes = allClassesWithNumber.filter(classDoc => {
      const classIdStr = classDoc._id.toString();
      const classNumberStr = classDoc.classNumber;
      
      return (teacher.assignedClassIds || []).some(assignedId => {
        const assignedIdStr = String(assignedId);
        // Match by ObjectId
        if (assignedIdStr === classIdStr) {
          return true;
        }
        // Match by classNumber (for backward compatibility)
        if (assignedIdStr === classNumberStr) {
          return true;
        }
        return false;
      });
    });
    
    console.log(`Found ${classes.length} classes with classNumber ${decodedClassNumber} assigned to teacher`);
    
    if (classes.length === 0) {
      console.log('No classes found for teacher');
      return res.json({
        success: true,
        subjects: [],
        message: 'No classes found for this class number'
      });
    }

    // Subjects actually on these class rows (matches what students see / prep content)
    const subjectIdSet = new Set();
    for (const classDoc of classes) {
      const full = await Class.findById(classDoc._id)
        .select('assignedSubjects')
        .populate('assignedSubjects', '_id');
      for (const sub of full?.assignedSubjects || []) {
        const raw = sub._id != null ? sub._id : sub;
        const str = raw.toString();
        if (mongoose.Types.ObjectId.isValid(str)) subjectIdSet.add(str);
      }
    }

    let subjectIds = [...subjectIdSet].map((id) => new mongoose.Types.ObjectId(id));
    const explicitIds = getExplicitTeacherSubjectObjectIds(teacher);
    const explicitStr = new Set(explicitIds.map((id) => id.toString()));

    // Only subjects both on the class and explicitly assigned on the teacher profile
    if (subjectIds.length > 0) {
      subjectIds = subjectIds.filter((id) => explicitStr.has(id.toString()));
    } else {
      // Class row has no subjects — fall back to teacher profile subjects only
      subjectIds = explicitIds;
    }

    if (subjectIds.length === 0) {
      console.log('No subjects for this class or teacher scope');
      return res.json({
        success: true,
        subjects: [],
        message: 'No subjects on this class yet. Please contact your administrator.',
      });
    }

    // Get Subject model to fetch full details
    const Subject = (await import('../../models/Subject.js')).default;

    console.log('Subject IDs to fetch for class:', subjectIds);

    // Fetch subject details from database
    const subjects = await Subject.find({
      _id: { $in: subjectIds },
      isActive: true
    })
    .sort({ name: 1 })
    .select('_id name description code board');
    
    console.log(`Fetched ${subjects.length} subjects assigned to teacher`);
    subjects.forEach(subj => {
      console.log(`  - ${subj.name} (${subj._id})`);
    });
    
    if (subjects.length === 0) {
      console.log('Warning: Subject IDs exist but no active subjects found in database');
      return res.json({
        success: true,
        subjects: [],
        message: 'No active subjects found. Please contact your administrator.'
      });
    }
    
    res.json({
      success: true,
      subjects: subjects.map(subj => ({
        _id: subj._id.toString(),
        name: subj.name,
        description: subj.description || '',
        code: subj.code || '',
        board: subj.board || ''
      }))
    });
  } catch (error) {
    console.error('Error fetching subjects for class:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects', error: error.message });
  }
});



export default router;
