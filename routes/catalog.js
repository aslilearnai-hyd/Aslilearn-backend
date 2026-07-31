import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { join, extname } from 'path';
import fs from 'fs';
import { verifyToken, verifySuperAdmin, verifyAdmin } from '../middleware/auth.js';
import { extractAuthToken } from '../utils/auth-cookie.js';
import {
  generateProvisionalPassword,
  resolveTenantAdminId,
  SAFE_USER_UPDATE_FIELDS,
} from '../utils/secure-tenant.js';
import { cleanCsvCell } from '../utils/csv-encoding.js';
import { spreadsheetBufferToCsv } from '../utils/spreadsheet-to-csv.js';
import User from '../models/User.js';
import Video from '../models/Video.js';
import LearningPath from '../models/LearningPath.js';
import Assessment from '../models/Assessment.js';
import Teacher from '../models/Teacher.js';
import Subject from '../models/Subject.js';
import Exam from '../models/Exam.js';
import Question from '../models/Question.js';
import Event from '../models/Event.js';
import { getBackendRoot } from '../bootstrap/env.js';

const router = express.Router();
const __dirname = getBackendRoot();

const requireAuth = (req, res, next) => {
  const token = extractAuthToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    req.userId = decoded.userId || decoded.id || decoded._id;
    req.isAuthenticated = () => true;
    next();
  } catch {
    res.status(401).json({ message: 'Not authenticated' });
  }
};
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 'admin') return next();
  res.status(403).json({ message: 'Admin access required' });
};

const buildSafeAppendQuestionPipeline = (questionId) => [
  { $set: { questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] } } },
  { $set: { questions: { $concatArrays: ['$questions', [questionId]] } } },
];
const buildSafeRemoveQuestionPipeline = (questionId) => [
  { $set: { questions: { $cond: [{ $isArray: '$questions' }, '$questions', []] } } },
  {
    $set: {
      questions: {
        $filter: {
          input: '$questions',
          as: 'existingQuestionId',
          cond: { $ne: ['$$existingQuestionId', questionId] },
        },
      },
    },
  },
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ok =
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime === 'text/csv' ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ok) return cb(null, true);
    return cb(new Error('Unsupported file type'), false);
  },
});

// Public catalog routes — authenticated + tenant-scoped (no cross-school scrape)
router.get('/api/videos', requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;
    const uid = String(req.user?.userId || req.user?.id || '');
    const filter = { isPublished: true };
    if (role === 'admin') {
      filter.adminId = uid;
    } else if (role === 'teacher') {
      filter.$or = [{ createdBy: uid }, { adminId: uid }];
    } else if (role === 'student') {
      const student = await User.findById(uid).select('assignedAdmin').lean();
      if (student?.assignedAdmin) filter.adminId = student.assignedAdmin;
      else filter.adminId = { $exists: false }; // individual: only unscoped published if any
    } else if (role !== 'super-admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const videos = await Video.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(videos);
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

router.get('/api/learning-paths', requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;
    const uid = String(req.user?.userId || req.user?.id || '');
    const filter = { isPublished: true };
    if (role === 'super-admin') {
      // unrestricted
    } else if (role === 'admin') {
      filter.adminId = uid;
    } else if (role === 'student') {
      const student = await User.findById(uid).select('assignedAdmin').lean();
      if (student?.assignedAdmin) filter.adminId = student.assignedAdmin;
      else return res.json([]);
    } else if (role === 'teacher') {
      const teacher = await Teacher.findById(uid).select('adminId').lean();
      if (teacher?.adminId) filter.adminId = teacher.adminId;
      else return res.json([]);
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }
    const paths = await LearningPath.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json(paths);
  } catch (error) {
    console.error('Failed to fetch learning paths:', error);
    res.status(500).json({ message: 'Failed to fetch learning paths' });
  }
});

