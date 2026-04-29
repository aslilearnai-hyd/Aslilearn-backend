import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  generateAndSaveContent,
  getAllGeneratorRecords,
  getSingleGeneratorRecord,
  updateGeneratorRecord,
  deleteGeneratorRecord,
  generatePDF,
} from '../controllers/aiGeneratorController.js';

const router = express.Router();

router.use(verifyToken);

router.post('/generate', generateAndSaveContent);
router.get('/records', getAllGeneratorRecords);
router.get('/records/:id', getSingleGeneratorRecord);
router.put('/records/:id', updateGeneratorRecord);
router.delete('/records/:id', deleteGeneratorRecord);
router.get('/pdf/:id', generatePDF);

export default router;
