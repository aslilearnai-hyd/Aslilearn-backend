import express from 'express';
import { getStudentOmrResults } from '../../controllers/omrResultsController.js';

const router = express.Router();

router.get('/omr-results', getStudentOmrResults);

export default router;
