import express from 'express';
import RiskAnalysisReport from '../../models/RiskAnalysisReport.js';
import {
  getAdminDashboardStats,
  getAnalytics,
  getAdminReports,
  getSchoolSettings,
  updateSchoolSettings,
  getTeacherDashboardStats,
} from '../../controllers/adminController.js';
import {
  getMySchoolImpactReport,
  downloadMySchoolImpactPdf,
} from '../../controllers/impactReportController.js';

const router = express.Router();

router.get('/dashboard/stats', getAdminDashboardStats);
router.get('/analytics', getAnalytics);
router.get('/reports', getAdminReports);
router.get('/impact-report', getMySchoolImpactReport);
router.get('/impact-report/pdf', downloadMySchoolImpactPdf);
router.get('/school-settings', getSchoolSettings);
router.put('/school-settings', updateSchoolSettings);
router.get('/risk-summary', async (req, res) => {
  try {
    const adminId = req.adminId;
    const filter = {
      'analysisData.riskLevel': { $regex: /^high$/i },
    };
    if (adminId) {
      filter.adminId = adminId;
    }

    const reports = await RiskAnalysisReport.find(filter)
      .sort({ sentAt: -1 })
      .limit(50)
      .populate('studentId', 'fullName name email classNumber')
      .lean();

    const students = reports.slice(0, 10).map((r) => {
      const scoreRaw = r.analysisData?.riskScore;
      const riskScorePct =
        scoreRaw != null && Number.isFinite(Number(scoreRaw))
          ? Math.round(Number(scoreRaw) <= 1 ? Number(scoreRaw) * 100 : Number(scoreRaw))
          : null;
      return {
        _id: r._id,
        studentId: r.studentId,
        riskScore: riskScorePct,
      };
    });

    res.json({ success: true, students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/teacher/dashboard', getTeacherDashboardStats);

export default router;
