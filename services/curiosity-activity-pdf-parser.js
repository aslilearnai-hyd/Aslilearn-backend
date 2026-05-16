/**
 * Deterministic parse for "Curiosity" / workbook-style activity PDFs where each block is:
 *   Activity N
 *   ...
 *   1. Title
 *   <real title line>
 *   2. Learning Objectives ...
 *   3. Materials Required
 *   ...
 * This matches extracted text from pdf-parse (same as upload pipeline).
 */

/** Strip bullet / numbering noise; drop page footers and orphan number lines. */
function cleanActivityLine(line) {
  let s = String(line || '')
    .replace(/^[\s•\-\u2022\u25cf]+/u, '')
    .replace(/^\d+[\).\s]+/, '')
    .trim();
  if (!s) return '';
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(s)) return '';
  if (/^Activity\s+\d+/i.test(s)) return '';
  if (/^\d+\.\s*$/.test(s)) return '';
  if (/^[•\u2022]\s*$/.test(line.trim())) return '';
  if (/^\d{1,2}$/.test(s)) return '';
  if (/^of\s+\d+/i.test(s)) return '';
  if (/\d+\s+of\s+\d+/.test(s) && s.length < 24) return '';
  return s;
}

/**
 * Workbook PDFs often append an index or "activities 11–50" summary after the last
 * "9. Real-life Application" with no further "Activity N" header, so line-based
 * extraction would swallow the rest of the file. Stop at line-start markers and
 * trim inline tail noise when the PDF merges lines.
 * @param {string} joined
 * @returns {string}
 */
function trimRealLifeApplicationTail(joined) {
  const s = String(joined || '').trim();
  if (!s) return s;
  const inlineCut = s.search(
    /\s(?:Included Activities\s*:|Activities\s+\d{1,3}\s*[-–]\s*\d{1,3}\s*\(|The remaining activities follow|Each activity is fully structured using)\b/i,
  );
  if (inlineCut > 0) return s.slice(0, inlineCut).trim();
  return s;
}

/** Lines that start workbook back-matter / index blocks (not part of section 9). */
const REAL_LIFE_LINE_STOP = new RegExp(
  [
    '^Included Activities\\s*:?',
    '^Activities\\s+\\d{1,3}\\s*[-–]\\s*\\d{1,3}\\b',
    '^The remaining activities\\b',
    '^Each activity is fully structured\\b',
    '^All activities are designed\\b',
    '^Appendix\\b',
    '^References\\b',
    '^Annex\\b',
    '^Index\\b',
    '^Table of contents\\b',
  ].join('|'),
  'i',
);

/**
 * @param {string} chunk one activity block (may include header lines before "Activity N")
 * @param {RegExp} headerLine first line of section must match (e.g. /^2\.\s*Learning Objectives/)
 * @param {RegExp|null} [stopAt] next section header at line start
 * @param {RegExp|null} [extraLineStop] optional extra stop (e.g. workbook index after last activity's section 9)
 * @returns {string[]}
 */
function extractLinesAfterHeader(chunk, headerLine, stopAt, extraLineStop = null) {
  const lines = chunk.split(/\n/).map((l) => l.replace(/\r/g, ''));
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (headerLine.test(t)) {
      i += 1;
      break;
    }
    i += 1;
  }
  const out = [];
  while (i < lines.length) {
    const t = lines[i].trim();
    if (stopAt && stopAt.test(t)) break;
    if (extraLineStop && extraLineStop.test(t)) break;
    if (/^Activity\s+\d+/i.test(t)) break;
    const c = cleanActivityLine(lines[i]);
    if (c) out.push(c);
    i += 1;
  }
  return out;
}

/**
 * @param {string} rawText
 * @returns {object[] | null} array of activity-shaped objects, or null if not this format
 */
export function extractActivitiesFromCuriosityWorkbookPdf(rawText) {
  const text = String(rawText || '').replace(/\r/g, '\n');
  if (!/\bActivity\s+\d+\b/i.test(text)) return null;
  if (!/\b1\.\s*Title\b/i.test(text)) return null;

  const parts = text.split(/\n(?=Activity\s+\d+\b)/gi).filter((p) => /\bActivity\s+\d+\b/i.test(p));
  if (parts.length === 0) return null;

  const out = [];
  for (const part of parts) {
    const numMatch = part.match(/\bActivity\s+(\d+)\b/i);
    if (!numMatch) continue;
    const sl_no = Number.parseInt(numMatch[1], 10);
    if (!Number.isFinite(sl_no)) continue;

    const titleMatch = part.match(/\b1\.\s*Title\s*\n+\s*([^\n\r]+)/i);
    const title = titleMatch ? String(titleMatch[1] || '').trim() : '';
    if (!title) continue;

    const subtopicLines = extractLinesAfterHeader(
      part,
      /Subtopic Link and Prior Knowledge/i,
      /Learning Objectives|NCF Competency/i,
    );
    const subtopic_link_prior_knowledge = subtopicLines.length ? subtopicLines.join(' ') : '';

    const learning_objectives = extractLinesAfterHeader(
      part,
      /Learning Objectives/i,
      /NCF Competency|Materials Required/i,
    );

    const ncfLines = extractLinesAfterHeader(
      part,
      /NCF Competency/i,
      /Materials Required/i,
    );
    const ncf_competency_alignment = ncfLines.length ? ncfLines.join(' ') : '';

    const materials_required = extractLinesAfterHeader(
      part,
      /Materials Required/i,
      /Step-by-step Procedure/i,
    );
    const step_by_step_procedure = extractLinesAfterHeader(
      part,
      /Step-by-step Procedure/i,
      /Teacher Instructions/i,
    );
    const teacher_instructions = extractLinesAfterHeader(
      part,
      /Teacher Instructions/i,
      /Student Instructions/i,
    );
    const student_instructions = extractLinesAfterHeader(
      part,
      /Student Instructions/i,
      /Differentiation|Expected Learning Outcomes/i,
    );

    const diffLines = extractLinesAfterHeader(
      part,
      /Differentiation/i,
      /Expected Learning Outcomes|Assessment Criteria/i,
    );
    const differentiation = diffLines.length ? diffLines.join(' ') : '';

    const elLines = extractLinesAfterHeader(
      part,
      /Expected Learning Outcomes/i,
      /Assessment Criteria/i,
    );
    const expected_learning_outcomes = elLines.length ? elLines.join(' ') : '';

    const assessment_criteria_rubric = extractLinesAfterHeader(
      part,
      /Assessment Criteria/i,
      /Real[-\s]?life Application/i,
    );

    const rlLines = extractLinesAfterHeader(
      part,
      /Real[-\s]?life Application/i,
      /Reflection|Exit Ticket/i,
      REAL_LIFE_LINE_STOP,
    );
    const real_life_application = rlLines.length ? trimRealLifeApplicationTail(rlLines.join(' ')) : '';

    const refLines = extractLinesAfterHeader(
      part,
      /Reflection|Exit Ticket/i,
      /^Activity\s+\d+/i,
    );
    const reflection_exit_ticket = refLines.length ? refLines.join(' ') : '';

    out.push({
      sl_no,
      question_number: sl_no,
      title,
      name: title,
      subtopic_link_prior_knowledge,
      learning_objectives,
      ncf_competency_alignment,
      materials_required,
      step_by_step_procedure,
      teacher_instructions,
      student_instructions,
      differentiation,
      expected_learning_outcomes,
      assessment_criteria_rubric,
      real_life_application,
      reflection_exit_ticket,
    });
  }

  return out.length ? out : null;
}
