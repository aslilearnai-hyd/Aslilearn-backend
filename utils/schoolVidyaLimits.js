/**
 * School-level Vidya AI usage policy (Super Admin School Management).
 * unlimited = no quotas; limited = per-user daily caps for chatbot and/or tools (24h rolling).
 */

export const SCHOOL_VIDYA_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SCHOOL_VIDYA_CHAT_PER_DAY = 10;
export const DEFAULT_SCHOOL_VIDYA_GENERATIONS_PER_DAY = 10;

export function normalizeSchoolVidyaPolicy(raw = {}) {
  const mode =
    String(raw.vidyaUsageMode || raw.mode || 'unlimited').toLowerCase() === 'limited'
      ? 'limited'
      : 'unlimited';

  let limitChatbot = Boolean(raw.vidyaLimitChatbot ?? raw.limitChatbot);
  let limitTools = Boolean(raw.vidyaLimitTools ?? raw.limitTools);

  const chatPerDay = Math.max(
    1,
    Math.min(
      10000,
      Math.floor(
        Number(raw.vidyaChatPerDay ?? raw.chatPerDay) || DEFAULT_SCHOOL_VIDYA_CHAT_PER_DAY
      )
    )
  );
  const generationsPerDay = Math.max(
    1,
    Math.min(
      10000,
      Math.floor(
        Number(raw.vidyaGenerationsPerDay ?? raw.generationsPerDay) ||
          DEFAULT_SCHOOL_VIDYA_GENERATIONS_PER_DAY
      )
    )
  );

  if (mode === 'limited' && !limitChatbot && !limitTools) {
    return {
      vidyaUsageMode: 'unlimited',
      vidyaLimitChatbot: false,
      vidyaLimitTools: false,
      vidyaChatPerDay: chatPerDay,
      vidyaGenerationsPerDay: generationsPerDay,
      applies: false,
    };
  }

  return {
    vidyaUsageMode: mode,
    vidyaLimitChatbot: mode === 'limited' ? limitChatbot : false,
    vidyaLimitTools: mode === 'limited' ? limitTools : false,
    vidyaChatPerDay: chatPerDay,
    vidyaGenerationsPerDay: generationsPerDay,
    applies: mode === 'limited',
  };
}

/** Fields to persist on admin User / School from request body. */
export function schoolVidyaPolicyFromBody(body = {}) {
  return normalizeSchoolVidyaPolicy(body);
}
