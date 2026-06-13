import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  generateAndSaveContent,
  generateBatchContent,
  getAllGeneratorRecords,
  getSingleGeneratorRecord,
  updateGeneratorRecord,
  deleteGeneratorRecord,
  bulkDeleteGeneratorRecords,
  generatePDF,
  getManagedTopicTaxonomy,
  getDuplicateAudit,
  getAiGeneratorAnalytics,
  getTopicSaturation,
} from '../controllers/aiGeneratorController.js';

const router = express.Router();

router.use(verifyToken);

router.post('/generate', generateAndSaveContent);
router.post('/generate-batch', generateBatchContent);
router.get('/audit/duplicates', getDuplicateAudit);
router.get('/audit/analytics', getAiGeneratorAnalytics);
router.get('/audit/saturation', getTopicSaturation);
router.get('/records', getAllGeneratorRecords);
router.get('/topic-taxonomy', getManagedTopicTaxonomy);
router.get('/records/:id', getSingleGeneratorRecord);
router.put('/records/:id', updateGeneratorRecord);
router.post('/records/bulk-delete', bulkDeleteGeneratorRecords);
router.delete('/records/:id', deleteGeneratorRecord);
router.get('/pdf/:id', generatePDF);

export default router;
