import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  listBookBasedTools,
  generateBookBatch,
  listBookGeneratorRecords,
  listBooksForGenerator,
  deleteBookGeneratorRecord,
} from '../controllers/bookGeneratorController.js';

const router = express.Router();
router.use(verifyToken);

router.get('/tools', listBookBasedTools);
router.get('/books', listBooksForGenerator);
router.post('/generate-batch', generateBookBatch);
router.get('/records', listBookGeneratorRecords);
router.delete('/records/:id', deleteBookGeneratorRecord);

export default router;
