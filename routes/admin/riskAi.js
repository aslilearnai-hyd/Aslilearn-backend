import express from 'express';
import { verifyAdmin } from '../../middleware/auth.js';
import {
  analyzeStudentRisk,
  downloadAndSendRiskAnalysisPDF,
  downloadRiskAnalysisPDF,
} from '../../controllers/adminController.js';

const router = express.Router();

router.post('/ai/student-risk-analysis', verifyAdmin, analyzeStudentRisk);
router.post('/ai/student-risk-analysis/download-send', verifyAdmin, downloadAndSendRiskAnalysisPDF);
router.get('/reports/download/:reportId', verifyAdmin, downloadRiskAnalysisPDF);

export default router;
