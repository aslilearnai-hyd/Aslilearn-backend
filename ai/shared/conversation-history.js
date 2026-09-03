// Keep the conversation, not just its last few turns. Very long conversations
// retain an explicitly shortened excerpt of every turn within a cost bound.
export function prepareConversationHistory(history = [], budget = 120000) {
  const rows = (Array.isArray(history) ? history : [])
    .filter(m => m && ['user', 'assistant'].includes(m.role))
    .map(m => ({ role: m.role, content: String(m.content || '').trim() }))
    .filter(m => m.content);
  if (rows.reduce((n, m) => n + m.content.length, 0) <= budget) return rows;
  const limit = Math.max(1, Math.floor(budget / Math.max(1, rows.length)));
  return rows.map(m => ({ ...m, content: m.content.length > limit
    ? `${m.content.slice(0, Math.floor(limit * 0.7))}\n[Earlier message shortened]\n${m.content.slice(-Math.max(1, Math.floor(limit * 0.3)))}` : m.content }));
}
