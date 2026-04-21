import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  listClasses,
  listSubjects,
  listTopics,
  listSubtopics,
} from '../controllers/curriculumController.js';

const router = express.Router();

const allowTeacherOrStudent = (req, res, next) => {
  const role = req.user?.role;
  if (role === 'teacher' || role === 'student') return next();
  return res.status(403).json({ success: false, message: 'Access denied. Teacher or Student required.' });
};

router.use(verifyToken);
router.use(allowTeacherOrStudent);

router.get('/classes', listClasses);
router.get('/subjects', listSubjects);
router.get('/topics', listTopics);
router.get('/subtopics', listSubtopics);

export default router;
