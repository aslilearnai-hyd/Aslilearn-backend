import express from 'express';
import mongoose from 'mongoose';
import { verifyToken } from '../middleware/auth.js';

import coreRoutes from './student/core.js';
import videosRoutes from './student/videos.js';
import assessmentsRoutes from './student/assessments.js';
import examsListRoutes from './student/examsList.js';
import contentLibraryRoutes from './student/contentLibrary.js';
import iqRankRoutes from './student/iqRank.js';
import homeworkRoutes from './student/homework.js';
import examResultsRoutes from './student/examResults.js';
import rankingsRemarksRoutes from './student/rankingsRemarks.js';
import quizzesRoutes from './student/quizzes.js';
import progressRoutes from './student/progress.js';
import aiToolRoutes from './student/aiTool.js';
import riskDiaryRoutes from './student/riskDiary.js';
import contentProxyRoutes from './student/contentProxy.js';
import calendarRoutes from './student/calendar.js';
import omrResultsRoutes from './student/omrResults.js';

const router = express.Router();

// iframe / window.open GETs cannot send Authorization.
// ONLY content-preview and content-download may accept ?token= (short-lived JWT).
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const pathOnly = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '') || '';
  const isProxyRoute =
    pathOnly.endsWith('/content-preview') || pathOnly.endsWith('/content-download');
  if (!isProxyRoute) return next();
  const hdr = req.headers.authorization || req.get('Authorization');
  const raw = req.query.token;
  const tokenFromQuery =
    typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '';
  if (!hdr && tokenFromQuery) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }
  next();
});

router.use(verifyToken);

router.use((req, res, next) => {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      message: 'User ID not found. Please log in again.',
    });
  }
  if (!mongoose.Types.ObjectId.isValid(req.userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format. Please log in again.',
    });
  }
  const pathOnly = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '') || '';
  const isSharedContentProxy =
    pathOnly.endsWith('/content-preview') || pathOnly.endsWith('/content-download');
  if (req.user && req.user.role !== 'student' && !isSharedContentProxy) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Student privileges required.',
    });
  }
  next();
});

router.use(coreRoutes);
router.use(videosRoutes);
router.use(assessmentsRoutes);
router.use(examsListRoutes);
router.use(contentLibraryRoutes);
router.use(iqRankRoutes);
router.use(homeworkRoutes);
router.use(examResultsRoutes);
router.use(rankingsRemarksRoutes);
router.use(quizzesRoutes);
router.use(progressRoutes);
router.use(aiToolRoutes);
router.use(riskDiaryRoutes);
router.use(contentProxyRoutes);
router.use(calendarRoutes);
router.use(omrResultsRoutes);

export default router;
