import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  listBookBasedTools,
  generateBookBatch,
  getBookGeneratorJobStatus,
  releaseBookGeneratorLock,
  listBookGeneratorRecords,
  listBooksForGenerator,
  deleteBookGeneratorRecord,
} from '../controllers/bookGeneratorController.js';

const router = express.Router();
router.use(verifyToken);

router.get('/tools', listBookBasedTools);
router.get('/books', listBooksForGenerator);
router.post('/generate-batch', generateBookBatch);
router.get('/jobs/:jobId', getBookGeneratorJobStatus);
router.post('/release-lock', releaseBookGeneratorLock);
router.get('/records', listBookGeneratorRecords);
router.delete('/records/:id', deleteBookGeneratorRecord);

export default router;
