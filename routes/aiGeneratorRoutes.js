import express from 'express';
import { verifyToken, verifySuperAdmin } from '../middleware/auth.js';
import { aiHeavyLimiter } from '../middleware/rate-limit.js';
import {
  generateAndSaveContent,
  generateBatchContent,
  releaseAiGeneratorLock,
  getAllGeneratorRecords,
  getSingleGeneratorRecord,
  updateGeneratorRecord,
  deleteGeneratorRecord,
  bulkDeleteGeneratorRecords,
  deleteAllGeneratorRecords,
  generatePDF,
  getManagedTopicTaxonomy,
  getDuplicateAudit,
  getAiGeneratorAnalytics,
  getTopicSaturation,
} from '../controllers/aiGeneratorController.js';
import { generateSixSectionPreview } from '../controllers/sixSectionController.js';

const router = express.Router();

router.use(verifyToken);
// Teachers/students need read-only taxonomy for AI tool dropdowns (controller enforces roles).
router.get('/topic-taxonomy', getManagedTopicTaxonomy);
router.use(verifySuperAdmin);

// Heavy limiter ONLY on Gemini/generate paths — not on list/view/poll (those burned
// the 10/min quota and caused "Records load failed" right after a successful batch).
router.post('/generate', aiHeavyLimiter, generateAndSaveContent);
router.post('/generate-batch', aiHeavyLimiter, generateBatchContent);
router.post('/six-section', aiHeavyLimiter, generateSixSectionPreview);

router.post('/release-lock', releaseAiGeneratorLock);
router.get('/audit/duplicates', getDuplicateAudit);
router.get('/audit/analytics', getAiGeneratorAnalytics);
router.get('/audit/saturation', getTopicSaturation);
router.get('/records', getAllGeneratorRecords);
router.get('/records/:id', getSingleGeneratorRecord);
router.put('/records/:id', updateGeneratorRecord);
router.post('/records/bulk-delete', bulkDeleteGeneratorRecords);
router.delete('/records/all', deleteAllGeneratorRecords);
router.delete('/records/:id', deleteGeneratorRecord);
router.get('/pdf/:id', generatePDF);

export default router;
