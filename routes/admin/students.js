import express from 'express';
import multer from 'multer';
import User from '../../models/User.js';
import {
  verifyDataOwnership,
  addAdminIdToBody,
} from '../../middleware/auth.js';
import {
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentAnalytics,
  assignSubjectsToStudent,
  assignClassToStudent,
  uploadStudentsCsv,
} from '../../controllers/adminController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/students', getStudents);
router.get('/students/analytics', getStudentAnalytics);
router.post('/students', addAdminIdToBody, createStudent);
router.put('/students/:id', verifyDataOwnership(User), updateStudent);
router.delete('/students/:id', verifyDataOwnership(User), deleteStudent);
router.post('/students/:studentId/assign-subjects', assignSubjectsToStudent);
router.post('/students/:studentId/assign-class', assignClassToStudent);
router.post('/students/upload', upload.single('file'), uploadStudentsCsv);

export default router;
