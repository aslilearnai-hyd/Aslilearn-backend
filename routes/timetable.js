import express from 'express';
import multer from 'multer';
import {
  verifyToken,
  authorizeRoles,
} from '../middleware/auth.js';
import {
  createTimetableEntry,
  getTimetableEntries,
  getTimetableById,
  updateTimetableEntry,
  patchTimetableStatus,
  deleteTimetableEntry,
  bulkDeleteTimetable,
  bulkDeleteByGroup,
  importTimetableCSV,
  validateTimetableCSV,
  downloadCSVTemplate,
  exportTimetableCSV,
  copyPreviousWeek,
} from '../controllers/timetableController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(verifyToken);

router.post('/', authorizeRoles('admin'), createTimetableEntry);
router.put('/:id', authorizeRoles('admin'), updateTimetableEntry);
router.patch('/:id', authorizeRoles('admin', 'teacher'), patchTimetableStatus);
router.post('/bulk-delete', authorizeRoles('admin', 'super-admin'), bulkDeleteTimetable);
router.delete('/group/:groupId', authorizeRoles('admin', 'super-admin'), bulkDeleteByGroup);
router.delete('/:id', authorizeRoles('admin', 'super-admin'), deleteTimetableEntry);
router.post('/import/csv', authorizeRoles('admin'), upload.single('file'), importTimetableCSV);
router.post('/validate/csv', authorizeRoles('admin'), upload.single('file'), validateTimetableCSV);
router.get('/template/csv', authorizeRoles('admin'), downloadCSVTemplate);
router.post('/copy-week', authorizeRoles('admin'), copyPreviousWeek);
router.get('/export/csv', authorizeRoles('admin'), exportTimetableCSV);

router.get('/', getTimetableEntries);
router.get('/:id', getTimetableById);

export default router;
