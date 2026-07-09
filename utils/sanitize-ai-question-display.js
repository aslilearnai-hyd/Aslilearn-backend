/** Remove internal batch variant/scaffold metadata from question stems shown to users. */
export function stripVariantScaffoldFromQuestionText(text) {
  let q = String(text || '').replace(/\s+/g, ' ').trim();
  if (!q) return '';

  for (let i = 0; i < 3; i += 1) {
    const next = q.replace(/^\[[^\]]{6,280}\]\s*/i, '').trim();
    if (next === q) break;
    q = next;
  }

  q = q.replace(/^(?:record|set)\s+\d+\s*:\s*/i, '').trim();
  q = q.replace(/\s*\((?:VSA|SA|LA|MCQ|HOTS|Q)\s*\d+\)\s*$/i, '').trim();
  q = q.replace(/\s*\(variant\s+\d+\)\s*$/i, '').trim();

  return q;
}

const PROMPT_LEAK_MARKERS = [
  /\bNo filler content\b/i,
  /\bAll sections mandatory\b/i,
  /\bValid JSON output required\b/i,
  /\b(?:Only|Just)\s+JSON\b/i,
  /\bStart JSON construction\b/i,
  /\bFinal verification complete\b/i,
  /\bPlain JSON string only\b/i,
  /\bDo not fail validation\b/i,
  /\bExecution started\b/i,
  /\bFinal JSON block follows\b/i,
  /\bNo code fences\b/i,
  /\bReady for implementation\b/i,
  /\bTarget:\s*100%/i,
  /\bProfessional (?:tone|educational content)\b/i,
  /\bCorrected for CBSE standards\b/i,
  /\bAll constraints followed\b/i,
  /\bOne valid JSON object\b/i,
  /\bValid JSON object starts now\b/i,
  /\bready\.\s*proceed\.\s*execution\b/i,
  /\bExecution complete\b/i,
  /\bJSON production\b/i,
  /\bNo extra text outside the JSON\b/i,
];

const LESSON_PLAN_LABEL_MARKERS = [
  /\bThis lesson requires\b/i,
  /\bSafety:\s*Wear\b/i,
  /\bTeacher:\s*['"]/i,
  /\bExpected Answer:\s*['"]/i,
  /\bTeacher Response:\s*['"]/i,
  /\bFocus:\s*Measuring\b/i,
  /\bBloom'?s Taxonomy:\s*Remember\b/i,
  /\bDuration:\s*\d+\s*minutes\b/i,
  /\bFormative Assessment:\s*Exit ticket\b/i,
  /\bBoard Alignment:\s*CBSE\b/i,
  /\bIndian Context:\s*Analysis\b/i,
  /\bScience Skill:\s*Measuring\b/i,
  /\bTeacher Move:\s*Use\b/i,
];

function truncateAtEarliestMarker(text, markers, minKeep = 24) {
  let cut = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index !== undefined && m.index >= minKeep && m.index < cut) {
      cut = m.index;
    }
  }
  return cut < text.length ? text.slice(0, cut).trim() : text;
}

function stripPromptValidationLoops(text) {
  let s = text;
  if (
    (/\bReady\b/i.test(s) && /\bProceed\b/i.test(s) && /\bValid\b/i.test(s) && /\bJSON\b/i.test(s)) ||
    (/\bReady\b/gi.test(s) && (s.match(/\bReady\b/gi) || []).length >= 3)
  ) {
    const loopStart = s.search(/\bReady\b\.?\s*\bProceed\b/i);
    if (loopStart > 40) s = s.slice(0, loopStart).trim();
  }
  s = s.replace(/(?:\bReady\b\.?\s*\bProceed\b\.?\s*\bExecution\b\.?\s*){2,}[\s\S]*$/gi, '').trim();
  s = s.replace(/(?:\bValid\b\.?\s*\bJSON\b\.?\s*){3,}[\s\S]*$/gi, '').trim();
  s = s.replace(/(?:\bReady\b\.?\s*){3,}[\s\S]*$/gi, '').trim();
  return s;
}

/** Trim topic/subtopic labels that accidentally include full lesson-plan prose. */
export function stripLessonPlanLeakFromLabel(text) {
  let s = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!s) return '';
  s = truncateAtEarliestMarker(s, LESSON_PLAN_LABEL_MARKERS, 16);
  s = truncateAtEarliestMarker(s, PROMPT_LEAK_MARKERS, 16);
  if (s.length > 280) {
    const sentence = s.match(/^[\s\S]{1,280}?[.!?](?=\s|$)/);
    if (sentence) s = sentence[0].trim();
    else s = `${s.slice(0, 277).trim()}…`;
  }
  return s;
}

