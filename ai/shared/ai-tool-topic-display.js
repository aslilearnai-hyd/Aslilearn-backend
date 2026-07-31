export function normalizeTopicText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function buildDisplayTopicName(label, topicName) {
  const safeLabel = normalizeTopicText(label);
  const safeTopicName = normalizeTopicText(topicName);
  if (!safeLabel) return safeTopicName;
  const prefix = `${safeLabel} - `;
  return safeTopicName.startsWith(prefix) ? safeTopicName : `${prefix}${safeTopicName}`;
}
