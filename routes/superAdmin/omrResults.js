import express from 'express';
import multer from 'multer';
import {
  uploadOmrResults,
  listOmrBatches,
  getOmrBatch,
  assignOmrRows,
  getOmrAdminSummary,
  listOmrClassOptions,
  listOmrStudentsForAssign,
} from '../../controllers/omrResultsController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const ok =
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      mime.includes('csv') ||
      mime.includes('excel') ||
      mime.includes('spreadsheet') ||
      mime === 'text/plain' ||
      mime === 'application/octet-stream';
    if (ok) return cb(null, true);
    return cb(new Error('Only CSV/Excel OMR score files are allowed'), false);
  },
});

router.get('/omr-results/summary', getOmrAdminSummary);
router.get('/omr-results/class-options', listOmrClassOptions);
router.get('/omr-results/students', listOmrStudentsForAssign);
router.get('/omr-results/batches', listOmrBatches);
router.get('/omr-results/batches/:id', getOmrBatch);
router.post('/omr-results/batches/:id/assign', assignOmrRows);
router.post('/omr-results/upload', upload.single('file'), uploadOmrResults);

export default router;