router.get('/api/assessments', requireAuth, async (req, res) => {
  try {
    const role = req.user?.role;
    const uid = String(req.user?.userId || req.user?.id || '');
    const filter = { isPublished: true };
    if (role === 'admin') {
      filter.adminId = uid;
    } else if (role === 'student') {
      const student = await User.findById(uid).select('assignedAdmin assignedClass').lean();
      if (student?.assignedAdmin) filter.adminId = student.assignedAdmin;
      if (student?.assignedClass) filter.assignedClasses = student.assignedClass;
    } else if (role === 'teacher') {
      filter.$or = [{ createdBy: uid }, { adminId: uid }];
    } else if (role !== 'super-admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const assessments = await Assessment.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(assessments);
  } catch (error) {
    console.error('Failed to fetch assessments:', error);
    res.status(500).json({ message: 'Failed to fetch assessments' });
  }
});

// Admin routes (protected) — fail closed in every environment

router.get('/api/quizzes', async (req, res) => {
  try {
    const quizzes = await Assessment.find({ isPublished: true }).sort({ createdAt: -1 });
    res.json(quizzes);
  } catch (error) {
    console.error('Failed to fetch quizzes:', error);
    res.status(500).json({ message: 'Failed to fetch quizzes' });
  }
});

router.post('/api/quizzes', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

router.put('/api/quizzes/:id', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

router.delete('/api/quizzes/:id', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

router.patch('/api/quizzes/:id/toggle', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

// Admin Videos endpoints — duplicate unauthenticated GET removed (auth'd handler registered above)
router.get('/api/videos/legacy-public', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'Unauthenticated catalog listing has been removed. Use GET /api/videos with a Bearer token.',
  });
});

router.post('/api/videos', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

router.put('/api/videos/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const role = req.user?.role;
    const uid = String(req.userId || req.user?.userId || req.user?.id || '');
    const filter = { _id: id };
    if (role === 'teacher') {
      filter.createdBy = uid;
    } else if (role === 'admin') {
      filter.adminId = uid;
    } else if (role !== 'super-admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const allowed = ['title', 'description', 'videoUrl', 'thumbnailUrl', 'duration', 'difficulty', 'isPublished', 'youtubeUrl'];
    const updateData = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) updateData[key] = req.body[key];
    }
    const video = await Video.findOneAndUpdate(filter, updateData, { new: true });
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    res.json(video);
  } catch (error) {
    console.error('Failed to update video:', error);
    res.status(500).json({ message: 'Failed to update video' });
  }
});

router.delete('/api/videos/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const role = req.user?.role;
    const uid = String(req.userId || req.user?.userId || req.user?.id || '');
    const filter = { _id: id };
    if (role === 'teacher') {
      filter.createdBy = uid;
    } else if (role === 'admin') {
      filter.adminId = uid;
    } else if (role !== 'super-admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    const deleted = await Video.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ message: 'Video not found' });
    }
    res.json({ message: 'Video deleted successfully', success: true });
  } catch (error) {
    console.error('Failed to delete video:', error);
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

router.patch('/api/videos/:id/toggle', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const uid = String(req.userId || req.user?.userId || req.user?.id || '');
    const filter =
      req.user?.role === 'super-admin'
        ? { _id: id }
        : { _id: id, adminId: uid };
    const video = await Video.findOneAndUpdate(filter, { isPublished: isActive }, { new: true });
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    res.json(video);
  } catch (error) {
    console.error('Failed to toggle video status:', error);
    res.status(500).json({ message: 'Failed to toggle video status' });
  }
});

// Duplicate assessments GET route removed - handled above

router.post('/api/assessments', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { title, description, subject, type, difficulty, duration, totalMarks, passingMarks, questions, driveLink, isDriveQuiz } = req.body;
    const uid = String(req.userId || req.user?.userId || req.user?.id || '');
    
    const difficultyMap = {
      'easy': 'beginner',
      'medium': 'intermediate', 
      'hard': 'advanced'
    };
    
    const newAssessment = new Assessment({
      title,
      description,
      subjectIds: subject ? [subject] : [],
      type,
      difficulty: difficultyMap[difficulty] || 'beginner',
      duration,
      totalPoints: totalMarks,
      passingPoints: passingMarks,
      questions: [],
      driveLink: driveLink || '',
      isDriveQuiz: isDriveQuiz || false,
      isPublished: true,
      createdBy: uid || null,
      adminId: req.user?.role === 'admin' ? uid : null,
    });

    await newAssessment.save();
    res.status(201).json(newAssessment);
  } catch (error) {
    console.error('Failed to create assessment:', error);
    res.status(500).json({ message: 'Failed to create assessment' });
  }
});

