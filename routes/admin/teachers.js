import express from 'express';
import multer from 'multer';
import Teacher from '../../models/Teacher.js';
import {
  verifyDataOwnership,
  addAdminIdToBody,
} from '../../middleware/auth.js';
import {
  getTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  bulkDeleteTeachers,
  assignSubjects,
  assignClasses,
  uploadTeachersCsv,
} from '../../controllers/adminController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/teachers', getTeachers);
router.post('/teachers', addAdminIdToBody, createTeacher);
router.post('/teachers/bulk-delete', bulkDeleteTeachers);
router.post('/teachers/upload', upload.single('file'), uploadTeachersCsv);
router.put('/teachers/:id', verifyDataOwnership(Teacher), updateTeacher);
router.delete('/teachers/:id', verifyDataOwnership(Teacher), deleteTeacher);
router.post('/teachers/:teacherId/assign-subjects', assignSubjects);
router.post('/teachers/:teacherId/assign-classes', assignClasses);

export default router;
