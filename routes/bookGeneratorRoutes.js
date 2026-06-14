import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  listBookBasedTools,
  generateBookBatch,
  getBookGeneratorJobStatus,
  releaseBookGeneratorLock,
  listBookGeneratorRecords,
  getBookGeneratorRecord,
  updateBookGeneratorRecord,
  bulkDeleteBookGeneratorRecords,
  deleteAllBookGeneratorRecords,
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
router.get('/records/:id', getBookGeneratorRecord);
router.put('/records/:id', updateBookGeneratorRecord);
router.post('/records/bulk-delete', bulkDeleteBookGeneratorRecords);
router.delete('/records/all', deleteAllBookGeneratorRecords);
router.delete('/records/:id', deleteBookGeneratorRecord);

export default router;