router.put('/api/assessments/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const uid = String(req.userId || req.user?.userId || req.user?.id || '');
    const filter =
      req.user?.role === 'super-admin'
        ? { _id: id }
        : { _id: id, adminId: uid };
    const allowed = [
      'title', 'description', 'type', 'difficulty', 'duration',
      'totalPoints', 'passingPoints', 'driveLink', 'isDriveQuiz', 'isPublished', 'subjectIds',
    ];
    const updateData = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) updateData[key] = req.body[key];
    }
    // Map legacy field names from older clients
    if (req.body.totalMarks != null) updateData.totalPoints = req.body.totalMarks;
    if (req.body.passingMarks != null) updateData.passingPoints = req.body.passingMarks;
    if (req.body.subject) updateData.subjectIds = [req.body.subject];

    const assessment = await Assessment.findOneAndUpdate(filter, updateData, { new: true });
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    
    res.json(assessment);
  } catch (error) {
    console.error('Failed to update assessment:', error);
    res.status(500).json({ message: 'Failed to update assessment' });
  }
});

router.delete('/api/assessments/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const uid = String(req.userId || req.user?.userId || req.user?.id || '');
    const filter =
      req.user?.role === 'super-admin'
        ? { _id: id }
        : { _id: id, adminId: uid };
    const deleted = await Assessment.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    res.json({ message: 'Assessment deleted successfully' });
  } catch (error) {
    console.error('Failed to delete assessment:', error);
    res.status(500).json({ message: 'Failed to delete assessment' });
  }
});

router.patch('/api/assessments/:id/toggle', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const uid = String(req.userId || req.user?.userId || req.user?.id || '');
    const filter =
      req.user?.role === 'super-admin'
        ? { _id: id }
        : { _id: id, adminId: uid };
    
    const assessment = await Assessment.findOneAndUpdate(filter, { isPublished: isActive }, { new: true });
    if (!assessment) {
      return res.status(404).json({ message: 'Assessment not found' });
    }
    
    res.json(assessment);
  } catch (error) {
    console.error('Failed to toggle assessment status:', error);
    res.status(500).json({ message: 'Failed to toggle assessment status' });
  }
});

// Error handling middleware
// NOTE: the global error handler used to live here, but ~30 route
// registrations follow this point in the file. Express only routes errors to
// error middleware declared AFTER the routes that throw, so those 30 routes
// were bypassing it entirely and falling through to Express's default handler.
// It now sits immediately before app.listen — see the bottom of this file.

// Vidya AI endpoints have moved to routes/vidya.js
// (mounted via router.use('/api', vidyaRoutes) earlier in this file).
// The old in-memory Map / unauthenticated handlers have been removed.

// Subject Management endpoints
router.get('/api/subjects', async (req, res) => {
  try {
    const subjects = await Subject.find({ isActive: true })
      .populate('videos', 'title duration')
      .populate('quizzes', 'question')
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 });
    
    if (!subjects || subjects.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No subjects found in database',
        subjects: []
      });
    }
    
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subjects' });
  }
});

router.get('/api/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid subject ID format' });
    }
    
    const subject = await Subject.findById(id);
    
    if (!subject) {
      return res.status(404).json({ 
        success: false, 
        message: 'Subject not found in database' 
      });
    }
    
    res.json({ success: true, subject });
  } catch (error) {
    console.error('Error fetching subject:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch subject',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/api/subjects', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

router.put('/api/subjects/:id', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

router.delete('/api/subjects/:id', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

// Add video to subject
router.post('/api/subjects/:id/videos', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});

// Add quiz to subject
router.post('/api/subjects/:id/quizzes', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This legacy unauthenticated endpoint has been permanently removed. Use the authenticated admin/teacher APIs.',
  });
});
// Get all admins with enhanced data


export default router;
