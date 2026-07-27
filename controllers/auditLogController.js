import AuditLog from '../models/AuditLog.js';

/**
 * Super-admin: list / filter durable audit logs.
 * GET /api/super-admin/audit-logs?page=1&limit=50&action=&actor=&q=&from=&to=
 */
export async function listAuditLogs(req, res) {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.action) {
      filter.action = { $regex: String(req.query.action).trim(), $options: 'i' };
    }
    if (req.query.actor) {
      const a = String(req.query.actor).trim();
      filter.$or = [
        { 'actor.email': { $regex: a, $options: 'i' } },
        { 'actor.name': { $regex: a, $options: 'i' } },
        { 'actor.id': a },
        { 'actor.role': { $regex: a, $options: 'i' } },
      ];
    }
    if (req.query.q) {
      const q = String(req.query.q).trim();
      filter.$or = [
        ...(filter.$or || []),
        { summary: { $regex: q, $options: 'i' } },
        { path: { $regex: q, $options: 'i' } },
        { action: { $regex: q, $options: 'i' } },
        { 'target.label': { $regex: q, $options: 'i' } },
        { 'target.email': { $regex: q, $options: 'i' } },
        { 'target.id': q },
        { requestId: q },
      ];
    }
    if (req.query.from || req.query.to) {
      filter.at = {};
      if (req.query.from) {
        const fromRaw = String(req.query.from).trim();
        filter.at.$gte =
          fromRaw.length <= 10
            ? new Date(`${fromRaw}T00:00:00.000`)
            : new Date(fromRaw);
      }
      if (req.query.to) {
        const toRaw = String(req.query.to).trim();
        // Date-only "to" should include the full calendar day
        filter.at.$lte =
          toRaw.length <= 10
            ? new Date(`${toRaw}T23:59:59.999`)
            : new Date(toRaw);
      }
    }
    if (req.query.method) {
      filter.method = String(req.query.method).toUpperCase();
    }
    if (req.query.status) {
      const s = parseInt(String(req.query.status), 10);
      if (Number.isFinite(s)) filter.statusCode = s;
    }

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        items,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load audit logs',
    });
  }
}
