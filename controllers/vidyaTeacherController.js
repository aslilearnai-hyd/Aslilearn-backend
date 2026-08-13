import VidyaCallLog from '../models/VidyaCallLog.js';
import { runHybridTeacherVidyaChat } from '../services/vidya-teacher/teacher-hybrid-chat-controller.js';

export async function postTeacherMentorChat(req, res) {
  const started = Date.now();
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teachers only' });
    }
    const question = String(req.body?.message || '').trim();
    if (!question) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }

    const { consumeTrialVidyaChat, trialLimitHttpPayload } = await import(
      '../utils/trialUsageLimits.js'
    );
    let trialUsage = null;
    try {
      const consumed = await consumeTrialVidyaChat(req.userId, 'teacher');
      trialUsage = consumed.usage;
    } catch (limitErr) {
      return res.status(limitErr.statusCode || 429).json(trialLimitHttpPayload(limitErr));
    }

    const result = await runHybridTeacherVidyaChat({
      viewerUserId: req.userId,
      question,
    });

    await VidyaCallLog.create({
      userId: String(req.userId),
      role: 'teacher',
      route: 'analysis',
      prompt: question,
      response: result.message,
      provider: 'gemini',
      success: true,
      latencyMs: Date.now() - started,
      safetyBlocked: false,
      safetyDetails: {
        groundingStatus: result.groundingStatus,
        scope: 'teacher-mentor',
        mode: result.mode || 'application',
        intent: result.intent || null,
      },
      requestIp: req.ip || '',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    }).catch(() => null);

    return res.json({
      success: true,
      message: result.message,
      mode: result.mode || 'application',
      intent: result.intent || null,
      groundingStatus: result.groundingStatus,
      facts: result.facts,
      trialUsage,
    });
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    return res.status(status).json({
      success: false,
      message: err?.message || 'Failed to process teacher mentor chat.',
    });
  }
}
