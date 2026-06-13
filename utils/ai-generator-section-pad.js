import { getAiToolTemplate } from '../config/aiToolTemplates.js';
import { applyAiGeneratorSectionFallbacks } from './ai-generator-section-fallbacks.js';
import { isAiGeneratorCostSaverEnabled } from './ai-generator-batch-config.js';

const MIN_TEXT_LEN = 4;

const OBJECT_TEXT_KEYS = [
  'question',
  'text',
  'prompt',
  'statement',
  'content',
  'label',
  'value',
  'item',
  'description',
  'name',
  'title',
  'body',
  'answer',
  'front',
  'back',
  'step',
  'activity',
  'task',
  'detail',
  'instruction',
  'objective',
  'outcome',
  'point',
];

function textFromObjectRow(item) {
  if (!item || typeof item !== 'object') return String(item ?? '').trim();
  for (const k of OBJECT_TEXT_KEYS) {
    const s = String(item[k] ?? '').trim();
    if (s.length >= MIN_TEXT_LEN) return s;
  }
  const first = Object.values(item).find(
    (v) => typeof v === 'string' && String(v).trim().length >= MIN_TEXT_LEN,
  );
  return first ? String(first).trim() : '';
}

/** Flatten LLM object-array fields (e.g. [{ description: "..." }]) into string arrays for viewers. */
export function normalizeStructuredArrayFields(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (!Array.isArray(value)) continue;
    const flat = value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return textFromObjectRow(item);
        return String(item ?? '').trim();
      })
      .filter((s) => s.length >= MIN_TEXT_LEN);
    if (flat.length) out[key] = flat;
  }
  if (Array.isArray(out.concepts)) {
    out.concepts = out.concepts.map((c) =>
      c && typeof c === 'object' ? normalizeStructuredArrayFields(c) : c,
    );
  }
  if (Array.isArray(out.cards)) {
    out.cards = out.cards.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const row = { ...c };
      if (!hasFieldContent(row.front)) row.front = textFromObjectRow(row) || row.term || row.question;
      if (!hasFieldContent(row.back)) row.back = textFromObjectRow(row) || row.definition || row.answer;
      return row;
    });
  }
  return out;
}

function ctx(meta = {}) {
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const title = String(meta.title || topic).trim();
  return { topic, subject, title };
}

function setIfEmpty(target, key, value) {
  if (hasFieldContent(target[key])) return;
  if (Array.isArray(value)) {
    if (value.length) target[key] = [...value];
    return;
  }
  const text = String(value ?? '').trim();
  if (text.length >= MIN_TEXT_LEN) target[key] = text;
}

function firstFilledLines(structured, keys = []) {
  for (const key of keys) {
    const val = structured[key];
    if (Array.isArray(val) && val.length) {
      return val.map((x) => String(x ?? '').trim()).filter((s) => s.length >= MIN_TEXT_LEN);
    }
    const text = String(val ?? '').trim();
    if (text.length >= MIN_TEXT_LEN) return [text];
  }
  return [];
}

