/**
 * Regex-based lesson planner extraction from PDF text.
 * @module services/pdf-lesson-extract
 */

import { bulletsFromLines, parseNumberedSections, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const LESSON_MARKER = /^(?:Lesson|Variation|Plan)\s+\d+\b/i;

function parseLessonBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let lesson_name = '';
  const sections = parseNumberedSections(block, 14);

  for (const line of lines) {
    if (LESSON_MARKER.test(line)) continue;
    const nameMatch = line.match(/^(?:Lesson\s*Name|Title)\s*[:\-—]\s*(.+)$/i);
    if (nameMatch) {
      lesson_name = str(nameMatch[1]);
      break;
    }
    if (!lesson_name && line.length >= 4 && line.length <= 160 && !/^\d+[\.)]/.test(line)) {
      lesson_name = line;
      break;
    }
  }

  const learning_objectives = bulletsFromLines(sections.get(2) || sections.get(1) || []);
  const teaching_activities = bulletsFromLines(sections.get(7) || sections.get(4) || []);
  const materials_required = bulletsFromLines(sections.get(13) || sections.get(3) || []);
  const introduction_warmup = (sections.get(5) || []).join('\n').trim();
  const teaching_strategy = (sections.get(6) || []).join('\n').trim();
  const assessment = (sections.get(10) || []).join('\n').trim();
  const closure_exit_ticket = (sections.get(14) || []).join('\n').trim();

  const hasBody =
    learning_objectives.length > 0 ||
    teaching_activities.length > 0 ||
    str(introduction_warmup).length > 10 ||
    str(teaching_strategy).length > 10;

  if (!lesson_name && !hasBody) return null;

  return {
    sl_no: index + 1,
    lesson_name: lesson_name || `Lesson ${index + 1}`,
    title: lesson_name || `Lesson ${index + 1}`,
    learning_objectives,
    teaching_activities,
    materials_required,
    introduction_warmup,
    teaching_strategy,
    formative_assessment_questions: bulletsFromLines(sections.get(10) || []),
    assessment,
    closure_exit_ticket,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=50]
 */
export function extractLessonPlannerItemsFromPdfText(text, limit = 50) {
  const blocks = splitPdfTextByMarkerLines(str(text), LESSON_MARKER, 80);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const lesson = parseLessonBlock(block, out.length);
    if (lesson) out.push(lesson);
  }

  if (!out.length) {
    const single = parseLessonBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit).map((row, i) => ({
    ...row,
    sl_no: row.sl_no ?? i + 1,
    learning_objectives: strArr(row.learning_objectives),
    teaching_activities: strArr(row.teaching_activities),
    materials_required: strArr(row.materials_required),
    _fromPdf: true,
  }));
}
