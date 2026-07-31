import express from 'express';
import {
  verifyToken,
  verifyTeacher,
  extractTeacherId
} from '../middleware/auth.js';

import aiSharedRoutes from './teacher/aiShared.js';
import coreRoutes from './teacher/core.js';
import calendarRoutes from './teacher/calendar.js';
import classesRoutes from './teacher/classes.js';
import aiRoutes from './teacher/ai.js';
import contentRoutes from './teacher/content.js';
import homeworkRoutes from './teacher/homework.js';
import attendanceRoutes from './teacher/attendance.js';
import remarksRoutes from './teacher/remarks.js';
import studentsRoutes from './teacher/students.js';
import quizzesRoutes from './teacher/quizzes.js';
import workDiaryRoutes from './teacher/workDiary.js';

const router = express.Router();

/*
 * REMOVED (July 2026): unauthenticated debug routes (POST /test-video, GET /test).
 * Auth order must stay: verifyToken → shared AI (teacher|student) → verifyTeacher.
 */
router.use(verifyToken);

// Dual-access AI + weekly digest (before teacher-only gate)
router.use(aiSharedRoutes);

router.use(verifyTeacher);
router.use(extractTeacherId);

router.use(coreRoutes);
router.use(calendarRoutes);
router.use(classesRoutes);
router.use(aiRoutes);
router.use(contentRoutes);
router.use(homeworkRoutes);
router.use(attendanceRoutes);
// Static /students/remarks before parametric /students/:id/* in students router
router.use(remarksRoutes);
router.use(studentsRoutes);
router.use(quizzesRoutes);
router.use(workDiaryRoutes);

export default router;
