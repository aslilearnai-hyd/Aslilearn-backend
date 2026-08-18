import geminiService from '../gemini-service.js';
import { buildSystemPrompt, buildAdminControlFeaturePrimer, stripModelLeaks } from '../vidya-persona.js';
import { callModel, buildContentsFromHistory } from '../model-router.js';

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

/** Model sometimes echoes the grounding payload. Never show that to the admin. */
function stripFactsJsonLeak(text) {
  let out = String(text || '');
  out = out.replace(/\bFACTS[_ ]?JSON\s*:?\s*/gi, '');
  out = out.replace(/\{[^{}]*"(?:module|count|operation|rows|overview)"[^{}]*\}/g, '');
  out = out.replace(/\n?\s*\{[^{}]{0,400}\}\s*$/g, '');
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function validateDbGroundedResponse({ text, facts, userPrompt }) {
  const t = stripFactsJsonLeak(String(text || '').trim());
  if (!t) return { ok: false, reason: 'empty_response' };
  if (/facts[_ ]?json/i.test(t) || /^\s*\{[\s\S]*\}\s*$/.test(t)) {
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
  if (facts?.operation === 'catalog_counts' || facts?.mode === 'catalog_counts') {
    const videos = Number(facts.publishedVideos || 0);
    const library = Number(facts.libraryVideos || 0);
    const assessments = Number(facts.publishedAssessments || 0);
    return `Published EduOTT videos: ${videos}. Library video items: ${library}. Published assessments (quizzes): ${assessments}.`;
  }

  const o = facts?.overview && typeof facts.overview === 'object' ? facts.overview : {};
  const label = String(
    facts?.personLabel || facts?.classLabel || facts?.schoolLabel || 'Your school',
  ).trim();
  const profile = facts?.profile && typeof facts.profile === 'object' ? facts.profile : null;
  const candidates = Array.isArray(facts?.candidates) ? facts.candidates : [];

  if (candidates.length > 1) {
    const names = candidates
      .slice(0, 8)
      .map((c) => {
        if (c.kind) {
          const extra = c.classNumber ? ` class ${c.classNumber}` : c.schoolName ? ` (${c.schoolName})` : '';
          return `${c.name || 'Unknown'} [${c.kind}]${extra}`;
        }
        const place = c.place ? ` (${c.place})` : '';
        return `${c.name}${place}`;
      })
      .join('; ');
    return `${facts.error || `Found ${candidates.length} matches.`} Matches: ${names}.`;
  }

  if (facts?.error && !Object.keys(o).length && !profile) {
    return String(facts.error);
  }

  const lines = [];
  const scope = String(facts?.scope || '');

  if (scope.startsWith('person_') || facts?.mode === 'person_detail') {
    lines.push(`About ${label}:`);
    if (profile?.fullName) lines.push(`Name: ${profile.fullName}.`);
    if (facts?.personType) lines.push(`Role: ${facts.personType}.`);
    if (profile?.classNumber) {
      lines.push(
        `Class: ${profile.classNumber}${profile.section ? profile.section : ''}${profile.className ? ` (${profile.className})` : ''}.`,
      );
    }
    if (profile?.schoolName) lines.push(`School: ${profile.schoolName}.`);
    if (typeof o.examsTaken === 'number') lines.push(`Exams taken: ${o.examsTaken}.`);
    if (typeof o.averagePercentage === 'number') lines.push(`Average score: ${o.averagePercentage}%.`);
    if (typeof o.latestPercentage === 'number') {
      lines.push(
        `Latest exam: ${o.latestPercentage}%${o.latestExamTitle ? ` (${o.latestExamTitle})` : ''}.`,
      );
    }
    if (o.trendDirection && o.trendDirection !== 'unknown') {
      const delta =
        o.deltaVsPrevious != null ? ` (${o.deltaVsPrevious > 0 ? '+' : ''}${o.deltaVsPrevious}%)` : '';
      lines.push(`Score trend: ${o.trendDirection}${delta}.`);
    }
    if (typeof o.videosCompleted === 'number' || typeof o.videosTracked === 'number') {
      lines.push(
        `Videos: ${o.videosCompleted || 0} completed of ${o.videosTracked || 0} tracked.`,
      );
    }
    if (typeof o.homeworkSubmitted === 'number') {
      lines.push(`Homework submitted: ${o.homeworkSubmitted} (graded ${o.homeworkGraded || 0}).`);
    }
    if (typeof o.loginDaysLast30 === 'number') {
      lines.push(`Login days (last 30): ${o.loginDaysLast30}.`);
    }
    if (typeof o.assignedClasses === 'number') lines.push(`Assigned classes: ${o.assignedClasses}.`);
    if (typeof o.studentsInAssignedClasses === 'number') {
      lines.push(`Students in those classes: ${o.studentsInAssignedClasses}.`);
    }
    if (typeof o.students === 'number') lines.push(`Students in school: ${o.students}.`);
    if (typeof o.teachers === 'number') lines.push(`Teachers: ${o.teachers}.`);
    const recentExams = Array.isArray(facts?.recentExams) ? facts.recentExams : [];
    if (recentExams.length) {
      lines.push(
        `Recent exams: ${recentExams
          .slice(0, 4)
          .map((e) => `${e.examTitle} ${e.percentage ?? 'N/A'}%`)
          .join('; ')}.`,
      );
    }
    const classes = Array.isArray(facts?.classes) ? facts.classes : [];
    if (classes.length) {
      lines.push(
        `Classes: ${classes
          .map((c) => `${c.classNumber || ''}${c.section || ''}${c.name ? ` ${c.name}` : ''}`.trim())
          .join(', ')}.`,
      );
    }
    if (facts?.error) lines.push(String(facts.error));
    if (lines.length <= 1) return 'I could not find matching person records in the database.';
    return lines.join(' ');
  }

  if (scope === 'class_group' || facts?.mode === 'class_detail') {
    lines.push(`${label} group summary:`);
    if (typeof o.students === 'number') lines.push(`Students: ${o.students}.`);
    if (typeof o.activeStudents === 'number') lines.push(`Active students: ${o.activeStudents}.`);
    if (typeof o.averagePercentage === 'number') {
      lines.push(`Average exam score (30d): ${o.averagePercentage}%.`);
    }
    if (typeof o.examResultsLast30Days === 'number') {
      lines.push(`Exam results (last 30 days): ${o.examResultsLast30Days}.`);
    }
    if (typeof o.activeExams === 'number') lines.push(`Active exams for this class: ${o.activeExams}.`);
    if (typeof o.loginSessionsToday === 'number') {
      lines.push(`Student login sessions today: ${o.loginSessionsToday}.`);
    }
    const top = Array.isArray(facts?.topStudents) ? facts.topStudents : [];
    if (top.length) {
      lines.push(
        `Top scorers: ${top
          .map((s) => `${s.name} ${s.averagePercentage}%`)
          .join('; ')}.`,
      );
    }
    if (facts?.error) lines.push(String(facts.error));
    if (lines.length <= 1) return 'I could not find matching class records in the database.';
    return lines.join(' ');
  }

  lines.push(`Reports overview for ${label}:`);
  if (profile) {
    if (profile.name) lines.push(`School: ${profile.name}.`);
    if (profile.place) lines.push(`Place: ${profile.place}.`);
    if (profile.board || profile.curriculumBoard) {
      lines.push(`Board: ${profile.board || profile.curriculumBoard}.`);
    }
    if (profile.phone) lines.push(`Phone: ${profile.phone}.`);
    if (profile.contactPerson) lines.push(`Contact: ${profile.contactPerson}.`);
    if (typeof profile.licensedStudents === 'number') {
      lines.push(`Licensed student seats: ${profile.licensedStudents}.`);
    }
    if (typeof profile.licensedTeachers === 'number') {
      lines.push(`Licensed teacher seats: ${profile.licensedTeachers}.`);
    }
    if (profile.isActive === false) lines.push('Status: inactive.');
  }

  if (typeof o.schools === 'number') lines.push(`Schools: ${o.schools}.`);
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
  if (typeof o.trialMembers === 'number') lines.push(`Trial members: ${o.trialMembers}.`);
  if (typeof o.publishedVideos === 'number') {
    lines.push(`Published EduOTT videos: ${o.publishedVideos}.`);
  }
  if (typeof o.publishedAssessments === 'number') {
    lines.push(`Published assessments: ${o.publishedAssessments}.`);
  }
  if (facts?.error && (profile || Object.keys(o).length)) {
    lines.push(String(facts.error));
  }
  if (lines.length <= 1) return 'I could not find matching records in the database.';
  return lines.join(' ');
}

function localFallbackResponse({ userPrompt, facts }) {
  if (
    facts?.operation === 'overview' ||
    facts?.mode === 'school_detail' ||
    facts?.mode === 'person_detail' ||
    facts?.mode === 'class_detail'
  ) {
    return formatOverviewFallback(facts);
  }
  if (facts?.operation === 'catalog_counts' || facts?.mode === 'catalog_counts') {
    return formatOverviewFallback(facts);
  }
  const moduleLabels = {
    schools: 'schools',
    students: 'students',
    teachers: 'teachers',
    users: 'users',
    trial_members: 'trial members',
    school_orders: 'school orders',
    classes: 'classes',
    exams: 'exams',
    results: 'exam results',
    attendance: 'attendance records',
    subjects: 'subjects',
    notices: 'notices',
    analytics: 'AI usage analytics entries',
    audit_logs: 'audit log entries',
    teacher_tool_usage: 'teacher tool usage entries',
    impact_snapshots: 'school impact snapshots',
    ai_tool_data: 'AI generations',
    learning_sessions: 'learning sessions',
    videos: 'published videos',
    assessments: 'published assessments',
    library_content: 'library items',
  };
  const label = moduleLabels[facts?.module] || facts?.module || 'records';
  const asksForCount = /((how|who)\s*many|count|total|number of|are there|how much)/i.test(
    String(userPrompt || '')
  );
  // "Could not find matching records" reads as "your data is missing", which
  // sends admins hunting for a data problem when the real answer is that the
  // question could not be turned into a query. Say which it is.
  if (facts?.available === false && facts?.reason) {
    return `${facts.reason} Try naming a specific record type — for example schools, students, teachers, classes, exams, results, subjects, trial members, school orders, usage analytics or audit logs.`;
  }
  if (facts?.operation === 'count' && typeof facts.count === 'number') {
    if (facts.count === 0) return `There are exactly 0 ${label}.`;
    return `There are exactly ${facts.count} ${label}.`;
  }
  if (facts?.operation === 'distinct') {
    if (!facts.totalDistinct) {
      return asksForCount
        ? `There are exactly 0 ${label}.`
        : `There are no ${label} on record yet.`;
    }
    return `Found exactly ${facts.totalDistinct} distinct values in ${facts.field || 'field'} for ${label}.`;
  }
  if (facts?.operation === 'aggregate' && Array.isArray(facts.rows)) {
    if (!facts.rows.length) return `There are no ${label} on record for that query yet.`;
    const top = facts.rows[0] || {};
    const gb = Array.isArray(facts.groupBy) ? facts.groupBy : [];
    const groupField = gb[0] || '';
    const topId = top?._id && typeof top._id === 'object' ? top._id : {};
    const metricKey = Object.keys(top).find((k) => k !== '_id') || '';
    const metricValue = metricKey ? Number(top[metricKey] || 0) : 0;
    const totalAcrossGroups = facts.rows.reduce((sum, row) => {
      const key = Object.keys(row || {}).find((k) => k !== '_id');
      return sum + (key ? Number(row[key] || 0) : 0);
    }, 0);

    if (groupField === 'school' || topId.school != null) {
      const lines = facts.rows.slice(0, 20).map((row, i) => {
        const id = row?._id && typeof row._id === 'object' ? row._id : {};
        const school = String(id.school || row.school || 'Unknown school').trim();
        const key = Object.keys(row || {}).find((k) => k !== '_id') || 'count';
        const n = Number(row[key] || 0);
        return `${i + 1}. ${school}: ${n}`;
      });
      return `Found exactly ${totalAcrossGroups} ${label} across ${facts.rows.length} school group(s). Breakdown: ${lines.join('; ')}.`;
    }

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
      if (facts.module === 'schools') {
        return 'No schools matched that name. Try a shorter or partial school name.';
      }
      return asksForCount
        ? `There are exactly 0 ${label}.`
        : 'I could not find matching records in the database.';
    }
    if (facts.module === 'schools') {
      const names = facts.rows
        .map((r) => {
          const name = String(r?.name || '').trim();
          const place = String(r?.place || '').trim();
          if (!name) return '';
          return place ? `${name} (${place})` : name;
        })
        .filter(Boolean);
      if (names.length) {
        const shown = names.slice(0, 20);
        return `Schools: ${shown.join('; ')}.`;
      }
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
    if (facts.module === 'users' || facts.module === 'students' || facts.module === 'teachers') {
      const shown = facts.rows.slice(0, 15).map((r, i) => {
        const name = String(r?.fullName || r?.name || r?.email || 'User').trim();
        const role = r?.role ? ` [${r.role}]` : '';
        const klass = r?.classNumber ? ` class ${r.classNumber}` : '';
        const login = r?.lastLogin
          ? ` last login ${String(r.lastLogin).slice(0, 19).replace('T', ' ')}`
          : '';
        return `${i + 1}. ${name}${role}${klass}${login}`;
      });
      return `Found exactly ${facts.totalReturned ?? facts.rows.length} ${label}. ${shown.join('; ')}.`;
    }
    return `Fetched exactly ${facts.rows.length} records from ${facts.module}.`;
  }
  return `I could not find matching records in the database.`;
}

/**
 * Non-DB questions (greetings, general knowledge, "how do I use feature X") get the
 * same on-brand persona + formatting quality as the student general-knowledge path,
 * instead of a bare unbranded one-line Gemini call.
 */
async function answerAsVidyaControlKnowledge({ userPrompt, viewerRole, history = [] }) {
  const role = String(viewerRole || '').toLowerCase() === 'super-admin' ? 'super-admin' : 'school-admin';
  const systemInstruction = [
    buildSystemPrompt({ role }),
    buildAdminControlFeaturePrimer(role),
    'This is the Vidya AI Control chat (live database Q&A + general assistant). If the question needs an exact live number/list from AsliLearn data, ask the admin to phrase it as a data question (e.g. "how many students in Class 7") rather than guessing a figure.',
  ].join('\n\n');

  try {
    const result = await callModel({
      systemInstruction,
      contents: buildContentsFromHistory({ history, userMessage: userPrompt }),
      generationConfig: { temperature: 0.3, maxOutputTokens: 1600 },
    });
    const text = stripModelLeaks(String(result?.text || '').trim());
    if (text) return text;
  } catch {
    /* fall through to legacy single-shot call below */
  }

  try {
    const prompt = `You are Vidya AI Control. The user asked a knowledge/general question.
Provide a concise, helpful answer. If this requires live DB values, explicitly ask for the exact metric/module.

Question:
${String(userPrompt || '').slice(0, 4000)}
`;
    return String(await geminiService.generateStructuredContent(prompt, 'text') || '').trim();
  } catch {
    return 'I can answer knowledge questions, but Gemini is temporarily unavailable. Please retry in a moment.';
  }
}

export async function formatDynamicResponse({
  userPrompt,
  plan,
  facts,
  notes = [],
  viewerRole,
  history = [],
}) {
  if (
    plan?.mode === 'overview' ||
    plan?.mode === 'catalog_counts' ||
    plan?.mode === 'school_detail' ||
    plan?.mode === 'person_detail' ||
    plan?.mode === 'class_detail' ||
    facts?.operation === 'overview' ||
    facts?.operation === 'catalog_counts' ||
    facts?.mode === 'school_detail' ||
    facts?.mode === 'person_detail' ||
    facts?.mode === 'class_detail' ||
    facts?.mode === 'catalog_counts'
  ) {
    return formatOverviewFallback(facts);
  }

  if (plan?.mode === 'knowledge') {
    return answerAsVidyaControlKnowledge({ userPrompt, viewerRole, history });
  }

  const prompt = `You are Vidya AI Control. Use ONLY FACTS_JSON for numeric claims.
You are a database-aware AI assistant.
You must never invent values.
You must only respond using values returned from backend database queries.
If FACTS_JSON includes numeric counts (including 0), report those exact counts. Only say "I could not find matching records in the database." when FACTS_JSON has no count, rows, or published catalog numbers at all.
Do not estimate. Do not guess. Do not hallucinate.
Never use words: approximately, maybe, likely, around, probably, estimated.
If module unavailable, say so clearly.
Keep answer concise and admin-friendly.
Never reprint FACTS_JSON. Never output JSON. Answer in plain English only.

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
    const first = stripFactsJsonLeak(
      String(await geminiService.generateStructuredContent(prompt, 'text') || '').trim(),
    );
    const firstCheck = validateDbGroundedResponse({ text: first, facts, userPrompt });
    if (firstCheck.ok) return stripModelLeaks(first);

    const repairPrompt = `${prompt}

Your previous answer violated grounding policy: ${firstCheck.reason}.
Regenerate now in plain English only. Do not print FACTS_JSON or JSON.`;
    const second = stripFactsJsonLeak(
      String(await geminiService.generateStructuredContent(repairPrompt, 'text') || '').trim(),
    );
    const secondCheck = validateDbGroundedResponse({ text: second, facts, userPrompt });
    if (secondCheck.ok) return stripModelLeaks(second);
    return localFallbackResponse({ userPrompt, facts });
  } catch {
    return localFallbackResponse({ userPrompt, facts });
  }
}
