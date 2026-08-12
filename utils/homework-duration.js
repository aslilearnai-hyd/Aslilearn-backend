/** Parse teacher-entered homework duration (minutes). */
export function parseHomeworkDurationMinutes(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 600) return null;
  return n;
}

const TIME_IN_TEXT =
  /\b(?:time|duration)\s*[:\-]?\s*\d+\s*(?:minutes?|mins?|min\.?)\b/gi;

/** Replace any "Time: N minutes" (or Duration) phrase in prose/markdown. */
export function rewriteHomeworkTimeInText(text, minutes) {
  if (!minutes) return String(text || '');
  const source = String(text || '');
  if (!source.trim()) return source;
  return source.replace(TIME_IN_TEXT, (match) => {
    const prefix = /^duration/i.test(match) ? 'Duration' : 'Time';
    return `${prefix}: ${minutes} minutes`;
  });
}

function countHomeworkQuestions(structured = {}) {
  const rows = [
    ...(Array.isArray(structured.practice_questions) ? structured.practice_questions : []),
    ...(Array.isArray(structured.questions) ? structured.questions : []),
  ];
  return rows.filter((row) => {
    if (typeof row === 'string') return row.trim().length >= 4;
    if (row && typeof row === 'object') {
      return String(row.question || row.prompt || row.text || '').trim().length >= 4;
    }
    return false;
  }).length;
}

/** Ensure instructions mention the exact duration the teacher requested. */
export function applyHomeworkDurationToInstructions(instructions, minutes, options = {}) {
  const mins = parseHomeworkDurationMinutes(minutes);
  if (!mins) return String(instructions || '').trim();

  const text = String(instructions || '').trim();
  if (/\b(?:time|duration)\s*[:\-]?\s*\d+\s*(?:minutes?|mins?|min\.?)\b/i.test(text)) {
    return rewriteHomeworkTimeInText(text, mins);
  }
  if (text) {
    return `${text.replace(/\.\s*$/, '')}. Time: ${mins} minutes.`;
  }

  const questionCount = Number(options.questionCount);
  const qLine =
    Number.isFinite(questionCount) && questionCount > 0
      ? `Answer all ${questionCount} questions. `
      : 'Answer all questions. ';
  return `${qLine}Time: ${mins} minutes. Use clear, concise language.`;
}

export function applyHomeworkDurationToStructured(structured, durationMinutes) {
  const minutes = parseHomeworkDurationMinutes(durationMinutes);
  if (!structured || typeof structured !== 'object' || !minutes) return structured;

  const out = { ...structured };
  const questionCount = countHomeworkQuestions(out);
  const patched = applyHomeworkDurationToInstructions(
    out.instructions || out.student_instructions,
    minutes,
    { questionCount: questionCount || undefined },
  );
  out.instructions = patched;
  if (out.student_instructions) out.student_instructions = patched;
  return out;
}

/** Patch cached or live homework delivery so dashboard time matches the form. */
export function applyHomeworkDurationToDelivery(toolType, delivery, durationMinutes) {
  const minutes = parseHomeworkDurationMinutes(durationMinutes);
  if (String(toolType || '') !== 'homework-creator' || !minutes) {
    return delivery || { content: '', rawData: null };
  }

  const content = rewriteHomeworkTimeInText(delivery?.content || '', minutes);
  let rawData = delivery?.rawData;
  if (rawData && typeof rawData === 'object') {
    rawData = applyHomeworkDurationToStructured(rawData, minutes);
  }
  return { content, rawData };
}
