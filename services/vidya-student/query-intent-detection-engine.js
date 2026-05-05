const APP_HINTS = [
  'my marks',
  'my score',
  'my exams',
  'my attendance',
  'my progress',
  'my rank',
  'my dashboard',
  'my weak',
  'my performance',
];

const GENERAL_HINTS = ['what is', 'explain', 'define', 'how does', 'difference between'];

export function detectQueryIntent(question) {
  const q = String(question || '').toLowerCase();
  const app = APP_HINTS.some((s) => q.includes(s)) || /\bmy\b|\bmine\b/.test(q);
  const general = GENERAL_HINTS.some((s) => q.includes(s));
  if (app && general) return { type: 'hybrid', confidence: 0.8 };
  if (app) return { type: 'application', confidence: 0.9 };
  if (general) return { type: 'general', confidence: 0.85 };
  return { type: 'uncertain', confidence: 0.4 };
}

export function buildUncertainClarificationMessage() {
  return 'Are you asking about your personal academic performance or a general subject explanation?';
}