export function isScaffoldFlashcardPair(front, back) {
  const f = String(front || '').trim();
  const b = String(back || '').trim();
  if (!f || !b) return false;
  if (
    /^What are the key ideas about .+\?$/i.test(f) &&
    /^Students should define the concept, give one example/i.test(b)
  ) {
    return true;
  }
  if (/^What is .+\?$/i.test(f) && f.replace(/^What is (.+)\?$/i, '$1') === b) return true;
  if (/— key idea \d+$/i.test(f) && /Summarize one key idea about/i.test(b)) return true;
  return false;
}

/** Strip batch metadata, prompt leaks, and catalog paths from any AI tool text field. */
export function stripAiGeneratorLeakage(text) {
  let s = stripVariantScaffoldFromQuestionText(String(text || '').replace(/\r\n/g, '\n'));
  if (!s) return '';

  s = truncateAtEarliestMarker(s, PROMPT_LEAK_MARKERS, 32);
  s = stripPromptValidationLoops(s);

  s = s.replace(
    /\bvolume-\d+\s*\|\s*chapter\s+\d+\s*[-—–:]\s*.*?(?=\s+(?:explain|describe|list|follow|design|students|complete|write|observe|in pairs|during|walk)\b)/gi,
    ' ',
  ).trim();
  s = s.replace(/\bvolume-\d+\s*\|\s*chapter\s+\d+\s*[-—–:]\s*[^|]+(?:\s*\|\s*[^|]+)?/gi, ' ').trim();
  s = s.replace(/(?:^|[\s(])(?:variant|set|record)\s+\d+\s*:\s*/gi, ' ').trim();
  s = s.replace(/\(\s*uniqueness\s+seed\s*:[^)]*\)/gi, ' ').trim();
  s = s.replace(/\bseed\s*:\s*[\w-]+/gi, ' ').trim();
  s = s.replace(/\b\d+\s+of\s+\d+\s+variant\b/gi, ' ').trim();
  s = s.replace(
    /\b(?:constraints|alignment|differentiation)\s*:[^.]{0,220}(?:foundation\s+level|provided|remember\s+through\s+create)[^.]*\.?/gi,
    ' ',
  ).trim();
  s = s.replace(
    /\b(?:no\s+markdown|plain\s+text\s+only|valid\s+json(?:\s+output)?\s+only|complete\s+fields\s+only|no\s+placeholders?|no\s+repetition|no\s+ai\s+fluff|100\s*percent\s+compliant)[^.]*\.?/gi,
    ' ',
  ).trim();
  s = s.replace(/\bready\s+to\s+export\s+as\s+json\b[^.]*\.?/gi, ' ').trim();
  s = s.replace(/(?:\b(?:success|done|ok)\b[\s.]*){2,}/gi, ' ').trim();
  s = s.replace(/\s*\|\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/^[,;:\-\s.]+|[,;:\-\s.]+$/g, '').trim();
  return s;
}

/** Recursively sanitize all string fields in structured AI tool payloads. */
export function sanitizeAiStructuredTextDeep(value, { labelField = false } = {}) {
  if (typeof value === 'string') {
    const cleaned = stripAiGeneratorLeakage(value);
    return labelField ? stripLessonPlanLeakFromLabel(cleaned) : cleaned;
  }
  if (Array.isArray(value)) {
    return value.map((row) => sanitizeAiStructuredTextDeep(row, { labelField: false }));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, row] of Object.entries(value)) {
      const isLabel = /^(topic|subtopic|sub_topic|title|deck_title|flashcard_deck_title|chapter|subTopic)$/i.test(
        key,
      );
      out[key] = sanitizeAiStructuredTextDeep(row, { labelField: isLabel });
    }
    return out;
  }
  return value;
}
