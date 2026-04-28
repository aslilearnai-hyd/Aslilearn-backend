import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  listClasses,
  listSubjects,
  listTopics,
  listSubtopics,
} from '../controllers/curriculumController.js';

const router = express.Router();

const allowCurriculumRoles = (req, res, next) => {
  const role = req.user?.role;
  if (role === 'teacher' || role === 'student' || role === 'admin' || role === 'super-admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied for this role.' });
};

router.use(verifyToken);
router.use(allowCurriculumRoles);

router.get('/classes', listClasses);
router.get('/subjects', listSubjects);
router.get('/topics', listTopics);
router.get('/subtopics', listSubtopics);

export default router;
