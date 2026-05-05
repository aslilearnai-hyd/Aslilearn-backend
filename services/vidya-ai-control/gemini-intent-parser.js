import geminiService from '../gemini-service.js';

const INTENT_PROMPT_HEAD = `You are an intent extractor for an admin analytics assistant on a MongoDB-backed school LMS.
Return ONLY valid JSON (no markdown fences). Allowed keys:
{
  "operation": "<one allowed operation>",
  "filters": { "classNumber": "", "section": "", "activeOnly": false, "board": "" },
  "timeframe": "today" | "this_week" | "this_month" | "all",
  "needsClarification": false,
  "clarification": ""
}

ALLOWED operations (pick exactly one; choose the closest):
- student_count_total
- student_count_by_class_number  (requires filters.classNumber when user names a grade)
- student_count_by_class_section (requires filters.classNumber and filters.section)
- teacher_count_total
- teacher_count_active           (filters.activeOnly true by default for "active")
- class_count
- subject_count_active
- exam_count_this_week
- exam_count_all_active
- rank_class_student_count       (which class / grade band has highest student count)
- rank_section_attendance_week   (approximate attendance from login sessions captured in UserSession; label honestly)
- attendance_summary_today      (distinct students with login session recorded today IST)
- ai_generations_count_today
- fee_records_status            (billing not stored locally)
- vidya_calls_count_today
- vidya_calls_count_week
- user_role_breakdown            (counts by role User.role)
- learning_paths_published_count
- exam_results_count_period      (use timeframe)
- unsupported

Rules:
- If the user mentions a grade like "Class 7", put digits in filters.classNumber (e.g. "7").
- Section letters A/B/C uppercase in filters.section.
- timeframe: "today" only if explicitly relative to today; exams "this week" -> timeframe this_week and operation exam_count_this_week.
- Never invent counts. You only classify.
- needsClarification true only when a required filter is missing (e.g. class section query without section when ambiguous).
`;

function safeJsonParse(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const ALLOWED_OPS = new Set([
  'student_count_total',
  'student_count_by_class_number',
  'student_count_by_class_section',
  'teacher_count_total',
  'teacher_count_active',
  'class_count',
  'subject_count_active',
  'exam_count_this_week',
  'exam_count_all_active',
  'rank_class_student_count',
  'rank_section_attendance_week',
  'attendance_summary_today',
  'ai_generations_count_today',
  'fee_records_status',
  'vidya_calls_count_today',
  'vidya_calls_count_week',
  'user_role_breakdown',
  'learning_paths_published_count',
  'exam_results_count_period',
  'unsupported',
]);

/**
 * @param {{ userMessage: string, history?: Array<{ role: string, content: string }> }} param0
 */
export async function parseControlIntent({ userMessage, history = [] }) {
  const hb = Array.isArray(history) ? history.slice(-6) : [];
  const historyBlock =
    hb.length > 0
      ? `Recent turns (most recent last):\n${hb
          .map((m) => `${String(m.role || '').toUpperCase()}: ${String(m.content || '').slice(0, 500)}`)
          .join('\n')}\n`
      : '';

  const prompt = `${INTENT_PROMPT_HEAD}\n${historyBlock}\nUser question:\n${String(userMessage || '').slice(0, 4000)}\n`;

  const raw = await geminiService.generateStructuredContent(prompt, 'json');
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object') {
    return {
      operation: 'unsupported',
      filters: {},
      timeframe: 'all',
      rawPreview: String(raw || '').slice(0, 200),
    };
  }

  const op = ALLOWED_OPS.has(String(parsed.operation)) ? String(parsed.operation) : 'unsupported';
  const filters =
    parsed.filters && typeof parsed.filters === 'object'
      ? {
          classNumber: parsed.filters.classNumber != null ? String(parsed.filters.classNumber).trim() : '',
          section: parsed.filters.section != null ? String(parsed.filters.section).trim().toUpperCase() : '',
          activeOnly:
            parsed.filters.activeOnly === undefined ? false : Boolean(parsed.filters.activeOnly),
          board: parsed.filters.board != null ? String(parsed.filters.board).trim() : '',
        }
      : { classNumber: '', section: '', activeOnly: false, board: '' };

  const tf = ['today', 'this_week', 'this_month', 'all'].includes(String(parsed.timeframe))
    ? String(parsed.timeframe)
    : 'all';

  return {
    operation: op,
    filters,
    timeframe: tf,
    needsClarification: Boolean(parsed.needsClarification),
    clarification: String(parsed.clarification || '').slice(0, 280),
    rawPreview: String(raw || '').slice(0, 400),
  };
}
