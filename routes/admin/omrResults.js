import express from 'express';
import {
  listOmrBatches,
  getOmrBatch,
  getOmrAdminSummary,
} from '../../controllers/omrResultsController.js';

const router = express.Router();

router.get('/omr-results/summary', getOmrAdminSummary);
router.get('/omr-results/batches', listOmrBatches);
router.get('/omr-results/batches/:id', getOmrBatch);

export default router;