function scaffoldLessonPlannerSections(structured, meta = {}) {
  const out = { ...structured };
  const { topic, subject, title } = ctx(meta);
  const lessonTitle = String(out.lesson_name || out.title || out.name || `${topic} — ${subject}`).trim();
  out.lesson_name = lessonTitle;
  out.title = String(out.title || lessonTitle).trim() || lessonTitle;

  setIfEmpty(out, 'learning_objectives', [
    `Students explain key ideas about ${topic}.`,
    `Students apply ${topic} using classroom examples and evidence.`,
  ]);
  setIfEmpty(out, 'ncf_competency_alignment', `Aligns with inquiry, critical thinking, and scientific literacy for ${topic}.`);
  setIfEmpty(
    out,
    'prior_knowledge_diagnostic',
    `What do you already know about ${topic}? Share one example from daily life.`,
  );
  setIfEmpty(
    out,
    'introduction_warmup',
    firstFilledLines(out, ['teaching_strategy', 'teaching_activities', 'activities'])[0] ||
      `Warm-up: quick recall of prior ideas linked to ${topic}.`,
  );
  setIfEmpty(
    out,
    'teaching_strategy',
    firstFilledLines(out, ['introduction_warmup', 'teaching_activities', 'activities'])[0] ||
      `Interactive teaching using discussion, demonstration, and guided practice on ${topic}.`,
  );
  setIfEmpty(out, 'teaching_activities', [
    `Guided explanation of ${topic} with board notes and student questions.`,
    `Pair activity: students classify or sort examples related to ${topic}.`,
  ]);
  setIfEmpty(out, 'activities', out.teaching_activities);
  setIfEmpty(
    out,
    'teacher_talk_points',
    firstFilledLines(out, ['teaching_activities', 'activities', 'teaching_strategy']).map((x) => `Teacher: ${x}`),
  );
  setIfEmpty(
    out,
    'student_tasks',
    [
      `Students record observations and answers about ${topic} in notebooks.`,
      `Students discuss in pairs and share one finding with the class.`,
    ],
  );
  setIfEmpty(out, 'formative_assessment_questions', [
    `Define one key term related to ${topic}.`,
    `Give one real-life example of ${topic}.`,
  ]);
  setIfEmpty(
    out,
    'differentiation_plan',
    `Support: sentence stems and visuals. Extension: students design a new example for ${topic}.`,
  );
  setIfEmpty(
    out,
    'homework_practice',
    `Review class notes on ${topic} and answer two short questions in the notebook.`,
  );
  setIfEmpty(out, 'teaching_aids_required', ['Whiteboard', 'Chart paper', 'Subject textbook']);
  setIfEmpty(
    out,
    'closure_exit_ticket',
    `Exit ticket: In one sentence, explain why ${topic} matters in ${subject}.`,
  );
  return out;
}

function scaffoldStudyScheduleSections(structured, meta = {}) {
  const out = scaffoldLessonPlannerSections(structured, meta);
  const { topic, subject } = ctx(meta);
  const schedTitle = String(out.study_schedule_title || out.lesson_name || `${topic} Study Schedule`).trim();
  out.study_schedule_title = schedTitle;
  setIfEmpty(out, 'study_goal_subtopic_link', `Study goal: master ${topic} in ${subject}.`);
  setIfEmpty(
    out,
    'prior_knowledge_readiness_check',
    out.prior_knowledge_diagnostic || `List two facts you already know about ${topic}.`,
  );
  setIfEmpty(out, 'study_plan_table', firstFilledLines(out, ['timeline', 'teaching_activities', 'activities']));
  setIfEmpty(
    out,
    'concept_learning_slot',
    [out.introduction_warmup, out.teaching_strategy, ...(out.teaching_activities || []).slice(0, 3)]
      .filter(Boolean)
      .join('\n\n'),
  );
  setIfEmpty(
    out,
    'practice_slot',
    [out.homework_practice, ...(out.student_tasks || []).slice(0, 2)].filter(Boolean).join('\n\n'),
  );
  setIfEmpty(out, 'breaks_focus_tips', 'Take a 5-minute stretch break; sip water; review key terms aloud.');
  setIfEmpty(
    out,
    'self_assessment_checkpoint',
    (out.formative_assessment_questions || []).join('\n') ||
      `Self-check: explain ${topic} in your own words.`,
  );
  setIfEmpty(out, 'support_extension_plan', out.differentiation_plan);
  setIfEmpty(out, 'expected_learning_outcomes', out.learning_objectives);
  setIfEmpty(out, 'reflection_exit_ticket', out.closure_exit_ticket);
  return out;
}

