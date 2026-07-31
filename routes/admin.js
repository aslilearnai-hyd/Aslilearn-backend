import express from 'express';
import {
  verifyToken,
  verifyAdmin,
  extractAdminId,
} from '../middleware/auth.js';

import dashboardRoutes from './admin/dashboard.js';
import studentsRoutes from './admin/students.js';
import classesSubjectsRoutes from './admin/classesSubjects.js';
import teachersRoutes from './admin/teachers.js';
import mediaRoutes from './admin/media.js';
import assessmentsRoutes from './admin/assessments.js';
import examsRoutes from './admin/exams.js';
import contentRoutes from './admin/content.js';
import riskAiRoutes from './admin/riskAi.js';
import workDiaryRoutes from './admin/workDiary.js';
import eventsRoutes from './admin/events.js';
import learningPathsRoutes from './admin/learningPaths.js';
import usersRoutes from './admin/users.js';

const router = express.Router();

router.use(verifyToken);
router.use(verifyAdmin);
router.use(extractAdminId);

router.use(dashboardRoutes);
router.use(studentsRoutes);
router.use(classesSubjectsRoutes);
router.use(teachersRoutes);
router.use(mediaRoutes);
router.use(assessmentsRoutes);
router.use(examsRoutes);
router.use(contentRoutes);
router.use(riskAiRoutes);
router.use(workDiaryRoutes);
router.use(eventsRoutes);
router.use(learningPathsRoutes);
router.use(usersRoutes);

export default router;
