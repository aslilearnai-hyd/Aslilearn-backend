import fs from 'fs';
import {
  startOfIsoWeek,
  endOfIsoWeek,
  formatPeriodLabel,
  buildSchoolImpactSnapshot,
  buildAllSchoolImpactSnapshots,
  buildDigestsForSchool,
  listSchoolSnapshots,
  getSchoolSnapshot,
  getLatestDigestForUser,
} from '../services/impact-report-service.js';
import { generateSchoolImpactPDF } from '../services/school-impact-pdf.js';
import { deliverPendingDigestsForWeek } from '../services/digest-email-service.js';
import { runWeeklyImpactJob } from '../services/weekly-impact-scheduler.js';
import WeeklyDigest from '../models/WeeklyDigest.js';

function parseWeek(q) {
  if (!q) return startOfIsoWeek(new Date());
  const d = new Date(q);
  if (Number.isNaN(d.getTime())) return startOfIsoWeek(new Date());
  return startOfIsoWeek(d);
}

/** Super Admin: list all school snapshots for a week */
export async function listImpactReports(req, res) {
  try {
    const weekStart = parseWeek(req.query.weekStart);
    let rows = await listSchoolSnapshots(weekStart);
    if (!rows.length && req.query.build === '1') {
      await buildAllSchoolImpactSnapshots(weekStart, 'manual');
      rows = await listSchoolSnapshots(weekStart);
    }
    return res.json({
      success: true,
      data: {
        weekStart,
        weekEnd: endOfIsoWeek(weekStart),
        periodLabel: formatPeriodLabel(weekStart, endOfIsoWeek(weekStart)),
        schools: rows,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to list impact reports' });
  }
}

/** Super Admin: one school snapshot */
export async function getImpactReportForAdmin(req, res) {
  try {
    const weekStart = parseWeek(req.query.weekStart);
    const snap = await getSchoolSnapshot(req.params.adminId, weekStart);
    return res.json({ success: true, data: snap });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load impact report' });
  }
}

/** Super Admin: force run weekly job */
export async function runImpactReportsJob(req, res) {
  try {
    const force = req.body?.force !== false;
    const weekStart = parseWeek(req.body?.weekStart || req.query?.weekStart);
    if (req.body?.weekStart || req.query?.weekStart) {
      const schoolResults = await buildAllSchoolImpactSnapshots(weekStart, 'manual');
      const { default: User } = await import('../models/User.js');
      const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
      let digests = 0;
      for (const a of admins) {
        digests += (await buildDigestsForSchool(a._id, weekStart)).length;
      }
      const email = await deliverPendingDigestsForWeek(weekStart);
      return res.json({ success: true, data: { weekStart, schools: schoolResults, digests, email } });
    }
    const result = await runWeeklyImpactJob({ source: 'manual', force });
    return res.json({ success: result.ok, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to run impact job' });
  }
}

/** Super Admin / School Admin: download PDF */
export async function downloadImpactReportPdf(req, res) {
  try {
    const adminId = req.params.adminId || req.user?._id || req.user?.userId;
    const weekStart = parseWeek(req.query.weekStart);
    const snap = await getSchoolSnapshot(adminId, weekStart);
    if (!snap) {
      return res.status(404).json({ success: false, message: 'Snapshot not found' });
    }
    const { filepath, filename } = await generateSchoolImpactPDF(snap);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(filepath);
    stream.pipe(res);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to generate PDF' });
  }
}

/** School Admin: own school report */
export async function getMySchoolImpactReport(req, res) {
  try {
    const adminId = req.user?._id || req.user?.userId;
    const weekStart = parseWeek(req.query.weekStart);
    const snap = await getSchoolSnapshot(adminId, weekStart);
    return res.json({ success: true, data: snap });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load school impact report' });
  }
}

export async function downloadMySchoolImpactPdf(req, res) {
  req.params.adminId = String(req.user?._id || req.user?.userId);
  return downloadImpactReportPdf(req, res);
}

/** Teacher / Student: latest weekly digest */
export async function getMyWeeklyDigest(req, res) {
  try {
    const userId = req.user?._id || req.user?.userId;
    let digest = await getLatestDigestForUser(userId);
    if (!digest && req.query.build === '1') {
      const weekStart = parseWeek(req.query.weekStart);
      const role = req.user?.role;
      const adminId = req.user?.assignedAdmin;
      if (adminId && (role === 'teacher' || role === 'student')) {
        await buildDigestsForSchool(adminId, weekStart);
        digest = await getLatestDigestForUser(userId);
      }
    }
    if (digest && !digest.readAt) {
      await WeeklyDigest.updateOne({ _id: digest._id }, { $set: { readAt: new Date() } });
    }
    return res.json({ success: true, data: digest });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load digest' });
  }
}
