/**
 * Class-adaptive vocabulary and cognitive complexity rules.
 * @module prompts/shared/grade-level
 */

const GRADE_BANDS = Object.freeze({
  primary: { min: 1, max: 5, label: 'Primary (Classes 1–5)' },
  middle: { min: 6, max: 8, label: 'Middle School (Classes 6–8)' },
  secondary: { min: 9, max: 10, label: 'Secondary (Classes 9–10)' },
  senior: { min: 11, max: 12, label: 'Senior Secondary (Classes 11–12)' },
});

/**
 * @param {string|number} classLabel e.g. "Class 8", 8
 * @returns {{ band: string, classNum: number, rules: string }}
 */
export function resolveGradeBand(classLabel) {
  const raw = String(classLabel || '').trim();
  const num = parseInt(raw.replace(/[^\d]/g, ''), 10);
  const classNum = Number.isFinite(num) ? num : 8;

  let band = 'middle';
  for (const [key, { min, max }] of Object.entries(GRADE_BANDS)) {
    if (classNum >= min && classNum <= max) {
      band = key;
      break;
    }
  }

  const rulesByBand = {
    primary: [
      'Use short sentences (8–12 words average). Concrete nouns children see daily.',
      'Activities: hands-on, 5–10 minute chunks, movement, drawing, role-play.',
      'Questions: oral first, picture-based, one-step reasoning.',
      'Avoid abstract terms without a physical example (e.g. show a real leaf before "photosynthesis").',
      'Homework: 15–20 minutes max; parent-friendly instructions.',
    ],
    middle: [
      'Mix short and medium sentences. Introduce subject vocabulary with Indian examples.',
      'Activities: group work, simple experiments, chart work, think-pair-share.',
      'Questions: MCQ + short answer; begin Apply and Analyse levels.',
      'Connect to NCERT chapter sequence; reference prior class knowledge explicitly.',
      'Homework: 30–45 minutes; include one challenge item.',
    ],
    secondary: [
      'Academic vocabulary appropriate for board preparation. Precise definitions.',
      'Activities: case studies, data interpretation, structured debates, lab-style procedures.',
      'Questions: assertion-reason, case-based, competency-style, HOTS.',
      'Cross-link to board exam patterns (CBSE typology where relevant).',
      'Homework: 45–60 minutes; include application and creative extension.',
    ],
    senior: [
      'University-prep depth. Multi-step reasoning, source-based analysis.',
      'Activities: research tasks, peer review, seminar-style presentation.',
      'Questions: evaluate and create levels; comparative analysis.',
      'Reference competitive exam angles only when subject-appropriate.',
    ],
  };

  return {
    band,
    classNum,
    label: GRADE_BANDS[band]?.label || GRADE_BANDS.middle.label,
    rules: (rulesByBand[band] || rulesByBand.middle).join('\n'),
  };
}

/**
 * @param {string|number} classLabel
 * @returns {string} prompt block
 */
export function buildGradeLevelBlock(classLabel) {
  const { classNum, label, rules } = resolveGradeBand(classLabel);
  return [
    `GRADE LEVEL: Class ${classNum} (${label})`,
    'Adapt ALL content to this cognitive band:',
    rules,
  ].join('\n');
}
