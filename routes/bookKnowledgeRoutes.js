import express from 'express';
import multer from 'multer';
import { verifyToken } from '../middleware/auth.js';
import {
  listBooks,
  getBook,
  uploadBook,
  reindexBook,
  removeBook,
  getBookChapters,
  getBookExtractedText,
  getBookGenerationStats,
  listBookChunks,
} from '../controllers/bookKnowledgeController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

router.use(verifyToken);

router.get('/books', listBooks);
router.get('/books/:id', getBook);
router.post('/books/upload', upload.single('file'), uploadBook);
router.post('/books/:id/reindex', reindexBook);
router.delete('/books/:id', removeBook);
router.get('/books/:id/chapters', getBookChapters);
router.get('/books/:id/text', getBookExtractedText);
router.get('/books/:id/stats', getBookGenerationStats);
router.get('/books/:id/chunks', listBookChunks);

export default router;
