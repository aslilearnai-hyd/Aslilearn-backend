import VidyaCallLog from '../models/VidyaCallLog.js';
import { handleVidyaTurn, PLANES } from '../services/vidya-orchestrator.js';
import { writeFailedMentorCallLog, writeMentorCallLog } from '../utils/vidya-call-log-meta.js';

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

    const result = await handleVidyaTurn({
      plane: PLANES.MENTOR_TEACHER,
      req,
      body: req.body,
    });

    await writeMentorCallLog({
      VidyaCallLog,
      req,
      started,
      question,
      result,
      scope: 'teacher-mentor',
    });

    import('../utils/user-activity.js')
      .then(({ recordUserPresence }) => recordUserPresence(req.userId))
      .catch(() => null);

    return res.json({
      success: true,
      message: result.message,
      citations: Array.isArray(result.citations) ? result.citations : [],
      mode: result.mode || 'application',
      intent: result.intent || null,
      groundingStatus: result.groundingStatus,
      facts: result.facts,
      trialUsage,
    });
  } catch (err) {
    await writeFailedMentorCallLog({
      VidyaCallLog,
      req,
      started,
      question: String(req.body?.message || '').trim(),
      scope: 'teacher-mentor',
      error: err,
    });
    const status = Number(err?.statusCode) || 500;
    return res.status(status).json({
      success: false,
      message: err?.message || 'Failed to process teacher mentor chat.',
    });
  }
}
