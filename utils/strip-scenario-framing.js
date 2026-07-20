/**
 * Detect and replace fictional scenario wrappers in AI tool titles / instructions.
 * Exam papers and worksheets should read like NCERT/CBSE classroom material — not adventures.
 */

const SCENARIO_TITLE_RE =
  /\b(?:adventure|journey|quest|expedition|market\s*day|bustling|school\s*(?:science\s*)?fair|festival\s*prep|role[- ]?play|imagine\s+you|exploring\s+.+\s*:\s*|visit\s+to\s+(?:our|the|a)\b|day\s+at\s+the\s+market|neighbourhood\s+walk|community\s+survey)\b/i;

const SCENARIO_INSTRUCTION_RE =
  /\b(?:welcome,?\s+young|embarking\s+on|inspired\s+by|bustling\s+(?:local\s+)?market|imagine\s+(?:you|yourself)|during\s+a\s+(?:visit|market|fair|festival)|set\s+the\s+scene|role[- ]?play|today,?\s+we(?:'re| are)\s+embarking|young\s+scientists)\b/i;

export function looksLikeScenarioTitle(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  return SCENARIO_TITLE_RE.test(t);
}

export function looksLikeScenarioInstructions(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return SCENARIO_INSTRUCTION_RE.test(t);
}

export function directExamPaperTitle(topic, subject, classLabel = '') {
  const t = String(topic || 'Chapter').trim() || 'Chapter';
  const s = String(subject || 'Subject').trim() || 'Subject';
  const cls = String(classLabel || '').trim();
  return cls ? `${t} — ${s} Examination Paper (Class ${cls.replace(/^class\s+/i, '')})` : `${t} — ${s} Examination Paper`;
}

export function directExamInstructions(topic) {
  const t = String(topic || 'the chapter').trim() || 'the chapter';
  return [
    'Read every question carefully before answering.',
    'Attempt all questions. Marks for each question are indicated against it.',
    'Write neat, point-wise answers for short and long questions.',
    `All questions are based on: ${t}.`,
  ].join(' ');
}

export function directWorksheetTitle(topic, subject) {
  const t = String(topic || 'Chapter').trim() || 'Chapter';
  const s = String(subject || 'Worksheet').trim() || 'Worksheet';
  return `${t} — ${s} Worksheet`;
}

export function directWorksheetInstructions(topic) {
  const t = String(topic || 'the chapter').trim() || 'the chapter';
  return `Answer all questions. Show working for numericals. Use correct units and terminology from ${t}.`;
}