function scaffoldHomeworkSections(structured, meta = {}) {
  const out = { ...structured };
  const { topic, subject } = ctx(meta);
  setIfEmpty(out, 'title', `${topic} — Homework`);
  setIfEmpty(out, 'instructions', `Complete the following tasks on ${topic}. Write neatly and show your reasoning.`);
  setIfEmpty(out, 'practice_questions', [
    `Explain the main idea of ${topic} in 3–4 sentences.`,
    `List two examples of ${topic} from daily life.`,
  ]);
  setIfEmpty(out, 'application_tasks', [`Apply ${topic} to solve a short scenario from ${subject}.`]);
  setIfEmpty(out, 'creative_thinking_question', `How would you teach ${topic} to a younger student?`);
  setIfEmpty(out, 'real_life_observation_task', `Observe your surroundings and note one example related to ${topic}.`);
  setIfEmpty(out, 'challenge_question', `What might happen if ${topic} were misunderstood? Give one reason.`);
  setIfEmpty(out, 'support_hint', 'Use your class notes and textbook glossary if you get stuck.');
  setIfEmpty(out, 'answer_hints', `Key ideas: evidence, examples, and clear definitions for ${topic}.`);
  setIfEmpty(out, 'parent_note', `Please encourage your child to explain ${topic} aloud after finishing.`);
  return out;
}

function scaffoldGenericSections(toolSlug, structured, meta = {}) {
  const t = getAiToolTemplate(toolSlug);
  if (!t) return structured;
  const out = { ...structured };
  const { topic, subject } = ctx(meta);
  const check = validateAllCanonicalToolFields(toolSlug, out);
  for (const detail of check.missingDetails || []) {
    const keys = Array.isArray(detail.keys) ? detail.keys : [];
    const primary = keys[0];
    if (!primary) continue;
    const label = String(detail.label || primary).trim();
    if (keys.some((k) => Array.isArray(out[k]))) {
      setIfEmpty(out, primary, [`${label} for ${topic} (${subject}).`]);
    } else {
      setIfEmpty(out, primary, `${label} for ${topic} in ${subject}.`);
    }
  }
  return out;
}

function scaffoldConceptRows(toolSlug, structured, meta = {}) {
  if (!Array.isArray(structured.concepts) || !structured.concepts.length) return structured;
  const out = { ...structured };
  const { topic, subject } = ctx(meta);
  out.concepts = structured.concepts.map((concept, i) => {
    const row = concept && typeof concept === 'object' ? { ...concept } : {};
    const name = String(row.concept_name || row.concept_title || row.title || `${topic} — Concept ${i + 1}`).trim();
    setIfEmpty(row, 'concept_name', name);
    setIfEmpty(row, 'concept_title', name);
    setIfEmpty(row, 'simple_definition', `A clear explanation of ${name} linked to ${topic}.`);
    setIfEmpty(row, 'why_important', `${name} helps students understand ${topic} in ${subject}.`);
    setIfEmpty(row, 'prior_knowledge_needed', `Basic vocabulary and ideas about ${topic}.`);
    setIfEmpty(row, 'lesson', `Step-by-step explanation of ${name} with examples from ${topic}.`);
    setIfEmpty(row, 'real_example', `Everyday example of ${name} from Indian context.`);
    setIfEmpty(row, 'common_mistakes', [`Confusing ${name} with a similar term.`]);
    setIfEmpty(row, 'key_points', [`Remember the core idea of ${name}.`]);
    setIfEmpty(row, 'concept_check_questions', [`What is ${name}? Give one example.`]);
    setIfEmpty(row, 'exam_tips', `Use precise terms when writing about ${name} in exams.`);
    setIfEmpty(row, 'hots_question', `How would you apply ${name} to a new situation?`);
    setIfEmpty(row, 'self_reflection_prompt', `What part of ${name} was hardest to understand?`);
    return row;
  });
  return out;
}

/**
 * Fill missing canonical template sections after fallbacks (AI Generator batch completeness).
 * @param {string} toolSlug
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [meta]
 */
