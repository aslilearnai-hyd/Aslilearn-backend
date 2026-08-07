import express from 'express';
import {
  getClasses,
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  createClass,
  updateClass,
  assignSubjectsToClassById,
  deleteAllClasses,
  deleteClass,
  promoteClasses,
  assignSubjectsToClass,
} from '../../controllers/adminController.js';

const router = express.Router();

router.get('/classes', getClasses);
router.get('/subjects', getSubjects);
router.post('/subjects', createSubject);
router.put('/subjects/:id', updateSubject);
router.delete('/subjects/:id', deleteSubject);
router.post('/classes', createClass);
router.put('/classes/:id', updateClass);
router.post('/classes/by-id/:classId/assign-subjects', assignSubjectsToClassById);
router.delete('/classes/delete-all', deleteAllClasses);
router.delete('/classes/:id', deleteClass);
router.post('/classes/promote', promoteClasses);
router.post('/classes/:classNumber/assign-subjects', assignSubjectsToClass);

export default router;
