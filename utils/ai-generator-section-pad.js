import { getAiToolTemplate } from '../config/aiToolTemplates.js';
import { applyAiGeneratorSectionFallbacks } from './ai-generator-section-fallbacks.js';
import { mustEnforceStoryPassageLanguageCompliance } from './story-passage-subject.js';
import { isAiGeneratorCostSaverEnabled } from './ai-generator-batch-config.js';
import {
  conceptQuestionsForBand,
  countValidQuestionRows,
  genericSectionFallback,
  instructionsForBand,
  isTemplateSectionHeaderLine,
  learningObjectivesForBand,
  questionTextFromRow,
  resolveScaffoldBand,
  isMathsBand,
  isNumericalBand,
  applicationTasksForBand,
  realLifeActivityForBand,
  creativeQuestionForBand,
  collaborativeTaskForBand,
  challengeQuestionForBand,
  assessmentRubricForBand,
  expectedOutcomesForBand,
} from './subject-scaffold-profile.js';

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

const PRESERVE_OBJECT_ARRAY_KEYS = new Set([
  'cards',
  'flashcard_set',
  'flashcards',
  'application_hots_cards',
  'application_cards',
  'sections',
  'questions',
  'concepts',
  'criteria',
  'important_terms',
  'practice_questions',
  'read_and_recall_questions',
  'think_and_infer_questions',
  'apply_and_connect_questions',
  'concept_based_questions',
  'application_oriented_tasks',
]);

const STRUCTURED_OBJECT_ARRAY_HINT_KEYS = new Set([
  'question',
  'front',
  'back',
  'term',
  'formula',
  'name',
  'title',
  'sectionName',
  'section',
  'excellent',
  'good',
  'satisfactory',
  'needs_improvement',
  'options',
  'type',
  'definition',
  'marks',
  'answer',
  'task',
  'solution',
]);

function shouldPreserveObjectArray(value) {
  if (!Array.isArray(value) || !value.length) return false;
  return value.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const keys = Object.keys(item);
    if (keys.length >= 2) return true;
    return keys.some((k) => STRUCTURED_OBJECT_ARRAY_HINT_KEYS.has(k));
  });
}

/** Flatten LLM object-array fields (e.g. [{ description: "..." }]) into string arrays for viewers. */
export function normalizeStructuredArrayFields(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (!Array.isArray(value)) continue;
    if (PRESERVE_OBJECT_ARRAY_KEYS.has(key) || shouldPreserveObjectArray(value)) continue;
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
  for (const key of PRESERVE_OBJECT_ARRAY_KEYS) {
    if (!Array.isArray(out[key])) continue;
    out[key] = out[key].map((c) => {
      if (!c || typeof c !== 'object') return c;
      const row = { ...c };
      if (!hasFieldContent(row.front)) {
        row.front =
          textFromObjectRow(row) || String(row.task || row.term || row.question || '').trim();
      }
      if (!hasFieldContent(row.back)) {
        row.back =
          textFromObjectRow(row) || String(row.solution || row.definition || row.answer || '').trim();
      }
      return row;
    });
  }
  return out;
}

