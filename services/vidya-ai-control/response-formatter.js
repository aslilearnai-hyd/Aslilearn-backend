import geminiService from '../gemini-service.js';

const BANNED_APPROX_WORDS = [
  'approximately',
  'approx',
  'around',
  'about',
  'maybe',
  'likely',
  'probably',
  'estimated',
  'estimate',
];

function collectNumericFacts(value, set = new Set()) {
  if (value === null || value === undefined) return set;
  if (typeof value === 'number' && Number.isFinite(value)) {
    set.add(String(value));
    return set;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumericFacts(item, set);
    return set;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectNumericFacts(v, set);
  }
  return set;
}

function extractNumberTokens(text) {
  const matches = String(text || '').match(/\b\d+(?:\.\d+)?\b/g) || [];
  return new Set(matches);
}

function validateDbGroundedResponse({ text, facts, userPrompt }) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, reason: 'empty_response' };
  if (/^\s*\{[\s\S]*\}\s*$/.test(t)) {
    return { ok: false, reason: 'json_like_response' };
  }
  const lower = t.toLowerCase();
  if (BANNED_APPROX_WORDS.some((w) => lower.includes(w))) {
    return { ok: false, reason: 'contains_approximation_language' };
  }

  const allowedNums = collectNumericFacts(facts);
  // allow class numbers appearing in user prompt (e.g. "Class 6")
  const promptNums = extractNumberTokens(userPrompt);
  for (const n of promptNums) allowedNums.add(n);
  const responseNums = extractNumberTokens(t);
  for (const n of responseNums) {
    if (!allowedNums.has(n)) {
      return { ok: false, reason: `unexpected_numeric_token:${n}` };
    }
  }
  return { ok: true };
}

function formatOverviewFallback(facts) {
  const o = facts?.overview && typeof facts.overview === 'object' ? facts.overview : {};
  const label = String(facts?.schoolLabel || 'Your school').trim();
  if (facts?.error && !Object.keys(o).length) {
    return `${facts.error} I could not find matching records in the database.`;
  }
  const lines = [`Reports overview for ${label}:`];
  if (typeof o.students === 'number') lines.push(`Students: ${o.students}.`);
  if (typeof o.studentsActiveLast7Days === 'number') {
    lines.push(`Students active in the last 7 days: ${o.studentsActiveLast7Days}.`);
  }
  if (typeof o.teachers === 'number') lines.push(`Active teachers: ${o.teachers}.`);
  if (typeof o.schoolAdmins === 'number') lines.push(`School admins: ${o.schoolAdmins}.`);
  if (typeof o.classes === 'number') lines.push(`Classes: ${o.classes}.`);
  if (typeof o.activeExams === 'number') lines.push(`Active exams: ${o.activeExams}.`);
  if (typeof o.examResultsLast30Days === 'number') {
    lines.push(`Exam results (last 30 days): ${o.examResultsLast30Days}.`);
  }
  if (typeof o.teacherRemarks === 'number') lines.push(`Teacher remarks on file: ${o.teacherRemarks}.`);
  if (typeof o.loginSessionsToday === 'number') {
    lines.push(`Student login sessions today (attendance proxy): ${o.loginSessionsToday}.`);
  }
  if (lines.length <= 1) return 'I could not find matching records in the database.';
  return lines.join(' ');
}