export function padAiGeneratorCanonicalSections(toolSlug, data, meta = {}) {
  const slug = String(toolSlug || '').trim();
  let out =
    data && typeof data === 'object' && !Array.isArray(data)
      ? normalizeStructuredArrayFields({ ...data })
      : {};
  out = applyAiGeneratorSectionFallbacks(slug, out);

  if (slug === 'lesson-planner') {
    out = scaffoldLessonPlannerSections(out, meta);
  } else if (slug === 'study-schedule-maker') {
    out = scaffoldStudyScheduleSections(out, meta);
  } else if (slug === 'homework-creator') {
    out = scaffoldHomeworkSections(out, meta);
  } else if (slug === 'concept-mastery-helper' || slug === 'concept-breakdown-explainer') {
    out = scaffoldConceptRows(slug, out, meta);
  }

  if (!validateAllCanonicalToolFields(slug, out).valid) {
    out = scaffoldGenericSections(slug, out, meta);
  }

  return normalizeStructuredArrayFields(out);
}

export function hasFieldContent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) {
    return value.some((x) => {
      if (x && typeof x === 'object') {
        return Object.values(x).some((v) => String(v ?? '').trim().length >= MIN_TEXT_LEN);
      }
      return String(x ?? '').trim().length >= MIN_TEXT_LEN;
    });
  }
  if (typeof value === 'object') {
    return Object.values(value).some((v) => String(v ?? '').trim().length >= MIN_TEXT_LEN);
  }
  return String(value).trim().length >= MIN_TEXT_LEN;
}

function validationTargets(toolSlug, structured) {
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return [structured];
  }
  if (toolSlug === 'concept-mastery-helper' && Array.isArray(structured.concepts) && structured.concepts.length) {
    return structured.concepts.filter((c) => c && typeof c === 'object');
  }
  if (toolSlug === 'concept-breakdown-explainer' && Array.isArray(structured.concepts) && structured.concepts.length) {
    return [structured.concepts[0]];
  }
  return [structured];
}

function extraArrayRules(toolSlug, structured) {
  const missing = [];
  if (!structured || typeof structured !== 'object') return missing;

  if (toolSlug === 'flashcard-generator' || toolSlug === 'my-study-decks') {
    const cards =
      (Array.isArray(structured.application_hots_cards) && structured.application_hots_cards.length
        ? structured.application_hots_cards
        : null) || (Array.isArray(structured.cards) ? structured.cards : []);
    const min = toolSlug === 'my-study-decks' ? 10 : 5;
    const good = cards.filter(
      (c) => c && typeof c === 'object' && hasFieldContent(c.front) && hasFieldContent(c.back),
    );
    if (good.length < min) {
      missing.push(`Flashcard set (need ${min}+ cards, each with front and back)`);
    }
  }

  if (toolSlug === 'worksheet-mcq-generator' || toolSlug === 'smart-qa-practice-generator') {
    const qs = Array.isArray(structured.questions) ? structured.questions : [];
    const sectionQs = Array.isArray(structured.sections)
      ? structured.sections.flatMap((s) => (Array.isArray(s?.questions) ? s.questions : []))
      : [];
    if (qs.length + sectionQs.length < 3) {
      missing.push('Question set (need at least 3 questions across sections)');
    }
  }

  if (toolSlug === 'homework-creator') {
    const pq = Array.isArray(structured.practice_questions) ? structured.practice_questions : [];
    const q = Array.isArray(structured.questions) ? structured.questions : [];
    if (pq.length + q.length < 2) {
      missing.push('Homework questions (need at least 2 items)');
    }
  }

  return missing;
}

/**
 * Every canonical template section must have content before AI Generator saves a record.
 * @param {string} toolSlug
 * @param {Record<string, unknown>} structured
 */
export function validateAllCanonicalToolFields(toolSlug, structured) {
  const t = getAiToolTemplate(toolSlug);
  if (!t) {
    return { valid: true, missingSections: [], missingDetails: [] };
  }

  const missingDetails = [];
  const targets = validationTargets(toolSlug, structured);
  let totalHeadings = 0;
  let filledHeadings = 0;

  for (const heading of t.canonicalHeadings || []) {
    const keys = Array.isArray(heading.storageKeys) ? heading.storageKeys : [];
    if (!keys.length) continue;
    totalHeadings += 1;
    const label = heading.label || heading.id || keys[0];
    const anyTargetFilled = targets.some((target) =>
      keys.some((k) => hasFieldContent(target?.[k])),
    );
    if (anyTargetFilled) {
      filledHeadings += 1;
    } else {
      missingDetails.push({ order: heading.order, label, keys });
    }
  }

  for (const extra of extraArrayRules(toolSlug, structured)) {
    missingDetails.push({ order: 999, label: extra, keys: [] });
  }

  const missingSections = missingDetails.map((m) => m.label);
  return {
    valid: missingSections.length === 0,
    missingSections,
    missingDetails,
    totalHeadings,
    filledHeadings,
  };
}

