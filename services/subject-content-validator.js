/**
 * Subject-accuracy validation — reject outputs with wrong disciplinary content.
 * Hard failures block save; soft failures are retry hints only.
 * @module services/subject-content-validator
 */

const SCIENCE_KEYWORDS = [
  'acid',
  'base',
  'alkali',
  'litmus',
  'ph',
  'neutral',
  'neutralization',
  'neutralisation',
  'reaction',
  'hcl',
  'naoh',
  'hydrogen',
  'carbonate',
  'indicator',
  'salt',
  'metal',
  'oxide',
  'hydroxide',
  'equation',
  'molecule',
  'ion',
  'experiment',
  'laboratory',
  'lab',
];

const GENERIC_SCIENCE_METHOD_OPTIONS = [
  /belief without evidence/i,
  /systematic observation and evidence/i,
  /superstition only/i,
  /unquestioned tradition/i,
];

function collectAllText(structured) {
  const parts = [];
  const walk = (obj) => {
    if (obj == null) return;
    if (typeof obj === 'string') {
      parts.push(obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    if (typeof obj === 'object') {
      for (const v of Object.values(obj)) walk(v);
    }
  };
  walk(structured);
  return parts.join('\n').toLowerCase();
}

function countKeywordHits(text, keywords) {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits += 1;
  }
  return hits;
}

function isAcidsBasesSubtopic(subtopic = '') {
  const s = String(subtopic || '').toLowerCase();
  return /\b(acid|base|alkali|litmus|neutral|ph|chemical propert)/i.test(s);
}

function collectQuestionRows(structured) {
  const pools = [];
  for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e', 'questions']) {
    if (Array.isArray(structured?.[key])) pools.push(...structured[key]);
  }
  if (Array.isArray(structured?.sections)) {
    for (const sec of structured.sections) {
      if (Array.isArray(sec?.questions)) pools.push(...sec.questions);
    }
  }
  return pools;
}

export function hasScaffoldRows(structured) {
  return collectQuestionRows(structured).some(
    (q) => q && typeof q === 'object' && q._scaffold === true,
  );
}

function hasGenericScientificMethodMcqs(structured) {
  let genericCount = 0;
  for (const q of collectQuestionRows(structured)) {
    const opts = Array.isArray(q?.options) ? q.options.join(' ') : '';
    if (GENERIC_SCIENCE_METHOD_OPTIONS.some((re) => re.test(opts))) {
      genericCount += 1;
    }
  }
  return genericCount > 0;
}

function hasTopicTitleOnlyQuestions(structured, subtopic) {
  const topic = String(subtopic || '').trim();
  if (!topic || topic.length < 8) return false;
  const pools = collectQuestionRows(structured);
  if (!pools.length) return false;
  let titleOnly = 0;
  for (const q of pools) {
    const stem = String(q?.question || '').trim();
    if (!stem) continue;
    const mentionsTopic = stem.toLowerCase().includes(topic.toLowerCase().slice(0, 20));
    const hasSpecificScience =
      /litmus|hcl|naoh|ph|reaction|metal|carbonate|hydrogen|indicator|salt|equation/i.test(stem);
    if (mentionsTopic && !hasSpecificScience && /related to|about|essential fact|correct idea|best description/i.test(stem)) {
      titleOnly += 1;
    }
  }
  return titleOnly >= 2;
}

function countRealQuestionStems(structured) {
  return collectQuestionRows(structured).filter((q) => {
    const stem = String(q?.question || q?.text || '').trim();
    return stem.length >= 20 && !q?._scaffold;
  }).length;
}

/**
 * @param {string} subject
 * @param {string} subtopic
 * @param {unknown} structured
 * @param {{ blockSave?: boolean }} [opts]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], score: number }}
 */
export function validateSubjectContent(subject, subtopic, structured, opts = {}) {
  const blockSave = opts.blockSave !== false;
  const hardErrors = [];
  const warnings = [];
  const text = collectAllText(structured);
  const subj = String(subject || '').toLowerCase();
  let score = 100;

  if (hasScaffoldRows(structured)) {
    hardErrors.push('Scaffold/template questions detected (_scaffold) — not publishable.');
    score -= 50;
  }

  if (hasGenericScientificMethodMcqs(structured) && isAcidsBasesSubtopic(subtopic)) {
    hardErrors.push(
      'MCQ options use generic scientific-method distractors instead of acids/bases chemistry content.',
    );
    score -= 35;
  }

  const realStems = countRealQuestionStems(structured);
  if (realStems < 3) {
    hardErrors.push(`Too few real exam questions (${realStems}; minimum 3).`);
    score -= 30;
  }

  if (hasTopicTitleOnlyQuestions(structured, subtopic)) {
    warnings.push('Some questions only repeat the subtopic title without specific subject content.');
    score -= 15;
  }

  if (/science|physics|chemistry|biology/i.test(subj) && isAcidsBasesSubtopic(subtopic)) {
    const hits = countKeywordHits(text, SCIENCE_KEYWORDS);
    if (hits < 3) {
      warnings.push(
        `Science paper could include more subject terminology (found ${hits} key terms; aim for 3+).`,
      );
      score -= 10;
    }
  }

  score = Math.max(0, Math.min(100, score));

  const valid = blockSave ? hardErrors.length === 0 : hardErrors.length === 0 && warnings.length === 0;

  return {
    valid,
    errors: [...hardErrors, ...warnings],
    warnings,
    hardErrors,
    score,
  };
}
