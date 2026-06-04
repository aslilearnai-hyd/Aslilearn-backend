/**
 * Line-start section header patterns for 13-point teacher / 14-point PIL activity PDFs.
 * Must NOT match the same words mid-sentence in body text.
 */

const NUM = '(?:\\d+[\.)]\\s*)?';

export const ACTIVITY_SECTION_HEADERS = {
  title: new RegExp(`^${NUM}(?:Title\\s+of\\s+(?:the\\s+)?Activity|Project\\s*\\/\\s*Activity\\s*Title|Title\\b)`, 'i'),
  subtopic: new RegExp(`^${NUM}Subtopic Link and Prior Knowledge`, 'i'),
  learningObjectives: new RegExp(`^${NUM}Learning Objectives`, 'i'),
  ncf: new RegExp(`^${NUM}NCF Competency`, 'i'),
  materials: new RegExp(`^${NUM}Materials Required`, 'i'),
  procedure: new RegExp(`^${NUM}Step-by-step(?:\\s+Student)?\\s+Procedure`, 'i'),
  teacherInstructions: new RegExp(`^${NUM}Teacher Instructions`, 'i'),
  studentInstructions: new RegExp(`^${NUM}Student Instructions`, 'i'),
  safety: new RegExp(`^${NUM}Safety and Care Instructions`, 'i'),
  observation: new RegExp(`^${NUM}Observation\\s*\\/\\s*Data Recording Table`, 'i'),
  creative: new RegExp(`^${NUM}Creative Output\\s*\\/\\s*Final Product`, 'i'),
  differentiation: new RegExp(`^${NUM}Differentiation(?:\\s*:\\s*Support and Extension)?`, 'i'),
  assessmentRubric: new RegExp(
    `^${NUM}(?:Self-Assessment Rubric|Assessment(?:\\s+Criteria)?(?:\\s+Rubric)?|Assessment Rubric)`,
    'i',
  ),
  expectedOutcomes: new RegExp(`^${NUM}Expected Learning Outcomes`, 'i'),
  realLife: new RegExp(`^${NUM}Real[-\\s]?life Application`, 'i'),
  reflection: new RegExp(`^${NUM}(?:Reflection\\s*\\/\\s*Exit\\s+Ticket|Reflection\\s*\\/\\s*Exit|Exit Ticket)`, 'i'),
};

/**
 * @param {string} line
 * @param {RegExp|RegExp[]} headerPattern
 */
export function isActivitySectionHeaderLine(line, headerPattern) {
  const t = String(line || '').trim();
  if (!t) return false;
  const patterns = Array.isArray(headerPattern) ? headerPattern : [headerPattern];
  return patterns.some((re) => re.test(t));
}

/**
 * @param {string} line
 * @param {RegExp[]} stopPatterns
 */
export function isActivitySectionStopLine(line, stopPatterns) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^Activity\s+\d+\b/i.test(t)) return true;
  return stopPatterns.some((re) => re.test(t));
}

/**
 * Split a blob that merged sections 11–13 into reflection (common PDF extract glitch).
 * @param {Record<string, unknown>} row
 */
export function splitMergedActivityTailSections(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  let reflection = String(out.reflection_exit_ticket || '').trim();
  if (!reflection) return out;

  const elMatch = reflection.match(
    /(?:^|\n)\s*Expected Learning Outcomes\s*:\s*([\s\S]*?)(?=(?:\n\s*Real[-\s]?life Application\s*:|$))/i,
  );
  const rlMatch = reflection.match(
    /(?:^|\n)\s*Real[-\s]?life Application\s*:\s*([\s\S]*?)(?=(?:\n\s*Reflection\s*\/\s*Exit(?:\s+Ticket)?\s*:|$))/i,
  );
  const refMatch = reflection.match(
    /(?:^|\n)\s*Reflection\s*\/\s*Exit(?:\s+Ticket)?\s*:\s*([\s\S]*)$/i,
  );

  if (!elMatch && !rlMatch && !refMatch) return out;

  const existingEl = String(out.expected_learning_outcomes || '').trim();
  const existingRl = String(out.real_life_application || '').trim();

  if (elMatch) {
    const el = elMatch[1].replace(/\s+/g, ' ').trim();
    if (el && (!existingEl || existingEl.length < el.length)) {
      out.expected_learning_outcomes = el;
    }
  }
  if (rlMatch) {
    const rl = rlMatch[1].replace(/\s+/g, ' ').trim();
    if (rl && (!existingRl || existingRl.length < rl.length)) {
      out.real_life_application = rl;
    }
  }
  if (refMatch) {
    out.reflection_exit_ticket = refMatch[1].replace(/\s+/g, ' ').trim();
  } else if (elMatch || rlMatch) {
    out.reflection_exit_ticket = '';
  }
  return out;
}