/** Minimum share of canonical sections that must be filled (cost saver defaults to 50%). */
export function getAiGeneratorMinSectionFillRatio() {
  const fromEnv = Number(process.env.AI_GENERATOR_MIN_SECTION_FILL_RATIO);
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv <= 1) return fromEnv;
  return isAiGeneratorStrictAllFieldsEnabled() ? 1 : 0.5;
}

/**
 * Cost saver: accept generation when ≥50% canonical sections are filled (configurable).
 * Quality mode: every section must be filled.
 */
export function validateCanonicalFieldsForSave(toolSlug, structured, meta = {}) {
  const allFields = validateAllCanonicalToolFields(toolSlug, structured);
  if (allFields.valid) return allFields;

  const strict = isStrictAllFieldsValidation(meta);
  if (strict) return allFields;

  const minRatio = getAiGeneratorMinSectionFillRatio();
  const total = Number(allFields.totalHeadings) || 0;
  const filled = Number(allFields.filledHeadings) || 0;
  const ratio = total > 0 ? filled / total : 1;
  if (ratio >= minRatio) {
    return {
      ...allFields,
      valid: true,
      partialFill: true,
      fillRatio: ratio,
    };
  }

  const minPct = Math.round(minRatio * 100);
  return {
    ...allFields,
    valid: false,
    message: `At least ${minPct}% of template sections must be filled (${filled}/${total}).`,
  };
}

export function buildAllFieldsRequiredMessage(missingSections = []) {
  if (!missingSections.length) return '';
  const numbered = missingSections.map((s, i) => `${i + 1}. ${s}`).join('; ');
  return `All template fields are required. Missing (${missingSections.length}): ${numbered}.`;
}

/** Tool-aware retry line for any missing canonical sections. */
export function buildCanonicalFieldsRetryHint(toolSlug, missingSections = []) {
  if (!missingSections.length) return '';
  const slug = String(toolSlug || '').trim();
  const list = missingSections.join('; ');
  const base = `Fill EVERY missing section with real ${slug.replace(/-/g, ' ')} content. Missing: ${list}.`;
  const extras = {
    'homework-creator':
      ' Include practice_questions[] (min 2), application_tasks[], creative_thinking_question, real_life_observation_task, challenge_question, support_hint, answer_hints, parent_note — all non-empty.',
    'lesson-planner':
      ' Include introduction_warmup, teaching_strategy, teaching_activities[], teacher_talk_points[], student_tasks[], formative_assessment_questions[], differentiation_plan, homework_practice, teaching_aids_required[], closure_exit_ticket.',
    'activity-project-generator':
      ' Include all 13 fields: subtopic_link_prior_knowledge, ncf_competency_alignment, teacher_instructions[], student_instructions[], differentiation, assessment_criteria_rubric[], real_life_application, reflection_exit_ticket.',
    'project-idea-lab':
      ' Include all 14 project fields including safety_care_instructions[], observation_table, creative_output, self_assessment_rubric[].',
  };
  return `${base}${extras[slug] || ''}`;
}

export function countEmptyCanonicalSections(toolSlug, structured) {
  return validateAllCanonicalToolFields(toolSlug, structured).missingSections.length;
}

export function isAiGeneratorStrictAllFieldsEnabled() {
  const raw = String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/** True when AI Generator (or caller) requires every canonical template field before save. */
export function isStrictAllFieldsValidation(meta = {}) {
  return (
    meta.requireAllCanonicalFields === true ||
    (meta.requireAllCanonicalFields !== false && isAiGeneratorStrictAllFieldsEnabled())
  );
}
