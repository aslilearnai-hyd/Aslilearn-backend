import VidyaControlQueryLog from '../models/VidyaControlQueryLog.js';
import { runDynamicAiQuery } from './vidya-ai-control/ai-query-engine.js';

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
    const log = await VidyaControlQueryLog.create({
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
        : 'Unable to process your request dynamically right now.'
    );
    e.statusCode = quotaHit ? 503 : 500;
    e.logId = log._id;
    throw e;
  }

  if (!dynamic.ok) {
    const log = await VidyaControlQueryLog.create({
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
  const answerText = String(dynamic.message || '').trim();

  const log = await VidyaControlQueryLog.create({
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
    logId: String(log._id),
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
