/** Standard Vidya API response shapes (web + mobile parity). */

export function chatSessionsResponse(sessions) {
  return {
    success: true,
    sessions: Array.isArray(sessions) ? sessions : [],
  };
}

export function chatSessionResponse(session) {
  return {
    success: true,
    session: session || null,
  };
}

export function vidyaErrorResponse(message, statusCode = 500) {
  return {
    success: false,
    message: String(message || 'Request failed'),
    statusCode,
  };
}