function ctx(meta = {}) {
  const topic = String(
    meta.subTopic || meta.subtopic || meta.topic || meta.topicName || meta.subject || 'Lesson',
  )
    .trim()
    .replace(/^this subtopic$/i, String(meta.subject || 'Lesson').trim() || 'Lesson');
  const subject = String(meta.subject || 'Science').trim();
  const title = String(meta.title || topic).trim().replace(/\bthis subtopic\b/gi, topic);
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
  const band = resolveScaffoldBand(subject);
  const lessonTitle = String(out.lesson_name || out.title || out.name || `${topic} — ${subject}`).trim();
  out.lesson_name = lessonTitle;
  out.title = String(out.title || lessonTitle).trim() || lessonTitle;

  setIfEmpty(out, 'learning_objectives', learningObjectivesForBand(topic, subject, band));
  setIfEmpty(
    out,
    'ncf_competency_alignment',
    isMathsBand(band)
      ? `Aligns with mathematical reasoning, problem-solving, and NCF numeracy competencies for ${topic}.`
      : band === 'stem'
        ? `Aligns with scientific inquiry, problem-solving, and NCF competencies for ${topic}.`
        : band === 'english'
          ? `Aligns with communication, comprehension, and NCF language competencies for ${topic}.`
          : `Aligns with inquiry, critical thinking, and NCF competencies for ${topic}.`,
  );
  setIfEmpty(
    out,
    'prior_knowledge_diagnostic',
    isMathsBand(band)
      ? `Solve one easy warm-up numerical related to ${topic}.`
      : band === 'stem'
        ? `What do you already know about ${topic}? Name one formula or observation from daily life.`
        : `What do you already know about ${topic}? Share one example from daily life.`,
  );
  setIfEmpty(
    out,
    'introduction_warmup',
    firstFilledLines(out, ['teaching_strategy', 'teaching_activities', 'activities'])[0] ||
      (isMathsBand(band)
        ? `Warm-up: solve 2 quick numericals on ${topic} on the board.`
        : band === 'stem'
          ? `Warm-up: predict an outcome related to ${topic}, then verify with a quick demo or diagram.`
          : `Warm-up: quick recall of prior ideas linked to ${topic}.`),
  );
  setIfEmpty(
    out,
    'teaching_strategy',
    firstFilledLines(out, ['introduction_warmup', 'teaching_activities', 'activities'])[0] ||
      (isMathsBand(band)
        ? `Model one worked example on ${topic}, then guided practice with increasing difficulty.`
        : band === 'stem'
          ? `Blend board explanation, worked example, and guided practice on ${topic}.`
          : `Blend short lecture, paired discussion, and guided annotation focused on ${topic}.`),
  );
  setIfEmpty(
    out,
    'teaching_activities',
    isMathsBand(band)
      ? [
          `Teacher solves a standard numerical on ${topic} with step-by-step working.`,
          `Students practise a set of ${topic} numericals in pairs and compare methods.`,
        ]
      : band === 'stem'
        ? [
            `Demonstrate ${topic} with a labelled diagram and one numerical example.`,
            `Students solve a short problem set in pairs and compare methods.`,
          ]
        : [
            `Guided explanation of ${topic} with board notes and student questions.`,
            `Pair activity: students classify or sort examples related to ${topic}.`,
          ],
  );
  setIfEmpty(out, 'activities', out.teaching_activities);
  setIfEmpty(
    out,
    'teacher_talk_points',
    firstFilledLines(out, ['teaching_activities', 'activities', 'teaching_strategy']).map((x) => `Teacher: ${x}`),
  );
  setIfEmpty(
    out,
    'student_tasks',
    isMathsBand(band)
      ? [
          `Students solve ${topic} numericals in notebooks with Given, Method, Working, and Answer.`,
          `Students create one word problem on ${topic} and exchange with a partner to solve.`,
        ]
      : isNumericalBand(band)
        ? [
            `Students record given data, substitute into formulas, and check units for ${topic}.`,
            `Students explain one real-life application of ${topic} in notebooks.`,
          ]
        : [
            `Students record definitions and answers about ${topic} in notebooks.`,
            `Students solve or explain one practice question on ${topic} and self-check.`,
          ],
  );
  setIfEmpty(
    out,
    'formative_assessment_questions',
    isMathsBand(band)
      ? [
          `Solve one direct numerical on ${topic}.`,
          `Solve one word problem on ${topic}.`,
        ]
      : band === 'stem'
        ? [
            `Define the key term central to ${topic} and give its unit.`,
            `Solve one short numerical based on ${topic}.`,
          ]
      : band === 'english'
        ? [
            `State one definition central to ${topic} in your own words.`,
            `Cite one line from the text that supports your understanding of ${topic}.`,
          ]
        : [
            `State one key idea about ${topic} in your own words.`,
            `Give one example that supports your understanding of ${topic}.`,
          ],
  );
  setIfEmpty(
    out,
    'differentiation_plan',
    isMathsBand(band)
      ? `Support: formula hints and one worked example. Extension: design a challenging multi-step numerical on ${topic}.`
      : isNumericalBand(band)
        ? `Support: formula sheet and step hints. Extension: design a new problem involving ${topic}.`
        : `Support: sentence stems and visuals. Extension: students design a new example for ${topic}.`,
  );
  setIfEmpty(
    out,
    'homework_practice',
    isMathsBand(band)
      ? `Solve six numericals on ${topic} (mix of direct and word problems). Show full working.`
      : band === 'stem'
        ? `Solve three short questions on ${topic}; show formula, substitution, and units.`
        : band === 'english'
          ? `Read the assigned passage on ${topic}; write two evidence-based responses in your workbook.`
          : `Complete two short written tasks on ${topic} with examples from ${subject}.`,
  );
  setIfEmpty(
    out,
    'teaching_aids_required',
    isMathsBand(band)
      ? ['Board', 'Calculator', 'Graph paper', 'Textbook']
      : isNumericalBand(band)
        ? ['Board', 'Chart paper', 'Calculator', 'Textbook']
        : ['Board', 'Printed excerpt', 'Highlighters'],
  );
  setIfEmpty(
    out,
    'closure_exit_ticket',
    isMathsBand(band)
      ? `Exit ticket: Solve one ${topic} numerical and write the final answer with units.`
      : isNumericalBand(band)
        ? `Exit ticket: Write the formula for ${topic} and one real-life use.`
        : `Exit ticket: In one sentence, explain why ${topic} matters in ${subject}.`,
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
  const band = resolveScaffoldBand(subject);
  setIfEmpty(out, 'title', `${topic} — Homework`);
  setIfEmpty(out, 'instructions', instructionsForBand(topic, subject, band));
  setIfEmpty(out, 'learning_objectives', learningObjectivesForBand(topic, subject, band));
  const existingPq = [
    ...(Array.isArray(out.practice_questions) ? out.practice_questions : []),
    ...(Array.isArray(out.questions) ? out.questions : []),
  ];
  const hasObjectQuestions = existingPq.some(
    (q) =>
      q &&
      typeof q === 'object' &&
      questionTextFromRow(q).length >= MIN_TEXT_LEN &&
      !isTemplateSectionHeaderLine(questionTextFromRow(q)),
  );
  if (!hasObjectQuestions && countValidQuestionRows(existingPq) < 3) {
    out.practice_questions = conceptQuestionsForBand(topic, subject, band);
    out.questions = out.practice_questions;
  } else if (!hasObjectQuestions) {
    const cleaned = existingPq.filter((row) => {
      const text = questionTextFromRow(row);
      return text.length >= MIN_TEXT_LEN && !isTemplateSectionHeaderLine(text);
    });
    out.practice_questions = cleaned;
    out.questions = cleaned;
  }
  setIfEmpty(out, 'application_tasks', applicationTasksForBand(topic, subject, band));
  setIfEmpty(out, 'creative_thinking_question', creativeQuestionForBand(topic, subject, band));
  setIfEmpty(out, 'real_life_observation_task', realLifeActivityForBand(topic, subject, band));
  setIfEmpty(
    out,
    'challenge_question',
    challengeQuestionForBand(topic, subject, band),
  );
  setIfEmpty(out, 'support_hint', isMathsBand(band) ? 'Write Given, Method, Working, and Answer. Check units and estimate to verify.' : 'Use your class notes and textbook glossary if you get stuck.');
  setIfEmpty(
    out,
    'answer_hints',
    isMathsBand(band)
      ? `Key steps: identify known values, choose method/formula, substitute, calculate, and state the answer with units for ${topic}.`
      : isNumericalBand(band)
        ? `Key ideas: definitions, formulas with units, and worked steps for ${topic}.`
        : `Key ideas: evidence, examples, and clear definitions for ${topic}.`,
  );
  setIfEmpty(out, 'parent_note', `Please encourage your child to explain ${topic} aloud after finishing.`);
  return out;
}

/** Ensure homework validation passes when the model returns too few practice questions. */
export function ensureHomeworkPracticeQuestions(structured, meta = {}) {
  const out = structured && typeof structured === 'object' ? { ...structured } : {};
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this topic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const band = resolveScaffoldBand(subject);
  const countValid = (rows) => countValidQuestionRows(rows, 8);

  const existing = Array.isArray(out.practice_questions) ? [...out.practice_questions] : [];
  const fromQuestions = Array.isArray(out.questions) ? out.questions : [];
  const validCount = countValid(existing) + countValid(fromQuestions);
  if (validCount >= 3) {
    const cleaned = [...existing, ...fromQuestions].filter((row) => {
      const text = questionTextFromRow(row);
      return text.length >= 8 && !isTemplateSectionHeaderLine(text);
    });
    if (cleaned.length) {
      out.practice_questions = cleaned;
      out.questions = cleaned;
    }
    return out;
  }

  const scaffold = conceptQuestionsForBand(topic, subject, band);
  const merged = [...existing];
  for (const row of scaffold) {
    if (countValid(merged) >= 3) break;
    merged.push(row);
  }
  out.practice_questions = merged;
  out.questions = merged;
  return out;
}

function scaffoldQuickAssignmentSections(structured, meta = {}) {
  const out = { ...structured };
  const { topic, subject } = ctx(meta);
  const band = resolveScaffoldBand(subject);
  const assignmentTitle = String(out.assignment_title || out.title || `${topic} — Assignment`).trim();
  out.assignment_title = assignmentTitle;
  out.title = String(out.title || assignmentTitle).trim() || assignmentTitle;
  setIfEmpty(out, 'learning_objectives', learningObjectivesForBand(topic, subject, band));
  setIfEmpty(out, 'instructions', instructionsForBand(topic, subject, band));
  const existingCq = Array.isArray(out.concept_based_questions)
    ? out.concept_based_questions
    : Array.isArray(out.questions)
      ? out.questions
      : [];
  const hasObjectQuestions = existingCq.some(
    (q) =>
      q &&
      typeof q === 'object' &&
      questionTextFromRow(q).length >= MIN_TEXT_LEN &&
      !isTemplateSectionHeaderLine(questionTextFromRow(q)),
  );
  if (!hasObjectQuestions && countValidQuestionRows(existingCq) < 3) {
    out.concept_based_questions = conceptQuestionsForBand(topic, subject, band);
    out.questions = out.concept_based_questions;
    out.practice_questions = out.concept_based_questions;
  } else if (!hasObjectQuestions) {
    out.concept_based_questions = existingCq.filter((row) => {
      const text = questionTextFromRow(row);
      return text.length >= MIN_TEXT_LEN && !isTemplateSectionHeaderLine(text);
    });
    out.questions = out.concept_based_questions;
    out.practice_questions = out.concept_based_questions;
  }
  setIfEmpty(out, 'application_oriented_tasks', applicationTasksForBand(topic, subject, band));
  setIfEmpty(out, 'real_life_competency_activity', realLifeActivityForBand(topic, subject, band));
  setIfEmpty(out, 'creative_thinking_question', creativeQuestionForBand(topic, subject, band));
  setIfEmpty(out, 'collaborative_discussion_task', collaborativeTaskForBand(topic, subject, band));
  setIfEmpty(out, 'challenge_question_advanced', challengeQuestionForBand(topic, subject, band));
  setIfEmpty(out, 'assessment_criteria_rubric', assessmentRubricForBand(band));
  setIfEmpty(out, 'expected_learning_outcomes', expectedOutcomesForBand(topic, subject, band));
  return out;
}

function scaffoldGenericSections(toolSlug, structured, meta = {}) {
  const t = getAiToolTemplate(toolSlug);
  if (!t) return structured;
  const out = { ...structured };
  const { topic, subject } = ctx(meta);
  const band = resolveScaffoldBand(subject);
  const check = validateAllCanonicalToolFields(toolSlug, out);
  for (const detail of check.missingDetails || []) {
    const keys = Array.isArray(detail.keys) ? detail.keys : [];
    const primary = keys[0];
    if (!primary) continue;
    const label = String(detail.label || primary).trim();
    const isList = keys.some((k) => Array.isArray(out[k]));
    setIfEmpty(out, primary, genericSectionFallback(label, topic, subject, band, isList));
  }
  return out;
}

function scaffoldConceptBreakdownSections(structured, meta = {}) {
  const out = { ...structured };
  const { topic, subject, title } = ctx(meta);
  const conceptTitle = String(
    out.concept_title || out.concept_name || out.title || title || topic,
  ).trim();
  out.concept_title = conceptTitle;
  out.concept_name = conceptTitle;
  out.title = String(out.title || conceptTitle).trim() || conceptTitle;
  setIfEmpty(
    out,
    'simple_definition',
    `${conceptTitle} is a core idea within ${topic}, explained using ${subject} vocabulary and evidence.`,
  );
  setIfEmpty(out, 'breakdown_steps', [
    `Start with the definition of ${conceptTitle} using textbook terms.`,
    `Break the idea into cause, process, and outcome with a labelled diagram.`,
    `Close with one classroom example that shows ${conceptTitle} in action.`,
  ]);
  setIfEmpty(out, 'real_life_examples', [
    `One device or phenomenon that demonstrates ${conceptTitle}.`,
    `One numerical or formula application for ${conceptTitle}.`,
  ]);
  setIfEmpty(out, 'important_terms', [
    { term: conceptTitle, definition: `Central term for ${topic}.` },
    { term: topic, definition: `Broader chapter context for ${conceptTitle}.` },
  ]);
  setIfEmpty(out, 'concept_check_questions', [
    `Define ${conceptTitle} in one sentence.`,
    `Give one example of ${conceptTitle} from ${topic}.`,
  ]);
  setIfEmpty(
    out,
    'application_thinking_question',
    `Use ${conceptTitle}: state the formula (if any), substitute values, and calculate.`,
  );
  setIfEmpty(
    out,
    'higher_order_thinking_prompt',
    `Compare two cases involving ${conceptTitle} and justify which explanation is stronger.`,
  );
  setIfEmpty(
    out,
    'quick_revision_summary',
    `${conceptTitle}: definition, one diagram cue, one example, and one exam tip for ${topic}.`,
  );
  if (Array.isArray(out.concepts) && out.concepts.length) {
    const row = out.concepts[0] && typeof out.concepts[0] === 'object' ? { ...out.concepts[0] } : {};
    out.concepts = [
      {
        ...row,
        concept_title: out.concept_title,
        concept_name: out.concept_name,
        simple_definition: out.simple_definition,
        breakdown_steps: out.breakdown_steps,
        real_life_examples: out.real_life_examples,
        important_terms: out.important_terms,
        concept_check_questions: out.concept_check_questions,
        application_thinking_question: out.application_thinking_question,
        higher_order_thinking_prompt: out.higher_order_thinking_prompt,
        quick_revision_summary: out.quick_revision_summary,
      },
    ];
  }
  return out;
}

function scaffoldConceptRows(toolSlug, structured, meta = {}) {
  if (!Array.isArray(structured.concepts) || !structured.concepts.length) return structured;
  const out = { ...structured };
  const { topic, subject } = ctx(meta);
  const variantN = Number(meta.generationVariant) || 0;
  const variantNote = variantN > 1 ? ` (set ${variantN})` : '';
  out.concepts = structured.concepts.map((concept, i) => {
    const row = concept && typeof concept === 'object' ? { ...concept } : {};
    const baseName = String(row.concept_name || row.concept_title || row.title || `${topic} — Concept ${i + 1}`).trim();
    const name = baseName;
    setIfEmpty(row, 'concept_name', name);
    setIfEmpty(row, 'concept_title', name);
    setIfEmpty(
      row,
      'simple_definition',
      `A clear definition of ${baseName}${variantNote} linked to ${topic}.`,
    );
    setIfEmpty(row, 'why_important', `${baseName} helps students understand ${topic} in ${subject}.`);
    setIfEmpty(row, 'prior_knowledge_needed', `Basic vocabulary and ideas about ${topic}.`);
    setIfEmpty(
      row,
      'lesson',
      `Step-by-step explanation of ${baseName}: definition, labelled diagram, worked example, and one check question from ${topic}.`,
    );
    setIfEmpty(
      row,
      'real_example',
      `One concrete example of ${baseName} — device, formula application, or phenomenon.`,
    );
    setIfEmpty(row, 'common_mistakes', [`Confusing ${name} with a similar term.`]);
    setIfEmpty(row, 'key_points', [`Remember the core idea of ${name}.`]);
    setIfEmpty(row, 'concept_check_questions', [`Define ${name}. Give one example.`]);
    setIfEmpty(row, 'exam_tips', `Use precise terms when writing about ${name} in exams.`);
    setIfEmpty(row, 'hots_question', `Apply ${name}: solve one problem or explain one non-standard case.`);
    setIfEmpty(row, 'self_reflection_prompt', `Which step in ${name} needs more practice?`);
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

  const skipEnglishScaffold = mustEnforceStoryPassageLanguageCompliance(meta.subject);
  if (skipEnglishScaffold) {
    return normalizeStructuredArrayFields(out);
  }

  if (slug === 'lesson-planner') {
    out = scaffoldLessonPlannerSections(out, meta);
  } else if (slug === 'study-schedule-maker') {
    out = scaffoldStudyScheduleSections(out, meta);
  } else if (slug === 'homework-creator') {
    out = scaffoldHomeworkSections(out, meta);
  } else if (slug === 'concept-mastery-helper') {
    out = scaffoldConceptRows(slug, out, meta);
  } else if (slug === 'concept-breakdown-explainer') {
    out = scaffoldConceptBreakdownSections(out, meta);
    out = scaffoldConceptRows(slug, out, meta);
  } else if (slug === 'quick-assignment-builder') {
    out = scaffoldQuickAssignmentSections(out, meta);
  }

  if (
    !validateAllCanonicalToolFields(slug, out).valid &&
    slug !== 'reading-practice-room' &&
    slug !== 'story-passage-creator'
  ) {
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
  if (toolSlug === 'concept-breakdown-explainer') {
    return [structured];
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
    const good = cards.filter((c) => {
      if (!c || typeof c !== 'object') return false;
      const front = String(c.front || c.task || c.question || c.term || '').trim();
      const back = String(c.back || c.solution || c.answer || c.definition || '').trim();
      return front.length >= MIN_TEXT_LEN && back.length >= MIN_TEXT_LEN;
    });
    if (good.length < min) {
      missing.push(`Flashcard set (need ${min}+ cards, each with front and back)`);
    }
  }

  if (toolSlug === 'worksheet-mcq-generator') {
    const qs = Array.isArray(structured.questions) ? structured.questions : [];
    const sectionQs = Array.isArray(structured.sections)
      ? structured.sections.flatMap((s) => (Array.isArray(s?.questions) ? s.questions : []))
      : [];
    if (qs.length + sectionQs.length < 3) {
      missing.push('Question set (need at least 3 questions across sections)');
    }
  }

  if (toolSlug === 'smart-qa-practice-generator') {
    const qs = Array.isArray(structured.questions) ? structured.questions : [];
    const sectionQs = Array.isArray(structured.sections)
      ? structured.sections.flatMap((s) => (Array.isArray(s?.questions) ? s.questions : []))
      : [];
    if (qs.length + sectionQs.length < 3) {
      missing.push('Question set (need at least 3 questions across sections)');
    }
    const filledSections = Array.isArray(structured.sections)
      ? structured.sections.filter((s) => Array.isArray(s?.questions) && s.questions.length).length
      : 0;
    if (filledSections > 0 && filledSections < 7) {
      missing.push('Practice Q&A sections (need questions in all sections A–G)');
    }
  }

  if (toolSlug === 'homework-creator') {
    const countValidHomeworkQuestion = (item) => {
      if (typeof item === 'string') return String(item).trim().length >= 8;
      if (item && typeof item === 'object') {
        return String(item.question || item.prompt || item.text || '').trim().length >= 8;
      }
      return false;
    };
    const pq = Array.isArray(structured.practice_questions) ? structured.practice_questions : [];
    const q = Array.isArray(structured.questions) ? structured.questions : [];
    const good = [...pq, ...q].filter(countValidHomeworkQuestion).length;
    if (good < 3) {
      missing.push('Homework questions (need at least 3 items)');
    }
  }

  if (toolSlug === 'quick-assignment-builder') {
    const cq = Array.isArray(structured.concept_based_questions)
      ? structured.concept_based_questions
      : [];
    const q = Array.isArray(structured.questions) ? structured.questions : [];
    if (cq.length + q.length < 3) {
      missing.push('Concept-based questions (need at least 3 items)');
    }
  }

  if (toolSlug === 'exam-question-paper-generator') {
    const sectionKeys = ['section_a', 'section_b', 'section_c', 'section_d', 'section_e'];
    const filled = sectionKeys.filter((k) => {
      const rows = Array.isArray(structured[k]) ? structured[k] : [];
      return rows.some((q) => String(q?.question || q?.prompt || '').trim().length >= 10);
    }).length;
    if (filled > 0 && filled < 5) {
      missing.push('Exam question sections (need questions in all sections A–E)');
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
    'quick-assignment-builder':
      ' Include assignment_title, learning_objectives[], instructions, concept_based_questions[] (min 3 with question text), application_oriented_tasks[], real_life_competency_activity, creative_thinking_question, collaborative_discussion_task, challenge_question_advanced, assessment_criteria_rubric, expected_learning_outcomes[].',
    'lesson-planner':
      ' Include introduction_warmup, teaching_strategy, teaching_activities[], teacher_talk_points[], student_tasks[], formative_assessment_questions[], differentiation_plan, homework_practice, teaching_aids_required[], closure_exit_ticket.',
    'activity-project-generator':
      ' Include all 13 fields: subtopic_link_prior_knowledge, ncf_competency_alignment, teacher_instructions[], student_instructions[], differentiation, assessment_criteria_rubric[], real_life_application, reflection_exit_ticket.',
    'project-idea-lab':
      ' Include all 14 project fields including safety_care_instructions[], observation_table, creative_output, self_assessment_rubric[].',
    'reading-practice-room':
      ' Include ALL 13 sections with REAL content in the output language. passage = full story (120+ words). Never use section headings like "Passage / Story for … in Hindi." as field values. Min 2 real questions in each question array.',
    'story-passage-creator':
      ' Include ALL 19 sections with REAL content in the output language. passage = full story (120+ words). Never echo canonical section labels. Min 2 real questions in each question array.',
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
