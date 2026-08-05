import VidyaControlQueryLog from '../models/VidyaControlQueryLog.js';
import { runDynamicAiQuery } from './vidya-ai-control/ai-query-engine.js';

function compactControlSnapshot(facts) {
  if (!facts || typeof facts !== 'object') return null;
  try {
    const slim = { ...facts };
    if (Array.isArray(slim.rows)) {
      slim.rows = slim.rows.slice(0, 25).map((row) => {
        if (!row || typeof row !== 'object') return row;
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          if (['password', 'refreshToken', 'otp', 'otpHash', 'pin'].includes(k)) continue;
          if (v instanceof Date) out[k] = v.toISOString();
          else if (v && typeof v === 'object' && v._id) out[k] = String(v._id);
          else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            // keep small plain objects only
            const keys = Object.keys(v);
            if (keys.length <= 6) out[k] = v;
          } else out[k] = v;
        }
        return out;
      });
    }
    if (slim.filter && typeof slim.filter === 'object') {
      slim.filter = JSON.parse(
        JSON.stringify(slim.filter, (_k, v) => {
          if (v instanceof Date) return v.toISOString();
          if (v && typeof v === 'object' && v._bsontype === 'ObjectID') return String(v);
          return v;
        }),
      );
    }
    const raw = JSON.stringify(slim);
    if (raw.length > 80000) {
      return {
        mode: slim.mode,
        module: slim.module,
        operation: slim.operation,
        count: slim.count,
        totalReturned: slim.totalReturned,
        truncated: true,
        note: 'Snapshot truncated for storage size.',
      };
    }
    return JSON.parse(raw);
  } catch {
    return { note: 'Snapshot unavailable' };
  }
}

async function safeWriteControlLog(payload) {
  try {
    return await VidyaControlQueryLog.create({
      ...payload,
      dataSnapshot: compactControlSnapshot(payload.dataSnapshot),
    });
  } catch (err) {
    console.warn('[VidyaControl] log write failed:', err?.message || err);
    try {
      return await VidyaControlQueryLog.create({
        ...payload,
        dataSnapshot: { note: 'Snapshot omitted due to write error' },
        error: String(payload.error || err?.message || '').slice(0, 500),
      });
    } catch {
      return { _id: '' };
    }
  }
}

/**
 * Vidya AI Control Panel — Gemini classifies intent; MongoDB produces facts.
 *
 * @param {{
 *  userMessage: string,
 *  viewerUserId: string,
 *  viewerRole: string,
 *  conversationHistory?: Array<{ role: string, content: string }>,
 *  requestIp?: string,
 *  userAgent?: string,
 * }} opts
 */
export async function handleControlAssistantTurn({
  userMessage,
  viewerUserId,
  viewerRole,
  conversationHistory = [],
  requestIp = '',
  userAgent = '',
}) {
  const started = Date.now();
  const jwtRole = String(viewerRole || '').toLowerCase();
  const allowedRoles = ['admin', 'super-admin'];
  if (!allowedRoles.includes(jwtRole)) {
    const e = new Error('Vidya AI Control is limited to administrators.');
    e.statusCode = 403;
    throw e;
  }

  const prompt = String(userMessage || '').trim();
  if (!prompt) {
    const e = new Error('Message is required');
    e.statusCode = 400;
    throw e;
  }

  let dynamic;
  try {
    dynamic = await runDynamicAiQuery({
      userMessage: prompt,
      history: conversationHistory,
      viewerRole: jwtRole,
      viewerUserId,
    });
  } catch (err) {
    const log = await safeWriteControlLog({
      adminUserId: viewerUserId,
      adminRole: jwtRole,
      prompt,
      promptPreview: prompt.slice(0, 180),
      intentJson: null,
      auditQuery: '--',
      dataSnapshot: { error: String(err?.message || '') },
      responseText: '',
      responsePreview: '',
      latencyMs: Date.now() - started,
      success: false,
      error: String(err?.message || 'dynamic_query_failed'),
      requestIp: String(requestIp || '').slice(0, 64),
      userAgent: String(userAgent || '').slice(0, 200),
    });
    const msg = String(err?.message || '');
    const quotaHit = /quota|resource_exhausted|429/i.test(msg);
    const e = new Error(
      quotaHit
        ? 'Gemini quota reached temporarily. Retrying shortly should work.'
        : 'Unable to process your request dynamically right now.',
    );
    e.statusCode = quotaHit ? 503 : 500;
    e.logId = log._id;
    throw e;
  }

  if (!dynamic.ok) {
    const log = await safeWriteControlLog({
      adminUserId: viewerUserId,
      adminRole: jwtRole,
      prompt,
      promptPreview: prompt.slice(0, 180),
      intentJson: dynamic.plan || null,
      auditQuery: dynamic.auditQuery || '--',
      dataSnapshot: { error: dynamic.error || '' },
      responseText: '',
      responsePreview: '',
      latencyMs: Date.now() - started,
      success: false,
      error: String(dynamic.error || ''),
      requestIp: String(requestIp || '').slice(0, 64),
      userAgent: String(userAgent || '').slice(0, 200),
    });
    const e = new Error(dynamic.error || 'Query failed.');
    e.statusCode = 400;
    e.logId = log._id;
    throw e;
  }

  const facts = dynamic.facts && typeof dynamic.facts === 'object' ? dynamic.facts : {};
  let answerText = String(dynamic.message || '').trim();
  if (!answerText) {
    // Never return an empty bubble to the admin UI.
    if (facts?.operation === 'count' && typeof facts.count === 'number') {
      answerText = `There are exactly ${facts.count} matching records.`;
    } else if (facts?.operation === 'list' && Array.isArray(facts.rows)) {
      answerText = facts.rows.length
        ? `Found exactly ${facts.rows.length} matching records.`
        : 'I could not find matching records in the database.';
    } else {
      answerText = 'I could not find matching records in the database.';
    }
  }

  const log = await safeWriteControlLog({
    adminUserId: viewerUserId,
    adminRole: jwtRole,
    prompt,
    promptPreview: prompt.slice(0, 180),
    intentJson: dynamic.plan || null,
    auditQuery: dynamic.auditQuery || '--',
    dataSnapshot: facts,
    responseText: answerText,
    responsePreview: answerText.slice(0, 480),
    latencyMs: Date.now() - started,
    success: true,
    error: '',
    requestIp: String(requestIp || '').slice(0, 64),
    userAgent: String(userAgent || '').slice(0, 200),
  });

  return {
    success: true,
    message: answerText,
    logId: String(log._id || ''),
    groundedFacts: facts,
    auditQuery: dynamic.auditQuery,
    latencyMs: Date.now() - started,
  };
}

/**
 * Recent control-panel conversation for this administrator.
 */
export async function listRecentControlLogs(userId, { limit = 40 } = {}) {
  const cap = Math.min(100, Math.max(1, Number(limit) || 40));
  return VidyaControlQueryLog.find({ adminUserId: userId })
    .sort({ createdAt: -1 })
    .limit(cap)
    .select('prompt responseText auditQuery intentJson latencyMs createdAt success')
    .lean();
}

export async function clearControlLogs(userId) {
  const res = await VidyaControlQueryLog.deleteMany({ adminUserId: String(userId) });
  return Number(res?.deletedCount || 0);
}
