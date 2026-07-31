import express from 'express';
import Assessment from '../../models/Assessment.js';
import {
  verifyDataOwnership,
  addAdminIdToBody,
} from '../../middleware/auth.js';
import {
  getAssessments,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  getQuizzes,
  createQuiz,
} from '../../controllers/adminController.js';

const router = express.Router();

router.get('/assessments', getAssessments);
router.post('/assessments', addAdminIdToBody, createAssessment);
router.put('/assessments/:id', verifyDataOwnership(Assessment), updateAssessment);
router.delete('/assessments/:id', verifyDataOwnership(Assessment), deleteAssessment);
router.get('/quizzes', getQuizzes);
router.post('/quizzes', addAdminIdToBody, createQuiz);

export default router;
