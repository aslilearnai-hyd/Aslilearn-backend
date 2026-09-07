// Conversation supplies lookup parameters only. Authorization stays in the DB layer.
export function resolveClassRosterQuestion(question, history = []) {
  const q = String(question || '').trim();
  const classPattern = /\b(?:class\s*)?(\d{1,2})\s*[-–]?\s*([a-z])\b|\bclass\s*(\d{1,2})\b/i;
  const bareClass = /^(?:class\s*)?\d{1,2}\s*[-–]?\s*[a-z]\??$/i.test(q);
  const rosterRequest = /\b(students?|names?|roster)\b/i.test(q) && /\b(list|show|all|names?|roster|who)\b/i.test(q);
  if (!bareClass && !rosterRequest) return q;
  if (!bareClass && classPattern.test(q)) return q;
  if (bareClass) return `List students in class ${q.replace(/^class\s*/i, '').replace(/\?$/, '')}`;
  for (const turn of [...history].reverse()) {
    if (turn?.role !== 'user') continue;
    const text = String(turn.content || '');
    const match = text.match(classPattern);
    if (match) return `${q} in class ${match[3] || `${match[1]}${match[2].toUpperCase()}`}`;
    // Do not carry a class across a change of topic.
    if (!/\b(students?|names?|roster|list|show)\b/i.test(text)) break;
  }
  return q;
}

export function formatClassRoster(question, facts) {
  const scopeOk = facts?.scope === 'class_group' || facts?.mode === 'class_detail';
  if (!scopeOk || !/\b(list|names?|roster|who|show|students?\s+from|students?\s+in|students?\s+of)\b/i.test(question)) {
    return null;
  }
  if (facts.error) return facts.error;
  if (!Array.isArray(facts.students)) return null;
  const rows = /\bactive\b/i.test(question) ? facts.students.filter(s => s.isActive) : facts.students;
  const label = facts.classLabel || 'This class';
  return rows.length
    ? `**${label} — ${rows.length} students:**\n\n${rows.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}`
    : `No matching students were found in ${label} within your access.`;
}
