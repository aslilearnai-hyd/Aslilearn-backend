import {
  handleControlAssistantTurn,
  listRecentControlLogs,
  clearControlLogs,
} from '../services/vidya-ai-control-service.js';

const requestMeta = (req) => ({
  requestIp: req.ip || req.headers['x-forwarded-for'] || '',
  userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
});

export async function postVidyaControlQuery(req, res) {
  const jwtRole = String(req.user?.role || '').toLowerCase();
  if (!['super-admin', 'admin'].includes(jwtRole)) {
    return res.status(403).json({ success: false, message: 'Vidya AI Control requires admin privileges.' });
  }

  try {
    const body = req.body || {};
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history = rawHistory
      .slice(-24)
      .map((h) => ({
        role: String(h.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
        content: String(h.content || '').slice(0, 6000),
      }))
      .filter((h) => h.content.trim());

    const result = await handleControlAssistantTurn({
      userMessage: body.message,
      viewerUserId: req.userId,
      viewerRole: req.user.role,
      conversationHistory: history,
      ...requestMeta(req),
    });

    res.json({
      success: true,
      message: result.message,
      logId: result.logId,
      groundedFacts: result.groundedFacts,
      auditQuery: result.auditQuery,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    res.status(status).json({
      success: false,
      message: err?.message || 'Control assistant failed.',
      logId: err?.logId ? String(err.logId) : '',
    });
  }
}

export async function getVidyaControlHistory(req, res) {
  const jwtRole = String(req.user?.role || '').toLowerCase();
  if (!['super-admin', 'admin'].includes(jwtRole)) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  try {
    const limit = Number(req.query.limit) || 30;
    const rows = await listRecentControlLogs(req.userId, { limit });
    const chronological = [...rows].reverse();

    /** @type {Array<{ prompt: string, responseText: string, createdAt?: Date, auditQuery?: string }>} */
    const items = chronological.map((r) => ({
      prompt: String(r.prompt || ''),
      responseText: String(r.responseText || ''),
      auditQuery: String(r.auditQuery || ''),
      createdAt: r.createdAt,
      success: r.success,
      latencyMs: r.latencyMs,
    }));

    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, message: err?.message || 'Failed to load history' });
  }
}

export async function deleteVidyaControlHistory(req, res) {
  const jwtRole = String(req.user?.role || '').toLowerCase();
  if (!['super-admin', 'admin'].includes(jwtRole)) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  try {
    const deleted = await clearControlLogs(req.userId);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, message: err?.message || 'Failed to clear history' });
  }
}
