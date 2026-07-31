import express from 'express';
import {
  getViewableExams,
  getExamDetails,
  getStudentExamResults,
  getExamPerformanceAnalytics,
} from '../../controllers/adminExamViewController.js';

const router = express.Router();

router.get('/exams/viewable', getViewableExams);
router.get('/exams/:examId/view', getExamDetails);
router.get('/exam-results', getStudentExamResults);
router.get('/exams/:examId/analytics', getExamPerformanceAnalytics);

export default router;
