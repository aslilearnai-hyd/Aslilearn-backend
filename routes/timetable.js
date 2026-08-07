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
  remapPeriodTimes,
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
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      mime === 'text/csv' ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/csv' ||
      mime === 'text/plain' ||
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls');
    if (ok) return cb(null, true);
    return cb(new Error('Only CSV/Excel timetable files are allowed'), false);
  },
});

router.use(verifyToken);

router.post('/', authorizeRoles('admin'), createTimetableEntry);
router.put('/:id', authorizeRoles('admin'), updateTimetableEntry);
router.patch('/:id', authorizeRoles('admin', 'teacher'), patchTimetableStatus);
router.post('/bulk-delete', authorizeRoles('admin', 'super-admin'), bulkDeleteTimetable);
router.post('/remap-periods', authorizeRoles('admin'), remapPeriodTimes);
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
