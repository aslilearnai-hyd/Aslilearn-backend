import express from 'express';
import {
  verifyToken,
  verifySuperAdmin,
  authorizeRoles,
  canAccessAdminData,
} from '../middleware/auth.js';
import {
  getAIAnalytics,
  getStudentPredictions,
  getContentRecommendations,
  getLearningPatterns,
  getRiskAssessment,
  generatePersonalizedContent,
  predictExamOutcome,
  optimizeLearningPath
} from '../controllers/aiController.js';
import {
  getDetailedAIAnalytics,
  getAdminDetailedAnalytics
} from '../controllers/detailedAIController.js';

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// AI Analytics Routes - Super Admin only
router.get('/analytics', verifySuperAdmin, getAIAnalytics);
router.get('/detailed-analytics', verifySuperAdmin, getDetailedAIAnalytics);

// Admin-specific AI Analytics Routes — tenant-scoped via canAccessAdminData
router.get('/admins/:adminId/predictions', authorizeRoles('super-admin', 'admin'), canAccessAdminData, getStudentPredictions);
router.get('/admins/:adminId/recommendations', authorizeRoles('super-admin', 'admin'), canAccessAdminData, getContentRecommendations);
router.get('/admins/:adminId/patterns', authorizeRoles('super-admin', 'admin'), canAccessAdminData, getLearningPatterns);
router.get('/admins/:adminId/risk-assessment', authorizeRoles('super-admin', 'admin'), canAccessAdminData, getRiskAssessment);
router.get('/admins/:adminId/detailed-analytics', authorizeRoles('super-admin', 'admin'), canAccessAdminData, getAdminDetailedAnalytics);

// Personalized AI Features
router.post('/personalized-content', authorizeRoles('super-admin', 'admin'), generatePersonalizedContent);
router.get('/predict-exam/:examId/:studentId', authorizeRoles('super-admin', 'admin'), predictExamOutcome);
router.get('/optimize-path/:studentId', authorizeRoles('super-admin', 'admin'), optimizeLearningPath);

export default router;
