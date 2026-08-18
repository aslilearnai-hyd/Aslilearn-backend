import fs from 'fs';
import {
  startOfIsoWeek,
  resolveImpactPeriod,
  buildAllSchoolImpactSnapshots,
  buildDigestsForSchool,
  listSchoolSnapshots,
  getSchoolSnapshot,
  getSchoolImpactDetail,
  getLatestDigestForUser,
  rebuildStudentWeeklyDigestForUser,
  rebuildTeacherWeeklyDigestForUser,
} from '../services/impact-report-service.js';
import { generateSchoolImpactPDF } from '../services/school-impact-pdf.js';
import { deliverPendingDigestsForWeek } from '../services/digest-email-service.js';
import { runWeeklyImpactJob } from '../services/weekly-impact-scheduler.js';
import WeeklyDigest from '../models/WeeklyDigest.js';

/** Parse weekStart / from / to from query or body. */
function periodFromReq(req) {
  const src = { ...(req.query || {}), ...(req.body || {}) };
  if (src.from || src.to) {
    return resolveImpactPeriod({ from: src.from, to: src.to });
  }
  if (src.weekStart) {
    return resolveImpactPeriod({ weekStart: src.weekStart });
  }
  return resolveImpactPeriod({ weekStart: new Date() });
}

/** Super Admin: list all school snapshots for a week or custom range */
export async function listImpactReports(req, res) {
  try {
    const period = periodFromReq(req);
    const shouldRebuild =
      req.query.build === '1' ||
      req.query.refresh === '1' ||
      String(req.query.live || '').toLowerCase() === 'true';

    // Always rebuild when explicitly requested — stale zero snapshots were sticking
    // because we only rebuilt when the list was empty.
    if (shouldRebuild) {
      await buildAllSchoolImpactSnapshots(period, 'manual');
    }

    let rows = await listSchoolSnapshots(period);

    // If nothing cached yet, build once so the table isn't empty on first open.
    if (!rows.length) {
      await buildAllSchoolImpactSnapshots(period, 'api');
      rows = await listSchoolSnapshots(period);
    }

    return res.json({
      success: true,
      data: {
        weekStart: period.weekStart,
        weekEnd: period.weekEnd,
        periodLabel: period.periodLabel,
        mode: period.mode,
        rebuilt: shouldRebuild,
        schools: rows,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to list impact reports' });
  }
}

/** Super Admin: one school snapshot (+ student-wise detail by default) */
export async function getImpactReportForAdmin(req, res) {
  try {
    const period = periodFromReq(req);
    const detail = String(req.query.detail || '1') !== '0';
    const snap = detail
      ? await getSchoolImpactDetail(req.params.adminId, period)
      : await getSchoolSnapshot(req.params.adminId, period);
    return res.json({ success: true, data: snap });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load impact report' });
  }
}

/** Super Admin: force run weekly / range job */
export async function runImpactReportsJob(req, res) {
  try {
    const force = req.body?.force !== false;
    const hasCustom =
      Boolean(req.body?.weekStart || req.query?.weekStart || req.body?.from || req.body?.to || req.query?.from || req.query?.to);
    if (hasCustom) {
      const period = periodFromReq(req);
      const schoolResults = await buildAllSchoolImpactSnapshots(period, 'manual');
      // Digests remain weekly-keyed; only build when this is a normal ISO week window
      let digests = 0;
      let email = null;
      if (period.mode === 'weekly') {
        const { default: User } = await import('../models/User.js');
        const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
        for (const a of admins) {
          digests += (await buildDigestsForSchool(a._id, period.weekStart)).length;
        }
        email = await deliverPendingDigestsForWeek(period.weekStart);
      }
      return res.json({
        success: true,
        data: { weekStart: period.weekStart, weekEnd: period.weekEnd, periodLabel: period.periodLabel, schools: schoolResults, digests, email },
      });
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
    const period = periodFromReq(req);
    const snap = await getSchoolImpactDetail(adminId, period);
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

/** School Admin: own school report (+ student-wise detail, same as super admin view). */
export async function getMySchoolImpactReport(req, res) {
  try {
    const adminId = req.user?._id || req.user?.userId;
    const period = periodFromReq(req);
    const detail = String(req.query.detail || '1') !== '0';
    const snap = detail
      ? await getSchoolImpactDetail(adminId, period)
      : await getSchoolSnapshot(adminId, period);
    return res.json({ success: true, data: snap });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load school impact report' });
  }
}

export async function downloadMySchoolImpactPdf(req, res) {
  req.params.adminId = String(req.user?._id || req.user?.userId);
  return downloadImpactReportPdf(req, res);
}

/** Teacher / Student: latest weekly digest (always live-rebuild for current week). */
export async function getMyWeeklyDigest(req, res) {
  try {
    const userId = req.userId || req.user?.userId || req.user?.id || req.user?._id;
    const role = req.user?.role;
    const weekStart = startOfIsoWeek(req.query.weekStart ? new Date(req.query.weekStart) : new Date());

    let digest = null;

    if (role === 'student') {
      digest = await rebuildStudentWeeklyDigestForUser(userId, weekStart);
      if (!digest) digest = await getLatestDigestForUser(userId);
    } else if (role === 'teacher') {
      digest = await rebuildTeacherWeeklyDigestForUser(userId, weekStart);
      if (!digest) digest = await getLatestDigestForUser(userId);
    } else {
      digest = await getLatestDigestForUser(userId);
    }

    if (digest && !digest.readAt) {
      await WeeklyDigest.updateOne({ _id: digest._id }, { $set: { readAt: new Date() } });
    }
    return res.json({ success: true, data: digest });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to load digest' });
  }
}
