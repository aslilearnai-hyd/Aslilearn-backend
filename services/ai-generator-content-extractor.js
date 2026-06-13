/** Extract fingerprintable text units from structured tool JSON. */

const QUESTION_TOOLS = new Set([
  'worksheet-mcq-generator',
  'homework-creator',
  'mock-test-builder',
  'exam-question-paper-generator',
  'smart-qa-practice-generator',
  'quick-assignment-builder',
]);

function pushText(units, contentType, text, path = '') {
  const t = String(text || '').trim();
  if (t.length < 4) return;
  units.push({ contentType, text: t, path });
}

function extractQuestionsFromStructured(toolSlug, data, units, prefix = '') {
  if (!data || typeof data !== 'object') return;

  const pools = [
    data.questions,
    data.practice_questions,
    data.formative_assessment_questions,
  ];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (let i = 0; i < pool.length; i += 1) {
      const q = pool[i];
      if (typeof q === 'string') {
        pushText(units, 'question', q, `${prefix}questions[${i}]`);
      } else if (q && typeof q === 'object') {
        pushText(units, 'question', q.question || q.prompt || q.text || q.front, `${prefix}questions[${i}]`);
        if (q.front) pushText(units, 'flashcard', `${q.front}|||${q.back || ''}`, `${prefix}card[${i}]`);
      }
    }
  }

  if (Array.isArray(data.sections)) {
    for (let si = 0; si < data.sections.length; si += 1) {
      const sec = data.sections[si];
      const secQs = Array.isArray(sec?.questions) ? sec.questions : [];
      for (let qi = 0; qi < secQs.length; qi += 1) {
        const q = secQs[qi];
        if (typeof q === 'string') pushText(units, 'question', q, `${prefix}sections[${si}].questions[${qi}]`);
        else if (q && typeof q === 'object') {
          pushText(
            units,
            'question',
            q.question || q.prompt || q.text,
            `${prefix}sections[${si}].questions[${qi}]`,
          );
        }
      }
    }
  }

  for (const key of [
    'section_a',
    'section_a_mcqs',
    'section_b',
    'section_b_fib',
    'section_c',
    'section_c_vsa',
    'section_d',
    'section_d_sa',
    'section_e',
    'section_e_competency',
    'cards',
    'application_hots_cards',
  ]) {
    if (!Array.isArray(data[key])) continue;
    for (let i = 0; i < data[key].length; i += 1) {
      const row = data[key][i];
      if (typeof row === 'string') pushText(units, 'question', row, `${prefix}${key}[${i}]`);
      else if (row && typeof row === 'object') {
        const ct = key.includes('card') ? 'flashcard' : 'question';
        const text =
          ct === 'flashcard'
            ? `${row.front || row.term || ''}|||${row.back || row.definition || ''}`
            : row.question || row.prompt || row.text || row.front;
        pushText(units, ct, text, `${prefix}${key}[${i}]`);
      }
    }
  }

  if (Array.isArray(data.concepts)) {
    for (let i = 0; i < data.concepts.length; i += 1) {
      extractQuestionsFromStructured(toolSlug, data.concepts[i], units, `${prefix}concepts[${i}].`);
    }
  }

  if (Array.isArray(data.activities) || Array.isArray(data.teaching_activities)) {
    for (const act of [...(data.activities || []), ...(data.teaching_activities || [])]) {
      pushText(units, 'activity', act, `${prefix}activity`);
    }
  }

  if (Array.isArray(data.learning_objectives) || Array.isArray(data.objectives)) {
    for (const o of [...(data.learning_objectives || []), ...(data.objectives || [])]) {
      pushText(units, 'objective', o, `${prefix}objective`);
    }
  }

  pushText(
    units,
    'title',
    data.title ||
      data.worksheet_title ||
      data.lesson_name ||
      data.homework_title ||
      data.mock_test_title ||
      data.paper_title ||
      data.study_schedule_title ||
      data.chapter_summary_title ||
      data.name,
    `${prefix}title`,
  );

  if (QUESTION_TOOLS.has(toolSlug)) {
    pushText(units, 'body', JSON.stringify(data).slice(0, 2000), `${prefix}body`);
  }
}

/**
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 * @returns {Array<{ contentType: string, text: string, path: string }>}
 */
export function extractContentUnits(toolSlug, structured) {
  const units = [];
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return units;
  extractQuestionsFromStructured(toolSlug, structured, units, '');
  return units;
}

export function extractTitleFromStructured(structured) {
  if (!structured || typeof structured !== 'object') return '';
  return String(
    structured.title ||
      structured.worksheet_title ||
      structured.lesson_name ||
      structured.homework_title ||
      structured.mock_test_title ||
      structured.paper_title ||
      structured.study_schedule_title ||
      structured.chapter_summary_title ||
      structured.name ||
      '',
  ).trim();
}
