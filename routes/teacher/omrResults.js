import express from 'express';
import { getTeacherOmrResults } from '../../controllers/omrResultsController.js';

const router = express.Router();

router.get('/omr-results', getTeacherOmrResults);

export default router;
