import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import { applyCorsHeaders, corsPreflightHandler, longRunningRequest } from '../middleware/cors-headers.js';
import {
  listBookBasedTools,
  generateBookBatch,
  listBookGeneratorRecords,
  listBooksForGenerator,
  deleteBookGeneratorRecord,
  deleteAllBookGeneratorRecords,
  bulkDeleteBookGeneratorRecords,
  releaseBookGeneratorLock,
} from '../controllers/bookGeneratorController.js';

const router = express.Router();

router.use((req, res, next) => {
  applyCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return corsPreflightHandler(req, res);
  next();
});

router.use(verifyToken);

router.get('/tools', listBookBasedTools);
router.get('/books', listBooksForGenerator);
router.post('/generate-batch', longRunningRequest, generateBookBatch);
router.post('/release-lock', releaseBookGeneratorLock);
router.get('/records', listBookGeneratorRecords);
router.delete('/records/all', deleteAllBookGeneratorRecords);
router.post('/records/bulk-delete', bulkDeleteBookGeneratorRecords);
router.delete('/records/:id', deleteBookGeneratorRecord);

export default router;