function localFallbackResponse({ userPrompt, facts }) {
  if (facts?.operation === 'overview') {
    return formatOverviewFallback(facts);
  }
  const moduleLabels = {
    students: 'students',
    teachers: 'teachers',
    users: 'users',
    classes: 'classes',
    exams: 'exams',
    results: 'exam results',
    attendance: 'attendance records',
    subjects: 'subjects',
    notices: 'notices',
    analytics: 'analytics logs',
    ai_tool_data: 'AI generations',
  };
  const label = moduleLabels[facts?.module] || facts?.module || 'records';
  const asksForCount = /((how|who)\s*many|count|total|number of|are there|how much)/i.test(
    String(userPrompt || '')
  );
  if (facts?.available === false && facts?.reason) {
    return `${facts.reason} I could not find matching records in the database.`;
  }
  if (facts?.operation === 'count' && typeof facts.count === 'number') {
    if (facts.count === 0) return `There are exactly 0 ${label}.`;
    return `There are exactly ${facts.count} ${label}.`;
  }
  if (facts?.operation === 'distinct') {
    if (!facts.totalDistinct) {
      return asksForCount
        ? `There are exactly 0 ${label}.`
        : `I could not find matching records in the database.`;
    }
    return `Found exactly ${facts.totalDistinct} distinct values in ${facts.field || 'field'} for ${label}.`;
  }
  if (facts?.operation === 'aggregate' && Array.isArray(facts.rows)) {
    if (!facts.rows.length) return 'I could not find matching records in the database.';
    const top = facts.rows[0] || {};
    const gb = Array.isArray(facts.groupBy) ? facts.groupBy : [];
    const groupField = gb[0] || '';
    const topId = top?._id && typeof top._id === 'object' ? top._id : {};
    const metricKey = Object.keys(top).find((k) => k !== '_id') || '';
    const metricValue = metricKey ? Number(top[metricKey] || 0) : 0;

    if (facts.module === 'exams' && groupField === 'subject') {
      const subject = String(topId.subject || top.subject || '').trim();
      if (!subject) return `Computed exactly ${facts.rows.length} grouped results for exams.`;
      return `Subject "${subject}" has the highest exam count with exactly ${metricValue} exams.`;
    }

    if (facts.module === 'exams' && groupField === 'classNumber') {
      const classNumber = String(topId.classNumber || top.classNumber || '').trim();
      if (!classNumber) return `Computed exactly ${facts.rows.length} grouped results for exams.`;
      return `Class ${classNumber} has the highest number of exams with exactly ${metricValue} exams.`;
    }

    if (groupField) {
      const groupValue = String(topId[groupField] || top[groupField] || '').trim() || 'unknown';
      return `Top ${groupField} is "${groupValue}" with exactly ${metricValue}.`;
    }
    return `Computed exactly ${facts.rows.length} grouped results.`;
  }
  if (facts?.operation === 'list' && Array.isArray(facts.rows)) {
    if (!facts.rows.length) {
      return asksForCount
        ? `There are exactly 0 ${label}.`
        : 'I could not find matching records in the database.';
    }
    if (facts.module === 'exams') {
      const names = facts.rows
        .map((r) => String(r?.title || '').trim())
        .filter(Boolean);
      if (names.length) {
        const shown = names.slice(0, 20);
        return `Exam names: ${shown.join(', ')}.`;
      }
    }
    return `Fetched exactly ${facts.rows.length} records from ${facts.module}.`;
  }
  return `I could not find matching records in the database.`;
}

export async function formatDynamicResponse({
  userPrompt,
  plan,
  facts,
  notes = [],
}) {
  if (plan?.mode === 'overview' || facts?.operation === 'overview') {
    return formatOverviewFallback(facts);
  }

  if (plan?.mode === 'knowledge') {
    const prompt = `You are Vidya AI Control. The user asked a knowledge/general question.
Provide a concise, helpful answer. If this requires live DB values, explicitly ask for the exact metric/module.

Question:
${String(userPrompt || '').slice(0, 4000)}
`;
    try {
      return String(await geminiService.generateStructuredContent(prompt, 'text') || '').trim();
    } catch {
      return 'I can answer knowledge questions, but Gemini is temporarily unavailable. Please retry in a moment.';
    }
  }

  const prompt = `You are Vidya AI Control. Use ONLY FACTS_JSON for numeric claims.
You are a database-aware AI assistant.
You must never invent values.
You must only respond using values returned from backend database queries.
If no data exists, clearly say: "I could not find matching records in the database."
Do not estimate. Do not guess. Do not hallucinate.
Never use words: approximately, maybe, likely, around, probably, estimated.
If module unavailable, say so clearly.
Keep answer concise and admin-friendly.

User question:
${String(userPrompt || '').slice(0, 4000)}

Intent plan:
${JSON.stringify(plan).slice(0, 3000)}

Notes:
${notes.join('\n').slice(0, 1200)}

FACTS_JSON:
${JSON.stringify(facts).slice(0, 12000)}
`;

  try {
    const first = String(await geminiService.generateStructuredContent(prompt, 'text') || '').trim();
    const firstCheck = validateDbGroundedResponse({ text: first, facts, userPrompt });
    if (firstCheck.ok) return first;

    const repairPrompt = `${prompt}

Your previous answer violated grounding policy: ${firstCheck.reason}.
Regenerate now and strictly follow grounding rules.`;
    const second = String(await geminiService.generateStructuredContent(repairPrompt, 'text') || '').trim();
    const secondCheck = validateDbGroundedResponse({ text: second, facts, userPrompt });
    if (secondCheck.ok) return second;
    return localFallbackResponse({ userPrompt, facts });
  } catch {
    return localFallbackResponse({ userPrompt, facts });
  }
}
