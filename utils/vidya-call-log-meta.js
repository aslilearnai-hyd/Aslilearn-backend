/** Derive VidyaCallLog provider/success from mentor chat hybrid results. */
export function mentorCallLogMeta(result) {
  const grounding = String(result?.groundingStatus || '').toLowerCase();
  let provider = 'local';
  let success = true;

  if (grounding === 'ai_context_aware' || grounding === 'general_knowledge') {
    provider = 'gemini';
  } else if (grounding === 'ai_error') {
    provider = 'fallback';
    success = false;
  } else if (grounding === 'application_fallback') {
    provider = 'fallback';
  }

  return { provider, success };
}

export async function writeMentorCallLog({
  VidyaCallLog,
  req,
  started,
  question,
  result,
  scope,
}) {
  const { provider, success } = mentorCallLogMeta(result);
  await VidyaCallLog.create({
    userId: String(req.userId),
    role: String(req.user?.role || ''),
    route: 'analysis',
    prompt: question,
    response: result?.message || '',
    provider,
    success,
    latencyMs: Date.now() - started,
    safetyBlocked: false,
    safetyDetails: {
      groundingStatus: result?.groundingStatus,
      scope,
      mode: result?.mode || 'application',
      intent: result?.intent || null,
    },
    requestIp: req.ip || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  }).catch(() => null);
}

export async function writeFailedMentorCallLog({
  VidyaCallLog,
  req,
  started,
  question,
  scope,
  error,
}) {
  await VidyaCallLog.create({
    userId: String(req.userId),
    role: String(req.user?.role || ''),
    route: 'analysis',
    prompt: question,
    response: '',
    provider: 'unknown',
    success: false,
    error: String(error?.message || error || '').slice(0, 500),
    latencyMs: Date.now() - started,
    safetyBlocked: false,
    safetyDetails: { scope },
    requestIp: req.ip || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  }).catch(() => null);
}
