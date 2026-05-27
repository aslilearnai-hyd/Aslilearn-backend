import { PDFParse } from 'pdf-parse';
import geminiService from './gemini-service.js';
import {
  AI_TOOL_ORDERED_SLUGS,
  buildToolAliasToSlugMap,
  buildStrictOutputHintsMap,
  buildAiGeneratorStructuredPrompt,
  formatStructuredToolOutput,
  getToolDisplayTitle,
  getContentTypeDefault,
  isDeprecatedAiToolIdentifier,
  isValidAiToolSlug,
} from '../config/aiToolTemplates.js';

const TOOL_ALIAS_TO_SLUG = buildToolAliasToSlugMap();

const CONTENT_TYPE_BY_TOOL_SLUG = Object.fromEntries(
  AI_TOOL_ORDERED_SLUGS.map((slug) => [slug, getContentTypeDefault(slug)]),
);

const TOOL_STRICT_OUTPUT_HINTS = buildStrictOutputHintsMap();

const toStringList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

const toQuestionArray = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = entry.trim();
        return text ? { question: text, options: [], answer: '' } : null;
      }
      if (entry && typeof entry === 'object') {
        const question =
          String(entry.question || entry.prompt || entry.text || entry.statement || entry.title || '').trim();
        if (!question) return null;
        const options = Array.isArray(entry.options)
          ? entry.options.map((opt) => String(opt || '').trim()).filter(Boolean)
          : [];
        const answer = String(entry.answer || entry.correctAnswer || '').trim();
        return { question, options, answer };
      }
      return null;
    })
    .filter(Boolean);

const isHeadingLikeLine = (text) =>
  /\b(chapter|topic|lesson|unit|syllabus|mcqs?)\b/i.test(text) && !/[?]/.test(text);

const looksLikeQuestionPrompt = (text) =>
  /[?]|_{3,}|^\s*(what|which|why|how|define|choose|fill|select|state|identify)\b/i.test(text);

const sanitizeWorksheetQuestions = (questions = []) =>
  questions
    .map((row) => ({
      question: String(row?.question || '').replace(/\s+/g, ' ').trim(),
      options: (Array.isArray(row?.options) ? row.options : [])
        .map((opt) => String(opt || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .reduce((acc, opt) => {
          const labelMatch = opt.match(/^([A-D])\)\s*/i);
          const key = labelMatch ? labelMatch[1].toUpperCase() : opt.toLowerCase();
          if (!acc.some((existing) => {
            const existingMatch = existing.match(/^([A-D])\)\s*/i);
            return (existingMatch ? existingMatch[1].toUpperCase() : existing.toLowerCase()) === key;
          })) {
            acc.push(opt);
          }
          return acc;
        }, [])
        .slice(0, 4),
      answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((row) => row.question)
    .filter((row) => !isHeadingLikeLine(row.question))
    .filter((row) => looksLikeQuestionPrompt(row.question) || row.options.length >= 2)
    .filter((row, idx, arr) => arr.findIndex((q) => q.question.toLowerCase() === row.question.toLowerCase()) === idx);

export { buildDeterministicQuestionSetFromText } from './pdf-worksheet-extract.js';

/** Strings or arrays → trimmed non-empty lines (bullets / numbers stripped). */
function coerceBulletLines(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.replace(/^\s*[-*•]\s*|\s*\d+[\).]\s*/i, '').trim();
        if (item && typeof item === 'object') {
          const line = String(
            item.step ||
              item.text ||
              item.description ||
              item.detail ||
              item.instruction ||
              item.objective ||
              item.outcome ||
              item.goal ||
              item.point ||
              item.content ||
              item.activity ||
              '',
          ).trim();
          if (line) return line;
          const t = String(item.title || item.heading || item.name || '').trim();
          const d = String(item.description || item.details || item.body || '').trim();
          if (t && d) return `${t} — ${d}`;
          return t || d;
        }
        return String(item || '').trim();
      })
      .filter(Boolean);
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value)
      .flatMap((v) => coerceBulletLines(v))
      .filter(Boolean);
  }
  const s = String(value).trim();
  if (!s) return [];
  return s
    .split(/\n+|(?:\s*(?:;)\s*)/)
    .map((line) => line.replace(/^\s*[-*•]\s*|\s*\d+[\).]\s*/i, '').trim())
    .filter(Boolean);
}

/** PDF/Gemini sometimes puts a section heading in title — reject and fall back. */
const ACTIVITY_SECTION_HEADING_TITLE_RE =
  /^(?:\d+\.\s*)?(?:title\s*[—:-]\s*)?(materials required|learning objectives|step-by-step procedure|teacher instructions|expected learning outcomes|assessment criteria(?:\s*\(rubric\))?|rubric|real[-\s]?life application|title)\s*$/i;

/**
 * Clean activity title for storage and UI. Never return a bare template section name.
 */
export function sanitizeActivityTitle(rawTitle, rawName, slNo) {
  let t = String(rawTitle || '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^1\.\s*title\s*[—:-]\s*/i, '').trim();
  const parts = t.split(/\s*[—–]\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && ACTIVITY_SECTION_HEADING_TITLE_RE.test(parts[parts.length - 1])) {
    t = parts.slice(0, -1).join(' — ');
  }
  if (/title\s*[—:-]\s*materials required/i.test(t)) {
    t = t.replace(/\s*title\s*[—:-]\s*materials required\s*$/i, '').trim();
  }
  if (!t || ACTIVITY_SECTION_HEADING_TITLE_RE.test(t)) {
    const n = String(rawName || '').trim();
    if (n && !ACTIVITY_SECTION_HEADING_TITLE_RE.test(n)) return n;
    const num = slNo != null && slNo !== '' ? Number(slNo) : NaN;
    return Number.isFinite(num) ? `Activity ${num}` : 'Activity';
  }
  return t;
}

/**
 * Gemini often uses procedure / instructions / nested activity — map to materials + steps.
 */
export function normalizeActivityStructuredContent(raw /* pdfText reserved — do not paste raw PDF lines as steps */) {
  let source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  if (source.activity && typeof source.activity === 'object' && !Array.isArray(source.activity)) {
    source = { ...source.activity, ...source };
  }

  const pickAlias = (keys) => {
    for (const k of keys) {
      if (source[k] != null && source[k] !== '') return source[k];
    }
    return undefined;
  };
  if (source.materials == null || source.materials === '') {
    const m = pickAlias([
      'materials_required',
      'MaterialsRequired',
      'Materials',
      'material_list',
      'items_needed',
    ]);
    if (m != null) source.materials = m;
  }
  if (source.steps == null || source.steps === '') {
    const st = pickAlias([
      'step_by_step_procedure',
      'StepByStepProcedure',
      'Steps',
      'procedure_steps',
      'Procedure',
      'method',
      'how_to',
    ]);
    if (st != null) source.steps = st;
  }
  if (!String(source.title || '').trim() && String(source.Title || '').trim()) {
    source.title = source.Title;
  }

  let materials = coerceBulletLines(source.materials);
  if (!materials.length) {
    materials = [
      ...coerceBulletLines(source.materials_required),
      ...coerceBulletLines(source.material),
      ...coerceBulletLines(source.supplies),
      ...coerceBulletLines(source.equipment),
      ...coerceBulletLines(source.resources),
      ...coerceBulletLines(source.itemsNeeded),
    ].filter(Boolean);
  }

  /** (4) Student procedure only — do not fold teacher_instructions in here. */
  let steps = coerceBulletLines(source.step_by_step_procedure);
  if (!steps.length) steps = coerceBulletLines(source.steps);
  if (!steps.length) steps = coerceBulletLines(source.step);
  if (!steps.length) steps = coerceBulletLines(source.procedure);
  if (!steps.length) steps = coerceBulletLines(source.procedures);
  if (!steps.length) steps = coerceBulletLines(source.instructions);
  if (!steps.length) steps = coerceBulletLines(source.instruction);
  if (!steps.length) steps = coerceBulletLines(source.student_instructions);
  if (!steps.length && Array.isArray(source.activities)) {
    steps = source.activities.flatMap((a) => {
      if (typeof a === 'string') return coerceBulletLines(a);
      if (a && typeof a === 'object') {
        const line = [a.title || a.name, a.description || a.details || a.procedure].filter(Boolean).join(' — ');
        return line.trim() ? [line.trim()] : [];
      }
      return [];
    });
  }
  if (!steps.length && Array.isArray(source.phases)) {
    steps = source.phases.map((p) =>
      String(p?.name || p?.phase || '').trim()
        ? `${String(p.name || p.phase).trim()}${p?.details ? `: ${String(p.details).trim()}` : ''}`.trim()
        : ''
    ).filter(Boolean);
  }
  if (!steps.length) {
    const blob =
      typeof source.description === 'string'
        ? source.description
        : typeof source.overview === 'string'
          ? source.overview
          : typeof source.summary === 'string'
            ? source.summary
            : '';
    if (blob) steps = coerceBulletLines(blob);
  }
  if (!steps.length && typeof source.content === 'string') {
    steps = coerceBulletLines(source.content);
  }

  /** (5) Teacher instructions — separate from procedure. */
  let teacherInstructions = coerceBulletLines(source.teacher_instructions);
  if (!teacherInstructions.length) {
    teacherInstructions = coerceBulletLines(source.teacherInstructions);
  }

  /** (6) Student instructions (Curiosity workbook). */
  let studentInstructions = coerceBulletLines(source.student_instructions);
  if (!studentInstructions.length) studentInstructions = coerceBulletLines(source.studentInstructions);

  /** (2) Learning objectives — separate from (7) expected outcomes. */
  let learningObjectives = coerceBulletLines(source.learning_objectives);
  if (!learningObjectives.length) learningObjectives = coerceBulletLines(source.learningObjectives);

  const joinLines = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean).join('; ');
    return String(v).trim();
  };

  /** (7) Expected learning outcomes only — not the same as (2). */
  let learningOutcome = String(
    source.expected_learning_outcomes ||
      source.expectedLearningOutcomes ||
      source.learningOutcome ||
      source.learning_outcome ||
      source.outcome ||
      source.objective ||
      ''
  ).trim();
  if (!learningOutcome) learningOutcome = joinLines(source.learning_outcomes);
  if (!learningOutcome) learningOutcome = joinLines(source.objectives);

  /** (8) Rubric / assessment lines. */
  let rubricLines = coerceBulletLines(source.assessment_criteria_rubric);
  if (!rubricLines.length) rubricLines = coerceBulletLines(source.assessmentRubric);
  if (!rubricLines.length) rubricLines = coerceBulletLines(source.assessment);
  if (!rubricLines.length) rubricLines = coerceBulletLines(source.evaluation);

  /** (9) */
  const realLifeApplication = String(source.real_life_application || source.realLifeApplication || '').trim();

  if (steps.length === 0 && materials.length > 0) {
    steps = [
      'Use the materials listed above. Follow the detailed steps or instructions from the source PDF or your teacher guide.',
    ];
  }
  if (steps.length === 0 && learningOutcome) {
    steps = [`Learning focus: ${learningOutcome}`];
  }

  const isModelPlaceholderStep = (s) =>
    /^no structured steps were returned from the model/i.test(String(s || '').trim());
  if (steps.length === 1 && isModelPlaceholderStep(steps[0])) {
    steps = [];
  }

  const slNo = source.sl_no ?? source.question_number;
  const title = sanitizeActivityTitle(
    String(source.title || source.activityTitle || source.topic || '').trim(),
    String(source.name || '').trim(),
    slNo,
  );

  const subtopicLink = String(
    source.subtopic_link_prior_knowledge || source.prior_knowledge || source.subtopic_context || '',
  ).trim();
  const ncfAlignment = source.ncf_competency_alignment ?? source.competencies ?? source.learning_outcomes_ncf ?? '';
  const differentiation =
    source.differentiation != null && source.differentiation !== ''
      ? joinLines(source.differentiation) || String(source.differentiation).trim()
      : joinLines(source.differentiation_plan || source.udl_support);
  const reflectionTicket = String(
    source.reflection_exit_ticket || source.exit_ticket || source.reflection || '',
  ).trim();

  return {
    ...source,
    sl_no: source.sl_no ?? source.question_number,
    title,
    subtopic_link_prior_knowledge: subtopicLink,
    learning_objectives: learningObjectives.length ? learningObjectives : coerceBulletLines(source.learning_objectives),
    learningObjectives,
    ncf_competency_alignment: ncfAlignment,
    materials_required: materials,
    materials,
    step_by_step_procedure: steps,
    steps,
    teacher_instructions: teacherInstructions,
    teacherInstructions,
    student_instructions: studentInstructions,
    studentInstructions,
    differentiation,
    assessment_criteria_rubric: rubricLines,
    assessmentRubric: rubricLines,
    expected_learning_outcomes:
      learningOutcome || String(source.expected_learning_outcomes || '').trim(),
    learningOutcome: learningOutcome || source.learningOutcome || source.learning_outcome || '',
    real_life_application: realLifeApplication,
    realLifeApplication,
    reflection_exit_ticket: reflectionTicket,
  };
}

/** Activity PDF rows: all 13 template fields for storage + formatItemToContent. */
export function canonicalizeActivityExtractedItem(raw) {
  return normalizeActivityStructuredContent(raw);
}

/** Concept PDF rows: map Gemini aliases → 12-section template fields. */
export function normalizeConceptStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const conceptName = String(source.concept_name || source.title || source.name || source.topic || '').trim();
  const lesson = String(
    source.lesson ||
      source.explanation ||
      source.step_by_step_explanation ||
      source.content ||
      source.body ||
      source.summary ||
      source.text ||
      '',
  ).trim();
  const simpleDefinition = String(
    source.simple_definition ||
      source.simple_explanation ||
      source.definition ||
      source.intro ||
      '',
  ).trim();
  return {
    ...source,
    concept_name: conceptName || source.concept_name || 'Concept',
    title: conceptName || source.title,
    simple_definition: simpleDefinition,
    why_important: String(source.why_important || source.importance || source.relevance || '').trim(),
    prior_knowledge_needed: String(
      source.prior_knowledge_needed || source.prior_knowledge || source.prerequisites || '',
    ).trim(),
    lesson,
    diagram_suggestion: String(
      source.diagram_suggestion || source.visualisation || source.visualization || source.diagram || '',
    ).trim(),
    real_example: String(
      source.real_example || source.real_life_examples || source.examples || source.example || '',
    ).trim(),
    common_mistakes: toStringList(source.common_mistakes || source.misconceptions || source.mistakes),
    concept_check_questions: toStringList(
      source.concept_check_questions || source.check_questions || source.practice_questions,
    ),
    key_points: toStringList(source.key_points || source.keyPoints || source.takeaways),
    exam_tips: String(source.exam_tips || source.exam_tip || '').trim(),
    hots_question: String(
      source.hots_question || source.higher_order_question || source.hots || '',
    ).trim(),
    self_reflection_prompt: String(
      source.self_reflection_prompt || source.reflection || source.reflection_prompt || '',
    ).trim(),
  };
}

export function canonicalizeConceptExtractedItem(raw) {
  return normalizeConceptStructuredContent(raw);
}

function conceptRowHasBody(row) {
  if (!row || typeof row !== 'object') return false;
  const name = String(row.concept_name || row.title || row.name || '').trim();
  const lesson = String(
    row.lesson ||
      row.explanation ||
      row.step_by_step_explanation ||
      row.content ||
      row.simple_explanation ||
      '',
  ).trim();
  const definition = String(row.simple_definition || row.definition || row.intro || '').trim();
  const keyPoints = toStringList(row.key_points || row.keyPoints || row.takeaways);
  const checks = toStringList(row.concept_check_questions || row.check_questions);
  return (
    Boolean(name) ||
    lesson.length > 12 ||
    definition.length > 8 ||
    keyPoints.length > 0 ||
    checks.length > 0
  );
}

/** Concept Mastery deck: always `{ concepts: [...] }` for validation, storage, and viewers. */
export function normalizeConceptMasteryDeckStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  let rows = [];

  if (Array.isArray(source.concepts) && source.concepts.length) {
    rows = source.concepts;
  } else if (Array.isArray(source.items) && source.items.length) {
    rows = source.items;
  } else if (conceptRowHasBody(source)) {
    rows = [source];
  }

  const rootKeyPoints = toStringList(source.key_points || source.keyPoints);
  let concepts = rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => normalizeConceptStructuredContent(row))
    .filter(conceptRowHasBody);

  if (!concepts.length && conceptRowHasBody(source)) {
    concepts = [normalizeConceptStructuredContent(source)];
  }

  if (rootKeyPoints.length && concepts.length) {
    concepts = [
      {
        ...concepts[0],
        key_points: dedupeStringList([...toStringList(concepts[0].key_points), ...rootKeyPoints]),
      },
      ...concepts.slice(1),
    ];
  }

  const { concepts: _drop, items: _items, key_points: _kp, keyPoints: _kP, ...rest } = source;
  return { ...rest, concepts };
}

/** Scaffold one concept from topic + sub-topic when the model returns empty JSON. */
function buildCurriculumBackedConceptFallback(meta = {}) {
  const subTopic = String(meta.subTopic || meta.subtopic || '').trim();
  const topic = String(meta.topic || meta.chapter || '').trim();
  const subject = String(meta.subject || 'this subject').trim();
  const classLabel = String(meta.classLabel || meta.gradeLevel || 'the class').trim();
  const conceptName = subTopic || topic || `${subject} concept`;
  const focus = subTopic && topic ? `${topic} — ${subTopic}` : subTopic || topic;
  return {
    concepts: [
      normalizeConceptStructuredContent({
        concept_name: conceptName,
        simple_definition: `A clear introduction to ${conceptName} as part of ${focus} in ${subject}.`,
        why_important: `Mastering ${conceptName} helps ${classLabel} learners understand ${focus} for class tests and applications.`,
        prior_knowledge_needed: `Familiarity with the main ideas from ${topic || 'the previous unit'}.`,
        lesson: `Explain ${conceptName} step by step: definition, one labelled diagram, a worked example, and a short class discussion tied to ${focus}. Align examples to the NCERT/CBSE treatment of ${subject} for ${classLabel}.`,
        diagram_suggestion: `Labelled diagram or concept map for ${conceptName} (components, flow, or cause–effect as appropriate).`,
        real_example: `One everyday or Indian-context example that illustrates ${conceptName}.`,
        common_mistakes: [
          `Mixing up terms related to ${conceptName}`,
          'Skipping units, labels, or direction arrows in diagrams',
        ],
        concept_check_questions: [
          `Define ${conceptName} in your own words.`,
          `Give one example of ${conceptName} from daily life.`,
        ],
        key_points: [
          `Sub-topic focus: ${conceptName}`,
          focus ? `Chapter context: ${focus}` : '',
        ].filter(Boolean),
        exam_tips: `Use precise vocabulary for ${conceptName}; practice one 3-mark explanation outline.`,
        hots_question: `How would you apply ${conceptName} to solve a new problem?`,
        self_reflection_prompt: `What part of ${conceptName} do you still find confusing?`,
      }),
    ],
  };
}

export function finalizeConceptMasteryStructuredContent(structuredContent, meta = {}) {
  const raw =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {};
  let deck = normalizeConceptMasteryDeckStructuredContent(raw);
  if (!Array.isArray(deck.concepts) || !deck.concepts.length) {
    const fallback = buildCurriculumBackedConceptFallback(meta);
    deck = normalizeConceptMasteryDeckStructuredContent({ ...deck, ...fallback });
  } else if (deck.concepts.length === 1 && meta.subTopic) {
    const only = deck.concepts[0];
    const name = String(only.concept_name || only.title || '').trim();
    const sub = String(meta.subTopic || meta.subtopic || '').trim();
    if (!name || /^concept$/i.test(name)) {
      deck = normalizeConceptMasteryDeckStructuredContent({
        ...deck,
        concepts: [{ ...only, concept_name: sub || name || 'Concept' }],
      });
    }
  }
  return deck;
}

/** Concept Breakdown Explainer → 9-section template. */
export function normalizeConceptBreakdownStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const conceptTitle = String(
    source.concept_title || source.concept_name || source.title || source.name || '',
  ).trim();
  const simple_definition = String(
    source.simple_definition || source.simple_explanation || source.explanation || '',
  ).trim();
  const breakdown_steps = dedupeStringList([
    ...coerceBulletLines(source.breakdown_steps),
    ...coerceBulletLines(source.steps),
  ]);
  const real_life_examples = dedupeStringList([
    ...coerceBulletLines(source.real_life_examples),
    ...coerceBulletLines(source.indian_context_examples),
    ...coerceBulletLines(source.examples),
  ]);
  const important_terms = (Array.isArray(source.important_terms)
    ? source.important_terms
    : Array.isArray(source.keywords)
      ? source.keywords
      : Array.isArray(source.terms)
        ? source.terms
        : []
  )
    .map((t) => {
      if (t && typeof t === 'object') {
        return {
          term: String(t.term || t.keyword || t.name || '').trim(),
          definition: String(t.definition || '').trim(),
        };
      }
      return { term: String(t ?? '').trim(), definition: '' };
    })
    .filter((t) => t.term);
  const concept_check_questions = dedupeStringList([
    ...coerceBulletLines(source.concept_check_questions),
    ...coerceBulletLines(source.quick_check_questions),
  ]);
  const application_thinking_question = String(
    source.application_thinking_question || source.application_question || '',
  ).trim();
  const higher_order_thinking_prompt = String(
    source.higher_order_thinking_prompt ||
      source.hots_prompt ||
      source.hots_question ||
      '',
  ).trim();
  const quick_revision_summary = String(
    source.quick_revision_summary || source.revision_summary || source.summary || '',
  ).trim();

  return {
    ...source,
    concept_title: conceptTitle || 'Concept',
    concept_name: conceptTitle || source.concept_name || 'Concept',
    simple_definition,
    breakdown_steps,
    real_life_examples,
    important_terms,
    concept_check_questions,
    application_thinking_question,
    higher_order_thinking_prompt,
    quick_revision_summary,
  };
}

export function canonicalizeConceptBreakdownExtractedItem(raw) {
  return normalizeConceptBreakdownStructuredContent(raw);
}

/** Viewer payload for Concept Breakdown Explainer (PDF extract or generator). */
export function buildConceptBreakdownRenderableFromStructured(source) {
  const s = normalizeConceptBreakdownStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'conceptBreakdown',
    title: String(s.concept_title || s.concept_name || 'Concept').trim(),
    concept_title: String(s.concept_title || s.concept_name || 'Concept').trim(),
    concept_name: String(s.concept_name || s.concept_title || 'Concept').trim(),
    simple_definition: String(s.simple_definition || '').trim(),
    breakdown_steps: toStringList(s.breakdown_steps),
    real_life_examples: toStringList(s.real_life_examples),
    important_terms: Array.isArray(s.important_terms) ? s.important_terms : [],
    concept_check_questions: toStringList(s.concept_check_questions),
    application_thinking_question: String(s.application_thinking_question || '').trim(),
    higher_order_thinking_prompt: String(s.higher_order_thinking_prompt || '').trim(),
    quick_revision_summary: String(s.quick_revision_summary || '').trim(),
  };
}

/** Homework PDF / generator rows → 10-section template fields. */
export function normalizeHomeworkStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = String(source.title || source.homework_title || source.name || source.topic || '').trim();
  const instructions = String(
    source.instructions || source.student_instructions || source.homework_instructions || '',
  ).trim();

  const practiceRaw = [
    ...(Array.isArray(source.practice_questions) ? source.practice_questions : []),
    ...(Array.isArray(source.practiceQuestions) ? source.practiceQuestions : []),
    ...(Array.isArray(source.questions) ? source.questions : []),
  ];
  if (String(source.question || '').trim()) {
    practiceRaw.push({
      question: source.question,
      options: source.options,
      answer: source.answer,
      question_number: source.question_number ?? source.sl_no,
      section: source.section,
      type: source.type,
    });
  }
  const practice_questions = sanitizeWorksheetQuestions(toQuestionArray(practiceRaw));

  return {
    ...source,
    title: title || 'Homework',
    instructions,
    practice_questions,
    questions: practice_questions,
    application_tasks: dedupeStringList([
      ...coerceBulletLines(source.application_tasks),
      ...coerceBulletLines(source.applicationTasks),
    ]),
    creative_thinking_question: String(
      source.creative_thinking_question || source.creative_question || '',
    ).trim(),
    real_life_observation_task: String(
      source.real_life_observation_task || source.observation_task || '',
    ).trim(),
    challenge_question: String(source.challenge_question || source.challenge || '').trim(),
    support_hint: String(source.support_hint || source.hints || source.hint || '').trim(),
    answer_hints: String(
      source.answer_hints || source.answer_key || source.answerHints || '',
    ).trim(),
    parent_note: String(source.parent_note || source.parentNote || '').trim(),
  };
}

export function canonicalizeHomeworkExtractedItem(raw) {
  return normalizeHomeworkStructuredContent(raw);
}

function parseStoryDifferentiationFields(source = {}) {
  let support = String(source.differentiation_support || source.support_hint || '').trim();
  let extension = String(source.differentiation_extension || '').trim();
  const diff = source.differentiation;
  if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
    support = support || String(diff.support || diff.support_hint || '').trim();
    extension = extension || String(diff.extension || diff.extend || '').trim();
  } else if (typeof diff === 'string' && diff.trim()) {
    const text = diff.trim();
    const supM = text.match(/(?:^|\n)\s*support\s*[:\-]\s*([\s\S]*?)(?=\n\s*extension\s*[:\-]|$)/i);
    const extM = text.match(/(?:^|\n)\s*extension\s*[:\-]\s*([\s\S]*?)$/i);
    if (supM) support = support || supM[1].trim();
    if (extM) extension = extension || extM[1].trim();
    if (!support && !extension) support = text;
  }
  return { differentiation_support: support, differentiation_extension: extension };
}

/** Story & Passage PDF / generator → 10-section template. */
export function normalizeStoryStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = String(source.title || source.passage_title || source.story_title || '').trim();

  const nep = String(source.nep_ncf_focus || source.nep_ncf || '').trim();
  const skill = String(source.skill_focus || '').trim();
  const udl = String(source.udl_support || source.udl || '').trim();
  let alignment_block = String(source.alignment_block || source.alignment || '').trim();
  if (!alignment_block) {
    const parts = [];
    if (nep) parts.push(`NEP/NCF Focus: ${nep}`);
    if (skill) parts.push(`Skill Focus: ${skill}`);
    if (udl) parts.push(`UDL: ${udl}`);
    const legacyGenre = String(source.genre_purpose || source.reading_level || '').trim();
    const legacySubtopic = String(source.subtopic_link || '').trim();
    if (legacySubtopic) parts.push(legacySubtopic);
    if (legacyGenre) parts.push(legacyGenre);
    alignment_block = parts.join(' ');
  }

  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);

  const passage = String(source.passage || source.content || source.story_text || '').trim();

  const vocabulary_support = dedupeStringList([
    ...coerceBulletLines(source.vocabulary_support),
    ...coerceBulletLines(source.vocabulary),
  ]);

  const questions = toQuestionArray([
    ...(Array.isArray(source.questions) ? source.questions : []),
    ...(Array.isArray(source.comprehension_questions) ? source.comprehension_questions : []),
  ]);

  const answer_hints = dedupeStringList([
    ...coerceBulletLines(source.answer_hints),
    ...(String(source.answer_hints || '').trim() && !Array.isArray(source.answer_hints)
      ? [String(source.answer_hints)]
      : []),
    ...coerceBulletLines(source.answer_key),
    ...coerceBulletLines(source.moral),
    ...coerceBulletLines(source.formative_check),
  ]);

  const { differentiation_support, differentiation_extension } = parseStoryDifferentiationFields(source);

  const real_life_application = String(
    source.real_life_application || source.real_life_link || source.real_life || '',
  ).trim();

  const reflection_prompt = String(
    source.reflection_prompt || source.reflection_exit_ticket || source.reflection || '',
  ).trim();

  return {
    ...source,
    title: title || 'Story',
    alignment_block,
    nep_ncf_focus: nep,
    skill_focus: skill,
    udl_support: udl,
    learning_objectives,
    passage,
    content: passage,
    vocabulary_support,
    questions,
    answer_hints,
    differentiation_support,
    differentiation_extension,
    real_life_application,
    reflection_prompt,
    bloom_level: String(source.bloom_level || source.bloomLevel || '').trim(),
    difficulty_level: String(
      source.difficulty_level || source.difficulty_tag || source.difficulty || '',
    ).trim(),
    class_label: String(source.class_label || source.classLabel || '').trim(),
    subject: String(source.subject || '').trim(),
    subtopic: String(source.subtopic || source.subtopic_link || '').trim(),
  };
}

export function canonicalizeStoryExtractedItem(raw) {
  return normalizeStoryStructuredContent(raw);
}

/** Viewer payload for Story & Passage Creator (PDF extract or generator). */
export function buildStoryRenderableFromStructured(source) {
  const s = normalizeStoryStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'story',
    title: String(s.title || 'Story').trim(),
    alignmentBlock: String(s.alignment_block || '').trim(),
    nepNcfFocus: String(s.nep_ncf_focus || '').trim(),
    skillFocus: String(s.skill_focus || '').trim(),
    udlSupport: String(s.udl_support || '').trim(),
    learningObjectives: toStringList(s.learning_objectives),
    passage: String(s.passage || '').trim(),
    vocabularySupport: toStringList(s.vocabulary_support),
    questions: toQuestionArray(s.questions),
    answerHints: toStringList(s.answer_hints),
    differentiationSupport: String(s.differentiation_support || '').trim(),
    differentiationExtension: String(s.differentiation_extension || '').trim(),
    realLifeApplication: String(s.real_life_application || '').trim(),
    reflectionPrompt: String(s.reflection_prompt || '').trim(),
    bloomLevel: String(s.bloom_level || '').trim(),
    difficultyLevel: String(s.difficulty_level || '').trim(),
    classLabel: String(s.class_label || '').trim(),
    subject: String(s.subject || '').trim(),
    subtopic: String(s.subtopic || '').trim(),
  };
}

/** Short Notes & Summaries PDF / generator → 10-section template. */
export function normalizeShortNotesStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = String(source.title || source.concept_name || source.name || '').trim();

  const nep = String(source.nep_ncf_focus || source.nep_ncf || '').trim();
  const udl = String(source.udl_support || source.udl || '').trim();
  let alignment_block = String(source.alignment_block || source.alignment || '').trim();
  if (!alignment_block) {
    const parts = [];
    if (nep) parts.push(`NEP/NCF Focus: ${nep}`);
    if (udl) parts.push(`UDL: ${udl}`);
    const legacy = String(source.revision_scope || '').trim();
    if (legacy) parts.push(legacy);
    alignment_block = parts.join(' ');
  }

  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);

  const short_note_summary = String(
    source.short_note_summary ||
      source.summary ||
      source.exam_summary ||
      source.quick_recap ||
      '',
  ).trim();

  const key_points_to_remember = dedupeStringList([
    ...coerceBulletLines(source.key_points_to_remember),
    ...coerceBulletLines(source.key_points),
    ...coerceBulletLines(source.keyPoints),
  ]);

  const example = String(source.example || '').trim();

  let common_misconception_correction = String(
    source.common_misconception_correction || source.misconception_correction || '',
  ).trim();
  if (!common_misconception_correction) {
    const misconception = String(source.misconception || '').trim();
    const correction = String(source.correction || '').trim();
    const parts = [];
    if (misconception) parts.push(`Misconception: ${misconception}`);
    if (correction) parts.push(`Correction: ${correction}`);
    common_misconception_correction = parts.join(' ');
  }
  if (!common_misconception_correction) {
    const mistakes = dedupeStringList([
      ...coerceBulletLines(source.common_mistakes),
      ...coerceBulletLines(source.common_errors),
      ...coerceBulletLines(source.misconceptions),
    ]);
    if (mistakes.length) common_misconception_correction = mistakes.join('\n');
  }

  const quick_check_questions = dedupeStringList([
    ...coerceBulletLines(source.quick_check_questions),
    ...coerceBulletLines(source.self_check),
    ...toQuestionArray(source.questions).map((q) => String(q.question || '').trim()).filter(Boolean),
  ]);

  const { differentiation_support, differentiation_extension } = parseStoryDifferentiationFields(source);

  const real_life_application = String(
    source.real_life_application || source.real_life_link || source.real_life || '',
  ).trim();

  const reflection_exit_ticket = String(
    source.reflection_exit_ticket || source.reflection_prompt || '',
  ).trim();

  return {
    ...source,
    title: title || 'Notes',
    concept_name: title || String(source.concept_name || 'Notes').trim(),
    alignment_block,
    nep_ncf_focus: nep,
    udl_support: udl,
    learning_objectives,
    short_note_summary,
    summary: short_note_summary,
    key_points_to_remember,
    key_points: key_points_to_remember,
    keyPoints: key_points_to_remember,
    example,
    common_misconception_correction,
    quick_check_questions,
    differentiation_support,
    differentiation_extension,
    real_life_application,
    reflection_exit_ticket,
    bloom_level: String(source.bloom_level || source.bloomLevel || '').trim(),
    skill_focus: String(source.skill_focus || source.skillFocus || source.skill || '').trim(),
    subtopic: String(source.subtopic || source.subtopic_focus || '').trim(),
    class_label: String(source.class_label || source.classLabel || '').trim(),
    subject: String(source.subject || '').trim(),
  };
}

export function canonicalizeShortNotesExtractedItem(raw) {
  return normalizeShortNotesStructuredContent(raw);
}

function normalizeStudyGuideKeyConcepts(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((c) => {
      if (c && typeof c === 'object') {
        return {
          name: String(c.name || c.concept || '').trim(),
          explanation: String(c.explanation || '').trim(),
        };
      }
      return { name: String(c ?? '').trim(), explanation: '' };
    })
    .filter((c) => c.name);
}

function normalizeStudyGuidePracticeQuestions(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((q) => {
      if (q && typeof q === 'object') {
        const typeRaw = String(q.type || '').trim().toLowerCase();
        const type =
          typeRaw === 'objective' || typeRaw === 'mcq' ? 'objective' : 'subjective';
        return {
          question: String(q.question || '').trim(),
          type,
          answer: String(q.answer || '').trim(),
          options: Array.isArray(q.options)
            ? q.options.map((o) => String(o ?? '').trim()).filter(Boolean)
            : [],
        };
      }
      return {
        question: String(q ?? '').trim(),
        type: 'subjective',
        answer: '',
        options: [],
      };
    })
    .filter((q) => q.question);
}

/** Smart Study Guide Generator → 11-section template. */
export function normalizeStudyGuideStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = String(source.title || '').trim();
  const chapter_subtopic_overview = String(
    source.chapter_subtopic_overview || source.chapter_overview || source.overview || '',
  ).trim();
  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);
  const prior_knowledge_required = dedupeStringList([
    ...coerceBulletLines(source.prior_knowledge_required),
    ...coerceBulletLines(source.prior_knowledge),
  ]);
  const key_concepts = normalizeStudyGuideKeyConcepts(
    source.key_concepts || source.concepts,
  );
  const definitions = (Array.isArray(source.definitions) ? source.definitions : [])
    .map((d) => {
      if (d && typeof d === 'object') {
        return {
          term: String(d.term || d.name || '').trim(),
          definition: String(d.definition || '').trim(),
        };
      }
      return { term: String(d ?? '').trim(), definition: '' };
    })
    .filter((d) => d.term);
  const formulae = (Array.isArray(source.formulae)
    ? source.formulae
    : Array.isArray(source.formulas)
      ? source.formulas
      : Array.isArray(source.rules)
        ? source.rules
        : []
  )
    .map((f) => {
      if (f && typeof f === 'object') {
        return {
          name: String(f.name || '').trim(),
          formula: String(f.formula || '').trim(),
          note: String(f.note || '').trim(),
        };
      }
      return { name: '', formula: String(f ?? '').trim(), note: '' };
    })
    .filter((f) => f.formula || f.name);
  const concept_flow_mind_map = String(
    source.concept_flow_mind_map || source.concept_flow || source.mind_map || '',
  ).trim();
  const real_life_examples = dedupeStringList([
    ...coerceBulletLines(source.real_life_examples),
    ...coerceBulletLines(source.real_life_applications),
    ...coerceBulletLines(source.examples),
  ]);
  const quick_revision_notes = dedupeStringList([
    ...coerceBulletLines(source.quick_revision_notes),
    ...coerceBulletLines(source.revision_checklist),
    ...coerceBulletLines(source.quick_review),
    ...coerceBulletLines(source.review_points),
  ]);
  const practice_questions = normalizeStudyGuidePracticeQuestions(
    source.practice_questions || source.questions,
  );
  const improvement_tips = dedupeStringList([
    ...coerceBulletLines(source.improvement_tips),
    ...coerceBulletLines(source.study_tips),
    ...coerceBulletLines(source.tips),
  ]);

  return {
    ...source,
    title: title || 'Study Guide',
    chapter_subtopic_overview,
    learning_objectives,
    learningObjectives: learning_objectives,
    prior_knowledge_required,
    key_concepts,
    definitions,
    formulae,
    formulas: formulae,
    concept_flow_mind_map,
    real_life_examples,
    quick_revision_notes,
    practice_questions,
    improvement_tips,
  };
}

export function canonicalizeStudyGuideExtractedItem(raw) {
  return normalizeStudyGuideStructuredContent(raw);
}

/** Viewer payload for Smart Study Guide Generator (PDF extract or generator). */
export function buildStudyGuideRenderableFromStructured(source) {
  const s = normalizeStudyGuideStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'studyGuide',
    title: String(s.title || 'Study Guide').trim(),
    chapter_subtopic_overview: String(s.chapter_subtopic_overview || '').trim(),
    learning_objectives: toStringList(s.learning_objectives),
    learningObjectives: toStringList(s.learning_objectives),
    prior_knowledge_required: toStringList(s.prior_knowledge_required),
    key_concepts: Array.isArray(s.key_concepts) ? s.key_concepts : [],
    definitions: Array.isArray(s.definitions) ? s.definitions : [],
    formulae: Array.isArray(s.formulae) ? s.formulae : [],
    concept_flow_mind_map: String(s.concept_flow_mind_map || '').trim(),
    real_life_examples: toStringList(s.real_life_examples),
    quick_revision_notes: toStringList(s.quick_revision_notes),
    practice_questions: Array.isArray(s.practice_questions) ? s.practice_questions : [],
    improvement_tips: toStringList(s.improvement_tips),
  };
}

/** Chapter Summary Creator → 11-section template. */
export function normalizeChapterSummaryStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const chapter_summary_title = String(
    source.chapter_summary_title || source.chapter_title || source.title || '',
  ).trim();
  const chapter_overview = String(
    source.chapter_overview ||
      source.overview ||
      source.summary ||
      source.chapter_summary ||
      '',
  ).trim();
  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);
  const important_concepts = (Array.isArray(source.important_concepts)
    ? source.important_concepts
    : Array.isArray(source.key_concepts)
      ? source.key_concepts
      : Array.isArray(source.concepts)
        ? source.concepts
        : []
  )
    .map((c) => {
      if (c && typeof c === 'object') {
        return {
          name: String(c.name || c.concept || '').trim(),
          explanation: String(c.explanation || '').trim(),
        };
      }
      return { name: String(c ?? '').trim(), explanation: '' };
    })
    .filter((c) => c.name);
  const definitions = (Array.isArray(source.definitions) ? source.definitions : [])
    .map((d) => {
      if (d && typeof d === 'object') {
        return {
          term: String(d.term || d.name || '').trim(),
          definition: String(d.definition || '').trim(),
        };
      }
      return { term: String(d ?? '').trim(), definition: '' };
    })
    .filter((d) => d.term);
  const formulae = (Array.isArray(source.formulae)
    ? source.formulae
    : Array.isArray(source.formulas)
      ? source.formulas
      : Array.isArray(source.rules)
        ? source.rules
        : []
  )
    .map((f) => {
      if (f && typeof f === 'object') {
        return {
          name: String(f.name || '').trim(),
          formula: String(f.formula || f.rule || '').trim(),
          note: String(f.note || '').trim(),
        };
      }
      return { name: '', formula: String(f ?? '').trim(), note: '' };
    })
    .filter((f) => f.formula || f.name);
  const concept_connections = String(source.concept_connections || source.connections || '').trim();
  const real_life_applications = dedupeStringList([
    ...coerceBulletLines(source.real_life_applications),
    ...coerceBulletLines(source.applications),
    ...coerceBulletLines(source.examples),
  ]);
  const important_exam_points = dedupeStringList([
    ...coerceBulletLines(source.important_exam_points),
    ...coerceBulletLines(source.exam_points),
    ...coerceBulletLines(source.key_takeaways),
    ...coerceBulletLines(source.takeaways),
  ]);
  const quick_revision_notes = dedupeStringList([
    ...coerceBulletLines(source.quick_revision_notes),
    ...coerceBulletLines(source.review_points),
    ...coerceBulletLines(source.quick_review),
  ]);
  const practice_recall_questions = dedupeStringList([
    ...coerceBulletLines(source.practice_recall_questions),
    ...coerceBulletLines(source.recall_questions),
    ...coerceBulletLines(source.quick_check_questions),
  ]);

  return {
    ...source,
    chapter_summary_title: chapter_summary_title || 'Chapter Summary',
    chapter_title: chapter_summary_title || source.chapter_title || 'Chapter Summary',
    title: chapter_summary_title || source.title || 'Chapter Summary',
    chapter_overview,
    summary: chapter_overview,
    chapter_summary: chapter_overview,
    learning_objectives,
    learningObjectives: learning_objectives,
    important_concepts,
    definitions,
    formulae,
    formulas: formulae,
    concept_connections,
    real_life_applications,
    important_exam_points,
    quick_revision_notes,
    practice_recall_questions,
    key_takeaways: important_exam_points,
    review_points: quick_revision_notes,
  };
}

export function canonicalizeChapterSummaryExtractedItem(raw) {
  return normalizeChapterSummaryStructuredContent(raw);
}

/** Viewer payload for Chapter Summary Creator (PDF extract or generator). */
export function buildChapterSummaryRenderableFromStructured(source) {
  const s = normalizeChapterSummaryStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'chapterSummary',
    title: String(s.chapter_summary_title || s.chapter_title || 'Chapter Summary').trim(),
    chapter_summary_title: String(s.chapter_summary_title || s.chapter_title || '').trim(),
    chapter_overview: String(s.chapter_overview || '').trim(),
    learning_objectives: toStringList(s.learning_objectives),
    learningObjectives: toStringList(s.learning_objectives),
    important_concepts: Array.isArray(s.important_concepts) ? s.important_concepts : [],
    definitions: Array.isArray(s.definitions) ? s.definitions : [],
    formulae: Array.isArray(s.formulae) ? s.formulae : [],
    concept_connections: String(s.concept_connections || '').trim(),
    real_life_applications: toStringList(s.real_life_applications),
    important_exam_points: toStringList(s.important_exam_points),
    quick_revision_notes: toStringList(s.quick_revision_notes),
    practice_recall_questions: toStringList(s.practice_recall_questions),
  };
}

/** Key Points Extractor → 10-section template. */
export function normalizeKeyPointsStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const topic_title = String(source.topic_title || source.title || source.topic || '').trim();
  const important_concepts = (Array.isArray(source.important_concepts)
    ? source.important_concepts
    : Array.isArray(source.key_concepts)
      ? source.key_concepts
      : []
  )
    .map((c) => {
      if (c && typeof c === 'object') {
        return {
          name: String(c.name || c.concept || c.point || '').trim(),
          explanation: String(c.explanation || c.detail || '').trim(),
        };
      }
      return { name: String(c ?? '').trim(), explanation: '' };
    })
    .filter((c) => c.name);
  const essential_definitions = (Array.isArray(source.essential_definitions)
    ? source.essential_definitions
    : Array.isArray(source.definitions)
      ? source.definitions
      : []
  )
    .map((d) => {
      if (d && typeof d === 'object') {
        return {
          term: String(d.term || d.name || '').trim(),
          definition: String(d.definition || '').trim(),
        };
      }
      return { term: String(d ?? '').trim(), definition: '' };
    })
    .filter((d) => d.term);
  const formulae = (Array.isArray(source.formulae)
    ? source.formulae
    : Array.isArray(source.formulas)
      ? source.formulas
      : []
  )
    .map((f) => {
      if (f && typeof f === 'object') {
        return {
          name: String(f.name || '').trim(),
          formula: String(f.formula || '').trim(),
          note: String(f.note || f.when_to_use || '').trim(),
        };
      }
      return { name: '', formula: String(f ?? '').trim(), note: '' };
    })
    .filter((f) => f.formula || f.name);
  const keywords_terminologies = (Array.isArray(source.keywords_terminologies)
    ? source.keywords_terminologies
    : Array.isArray(source.keywords)
      ? source.keywords
      : []
  )
    .map((k) => {
      if (k && typeof k === 'object') {
        return {
          term: String(k.term || k.keyword || k.name || '').trim(),
          meaning: String(k.meaning || k.definition || '').trim(),
        };
      }
      return { term: String(k ?? '').trim(), meaning: '' };
    })
    .filter((k) => k.term);
  const must_remember_facts = dedupeStringList([
    ...coerceBulletLines(source.must_remember_facts),
    ...coerceBulletLines(source.key_points),
    ...coerceBulletLines(source.key_points_to_remember),
  ]);
  const real_life_connections = dedupeStringList([
    ...coerceBulletLines(source.real_life_connections),
    ...coerceBulletLines(source.real_life_applications),
  ]);
  const frequently_asked_exam_points = dedupeStringList([
    ...coerceBulletLines(source.frequently_asked_exam_points),
    ...coerceBulletLines(source.exam_points),
  ]);
  const mnemonics_memory_tricks = dedupeStringList([
    ...coerceBulletLines(source.mnemonics_memory_tricks),
    ...coerceBulletLines(source.mnemonics),
    ...coerceBulletLines(source.memory_tricks),
  ]);
  const one_minute_revision_summary = String(
    source.one_minute_revision_summary ||
      source.revision_summary ||
      source.summary ||
      source.short_note_summary ||
      '',
  ).trim();

  return {
    ...source,
    topic_title: topic_title || 'Key Points',
    title: topic_title || source.title || 'Key Points',
    important_concepts,
    essential_definitions,
    definitions: essential_definitions,
    formulae,
    formulas: formulae,
    keywords_terminologies,
    must_remember_facts,
    key_points: must_remember_facts,
    real_life_connections,
    frequently_asked_exam_points,
    mnemonics_memory_tricks,
    one_minute_revision_summary,
  };
}

export function canonicalizeKeyPointsExtractedItem(raw) {
  return normalizeKeyPointsStructuredContent(raw);
}

/** Viewer payload for Key Points Extractor (PDF extract or generator). */
export function buildKeyPointsRenderableFromStructured(source) {
  const k = normalizeKeyPointsStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'keyPoints',
    title: String(k.topic_title || k.title || 'Key Points').trim(),
    topic_title: String(k.topic_title || k.title || '').trim(),
    important_concepts: Array.isArray(k.important_concepts) ? k.important_concepts : [],
    essential_definitions: Array.isArray(k.essential_definitions) ? k.essential_definitions : [],
    formulae: Array.isArray(k.formulae) ? k.formulae : [],
    keywords_terminologies: Array.isArray(k.keywords_terminologies) ? k.keywords_terminologies : [],
    must_remember_facts: toStringList(k.must_remember_facts),
    real_life_connections: toStringList(k.real_life_connections),
    frequently_asked_exam_points: toStringList(k.frequently_asked_exam_points),
    mnemonics_memory_tricks: toStringList(k.mnemonics_memory_tricks),
    one_minute_revision_summary: String(k.one_minute_revision_summary || '').trim(),
  };
}

/** Quick Assignment Builder → 11-section template. */
export function normalizeQuickAssignmentStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const assignment_title = String(
    source.assignment_title || source.title || source.assignmentTitle || source.name || '',
  ).trim();
  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
  ]);
  const instructions = String(
    source.instructions ||
      source.instructions_to_students ||
      source.student_instructions ||
      '',
  ).trim();

  const conceptRaw = [
    ...(Array.isArray(source.concept_based_questions) ? source.concept_based_questions : []),
    ...(Array.isArray(source.questions) ? source.questions : []),
    ...(Array.isArray(source.practice_questions) ? source.practice_questions : []),
    ...(Array.isArray(source.practiceQuestions) ? source.practiceQuestions : []),
  ];
  if (String(source.question || '').trim()) {
    conceptRaw.push({
      question: source.question,
      options: source.options,
      answer: source.answer,
      marks: source.marks,
      question_number: source.question_number ?? source.sl_no,
    });
  }
  const concept_based_questions = sanitizeWorksheetQuestions(toQuestionArray(conceptRaw));

  const application_oriented_tasks = dedupeStringList([
    ...coerceBulletLines(source.application_oriented_tasks),
    ...coerceBulletLines(source.application_tasks),
    ...coerceBulletLines(source.applicationTasks),
  ]);

  const realLifeRaw = source.real_life_competency_activity ?? source.real_life_activity;
  const real_life_competency_activity = Array.isArray(realLifeRaw)
    ? realLifeRaw.map((x) => String(x ?? '').trim()).filter(Boolean).join('\n')
    : String(
        realLifeRaw ||
          source.real_life_observation_task ||
          source.real_life_applications ||
          '',
      ).trim();

  const creative_thinking_question = String(
    source.creative_thinking_question || source.creative_question || '',
  ).trim();
  const collaborative_discussion_task = String(
    source.collaborative_discussion_task ||
      source.discussion_task ||
      source.collaborative_task ||
      '',
  ).trim();
  const challenge_question_advanced = String(
    source.challenge_question_advanced ||
      source.challenge_question ||
      source.challenge ||
      '',
  ).trim();
  const assessment_criteria_rubric = String(
    source.assessment_criteria_rubric ||
      source.marking_criteria ||
      source.marking_scheme ||
      source.rubric ||
      '',
  ).trim();
  const expected_learning_outcomes = dedupeStringList([
    ...coerceBulletLines(source.expected_learning_outcomes),
    ...coerceBulletLines(source.learning_outcomes),
  ]);

  return {
    ...source,
    assignment_title: assignment_title || 'Assignment',
    title: assignment_title || source.title || 'Assignment',
    learning_objectives,
    instructions,
    concept_based_questions,
    questions: concept_based_questions,
    practice_questions: concept_based_questions,
    application_oriented_tasks,
    real_life_competency_activity,
    creative_thinking_question,
    collaborative_discussion_task,
    challenge_question_advanced,
    assessment_criteria_rubric,
    marking_criteria: assessment_criteria_rubric,
    expected_learning_outcomes,
  };
}

export function canonicalizeQuickAssignmentExtractedItem(raw) {
  return normalizeQuickAssignmentStructuredContent(raw);
}

/** Viewer payload for Quick Assignment Builder (PDF extract or generator). */
export function buildQuickAssignmentRenderableFromStructured(source) {
  const a = normalizeQuickAssignmentStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'quickAssignment',
    title: String(a.assignment_title || a.title || 'Assignment').trim(),
    assignment_title: String(a.assignment_title || a.title || '').trim(),
    learning_objectives: toStringList(a.learning_objectives),
    instructions: String(a.instructions || '').trim(),
    concept_based_questions: Array.isArray(a.concept_based_questions) ? a.concept_based_questions : [],
    application_oriented_tasks: toStringList(a.application_oriented_tasks),
    real_life_competency_activity: String(a.real_life_competency_activity || '').trim(),
    creative_thinking_question: String(a.creative_thinking_question || '').trim(),
    collaborative_discussion_task: String(a.collaborative_discussion_task || '').trim(),
    challenge_question_advanced: String(a.challenge_question_advanced || '').trim(),
    assessment_criteria_rubric: String(a.assessment_criteria_rubric || '').trim(),
    expected_learning_outcomes: toStringList(a.expected_learning_outcomes),
  };
}

/** Normalize one flashcard to the 7-field template (with legacy fallbacks). */
export function normalizeFlashcardCard(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const front = String(source.front || source.question || '').trim();
  const back = String(
    source.back || source.correct_answer || source.answer || source.content || '',
  ).trim();
  const memory_cue = String(
    source.memory_cue || source.memoryCue || source.hint || '',
  ).trim();
  const skill_focus = String(
    source.skill_focus || source.skillFocus || source.bloom_level || source.topic_tag || '',
  ).trim();
  const example_use = String(
    source.example_use || source.exampleUse || source.real_life_link || source.example || '',
  ).trim();
  const peer_prompt = String(source.peer_prompt || source.peerPrompt || '').trim();
  const reflection = String(
    source.reflection || source.reflection_prompt || source.self_check || '',
  ).trim();
  const deck_title = String(source.deck_title || source.title || '').trim();
  return {
    ...source,
    front,
    back,
    memory_cue,
    skill_focus,
    example_use,
    peer_prompt,
    reflection,
    deck_title,
    hint: memory_cue,
    bloom_level: skill_focus,
    real_life_link: example_use,
    self_check: reflection,
  };
}

export function canonicalizeFlashcardExtractedItem(raw) {
  return normalizeFlashcardCard(raw);
}

/** Deck shape for validation / AI Generator (cards[] with front + back on every card). */
export function normalizeFlashcardDeckStructuredContent(raw) {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const deck_title = String(source.deck_title || source.title || '').trim();

  const fromList = (list) =>
    (Array.isArray(list) ? list : [])
      .map((c) => normalizeFlashcardCard(c))
      .filter((c) => String(c.front || '').trim() && String(c.back || '').trim());

  let cards = [];
  if (Array.isArray(source.cards)) {
    cards = fromList(source.cards);
  } else if (Array.isArray(source.flashcards)) {
    cards = fromList(source.flashcards);
  } else if (Array.isArray(raw)) {
    cards = fromList(raw);
  } else {
    const grouped = source.flashcards;
    if (grouped && typeof grouped === 'object' && !Array.isArray(grouped)) {
      const g = grouped;
      for (const q of Array.isArray(g.questions) ? g.questions : []) {
        const c = normalizeFlashcardCard(q);
        if (c.front && c.back) cards.push(c);
      }
      for (const n of Array.isArray(g.important_notes) ? g.important_notes : []) {
        if (n && typeof n === 'object') {
          const title = String(n.title || '').trim();
          const content = String(n.content || '').trim();
          if (title && content) {
            cards.push(
              normalizeFlashcardCard({ front: title, back: content, type: 'note' }),
            );
          }
        }
      }
      for (const f of Array.isArray(g.facts) ? g.facts : []) {
        const fact = String((f && typeof f === 'object' ? f.fact : f) || '').trim();
        if (fact) {
          cards.push(
            normalizeFlashcardCard({ front: 'Quick fact', back: fact, type: 'fact' }),
          );
        }
      }
    }
    const single = normalizeFlashcardCard(source);
    if (single.front && single.back) {
      cards = [single];
    }
  }

  return {
    ...source,
    deck_title: deck_title || undefined,
    title: deck_title || String(source.title || '').trim() || undefined,
    cards,
  };
}

/** Viewer payload for Flashcard Generator (PDF extract or generator). */
export function buildFlashcardRenderableFromStructured(source) {
  const normalized = normalizeFlashcardDeckStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  const cards = normalized.cards || [];
  const deckTitle = String(normalized.deck_title || normalized.title || 'Flashcards').trim();
  return {
    kind: 'flashcards',
    title: deckTitle,
    cards: cards.map((c) => ({
      front: c.front,
      back: c.back,
      memoryCue: c.memory_cue,
      skillFocus: c.skill_focus,
      exampleUse: c.example_use,
      peerPrompt: c.peer_prompt,
      reflection: c.reflection,
    })),
  };
}

/** Viewer payload for Short Notes & Summaries (PDF extract or generator). */
export function buildShortNotesRenderableFromStructured(source) {
  const s = normalizeShortNotesStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  const noteTitle = String(s.title || s.concept_name || 'Notes').trim();
  return {
    kind: 'shortNotes',
    title: noteTitle,
    alignmentBlock: String(s.alignment_block || '').trim(),
    nepNcfFocus: String(s.nep_ncf_focus || '').trim(),
    udlSupport: String(s.udl_support || '').trim(),
    learningObjectives: toStringList(s.learning_objectives),
    shortNoteSummary: String(s.short_note_summary || '').trim(),
    keyPointsToRemember: toStringList(s.key_points_to_remember),
    example: String(s.example || '').trim(),
    commonMisconceptionCorrection: String(s.common_misconception_correction || '').trim(),
    quickCheckQuestions: toStringList(s.quick_check_questions),
    differentiationSupport: String(s.differentiation_support || '').trim(),
    differentiationExtension: String(s.differentiation_extension || '').trim(),
    realLifeApplication: String(s.real_life_application || '').trim(),
    reflectionExitTicket: String(s.reflection_exit_ticket || '').trim(),
    bloomLevel: String(s.bloom_level || '').trim(),
    skillFocus: String(s.skill_focus || '').trim(),
    subtopic: String(s.subtopic || '').trim(),
    classLabel: String(s.class_label || '').trim(),
    subject: String(s.subject || '').trim(),
  };
}

const WORKSHEET_SECTION_LABELS = {
  A: 'Section A: MCQs',
  B: 'Section B: Fill in the Blanks',
  C: 'Section C: Very Short Answer Questions',
  D: 'Section D: Short Answer Questions',
  E: 'Section E: Competency / Real-life Application Questions',
};

function isLikelyWorksheetCompetencyQuestion(text) {
  const q = String(text || '').trim();
  if (!q) return false;
  return /(?:real[\s-]*life|application|competency|case[\s-]*based|scenario|daily\s+life|at\s+home|in\s+school|how\s+would\s+you|what\s+would\s+you\s+do|design|plan|investigate|experiment|observe|compare)/i.test(
    q,
  );
}

function inferWorksheetSectionLabel(sectionRaw, question = {}) {
  const s = String(sectionRaw || '').trim();
  const t = String(question.type || '').trim().toUpperCase();
  if (/^A\b|SECTION\s*A|MCQ|MULTIPLE\s*CHOICE/i.test(s) || t === 'MCQ') return WORKSHEET_SECTION_LABELS.A;
  if (/^B\b|SECTION\s*B|FILL|FIB|BLANK/i.test(s) || t === 'FIB') return WORKSHEET_SECTION_LABELS.B;
  if (/^C\b|SECTION\s*C|VERY\s*SHORT|VSA/i.test(s) || t === 'VSA') return WORKSHEET_SECTION_LABELS.C;
  if (/^D\b|SECTION\s*D|SHORT\s*ANSWER/i.test(s) || t === 'SA' || t === 'LA' || t === 'CASE') return WORKSHEET_SECTION_LABELS.D;
  if (
    /^E\b|SECTION\s*E|COMPETENCY|REAL\s*LIFE|APPLICATION/i.test(s) ||
    /^F\b|SECTION\s*F/i.test(s) ||
    t === 'COMPETENCY'
  ) {
    return WORKSHEET_SECTION_LABELS.E;
  }
  if (/LONG\s*ANSWER|CASE\s*BASED/i.test(s)) return WORKSHEET_SECTION_LABELS.D;
  if (/^[A-E]$/i.test(s)) {
    const letter = s.toUpperCase();
    if (letter === 'F') return WORKSHEET_SECTION_LABELS.E;
    return WORKSHEET_SECTION_LABELS[letter] || s;
  }
  if (s && s !== 'Questions') return remapLegacyWorksheetSectionName(s);
  if (Array.isArray(question.options) && question.options.length >= 2) return WORKSHEET_SECTION_LABELS.A;
  if (/_{2,}/.test(String(question.question || ''))) return WORKSHEET_SECTION_LABELS.B;
  const qText = String(question.question || '').trim();
  const competencyCue =
    /(?:real[\s-]*life|application|competency|case[\s-]*based|scenario|daily\s+life|at\s+home|in\s+school|how\s+would\s+you|what\s+would\s+you\s+do|design|plan|investigate|experiment|observe|compare)\b/i.test(
      qText,
    );
  const looksPromptLike =
    /\?/.test(qText) ||
    /^(?:imagine|suppose|consider|how would you|what would you do|design|plan|investigate|observe|compare)\b/i.test(
      qText,
    );
  if (competencyCue && looksPromptLike) {
    return WORKSHEET_SECTION_LABELS.E;
  }
  if (looksPromptLike && /(?:in your daily life|around you|at home|in school)\b/i.test(qText)) {
    return WORKSHEET_SECTION_LABELS.E;
  }
  const words = qText.split(/\s+/).filter(Boolean).length;
  if (/\?/.test(qText) && words <= 14) return WORKSHEET_SECTION_LABELS.C;
  if (/\?/.test(qText)) return WORKSHEET_SECTION_LABELS.D;
  if (words >= 10) return WORKSHEET_SECTION_LABELS.D;
  return WORKSHEET_SECTION_LABELS.C;
}

/** Drop legacy long-answer section label; map old Section F → Section E. */
function remapLegacyWorksheetSectionName(sectionName) {
  const n = String(sectionName || '').trim();
  if (!n) return n;
  if (/long\s*answer|case\s*based|case-based/i.test(n) && !/competency|real[\s-]*life/i.test(n)) {
    return WORKSHEET_SECTION_LABELS.D;
  }
  if (/^section\s*f\b/i.test(n) || /competency|real[\s-]*life/i.test(n)) {
    return WORKSHEET_SECTION_LABELS.E;
  }
  if (n === 'Section E: Long Answer / Case-based Questions') return WORKSHEET_SECTION_LABELS.D;
  if (n === 'Section F: Competency / Real-life Application Questions') return WORKSHEET_SECTION_LABELS.E;
  return n;
}

function normalizeWorksheetAnswerKeyText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (raw.includes('\n')) {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }
  const compact = raw.replace(/\s+/g, ' ').trim();
  const parts = compact
    .split(/(?=\s*\d+\.\s+)/g)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.join('\n');
  return compact;
}

/** Group flat worksheet rows by section label (A–E). */
export function groupQuestionsIntoWorksheetSections(questions = []) {
  const cleaned = sanitizeWorksheetQuestions(toQuestionArray(questions));
  const map = new Map();
  for (const q of cleaned) {
    const sectionName = inferWorksheetSectionLabel(q.section, q);
    if (!map.has(sectionName)) map.set(sectionName, []);
    map.get(sectionName).push({
      ...q,
      question_number: q.question_number ?? q.sl_no,
      type: String(q.type || '').trim() || (q.options?.length >= 2 ? 'MCQ' : ''),
      marks: q.marks != null && q.marks !== '' ? Number(q.marks) : undefined,
    });
  }
  const order = Object.values(WORKSHEET_SECTION_LABELS);
  const sections = [];
  for (const label of order) {
    if (map.has(label)) {
      const qs = map.get(label);
      qs.sort((a, b) => Number(a.question_number || 0) - Number(b.question_number || 0));
      sections.push({
        sectionName: remapLegacyWorksheetSectionName(label),
        questions: qs,
        count: qs.length,
      });
      map.delete(label);
    }
  }
  for (const [sectionName, qs] of map.entries()) {
    qs.sort((a, b) => Number(a.question_number || 0) - Number(b.question_number || 0));
    sections.push({
      sectionName: remapLegacyWorksheetSectionName(sectionName),
      questions: qs,
      count: qs.length,
    });
  }
  const sectionD = sections.find((s) => s.sectionName === WORKSHEET_SECTION_LABELS.D);
  const sectionE = sections.find((s) => s.sectionName === WORKSHEET_SECTION_LABELS.E);
  if (sectionD && sectionE && sectionE.questions.length === 0 && sectionD.questions.length > 1) {
    const candidateIdx = sectionD.questions.findIndex((q) =>
      isLikelyWorksheetCompetencyQuestion(q.question),
    );
    if (candidateIdx >= 0) {
      const [moved] = sectionD.questions.splice(candidateIdx, 1);
      sectionE.questions.push({ ...moved, section: WORKSHEET_SECTION_LABELS.E });
      sectionD.count = sectionD.questions.length;
      sectionE.count = sectionE.questions.length;
    }
  }
  if (sectionD && sectionE && sectionD.questions.length === 0 && sectionE.questions.length > 1) {
    const moveBackIdx = sectionE.questions.findIndex((q) => !isLikelyWorksheetCompetencyQuestion(q.question));
    const idx = moveBackIdx >= 0 ? moveBackIdx : sectionE.questions.length - 1;
    const [movedBack] = sectionE.questions.splice(idx, 1);
    if (movedBack) {
      sectionD.questions.push({ ...movedBack, section: WORKSHEET_SECTION_LABELS.D });
      sectionD.count = sectionD.questions.length;
      sectionE.count = sectionE.questions.length;
    }
  }
  return sections;
}

export function mergeWorksheetSections(base = [], extra = []) {
  const allQs = [];
  for (const sec of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    const name = String(sec?.sectionName || sec?.name || '').trim();
    const qs = toQuestionArray(sec?.questions || []).map((q) => ({
      ...q,
      section: q.section || name,
    }));
    allQs.push(...qs);
  }
  return groupQuestionsIntoWorksheetSections(allQs);
}

/** Worksheet / MCQ PDF rows → 10-section template + sections A–E. */
export function normalizeWorksheetStructuredContent(raw, sourceText = '') {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = String(source.title || source.worksheet_title || source.name || source.topic || '').trim();
  const instructions = String(
    source.instructions || source.student_instructions || source.worksheet_instructions || '',
  ).trim();
  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);
  const answer_key = String(
    source.answer_key || source.answerKey || source.answers || source.answer_hints || '',
  ).trim();
  const bloom_level = String(source.bloom_level || source.bloomLevel || '').trim();
  const difficulty_tag = String(
    source.difficulty_tag || source.difficulty || source.difficultyTag || '',
  ).trim();

  let sections = [];
  if (Array.isArray(source.sections) && source.sections.length) {
    sections = mergeWorksheetSections(source.sections, []);
  }

  const looseQuestions = [];
  if (String(source.question || '').trim()) {
    looseQuestions.push({
      question: source.question,
      options: source.options,
      answer: source.answer,
      question_number: source.question_number ?? source.sl_no,
      section: source.section,
      type: source.type,
      marks: source.marks,
      explanation: source.explanation,
    });
  }
  const sectionKeys = [
    ['section_a', WORKSHEET_SECTION_LABELS.A],
    ['section_a_mcqs', WORKSHEET_SECTION_LABELS.A],
    ['section_b', WORKSHEET_SECTION_LABELS.B],
    ['section_b_fib', WORKSHEET_SECTION_LABELS.B],
    ['fill_in_blanks', WORKSHEET_SECTION_LABELS.B],
    ['section_c', WORKSHEET_SECTION_LABELS.C],
    ['section_c_vsa', WORKSHEET_SECTION_LABELS.C],
    ['section_d', WORKSHEET_SECTION_LABELS.D],
    ['section_d_sa', WORKSHEET_SECTION_LABELS.D],
    ['section_e', WORKSHEET_SECTION_LABELS.E],
    ['section_e_competency', WORKSHEET_SECTION_LABELS.E],
    ['section_f', WORKSHEET_SECTION_LABELS.E],
    ['section_f_competency', WORKSHEET_SECTION_LABELS.E],
  ];
  for (const [key, label] of sectionKeys) {
    const block = source[key];
    if (!block) continue;
    const blockQuestions = Array.isArray(block)
      ? toQuestionArray(block)
      : toQuestionArray(
          (block && typeof block === 'object' && !Array.isArray(block)
            ? block.questions || block.items || block.data
            : block) || [],
        );
    if (blockQuestions.length) {
      looseQuestions.push(
        ...blockQuestions.map((q) => ({
          ...q,
          section: q.section || q.sectionName || label,
        })),
      );
    }
  }

  const flatPools = [
    source.questions,
    source.mcqs,
    source.multipleChoiceQuestions,
    source.shortQuestions,
    source.longQuestions,
    source.fillInTheBlanks,
    source.exerciseQuestions,
    source.exercises,
    source.items,
    source.application_questions,
    source.real_life_questions,
    source.real_life_problem_solving_questions,
    source.competency_questions,
    source.case_based_questions,
  ];
  for (const pool of flatPools) {
    looseQuestions.push(...toQuestionArray(pool));
  }

  if (looseQuestions.length) {
    sections = mergeWorksheetSections(sections, groupQuestionsIntoWorksheetSections(looseQuestions));
  }

  if (!sections.length && sourceText) {
    const fromText = sanitizeWorksheetQuestions(extractQuestionsFromText(sourceText));
    if (fromText.length) sections = groupQuestionsIntoWorksheetSections(fromText);
  }

  const questions = sections.flatMap((sec) =>
    (sec.questions || []).map((q) => ({ ...q, section: q.section || sec.sectionName })),
  );

  let answerKeyOut = normalizeWorksheetAnswerKeyText(answer_key);
  if (!answerKeyOut && questions.length) {
    const lines = [];
    for (const q of questions) {
      if (String(q.answer || '').trim()) {
        const n = q.question_number != null ? `Q${q.question_number}` : 'Q';
        lines.push(`${n}: ${q.answer}`);
      }
    }
    if (lines.length) answerKeyOut = normalizeWorksheetAnswerKeyText(lines.join('\n'));
  }

  return {
    ...source,
    title: title || 'Worksheet',
    worksheet_title: title || source.worksheet_title || 'Worksheet',
    instructions,
    learning_objectives,
    objectives: learning_objectives,
    sections,
    questions: sanitizeWorksheetQuestions(questions.length ? questions : toQuestionArray(source.questions)),
    answer_key: answerKeyOut,
    bloom_level,
    difficulty_tag,
    type: String(source.type || 'Worksheet').trim() || 'Worksheet',
  };
}

export function canonicalizeWorksheetExtractedItem(raw, sourceText = '') {
  return normalizeWorksheetStructuredContent(raw, sourceText);
}

/** Always return sections A–E in template order (empty sections included). */
export function buildCanonicalWorksheetSectionList(sections = []) {
  const grouped = groupQuestionsIntoWorksheetSections(
    (Array.isArray(sections) ? sections : []).flatMap((sec) =>
      (Array.isArray(sec?.questions) ? sec.questions : []).map((q) => ({
        ...q,
        section: q.section || sec.sectionName,
      })),
    ),
  );
  const byName = new Map(grouped.map((sec) => [sec.sectionName, sec]));
  return Object.values(WORKSHEET_SECTION_LABELS).map((sectionName) => {
    const hit = byName.get(sectionName);
    return {
      sectionName,
      questions: hit?.questions || [],
      count: hit?.questions?.length || 0,
    };
  });
}

/** Viewer payload for one Worksheet & MCQ row (PDF extract or generator). */
export function buildWorksheetRenderableFromStructured(source) {
  const w = normalizeWorksheetStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  const canonicalSections = buildCanonicalWorksheetSectionList(w.sections);
  return {
    kind: 'worksheet',
    title: String(w.title || w.worksheet_title || 'Worksheet').trim(),
    learningObjectives: toStringList(w.learning_objectives),
    instructions: String(w.instructions || '').trim(),
    sections: canonicalSections.map((section) => ({
      sectionName: String(section?.sectionName || section?.title || 'Section').trim(),
      questions: toQuestionArray(section?.questions || []).map((q) => ({
        question: String(q.question || '').trim(),
        options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [],
        answer: String(q.answer || '').trim(),
        marks: q.marks != null && q.marks !== '' ? Number(q.marks) : undefined,
        question_number: q.question_number ?? q.sl_no,
        type: String(q.type || '').trim(),
        explanation: String(q.explanation || '').trim(),
        bloom_level: String(q.bloom_level || '').trim(),
      })),
      count: section?.count ?? (Array.isArray(section?.questions) ? section.questions.length : 0),
    })),
    questions: Array.isArray(w.questions) ? w.questions : [],
    answerKey: String(w.answer_key || '').trim(),
    bloomLevel: String(w.bloom_level || '').trim(),
    difficultyTag: String(w.difficulty_tag || '').trim(),
  };
}

export const PRACTICE_QA_SECTION_LABELS = {
  A: 'Section A: MCQs',
  B: 'Section B: Fill in the Blanks',
  C: 'Section C: Match the Following',
  D: 'Section D: Very Short Answer Questions',
  E: 'Section E: Short Answer Questions',
  F: 'Section F: Application / Case-based Questions',
  G: 'Section G: HOTS / Analytical Questions',
};

export const PRACTICE_QA_REAL_LIFE_SECTION = 'Real-life Problem-solving Questions';

function inferPracticeQaSectionLabel(sectionRaw, question = {}) {
  const s = String(sectionRaw || '').trim();
  const t = String(question.type || '').trim().toUpperCase();
  if (/^A\b|SECTION\s*A|MCQ|MULTIPLE\s*CHOICE/i.test(s) || t === 'MCQ') return PRACTICE_QA_SECTION_LABELS.A;
  if (/^B\b|SECTION\s*B|FILL|FIB|BLANK/i.test(s) || t === 'FIB') return PRACTICE_QA_SECTION_LABELS.B;
  if (/^C\b|SECTION\s*C|MATCH/i.test(s) || t === 'MATCH') return PRACTICE_QA_SECTION_LABELS.C;
  if (/^D\b|SECTION\s*D|VERY\s*SHORT|VSA/i.test(s) || t === 'VSA') return PRACTICE_QA_SECTION_LABELS.D;
  if (/^E\b|SECTION\s*E|SHORT\s*ANSWER/i.test(s) && !/very/i.test(s)) return PRACTICE_QA_SECTION_LABELS.E;
  if (/^F\b|SECTION\s*F|APPLICATION|CASE[\s-]*BASED/i.test(s) || t === 'APPLICATION' || t === 'CASE') {
    return PRACTICE_QA_SECTION_LABELS.F;
  }
  if (/^G\b|SECTION\s*G|HOTS|ANALYTICAL/i.test(s) || t === 'HOTS') return PRACTICE_QA_SECTION_LABELS.G;
  if (/REAL[\s-]*LIFE|PROBLEM[\s-]*SOLVING/i.test(s)) return PRACTICE_QA_REAL_LIFE_SECTION;
  if (s && s !== 'Questions') return s;
  if (Array.isArray(question.options) && question.options.length >= 2) return PRACTICE_QA_SECTION_LABELS.A;
  if (/_{2,}/.test(String(question.question || ''))) return PRACTICE_QA_SECTION_LABELS.B;
  if (/match\s*(the\s*)?following/i.test(String(question.question || ''))) {
    return PRACTICE_QA_SECTION_LABELS.C;
  }
  if (/application|case[\s-]*based|competency/i.test(String(question.question || ''))) {
    return PRACTICE_QA_SECTION_LABELS.F;
  }
  if (/hots|analytical|higher[\s-]*order/i.test(String(question.question || ''))) {
    return PRACTICE_QA_SECTION_LABELS.G;
  }
  const qText = String(question.question || '').trim();
  const words = qText.split(/\s+/).filter(Boolean).length;
  if (/\?/.test(qText) && words <= 22) return PRACTICE_QA_SECTION_LABELS.D;
  if (/\?/.test(qText)) return PRACTICE_QA_SECTION_LABELS.E;
  return PRACTICE_QA_SECTION_LABELS.D;
}

export function groupQuestionsIntoPracticeQaSections(questions = []) {
  const cleaned = sanitizeWorksheetQuestions(toQuestionArray(questions));
  const map = new Map();
  for (const q of cleaned) {
    const sectionName = inferPracticeQaSectionLabel(q.section, q);
    if (!map.has(sectionName)) map.set(sectionName, []);
    map.get(sectionName).push({
      ...q,
      question_number: q.question_number ?? q.sl_no,
      type: String(q.type || '').trim() || (q.options?.length >= 2 ? 'MCQ' : ''),
      bloom_level: String(q.bloom_level || q.bloomLevel || '').trim(),
      difficulty_tag: String(q.difficulty_tag || q.difficulty || q.difficultyTag || '').trim(),
      marks: q.marks != null && q.marks !== '' ? Number(q.marks) : undefined,
    });
  }
  const order = Object.values(PRACTICE_QA_SECTION_LABELS);
  const sections = [];
  for (const label of order) {
    if (map.has(label)) {
      const qs = map.get(label);
      qs.sort((a, b) => Number(a.question_number || 0) - Number(b.question_number || 0));
      sections.push({ sectionName: label, questions: qs, count: qs.length });
      map.delete(label);
    }
  }
  for (const [sectionName, qs] of map.entries()) {
    if (sectionName === PRACTICE_QA_REAL_LIFE_SECTION) continue;
    qs.sort((a, b) => Number(a.question_number || 0) - Number(b.question_number || 0));
    sections.push({ sectionName, questions: qs, count: qs.length });
  }
  return sections;
}

function mergePracticeQaSections(base = [], extra = []) {
  const allQs = [];
  for (const sec of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    const name = String(sec?.sectionName || sec?.name || '').trim();
    const qs = toQuestionArray(sec?.questions || []).map((q) => ({ ...q, section: q.section || name }));
    allQs.push(...qs);
  }
  return groupQuestionsIntoPracticeQaSections(allQs);
}

/** Smart Q&A Practice Generator → 14-section template (sections A–G + real-life). */
export function normalizePracticeQaStructuredContent(raw, sourceText = '') {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = String(source.title || source.practice_set_title || source.name || source.topic || '').trim();
  const instructions = String(
    source.instructions || source.student_instructions || '',
  ).trim();
  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);
  const answer_key_with_explanations = String(
    source.answer_key_with_explanations ||
      source.answer_key ||
      source.answerKey ||
      source.answers ||
      '',
  ).trim();

  let sections = [];
  if (Array.isArray(source.sections) && source.sections.length) {
    sections = mergePracticeQaSections(source.sections, []);
  }

  const looseQuestions = [];
  if (String(source.question || '').trim()) {
    looseQuestions.push({
      question: source.question,
      options: source.options,
      answer: source.answer,
      question_number: source.question_number ?? source.sl_no,
      section: source.section,
      type: source.type,
      marks: source.marks,
      explanation: source.explanation,
      bloom_level: source.bloom_level,
      difficulty_tag: source.difficulty_tag,
    });
  }

  const sectionKeys = [
    ['section_a_mcqs', PRACTICE_QA_SECTION_LABELS.A],
    ['section_a', PRACTICE_QA_SECTION_LABELS.A],
    ['section_b_fill_in_blanks', PRACTICE_QA_SECTION_LABELS.B],
    ['section_b_fib', PRACTICE_QA_SECTION_LABELS.B],
    ['fill_in_blanks', PRACTICE_QA_SECTION_LABELS.B],
    ['section_c_match_following', PRACTICE_QA_SECTION_LABELS.C],
    ['section_c_match', PRACTICE_QA_SECTION_LABELS.C],
    ['match_following', PRACTICE_QA_SECTION_LABELS.C],
    ['section_d_vsa', PRACTICE_QA_SECTION_LABELS.D],
    ['section_d', PRACTICE_QA_SECTION_LABELS.D],
    ['section_e_short_answer', PRACTICE_QA_SECTION_LABELS.E],
    ['section_e_sa', PRACTICE_QA_SECTION_LABELS.E],
    ['section_d_sa', PRACTICE_QA_SECTION_LABELS.E],
    ['section_f_application', PRACTICE_QA_SECTION_LABELS.F],
    ['section_f_case_based', PRACTICE_QA_SECTION_LABELS.F],
    ['section_g_hots', PRACTICE_QA_SECTION_LABELS.G],
    ['section_g_analytical', PRACTICE_QA_SECTION_LABELS.G],
  ];
  for (const [key, label] of sectionKeys) {
    const block = source[key];
    if (!block || !Array.isArray(block)) continue;
    looseQuestions.push(...toQuestionArray(block).map((q) => ({ ...q, section: q.section || label })));
  }

  const flatPools = [
    source.questions,
    source.practice_questions,
    source.mcqs,
    source.items,
  ];
  for (const pool of flatPools) {
    looseQuestions.push(...toQuestionArray(pool));
  }

  if (looseQuestions.length) {
    sections = mergePracticeQaSections(sections, groupQuestionsIntoPracticeQaSections(looseQuestions));
  }

  if (!sections.length && sourceText) {
    const fromText = sanitizeWorksheetQuestions(extractQuestionsFromText(sourceText));
    if (fromText.length) sections = groupQuestionsIntoPracticeQaSections(fromText);
  }

  const real_life_problem_solving_questions = sanitizeWorksheetQuestions(
    toQuestionArray(source.real_life_problem_solving_questions || source.real_life_questions).map((q) => ({
      ...q,
      section: PRACTICE_QA_REAL_LIFE_SECTION,
    })),
  );

  const questions = [
    ...sections.flatMap((sec) =>
      (sec.questions || []).map((q) => ({ ...q, section: q.section || sec.sectionName })),
    ),
    ...real_life_problem_solving_questions,
  ];

  let answerKeyOut = answer_key_with_explanations;
  if (!answerKeyOut && questions.length) {
    const lines = [];
    for (const q of questions) {
      if (String(q.answer || '').trim()) {
        const n = q.question_number != null ? `Q${q.question_number}` : 'Q';
        const expl = String(q.explanation || '').trim();
        lines.push(`${n}: ${q.answer}${expl ? ` — ${expl}` : ''}`);
      }
    }
    if (lines.length) answerKeyOut = lines.join('\n');
  }

  return {
    ...source,
    title: title || 'Practice Q&A',
    instructions,
    learning_objectives,
    objectives: learning_objectives,
    sections,
    real_life_problem_solving_questions,
    questions: sanitizeWorksheetQuestions(questions),
    answer_key_with_explanations: answerKeyOut,
    answer_key: answerKeyOut,
  };
}

export function canonicalizePracticeQaExtractedItem(raw, sourceText = '') {
  return normalizePracticeQaStructuredContent(raw, sourceText);
}

export function buildCanonicalPracticeQaSectionList(sections = []) {
  const grouped = groupQuestionsIntoPracticeQaSections(
    (Array.isArray(sections) ? sections : []).flatMap((sec) =>
      (Array.isArray(sec?.questions) ? sec.questions : []).map((q) => ({
        ...q,
        section: q.section || sec.sectionName,
      })),
    ),
  );
  const byName = new Map(grouped.map((sec) => [sec.sectionName, sec]));
  return Object.values(PRACTICE_QA_SECTION_LABELS).map((sectionName) => {
    const hit = byName.get(sectionName);
    return {
      sectionName,
      questions: hit?.questions || [],
      count: hit?.questions?.length || 0,
    };
  });
}

/** Viewer payload for Smart Q&A Practice Generator (PDF extract or generator). */
export function buildPracticeQaRenderableFromStructured(source) {
  const p = normalizePracticeQaStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  const canonicalSections = buildCanonicalPracticeQaSectionList(p.sections);
  const mapQuestion = (q) => ({
    question: String(q.question || '').trim(),
    options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [],
    answer: String(q.answer || '').trim(),
    marks: q.marks != null && q.marks !== '' ? Number(q.marks) : undefined,
    question_number: q.question_number ?? q.sl_no,
    type: String(q.type || '').trim(),
    explanation: String(q.explanation || q.step_by_step_answer || '').trim(),
    bloom_level: String(q.bloom_level || q.bloomLevel || '').trim(),
    difficulty_tag: String(q.difficulty_tag || q.difficulty || q.difficultyTag || '').trim(),
  });
  return {
    kind: 'practiceQa',
    title: String(p.title || 'Practice Q&A').trim(),
    learningObjectives: toStringList(p.learning_objectives),
    instructions: String(p.instructions || '').trim(),
    sections: canonicalSections.map((section) => ({
      sectionName: String(section?.sectionName || 'Section').trim(),
      questions: toQuestionArray(section?.questions || []).map(mapQuestion),
      count: section?.count ?? (Array.isArray(section?.questions) ? section.questions.length : 0),
    })),
    realLifeProblemSolvingQuestions: toQuestionArray(p.real_life_problem_solving_questions).map(
      mapQuestion,
    ),
    questions: Array.isArray(p.questions) ? p.questions.map(mapQuestion) : [],
    answerKeyWithExplanations: String(p.answer_key_with_explanations || '').trim(),
    answerKey: String(p.answer_key_with_explanations || '').trim(),
  };
}

/** Viewer payload for one Homework Creator row (PDF extract or generator). */
export function buildHomeworkRenderableFromStructured(source) {
  const h = normalizeHomeworkStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'homework',
    title: String(h.title || 'Homework').trim(),
    instructions: String(h.instructions || '').trim(),
    practiceQuestions: Array.isArray(h.practice_questions) ? h.practice_questions : [],
    applicationTasks: toStringList(h.application_tasks),
    creativeThinkingQuestion: String(h.creative_thinking_question || '').trim(),
    realLifeObservationTask: String(h.real_life_observation_task || '').trim(),
    challengeQuestion: String(h.challenge_question || '').trim(),
    supportHint: String(h.support_hint || '').trim(),
    answerHints: String(h.answer_hints || '').trim(),
    parentNote: String(h.parent_note || '').trim(),
  };
}

/** Group flat exam question rows by PDF section label (Section A, MCQs, etc.). */
export function groupQuestionsIntoExamSections(questions = []) {
  const cleaned = sanitizeWorksheetQuestions(toQuestionArray(questions));
  const map = new Map();
  for (const q of cleaned) {
    const sectionName = String(q.section || q.sectionName || '').trim() || 'Questions';
    if (!map.has(sectionName)) map.set(sectionName, []);
    map.get(sectionName).push({
      ...q,
      question_number: q.question_number ?? q.sl_no,
      internal_choice_group: String(q.internal_choice_group || q.internalChoiceGroup || '').trim(),
      marks: q.marks != null && q.marks !== '' ? Number(q.marks) : undefined,
    });
  }
  const sections = [];
  for (const [sectionName, qs] of map.entries()) {
    qs.sort((a, b) => Number(a.question_number || 0) - Number(b.question_number || 0));
    sections.push({
      sectionName,
      questions: qs,
      count: qs.length,
    });
  }
  return sections;
}

/** Merge section question lists when consolidating exam PDF fragments. */
export function mergeExamPaperSections(base = [], extra = []) {
  const map = new Map();
  for (const sec of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    if (!sec || typeof sec !== 'object') continue;
    const name = String(sec.sectionName || sec.name || sec.title || 'Questions').trim();
    const qs = toQuestionArray(sec.questions || []);
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(...qs);
  }
  return groupQuestionsIntoExamSections(
    Array.from(map.values()).flatMap((qs) => qs),
  ).map((sec, i) => {
    const prev = [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])].find(
      (s) => String(s?.sectionName || s?.name || '').trim() === sec.sectionName,
    );
    return {
      ...sec,
      type: prev?.type || prev?.section_type || '',
      total_marks: prev?.total_marks,
      estimated_time: prev?.estimated_time,
      count: sec.questions.length,
    };
  });
}

/** Exam paper PDF / generator → 11-section template + sections A–E. */
export function normalizeExamPaperStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};

  const paperTitle = String(
    source.paper_title || source.title || source.exam_title || source.name || '',
  ).trim();
  const instructions = String(
    source.instructions || source.general_instructions || source.exam_instructions || '',
  ).trim();
  const blueprint = String(source.blueprint || source.design_grid || source.blueprint_grid || '').trim();
  const internalChoices = String(
    source.internal_choices || source.internal_choice || source.choice_instructions || '',
  ).trim();
  const answerKey = String(
    source.answer_key || source.answerKey || source.answers || source.complete_answer_key || '',
  ).trim();
  const markingScheme = String(
    source.marking_scheme || source.markingScheme || source.detailed_marking_scheme || '',
  ).trim();
  const openEndedRubric = String(
    source.open_ended_rubric || source.openEndedRubric || source.rubric_open || source.rubric_hint || '',
  ).trim();

  let sections = [];
  if (Array.isArray(source.sections) && source.sections.length) {
    sections = mergeExamPaperSections(source.sections, []);
  }

  const looseQuestions = [];
  if (String(source.question || '').trim()) {
    looseQuestions.push({
      question: source.question,
      options: source.options,
      answer: source.answer,
      question_number: source.question_number ?? source.sl_no,
      section: source.section,
      marks: source.marks,
      internal_choice_group: source.internal_choice_group,
    });
  }
  for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {
    const block = source[key];
    if (!block) continue;
    const label =
      key === 'section_a'
        ? 'Section A: MCQs'
        : key === 'section_b'
          ? 'Section B: Very Short Answer Questions'
          : key === 'section_c'
            ? 'Section C: Short Answer Questions'
            : key === 'section_d'
              ? 'Section D: Long Answer Questions'
              : 'Section E: Case-based / Competency-based Questions';
    if (Array.isArray(block)) {
      looseQuestions.push(...toQuestionArray(block).map((q) => ({ ...q, section: q.section || label })));
    } else if (typeof block === 'object' && Array.isArray(block.questions)) {
      sections = mergeExamPaperSections(sections, [
        { sectionName: String(block.sectionName || label).trim(), questions: block.questions },
      ]);
    }
  }

  if (looseQuestions.length) {
    sections = mergeExamPaperSections(sections, groupQuestionsIntoExamSections(looseQuestions));
  }

  if (!sections.length) {
    const fromLists = toQuestionArray([
      ...(Array.isArray(source.questions) ? source.questions : []),
      ...(Array.isArray(source.mcqs) ? source.mcqs : []),
    ]);
    if (fromLists.length) sections = groupQuestionsIntoExamSections(fromLists);
  }

  let answerKeyOut = answerKey;
  if (!answerKeyOut && sections.length) {
    const lines = [];
    for (const sec of sections) {
      for (const q of sec.questions || []) {
        if (String(q.answer || '').trim()) {
          const n = q.question_number != null ? `Q${q.question_number}` : 'Q';
          lines.push(`${n} (${sec.sectionName}): ${q.answer}`);
        }
      }
    }
    if (lines.length) answerKeyOut = lines.join('\n');
  }

  return {
    ...source,
    title: paperTitle || source.title || 'Exam Paper',
    paper_title: paperTitle || source.paper_title || 'Exam Paper',
    instructions,
    blueprint,
    sections,
    internal_choices: internalChoices,
    answer_key: answerKeyOut,
    marking_scheme: markingScheme,
    open_ended_rubric: openEndedRubric,
    total_marks: source.total_marks ?? source.totalMarks,
    estimated_time: source.estimated_time ?? source.estimatedTime ?? source.duration,
  };
}

export function canonicalizeExamPaperExtractedItem(raw) {
  return normalizeExamPaperStructuredContent(raw);
}

/** Viewer payload for one Exam Question Paper row (PDF extract or generator). */
export function buildExamPaperRenderableFromStructured(source) {
  const ex = normalizeExamPaperStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'examPaper',
    title: String(ex.paper_title || ex.title || 'Exam Paper').trim(),
    paperTitle: String(ex.paper_title || ex.title || '').trim(),
    instructions: String(ex.instructions || '').trim(),
    blueprint: String(ex.blueprint || '').trim(),
    sections: (Array.isArray(ex.sections) ? ex.sections : []).map((section) => ({
      sectionName: String(section?.sectionName || section?.title || section?.name || 'Section').trim(),
      type: String(section?.type || section?.section_type || '').trim(),
      totalMarks: section?.total_marks,
      estimatedTime: section?.estimated_time,
      count: section?.count ?? (Array.isArray(section?.questions) ? section.questions.length : 0),
      questions: toQuestionArray(section?.questions || []).map((q) => ({
        question: String(q.question || '').trim(),
        options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [],
        answer: String(q.answer || '').trim(),
        marks: q.marks != null && q.marks !== '' ? Number(q.marks) : undefined,
        question_number: q.question_number ?? q.sl_no,
        internalChoiceGroup: String(q.internal_choice_group || q.internalChoiceGroup || '').trim(),
        explanation: String(q.explanation || '').trim(),
        bloom_level: String(q.bloom_level || '').trim(),
      })),
    })),
    internalChoices: String(ex.internal_choices || '').trim(),
    answerKey: String(ex.answer_key || '').trim(),
    markingScheme: String(ex.marking_scheme || '').trim(),
    openEndedRubric: String(ex.open_ended_rubric || '').trim(),
    totalMarks: ex.total_marks,
    estimatedTime: ex.estimated_time,
  };
}

function normalizeRubricCriterionRow(raw) {
  if (typeof raw === 'string') {
    const s = raw.trim();
    return s ? { name: s, excellent: '', good: '', satisfactory: '', needs_improvement: '' } : null;
  }
  const o = raw && typeof raw === 'object' ? raw : {};
  const name = String(o.name || o.criterion || o.skill || o.dimension || '').trim();
  const excellent = String(o.excellent || o.Exemplary || o.level_4 || o.level4 || '').trim();
  const good = String(o.good || o.Proficient || o.level_3 || o.level3 || '').trim();
  const satisfactory = String(o.satisfactory || o.Developing || o.level_2 || o.level2 || '').trim();
  const needs = String(
    o.needs_improvement || o.needsImprovement || o.Beginning || o.level_1 || o.level1 || o.poor || '',
  ).trim();
  if (!name && !excellent && !good && !satisfactory && !needs) return null;
  return {
    name: name || 'Criterion',
    excellent,
    good,
    satisfactory,
    needs_improvement: needs,
  };
}

/** Rubrics / report card PDF rows → 10-section template + criteria grid. */
export function normalizeRubricStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const criteriaRaw = [...(Array.isArray(source.criteria) ? source.criteria : [])];
  const rowLooksLikeCriterion =
    !String(source.title || source.assessment_purpose || '').trim() &&
    (source.excellent || source.good || source.satisfactory || source.needs_improvement);
  if (rowLooksLikeCriterion && String(source.name || source.criterion || '').trim()) {
    criteriaRaw.push(source);
  }
  const seen = new Set();
  const criteria = [];
  for (const entry of criteriaRaw) {
    const row = normalizeRubricCriterionRow(entry);
    if (!row) continue;
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    criteria.push(row);
  }

  const title = String(
    source.title || source.rubric_title || (rowLooksLikeCriterion ? '' : source.name) || 'Rubric',
  ).trim();

  return {
    ...source,
    title: title || 'Rubric',
    assessment_purpose: String(source.assessment_purpose || source.purpose || '').trim(),
    competency_assessed: String(
      source.competency_assessed || source.learning_outcome_assessed || source.competency || '',
    ).trim(),
    criteria,
    grading_criteria: String(
      source.grading_criteria || source.grading_scale_description || source.gradingScale || '',
    ).trim(),
    gradingScale: toStringList(source.gradingScale || source.grading_scale),
    strengths_observed: String(source.strengths_observed || source.strengths || '').trim(),
    areas_for_improvement: String(
      source.areas_for_improvement || source.improvements || source.weaknesses || '',
    ).trim(),
    teacher_remarks: String(source.teacher_remarks || source.remarks || source.comments || '').trim(),
    actionable_suggestions: String(
      source.actionable_suggestions || source.suggestions || source.recommendations || '',
    ).trim(),
    parent_friendly_feedback: String(
      source.parent_friendly_feedback || source.parent_feedback || source.parent_note || '',
    ).trim(),
    next_step_remedial_enrichment: String(
      source.next_step_remedial_enrichment || source.next_steps || source.remedial_enrichment || '',
    ).trim(),
  };
}

export function canonicalizeRubricExtractedItem(raw) {
  return normalizeRubricStructuredContent(raw);
}

/** Viewer payload for one Rubrics / Evaluation row (PDF extract or generator). */
export function buildRubricRenderableFromStructured(source) {
  const r = normalizeRubricStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'rubric',
    title: String(r.title || 'Rubric').trim(),
    assessmentPurpose: String(r.assessment_purpose || '').trim(),
    competencyAssessed: String(r.competency_assessed || '').trim(),
    criteriaRows: Array.isArray(r.criteria) ? r.criteria : [],
    gradingCriteria: String(r.grading_criteria || '').trim(),
    strengthsObserved: String(r.strengths_observed || '').trim(),
    areasForImprovement: String(r.areas_for_improvement || '').trim(),
    teacherRemarks: String(r.teacher_remarks || '').trim(),
    actionableSuggestions: String(r.actionable_suggestions || '').trim(),
    parentFriendlyFeedback: String(r.parent_friendly_feedback || '').trim(),
    nextStepRemedialEnrichment: String(r.next_step_remedial_enrichment || '').trim(),
  };
}

function dedupeStringList(items) {
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * PDF / Gemini often returns lesson_name + learning_objectives only; the app UI expects
 * objectives[], activities[], timeline[], assessment.
 */
export function normalizeLessonPlannerStructuredContent(raw, toolSlug = 'lesson-planner') {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};

  const objectives = dedupeStringList([
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.learningObjectives),
    ...coerceBulletLines(source.learning_outcomes),
    ...coerceBulletLines(source.outcomes),
    ...coerceBulletLines(source.goals),
    ...coerceBulletLines(source.learning_goals),
    ...coerceBulletLines(source.competencies),
  ]);

  const activities = dedupeStringList([
    ...coerceBulletLines(source.activities),
    ...coerceBulletLines(source.teaching_activities),
    ...coerceBulletLines(source.lesson_activities),
    ...coerceBulletLines(source.teaching_learning_process),
    ...coerceBulletLines(source.teaching_learning_activities),
    ...coerceBulletLines(source.classroom_activities),
    ...coerceBulletLines(source.classroom_transaction),
    ...coerceBulletLines(source.transaction_process),
    ...coerceBulletLines(source.pedagogy),
    ...coerceBulletLines(source.pedagogical_steps),
    ...coerceBulletLines(source.procedure),
    ...coerceBulletLines(source.methodology),
    ...coerceBulletLines(source.lesson_procedure),
    ...coerceBulletLines(source.instructional_procedure),
    ...coerceBulletLines(source.lesson_flow),
    ...coerceBulletLines(source.main_activity),
    ...coerceBulletLines(source.steps),
    ...(Array.isArray(source.phases)
      ? source.phases.map((p) =>
          [p?.name, p?.phase, p?.title, p?.details, p?.description]
            .filter(Boolean)
            .map((x) => String(x).trim())
            .join(' — '),
        )
      : []),
  ]);

  let timeline = dedupeStringList([
    ...coerceBulletLines(source.timeline),
    ...coerceBulletLines(source.schedule),
    ...coerceBulletLines(source.duration_plan),
    ...coerceBulletLines(source.period_plan),
  ]);

  if (Array.isArray(source.time_slots) && source.time_slots.length) {
    const fromSlots = source.time_slots
      .map((ts) => {
        const t = String(ts?.time || ts?.duration || ts?.slot || '').trim();
        const a = String(ts?.activity || ts?.task || ts?.topic || ts?.description || '').trim();
        if (t && a) return `${t}: ${a}`;
        if (a) return a;
        if (t) return t;
        return '';
      })
      .filter(Boolean);
    timeline = dedupeStringList([...timeline, ...fromSlots]);
  }

  if (!timeline.length && activities.length) {
    if (toolSlug === 'daily-class-plan-maker') {
      timeline = activities.slice();
    } else if (toolSlug === 'lesson-planner') {
      timeline = activities.map((a, i) => `${i + 1}. ${a}`).slice(0, 40);
    }
  }

  let activitiesOut = activities;
  if (!activitiesOut.length) {
    activitiesOut = dedupeStringList(
      coerceBulletLines(source.content || source.lesson_content || source.body || source.summary || ''),
    );
  }

  const formativeAssessmentQuestions = dedupeStringList([
    ...coerceBulletLines(source.formative_assessment_questions),
    ...coerceBulletLines(source.formative_questions),
  ]);

  const assessment = String(
    source.assessment ||
      source.evaluation ||
      source.assessment_strategy ||
      source.assessment_strategies ||
      source.summative_assessment ||
      source.assessment_criteria ||
      source.evaluation_criteria ||
      '',
  ).trim();

  const teacherTalkPoints = dedupeStringList([
    ...coerceBulletLines(source.teacher_talk_points),
    ...coerceBulletLines(source.teacher_instructions),
    ...coerceBulletLines(source.teacher_talk),
  ]);

  const studentTasks = dedupeStringList([
    ...coerceBulletLines(source.student_tasks),
    ...coerceBulletLines(source.student_instructions),
  ]);

  const materialsRequired = dedupeStringList([
    ...coerceBulletLines(source.materials_required),
    ...coerceBulletLines(source.materials),
    ...coerceBulletLines(source.resources),
  ]);

  let teachingAidsRequired = dedupeStringList([
    ...coerceBulletLines(source.teaching_aids_required),
    ...coerceBulletLines(source.teaching_aids),
  ]);
  if (!teachingAidsRequired.length) teachingAidsRequired = materialsRequired.slice();

  const ncfRaw = source.ncf_competency_alignment ?? source.competencies ?? source.ncf_alignment;
  const ncfCompetencyAlignment = Array.isArray(ncfRaw)
    ? dedupeStringList(ncfRaw)
    : String(ncfRaw || '').trim();

  const lessonTitle = String(source.lesson_name || source.title || source.name || '').trim();

  return {
    ...source,
    lesson_name: lessonTitle || source.lesson_name,
    title: String(source.title || lessonTitle || '').trim() || source.title,
    learning_objectives: objectives.length ? objectives : coerceBulletLines(source.learning_objectives),
    objectives,
    teaching_activities: activitiesOut,
    activities: activitiesOut,
    timeline,
    materials_required: materialsRequired,
    teaching_aids_required: teachingAidsRequired,
    ncf_competency_alignment: ncfCompetencyAlignment,
    prior_knowledge_diagnostic: String(
      source.prior_knowledge_diagnostic || source.diagnostic_question || source.prior_knowledge || '',
    ).trim(),
    introduction_warmup: String(
      source.introduction_warmup || source.warmup || source.warm_up || '',
    ).trim(),
    teaching_strategy: String(
      source.teaching_strategy || source.pedagogy || source.methodology_summary || '',
    ).trim(),
    teacher_talk_points: teacherTalkPoints,
    student_tasks: studentTasks,
    formative_assessment_questions: formativeAssessmentQuestions,
    differentiation_plan: String(
      source.differentiation_plan || source.differentiation || source.udl_support || '',
    ).trim(),
    homework_practice: String(
      source.homework_practice || source.homework || source.practice || '',
    ).trim(),
    closure_exit_ticket: String(
      source.closure_exit_ticket || source.reflection_exit_ticket || source.exit_ticket || '',
    ).trim(),
    assessment,
  };
}

export function canonicalizeLessonPlannerExtractedItem(raw, toolSlug = 'lesson-planner') {
  return normalizeLessonPlannerStructuredContent(raw, toolSlug);
}

/** Daily class plan PDF rows → 9-section template + period time_slots. */
export function normalizeDailyClassPlanStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};

  const objectives = dedupeStringList([
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.period_objectives),
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);

  const teachingMethods = dedupeStringList([
    ...coerceBulletLines(source.teaching_methods),
    ...coerceBulletLines(source.methodology),
    ...coerceBulletLines(source.pedagogy),
  ]);

  const classroomActivity = dedupeStringList([
    ...coerceBulletLines(source.classroom_activity),
    ...coerceBulletLines(source.classroom_activities),
    ...coerceBulletLines(source.activities),
    ...coerceBulletLines(source.teaching_activities),
    ...coerceBulletLines(source.demonstration),
  ]);

  const teachingAids = dedupeStringList([
    ...coerceBulletLines(source.teaching_aids),
    ...coerceBulletLines(source.materials_required),
    ...coerceBulletLines(source.materials),
    ...coerceBulletLines(source.resources),
  ]);

  let timeSlots = [];
  if (Array.isArray(source.time_slots) && source.time_slots.length) {
    timeSlots = source.time_slots
      .map((ts) => {
        if (!ts || typeof ts !== 'object') return null;
        const time = String(ts.time || ts.duration || ts.slot || ts.period || '').trim();
        const activity = String(ts.activity || ts.task || ts.topic || ts.description || '').trim();
        const type = String(ts.type || ts.period_type || '').trim();
        if (!time && !activity) return null;
        return { time, activity, type };
      })
      .filter(Boolean);
  }

  let timeline = dedupeStringList([
    ...coerceBulletLines(source.timeline),
    ...coerceBulletLines(source.schedule),
    ...coerceBulletLines(source.period_plan),
  ]);

  if (!timeSlots.length && timeline.length) {
    timeSlots = timeline
      .map((line) => {
        const m = String(line).match(/^([^:–-]+)[:–-]\s*(.+)$/);
        if (m) {
          return {
            time: m[1].trim(),
            activity: m[2].trim(),
            type: '',
          };
        }
        return { time: '', activity: line, type: '' };
      })
      .filter((s) => s.activity);
  }

  if (!timeline.length && timeSlots.length) {
    timeline = timeSlots.map((ts) => {
      const t = String(ts.time || '').trim();
      const a = String(ts.activity || '').trim();
      if (t && a) return `${t}: ${a}`;
      return a || t;
    });
  }

  const planTitle = String(
    source.title || source.day_period_topic_breakup || source.lesson_name || source.name || 'Daily Plan',
  ).trim();

  return {
    ...source,
    title: planTitle,
    day_period_topic_breakup: String(
      source.day_period_topic_breakup || source.topic_breakup || source.day_plan || source.title || '',
    ).trim(),
    objectives,
    period_objectives: objectives,
    teaching_methods: teachingMethods,
    classroom_activity: classroomActivity,
    exit_ticket: String(
      source.exit_ticket || source.formative_check || source.quick_assessment || source.assessment || '',
    ).trim(),
    differentiated_support: String(
      source.differentiated_support || source.differentiation || source.udl_support || '',
    ).trim(),
    homework_followup: String(
      source.homework_followup || source.homework || source.follow_up || source.homework_practice || '',
    ).trim(),
    teaching_aids: teachingAids,
    teacher_reflection_notes: String(
      source.teacher_reflection_notes || source.reflection || source.teacher_notes || '',
    ).trim(),
    time_slots: timeSlots,
    timeline,
  };
}

export function canonicalizeDailyClassPlanExtractedItem(raw) {
  return normalizeDailyClassPlanStructuredContent(raw);
}

/** Viewer payload for one Daily Class Plan row (PDF extract or generator). */
export function buildDailyClassPlanRenderableFromStructured(source) {
  const d = normalizeDailyClassPlanStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'dailyPlan',
    title: String(d.title || 'Daily Plan').trim(),
    dayPeriodTopicBreakup: String(d.day_period_topic_breakup || '').trim(),
    objectives: toStringList(d.objectives),
    teachingMethods: toStringList(d.teaching_methods),
    classroomActivity: toStringList(d.classroom_activity),
    exitTicket: String(d.exit_ticket || '').trim(),
    differentiatedSupport: String(d.differentiated_support || '').trim(),
    homeworkFollowup: String(d.homework_followup || '').trim(),
    teachingAids: toStringList(d.teaching_aids),
    teacherReflectionNotes: String(d.teacher_reflection_notes || '').trim(),
    timeSlots: Array.isArray(d.time_slots) ? d.time_slots : [],
    timeline: toStringList(d.timeline),
  };
}

/** Viewer payload for one Lesson Planner row (PDF extract or generator). */
export function buildLessonPlanRenderableFromStructured(source, toolSlug = 'lesson-planner') {
  const lp = normalizeLessonPlannerStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
    toolSlug,
  );
  const ncf = lp.ncf_competency_alignment;
  return {
    kind: 'lessonPlan',
    title: String(lp.lesson_name || lp.title || 'Lesson Plan').trim(),
    lesson_name: String(lp.lesson_name || lp.title || '').trim(),
    objectives: toStringList(lp.objectives),
    ncfAlignment: Array.isArray(ncf) ? toStringList(ncf) : String(ncf || '').trim(),
    priorKnowledgeDiagnostic: String(lp.prior_knowledge_diagnostic || '').trim(),
    introductionWarmup: String(lp.introduction_warmup || '').trim(),
    teachingStrategy: String(lp.teaching_strategy || '').trim(),
    activities: toStringList(lp.activities),
    teacherTalkPoints: toStringList(lp.teacher_talk_points),
    studentTasks: toStringList(lp.student_tasks),
    formativeAssessmentQuestions: toStringList(lp.formative_assessment_questions),
    differentiationPlan: String(lp.differentiation_plan || '').trim(),
    homeworkPractice: String(lp.homework_practice || '').trim(),
    materials: toStringList(lp.materials_required),
    teachingAids: toStringList(lp.teaching_aids_required),
    closureExitTicket: String(lp.closure_exit_ticket || '').trim(),
    timeline: toStringList(lp.timeline),
    assessment: String(lp.assessment || '').trim(),
  };
}

const normalizeStructuredContentByTool = (toolSlug, structuredContent, contentType, sourceText = '') => {
  const source = structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
    ? structuredContent
    : {};
  if (toolSlug === 'activity-project-generator') {
    const normalized = normalizeActivityStructuredContent(source);
    return { normalizedStructuredContent: normalized };
  }
  if (toolSlug === 'lesson-planner') {
    return { normalizedStructuredContent: normalizeLessonPlannerStructuredContent(source, toolSlug) };
  }
  if (toolSlug === 'daily-class-plan-maker') {
    return { normalizedStructuredContent: normalizeDailyClassPlanStructuredContent(source) };
  }
  if (toolSlug === 'concept-mastery-helper') {
    return { normalizedStructuredContent: normalizeConceptMasteryDeckStructuredContent(source) };
  }
  if (toolSlug === 'concept-breakdown-explainer') {
    return { normalizedStructuredContent: normalizeConceptBreakdownStructuredContent(source) };
  }
  if (toolSlug === 'homework-creator') {
    return { normalizedStructuredContent: normalizeHomeworkStructuredContent(source) };
  }
  if (toolSlug === 'story-passage-creator') {
    return { normalizedStructuredContent: normalizeStoryStructuredContent(source) };
  }
  if (toolSlug === 'short-notes-summaries-maker') {
    return { normalizedStructuredContent: normalizeShortNotesStructuredContent(source) };
  }
  if (toolSlug === 'smart-study-guide-generator') {
    return { normalizedStructuredContent: normalizeStudyGuideStructuredContent(source) };
  }
  if (toolSlug === 'chapter-summary-creator') {
    return { normalizedStructuredContent: normalizeChapterSummaryStructuredContent(source) };
  }
  if (toolSlug === 'key-points-formula-extractor') {
    return { normalizedStructuredContent: normalizeKeyPointsStructuredContent(source) };
  }
  if (toolSlug === 'quick-assignment-builder') {
    return { normalizedStructuredContent: normalizeQuickAssignmentStructuredContent(source) };
  }
  if (toolSlug === 'rubrics-evaluation-generator') {
    return { normalizedStructuredContent: normalizeRubricStructuredContent(source) };
  }
  if (toolSlug === 'exam-question-paper-generator') {
    return { normalizedStructuredContent: normalizeExamPaperStructuredContent(source) };
  }
  if (toolSlug === 'worksheet-mcq-generator') {
    return {
      normalizedStructuredContent: normalizeWorksheetStructuredContent(source, sourceText),
    };
  }
  if (toolSlug === 'smart-qa-practice-generator') {
    return {
      normalizedStructuredContent: normalizePracticeQaStructuredContent(source, sourceText),
    };
  }
  if (toolSlug === 'flashcard-generator') {
    return { normalizedStructuredContent: normalizeFlashcardDeckStructuredContent(source) };
  }
  return { normalizedStructuredContent: source };
};

const TOOL_STRUCTURED_RULES = {
  'worksheet-mcq-generator': {
    allowedTypes: ['MCQ', 'Worksheet'],
    validate: (data) =>
      (Array.isArray(data?.questions) && data.questions.length > 0) ||
      (Array.isArray(data?.sections) && data.sections.some((s) => s?.questions?.length)),
    message: 'Worksheet & MCQ content must include questions or section blocks.',
  },
  'activity-project-generator': {
    allowedTypes: ['Activity Plan', 'Activity'],
    validate: (data) => {
      const steps = Array.isArray(data?.steps) ? data.steps : [];
      const materials = Array.isArray(data?.materials) ? data.materials : [];
      const lo = Array.isArray(data?.learningObjectives) ? data.learningObjectives : [];
      const lo2 = Array.isArray(data?.learning_objectives) ? data.learning_objectives : [];
      const ti = Array.isArray(data?.teacherInstructions) ? data.teacherInstructions : [];
      const ti2 = Array.isArray(data?.teacher_instructions) ? data.teacher_instructions : [];
      const ar = Array.isArray(data?.assessmentRubric) ? data.assessmentRubric : [];
      const exp = String(data?.learningOutcome || '').trim();
      const rla = String(data?.realLifeApplication || '').trim();
      const errOnlyPlaceholders =
        steps.length === 1 &&
        /^no structured steps were returned/i.test(String(steps[0] || '').trim());
      const hasUsableSteps = steps.length > 0 && !errOnlyPlaceholders;
      return (
        materials.length > 0 ||
        hasUsableSteps ||
        lo.length > 0 ||
        lo2.length > 0 ||
        ti.length > 0 ||
    ti2.length > 0 ||
    (Array.isArray(data?.studentInstructions) && data.studentInstructions.length > 0) ||
    (Array.isArray(data?.student_instructions) && data.student_instructions.length > 0) ||
    ar.length > 0 ||
        exp.length > 8 ||
        rla.length > 8
      );
    },
    message:
      'Activity content must include at least one filled template section (materials, procedure, objectives, teacher notes, outcomes, rubric, or real-life application).',
  },
  'concept-mastery-helper': {
    allowedTypes: ['Concept Notes', 'Notes'],
    validate: (data) =>
      Array.isArray(data?.concepts) &&
      data.concepts.length > 0 &&
      data.concepts.some((c) => conceptRowHasBody(c)),
    message:
      'Could not build Concept Mastery content for the selected topic and sub-topic. Try Generate again.',
  },
  'lesson-planner': {
    allowedTypes: ['Lesson Plan'],
    validate: (data) => {
      const o = Array.isArray(data?.objectives) ? data.objectives.length : 0;
      const a = Array.isArray(data?.activities) ? data.activities.length : 0;
      const t = Array.isArray(data?.timeline) ? data.timeline.length : 0;
      const s = String(data?.assessment || '').trim().length;
      return o > 0 || a > 0 || t > 0 || s > 24;
    },
    message:
      'Lesson plan must include at least one of: objectives, activities, timeline, or assessment (from the PDF).',
  },
  'homework-creator': {
    allowedTypes: ['Homework'],
    validate: (data) => {
      const pq = Array.isArray(data?.practice_questions) ? data.practice_questions.length : 0;
      const q = Array.isArray(data?.questions) ? data.questions.length : 0;
      const app = Array.isArray(data?.application_tasks) ? data.application_tasks.length : 0;
      const ins = String(data?.instructions || '').trim().length;
      return (
        pq > 0 ||
        q > 0 ||
        app > 0 ||
        ins > 12 ||
        String(data?.creative_thinking_question || '').trim().length > 8
      );
    },
    message:
      'Homework must include practice questions, instructions, application tasks, or another filled template section.',
  },
  'rubrics-evaluation-generator': {
    allowedTypes: ['Rubric'],
    validate: (data) => {
      const c = Array.isArray(data?.criteria) ? data.criteria.length : 0;
      return (
        c > 0 ||
        String(data?.assessment_purpose || '').trim().length > 8 ||
        String(data?.strengths_observed || '').trim().length > 8 ||
        String(data?.teacher_remarks || '').trim().length > 8
      );
    },
    message:
      'Rubric must include criteria[] and/or narrative evaluation sections (purpose, strengths, remarks).',
  },
  'story-passage-creator': {
    allowedTypes: ['Story'],
    validate: (data) =>
      String(data?.passage || data?.content || '').trim().length > 0 ||
      String(data?.title || '').trim().length > 0,
    message: 'Story content must include a non-empty passage or title.',
  },
  'short-notes-summaries-maker': {
    allowedTypes: ['Notes', 'Summary'],
    validate: (data) =>
      String(data?.short_note_summary || data?.summary || '').trim().length > 0 ||
      (Array.isArray(data?.key_points_to_remember) && data.key_points_to_remember.length > 0) ||
      (Array.isArray(data?.key_points) && data.key_points.length > 0) ||
      (Array.isArray(data?.keyPoints) && data.keyPoints.length > 0),
    message: 'Short notes must include a summary or key points to remember.',
  },
  'flashcard-generator': {
    allowedTypes: ['Flashcards'],
    validate: (data) =>
      Array.isArray(data?.cards) &&
      data.cards.length > 0 &&
      data.cards.every((card) => String(card?.front || '').trim() && String(card?.back || '').trim()),
    message: 'Flashcards content must include cards with front and back values.',
  },
  'daily-class-plan-maker': {
    allowedTypes: ['Daily Plan'],
    validate: (data) =>
      (Array.isArray(data?.timeline) && data.timeline.length > 0) ||
      (Array.isArray(data?.time_slots) && data.time_slots.length > 0) ||
      (Array.isArray(data?.objectives) && data.objectives.length > 0) ||
      Boolean(String(data?.day_period_topic_breakup || data?.exit_ticket || '').trim()),
    message: 'Daily plan content must include timeline, time slots, objectives, or other daily-plan sections.',
  },
  'exam-question-paper-generator': {
    allowedTypes: ['Exam Paper'],
    validate: (data) =>
      (Array.isArray(data?.sections) && data.sections.length > 0) ||
      Boolean(String(data?.question || data?.paper_title || '').trim()),
    message: 'Exam paper content must include sections with questions or at least one exam question.',
  },
  'smart-study-guide-generator': {
    allowedTypes: ['Study Guide', 'Notes'],
    validate: (data) =>
      (Array.isArray(data?.key_concepts) && data.key_concepts.length > 0) ||
      (Array.isArray(data?.quick_revision_notes) && data.quick_revision_notes.length > 0) ||
      (Array.isArray(data?.revision_checklist) && data.revision_checklist.length > 0) ||
      String(data?.chapter_subtopic_overview || data?.chapter_overview || '').trim().length > 8 ||
      (String(data?.title || '').trim().length > 0 &&
        (Array.isArray(data?.learning_objectives) && data.learning_objectives.length > 0)),
    message:
      'Study guide must include key concepts, quick revision notes, chapter overview, or a title with learning objectives.',
  },
  'concept-breakdown-explainer': {
    allowedTypes: ['Concept Notes', 'Notes'],
    validate: (data) =>
      (Array.isArray(data?.concepts) && data.concepts.length > 0) ||
      String(data?.simple_definition || data?.simple_explanation || data?.explanation || '').trim()
        .length > 8 ||
      (Array.isArray(data?.breakdown_steps) && data.breakdown_steps.length > 0) ||
      String(data?.quick_revision_summary || data?.summary || '').trim().length > 8,
    message:
      'Concept breakdown must include concepts[], simple definition, breakdown steps, or quick revision summary.',
  },
  'smart-qa-practice-generator': {
    allowedTypes: ['Practice Q&A', 'Homework'],
    validate: (data) => {
      const flat = Array.isArray(data?.questions) ? data.questions.length : 0;
      const secQs = Array.isArray(data?.sections)
        ? data.sections.reduce((n, s) => n + (Array.isArray(s?.questions) ? s.questions.length : 0), 0)
        : 0;
      const rl = Array.isArray(data?.real_life_problem_solving_questions)
        ? data.real_life_problem_solving_questions.length
        : 0;
      return flat > 0 || secQs > 0 || rl > 0;
    },
    message: 'Practice Q&A must include questions in sections A–G, real-life questions, or a flat questions array.',
  },
  'chapter-summary-creator': {
    allowedTypes: ['Chapter Summary', 'Summary', 'Notes'],
    validate: (data) =>
      String(data?.chapter_overview || data?.summary || data?.chapter_summary || '').trim().length > 8 ||
      (Array.isArray(data?.important_concepts) && data.important_concepts.length > 0) ||
      (Array.isArray(data?.quick_revision_notes) && data.quick_revision_notes.length > 0) ||
      (Array.isArray(data?.key_takeaways) && data.key_takeaways.length > 0),
    message:
      'Chapter summary must include chapter overview, important concepts, quick revision notes, or legacy summary/takeaways.',
  },
  'key-points-formula-extractor': {
    allowedTypes: ['Key Points', 'Notes'],
    validate: (data) =>
      (Array.isArray(data?.important_concepts) && data.important_concepts.length > 0) ||
      (Array.isArray(data?.must_remember_facts) && data.must_remember_facts.length > 0) ||
      (Array.isArray(data?.key_points) && data.key_points.length > 0) ||
      (Array.isArray(data?.formulae) && data.formulae.length > 0) ||
      (Array.isArray(data?.formulas) && data.formulas.length > 0) ||
      String(data?.one_minute_revision_summary || data?.summary || '').trim().length > 8,
    message:
      'Key points extractor must include important concepts, must-remember facts, formulae, or a revision summary.',
  },
  'quick-assignment-builder': {
    allowedTypes: ['Assignment', 'Homework'],
    validate: (data) =>
      (Array.isArray(data?.concept_based_questions) && data.concept_based_questions.length > 0) ||
      (Array.isArray(data?.questions) && data.questions.length > 0) ||
      (Array.isArray(data?.learning_objectives) && data.learning_objectives.length > 0) ||
      (Array.isArray(data?.application_oriented_tasks) && data.application_oriented_tasks.length > 0) ||
      String(data?.instructions || '').trim().length > 8 ||
      String(data?.assessment_criteria_rubric || data?.marking_criteria || '').trim().length > 8,
    message:
      'Quick assignment must include concept questions, learning objectives, application tasks, instructions, or assessment rubric.',
  },
};

function normalizeToolKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function extractJsonObject(text) {
  const raw = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const startArr = raw.indexOf('[');
  const startObj = raw.indexOf('{');
  const start =
    startArr !== -1 && (startObj === -1 || startArr < startObj) ? startArr : startObj;
  if (start === -1) {
    throw new Error('Gemini returned invalid JSON payload');
  }
  const endArr = raw.lastIndexOf(']');
  const endObj = raw.lastIndexOf('}');
  const end = start === startArr ? endArr : endObj;
  if (end === -1 || end <= start) {
    throw new Error('Gemini returned invalid JSON payload');
  }
  const slice = raw.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (Array.isArray(parsed)) {
      if (parsed.length && typeof parsed[0] === 'object' && parsed[0] !== null) {
        return parsed[0];
      }
      return {};
    }
    return parsed;
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('Gemini returned invalid JSON payload');
    }
  }
}

/**
 * Gemini often nests wrong, puts arrays at root, or stringifies structuredContent.
 */
function coerceRegenerationStructuredContent(toolSlug, parsed) {
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  let inner = root.structuredContent;

  if (typeof inner === 'string') {
    try {
      const s = inner
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      inner = JSON.parse(s);
    } catch {
      inner = {};
    }
  }
  if (inner === null || inner === undefined || typeof inner !== 'object' || Array.isArray(inner)) {
    inner = {};
  }

  if (toolSlug === 'activity-project-generator') {
    const data = root.data;
    const fromData =
      data && typeof data === 'object' && data.structuredContent && typeof data.structuredContent === 'object'
        ? data.structuredContent
        : {};
    let merged = {
      ...(root.activity && typeof root.activity === 'object' && !Array.isArray(root.activity) ? root.activity : {}),
      ...fromData,
      ...inner,
    };
    if (root.title || root.materials || root.steps || root.learningOutcome) {
      merged = {
        ...merged,
        title: merged.title || root.title,
        materials: merged.materials?.length ? merged.materials : root.materials,
        steps: merged.steps?.length ? merged.steps : root.steps,
        learningOutcome: merged.learningOutcome || root.learningOutcome,
      };
    }
    inner = merged;
  }

  if (toolSlug === 'daily-class-plan-maker') {
    const rootPick = {
      ...(root.title ? { title: root.title } : {}),
      ...(root.day_period_topic_breakup ? { day_period_topic_breakup: root.day_period_topic_breakup } : {}),
      ...(root.objectives ? { objectives: root.objectives } : {}),
      ...(root.teaching_methods ? { teaching_methods: root.teaching_methods } : {}),
      ...(root.classroom_activity ? { classroom_activity: root.classroom_activity } : {}),
      ...(root.timeline ? { timeline: root.timeline } : {}),
      ...(root.time_slots ? { time_slots: root.time_slots } : {}),
      ...(root.exit_ticket ? { exit_ticket: root.exit_ticket } : {}),
      ...(root.differentiated_support ? { differentiated_support: root.differentiated_support } : {}),
      ...(root.homework_followup ? { homework_followup: root.homework_followup } : {}),
      ...(root.teaching_aids ? { teaching_aids: root.teaching_aids } : {}),
      ...(root.teacher_reflection_notes
        ? { teacher_reflection_notes: root.teacher_reflection_notes }
        : {}),
    };
    if (Object.keys(rootPick).length) {
      inner = { ...rootPick, ...inner };
    }
  } else if (toolSlug === 'lesson-planner') {
    const rootPick = {
      ...(root.objectives ? { objectives: root.objectives } : {}),
      ...(root.learning_objectives ? { learning_objectives: root.learning_objectives } : {}),
      ...(root.activities ? { activities: root.activities } : {}),
      ...(root.timeline ? { timeline: root.timeline } : {}),
      ...(root.time_slots ? { time_slots: root.time_slots } : {}),
      ...(root.assessment ? { assessment: root.assessment } : {}),
      ...(root.lesson_name ? { lesson_name: root.lesson_name } : {}),
    };
    if (Object.keys(rootPick).length) {
      inner = { ...rootPick, ...inner };
    }
  }

  if (toolSlug === 'concept-mastery-helper') {
    const rootConcepts = Array.isArray(root.concepts) ? root.concepts : [];
    const innerConcepts = Array.isArray(inner.concepts) ? inner.concepts : [];
    const mergedConcepts = innerConcepts.length ? innerConcepts : rootConcepts;
    const rootHasSingle = conceptRowHasBody(root);
    const innerHasSingle = conceptRowHasBody(inner);
    if (mergedConcepts.length) {
      inner = { ...inner, concepts: mergedConcepts };
    } else if (innerHasSingle) {
      inner = { ...inner };
    } else if (rootHasSingle) {
      inner = { ...root, ...inner };
    }
    if (!Array.isArray(inner.concepts) || !inner.concepts.length) {
      const lifted = { ...root, ...inner };
      delete lifted.contentType;
      delete lifted.structuredContent;
      if (conceptRowHasBody(lifted)) {
        inner = lifted;
      }
    }
  }

  return inner;
}

/** When the model returns empty / unusable Activity JSON, scaffold from selections (editable by teacher). */
function buildCurriculumBackedActivityFallback(meta = {}) {
  const topic = String(meta.topic || meta.chapter || 'the unit topic').trim();
  const subTopic = String(meta.subTopic || '').trim();
  const subject = String(meta.subject || 'this subject').trim();
  const classLabel = String(meta.classLabel || 'the class').trim();
  const tp = subTopic ? `${topic} — ${subTopic}` : topic;
  return {
    title: `Hands-on activity: ${topic}`,
    materials: [
      'Notebook / loose paper',
      'Pencils and coloured pencils or markers',
      'Plain A4 sheets for folding/cutting tasks (if needed)',
      'Ruler',
      `${subject} textbook or excerpt from the uploaded PDF`,
      'Chart paper / whiteboard markers for gallery walk (optional)',
    ],
    steps: [
      `In pairs, skim the uploaded material for ${topic} and list four key vocabulary terms or diagrams on one half-sheet.`,
      'Compare lists with another pair — merge duplicates and circle the two concepts that seemed most challenging.',
      `Design one mini-demonstration, fold-and-cut sketch, or table that explains one idea from "${tp}". Keep it doable in 15 minutes.`,
      'Groups post their artefact on the board; each group explains one design choice in two sentences.',
      'Whole class agrees on success criteria for "understands ${topic}" — write three bullet checkpoints on the board.',
      `Each learner writes an exit slip: one new idea, one question, one link to everyday life (${subject}).`,
    ],
    learningOutcome: `Learners collaborate to represent and verbalise central ideas about ${topic} in ${subject} (${classLabel}), using models or diagrams grounded in authentic classroom tasks.`,
  };
}

function augmentActivityStructuredContent(normalizedFlat, meta) {
  const n = normalizeActivityStructuredContent(normalizedFlat);
  const hasErrOnly =
    n.steps?.length === 1 && /^no structured steps were returned/i.test(String(n.steps[0] || ''));
  const materialsOk = Array.isArray(n.materials) && n.materials.length >= 3;
  const stepsOk =
    Array.isArray(n.steps) && n.steps.length >= 5 && !hasErrOnly && n.steps.every((s) => String(s).trim().length > 8);
  const loFromObjectives = Array.isArray(n.learningObjectives) ? n.learningObjectives.join(' ').trim() : '';
  const loOk =
    String(n.learningOutcome || '').trim().length > 30 || loFromObjectives.length > 30;

  if (materialsOk && stepsOk && loOk) {
    return n;
  }

  const fb = buildCurriculumBackedActivityFallback(meta);
  const title = String(n.title || fb.title || '').trim() || fb.title;
  const materials =
    materialsOk ? n.materials : [...new Set([...(n.materials || []), ...fb.materials])].filter(Boolean).slice(0, 14);

  let steps;
  if (stepsOk) {
    steps = n.steps;
  } else if (hasErrOnly || !n.steps?.length) {
    steps = fb.steps;
  } else {
    steps = [...n.steps, ...fb.steps].filter(Boolean).slice(0, 14);
  }
  const learningOutcome = loOk ? String(n.learningOutcome).trim() : fb.learningOutcome;

  return normalizeActivityStructuredContent({
    ...n,
    title,
    materials,
    steps,
    learningOutcome,
  });
}

export function finalizeActivityStructuredContent(structuredContent, meta = {}) {
  const raw =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {};
  return augmentActivityStructuredContent(raw, meta);
}

function buildPrompt(pdfText, selected = {}) {
  const selectedClass = String(selected.classLabel || '').trim();
  const selectedSubject = String(selected.subject || '').trim();
  const selectedTopic = String(selected.topic || selected.chapter || '').trim();
  const selectedSubTopic = String(selected.subTopic || '').trim();
  const selectedToolSlug = String(selected.toolType || '').trim();
  const selectedToolLabel = getToolLabelFromSlug(selectedToolSlug);
  const selectedToolHint = TOOL_STRICT_OUTPUT_HINTS[selectedToolSlug] || '';
  const isToolSelected = !!selectedToolSlug;

  const isPureDetection = !selectedClass && !selectedSubject && !selectedTopic;

  const toolGenerationBlock = isToolSelected
    ? `IMPORTANT: The user has selected tool "${selectedToolLabel}".
Generate structuredContent that EXACTLY matches this tool's output format.
${selectedToolHint}
This is the PRIMARY generation call — produce complete, high-quality content for this tool based on the PDF.`
    : `Detect the most appropriate tool from the list above and provide structuredContent preview in that tool's format.`;

  return `Analyze this educational PDF content and return ONLY valid JSON.

${isPureDetection
  ? 'PURE DETECTION MODE: No prior selections. Detect all fields from the PDF content alone. Infer bestMatchingTool and structuredContent aligned to that inferred tool.'
  : `GUIDED MODE: Validate whether PDF content matches these selected curriculum values:
- class: ${selectedClass || '(not provided)'}
- subject: ${selectedSubject || '(not provided)'}
- topic: ${selectedTopic || '(not provided)'}
- subtopic: ${selectedSubTopic || '(not provided)'}
- selectedTool: ${selectedToolLabel || '(not provided)'}

Still detect class, subject, topic, subtopic, and bestMatchingTool from the PDF, but populate structuredContent in the FORMAT required by the SELECTED TOOL (${selectedToolLabel || 'if provided'}), not merely the inferred tool.`}

Detect:
1. class (e.g. "Class 7", "Class 10", "IIT-6")
2. subject (e.g. "Mathematics", "Science", "English")
3. topic (main chapter/unit name from the PDF)
4. subtopic (specific subtopic if identifiable, else empty string)
5. bestMatchingTool from this exact list (ONLY these 11 — no other tool names):
   - Activity & Project Generator
   - Worksheet & MCQ Generator
   - Concept Mastery Helper
   - Lesson Planner
   - Homework Creator
   - Rubrics, Evaluation & Report Card
   - Story & Passage Creator
   - Short Notes & Summaries
   - Flashcard Generator
   - Daily Class Plan
   - Exam Question Paper
   Do NOT use retired labels such as "Enrichment / HOTS Task Generator" or "Remedial Support Plan Generator".
6. contentType from:
   MCQ, Notes, Worksheet, Lesson Plan, Story, Homework, Rubric, Flashcards, Exam Paper, Concept Notes, Activity Plan, Daily Plan
7. subjectTopicValidation object confirming PDF relevance (to selected values in guided mode, or internal consistency in pure detection).
8. structuredContent object matching the required tool format (${isPureDetection ? 'use the format for bestMatchingTool' : 'use the format for the SELECTED TOOL when provided, otherwise bestMatchingTool'}).

${toolGenerationBlock}

Return strict JSON exactly in this shape:
{
  "class": "string",
  "subject": "string",
  "topic": "string",
  "subtopic": "string",
  "bestMatchingTool": "string",
  "contentType": "string",
  "subjectTopicValidation": {
    "subjectMatched": true,
    "topicMatched": true,
    "reason": "string",
    "confidence": 0.0
  },
  "structuredContent": {}
}

PDF Content:
${pdfText.slice(0, 120000)}`;
}

export async function extractTextFromPdfBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const raw = String(parsed?.text || '');
    return raw
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function normalizeContentType(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (key.includes('concept')) return 'Concept Notes';
  if (key.includes('flash')) return 'Flashcards';
  if (key.includes('lesson')) return 'Lesson Plan';
  if (key.includes('daily')) return 'Daily Plan';
  if (key.includes('exam')) return 'Exam Paper';
  if (key.includes('activity')) return 'Activity Plan';
  if (key.includes('work')) return 'Worksheet';
  if (key.includes('mcq')) return 'MCQ';
  if (key.includes('homework')) return 'Homework';
  if (key.includes('rubric')) return 'Rubric';
  if (key.includes('story') || key.includes('passage')) return 'Story';
  if (key.includes('summary')) return 'Summary';
  if (key.includes('note')) return 'Notes';
  return raw;
}

export function validateToolSpecificStructuredContent(toolSlug, structuredContent, contentType, sourceText = '') {
  const normalizedTool = String(toolSlug || '').trim();
  const normalizedType = normalizeContentType(contentType);
  const rule = TOOL_STRUCTURED_RULES[normalizedTool];
  if (!rule) {
    return {
      valid: false,
      message: 'Unsupported content type for selected tool.',
      normalizedType,
    };
  }
  const allowed = rule.allowedTypes.map((type) => normalizeContentType(type));
  const defaultType = normalizeContentType(CONTENT_TYPE_BY_TOOL_SLUG[normalizedTool]);
  const resolvedType = normalizedType || defaultType;
  const { normalizedStructuredContent } = normalizeStructuredContentByTool(
    normalizedTool,
    structuredContent,
    resolvedType,
    sourceText,
  );
  if (!allowed.includes(resolvedType)) {
    return {
      valid: false,
      message: `Detected content type "${resolvedType}" is not allowed for selected tool.`,
      normalizedType: resolvedType,
      normalizedStructuredContent,
    };
  }
  if (!normalizedStructuredContent || typeof normalizedStructuredContent !== 'object' || Array.isArray(normalizedStructuredContent)) {
    return {
      valid: false,
      message: 'Structured content must be a JSON object.',
      normalizedType: resolvedType,
      normalizedStructuredContent,
    };
  }
  if (!rule.validate(normalizedStructuredContent)) {
    return {
      valid: false,
      message: rule.message,
      normalizedType: resolvedType,
      normalizedStructuredContent,
    };
  }
  return { valid: true, message: '', normalizedType: resolvedType, normalizedStructuredContent };
}

/** Viewer payload for one Concept Mastery row (PDF extract or generator). */
export function buildConceptRenderableFromStructured(source) {
  const s = normalizeConceptStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  const conceptName = String(s.concept_name || s.title || s.name || 'Concept').trim();
  return {
    kind: 'concept',
    title: conceptName,
    concept_name: conceptName,
    simple_definition: String(s.simple_definition || s.definition || '').trim(),
    why_important: String(s.why_important || s.importance || '').trim(),
    prior_knowledge_needed: String(s.prior_knowledge_needed || s.prior_knowledge || '').trim(),
    lesson: String(s.lesson || s.explanation || s.step_by_step_explanation || s.content || '').trim(),
    diagram_suggestion: String(s.diagram_suggestion || s.visualisation || '').trim(),
    real_example: String(s.real_example || s.real_life_examples || '').trim(),
    common_mistakes: toStringList(s.common_mistakes || s.misconceptions),
    concept_check_questions: toStringList(s.concept_check_questions),
    key_points: toStringList(s.key_points || s.keyPoints),
    exam_tips: String(s.exam_tips || '').trim(),
    hots_question: String(s.hots_question || '').trim(),
    self_reflection_prompt: String(
      s.self_reflection_prompt ||
        s.reflection_prompt ||
        s.reflectionPrompt ||
        s.reflection ||
        '',
    ).trim(),
  };
}

export function buildRenderableContent(toolSlug, contentType, structuredContent) {
  const type = normalizeContentType(contentType) || normalizeContentType(CONTENT_TYPE_BY_TOOL_SLUG[String(toolSlug || '').trim()]);
  const source = structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
    ? structuredContent
    : {};

  if (toolSlug === 'homework-creator') {
    return buildHomeworkRenderableFromStructured(source);
  }
  if (toolSlug === 'worksheet-mcq-generator') {
    return buildWorksheetRenderableFromStructured(source);
  }
  if (toolSlug === 'smart-qa-practice-generator') {
    return buildPracticeQaRenderableFromStructured(source);
  }
  if (toolSlug === 'concept-mastery-helper') {
    return buildConceptRenderableFromStructured(source);
  }
  if (toolSlug === 'concept-breakdown-explainer') {
    return buildConceptBreakdownRenderableFromStructured(source);
  }
  if (toolSlug === 'short-notes-summaries-maker') {
    return buildShortNotesRenderableFromStructured(source);
  }
  if (toolSlug === 'smart-study-guide-generator') {
    return buildStudyGuideRenderableFromStructured(source);
  }
  if (toolSlug === 'chapter-summary-creator') {
    return buildChapterSummaryRenderableFromStructured(source);
  }
  if (toolSlug === 'key-points-formula-extractor') {
    return buildKeyPointsRenderableFromStructured(source);
  }
  if (toolSlug === 'quick-assignment-builder') {
    return buildQuickAssignmentRenderableFromStructured(source);
  }
  if (toolSlug === 'story-passage-creator') {
    return buildStoryRenderableFromStructured(source);
  }
  if (toolSlug === 'lesson-planner') {
    return buildLessonPlanRenderableFromStructured(source, toolSlug);
  }
  if (toolSlug === 'daily-class-plan-maker') {
    return buildDailyClassPlanRenderableFromStructured(source);
  }
  if (toolSlug === 'flashcard-generator') {
    return buildFlashcardRenderableFromStructured(source);
  }
  if (toolSlug === 'rubrics-evaluation-generator') {
    return buildRubricRenderableFromStructured(source);
  }
  if (toolSlug === 'exam-question-paper-generator') {
    return buildExamPaperRenderableFromStructured(source);
  }
  if (toolSlug === 'activity-project-generator') {
    const act = canonicalizeActivityExtractedItem(source);
    const ncf = act.ncf_competency_alignment;
    return {
      kind: 'activity',
      title: String(act.title || type || 'Activity').trim(),
      subtopicLink: String(act.subtopic_link_prior_knowledge || '').trim(),
      learningObjectives: toStringList(act.learning_objectives || act.learningObjectives),
      ncfAlignment: Array.isArray(ncf) ? toStringList(ncf) : String(ncf || '').trim(),
      materials: toStringList(act.materials_required || act.materials),
      steps: toStringList(act.step_by_step_procedure || act.steps),
      teacherInstructions: toStringList(act.teacher_instructions || act.teacherInstructions),
      studentInstructions: toStringList(act.student_instructions || act.studentInstructions),
      differentiation: String(act.differentiation || '').trim(),
      learningOutcome: String(act.expected_learning_outcomes || act.learningOutcome || '').trim(),
      assessmentRubric: toStringList(act.assessment_criteria_rubric || act.assessmentRubric),
      realLifeApplication: String(act.real_life_application || act.realLifeApplication || '').trim(),
      reflectionExitTicket: String(act.reflection_exit_ticket || '').trim(),
    };
  }

  return {
    kind: 'notes',
    title: type || 'Generated Content',
    sections: [
      {
        heading: 'Content',
        explanation: String(source.content || source.text || source.summary || '').trim(),
      },
    ],
    keyPoints: [],
  };
}

export async function classifyPdfContentWithGemini(pdfText, selected = {}) {
  if (!pdfText || !pdfText.trim()) {
    throw new Error('No extractable text found in PDF');
  }

  const prompt = buildPrompt(pdfText, selected);
  const selectedToolSlug = String(selected.toolType || '').trim();
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = await geminiService.generateStructuredContent(prompt, 'json');
      const json = extractJsonObject(raw);
      const candidate = {
        classLabel: String(json.class || '').trim(),
        subject: String(json.subject || '').trim(),
        topic: String(json.topic || '').trim(),
        subTopic: String(json.subtopic || '').trim(),
        bestMatchingToolLabel: String(json.bestMatchingTool || '').trim(),
        contentType: normalizeContentType(json.contentType),
        structuredContent: json.structuredContent && typeof json.structuredContent === 'object'
          ? json.structuredContent
          : {},
        subjectTopicValidation: {
          subjectMatched: Boolean(json?.subjectTopicValidation?.subjectMatched),
          topicMatched: Boolean(json?.subjectTopicValidation?.topicMatched),
          reason: String(json?.subjectTopicValidation?.reason || '').trim(),
          confidence: Number(json?.subjectTopicValidation?.confidence || 0),
        },
        rawGemini: json,
      };
      if (isDeprecatedAiToolIdentifier(candidate.bestMatchingToolLabel)) {
        candidate.bestMatchingToolLabel = selectedToolSlug ? getToolLabelFromSlug(selectedToolSlug) : '';
      }
      if (selectedToolSlug) {
        const structural = validateToolSpecificStructuredContent(
          selectedToolSlug,
          candidate.structuredContent,
          candidate.contentType || CONTENT_TYPE_BY_TOOL_SLUG[selectedToolSlug] || '',
          '',
        );
        if (structural.normalizedStructuredContent) {
          candidate.structuredContent = structural.normalizedStructuredContent;
        }
        if (structural.normalizedType) {
          candidate.contentType = structural.normalizedType;
        }
        if (!structural.valid) {
          candidate.structuredContentNeedsRegeneration = true;
          candidate.structuredContentValidationMessage = structural.message;
        }
      }
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'Gemini classification failed');
}

export async function regenerateStructuredContentForTool(pdfText, selected = {}) {
  const toolSlug = String(selected.toolType || '').trim();
  if (!toolSlug) throw new Error('toolType is required for regeneration');
  const toolLabel = getToolLabelFromSlug(toolSlug);
  const contentType = CONTENT_TYPE_BY_TOOL_SLUG[toolSlug] || 'Notes';
  const strictHint = TOOL_STRICT_OUTPUT_HINTS[toolSlug] || 'Return only tool-specific educational content.';

  const selectedSubject = String(selected.subject || '').trim();
  const selectedClass = String(selected.classLabel || '').trim();
  const selectedTopic = String(selected.topic || selected.chapter || '').trim();
  const selectedSubTopic = String(selected.subTopic || '').trim();

  const prompt = `You are an expert educational content generator. Analyze the PDF content below and generate high-quality educational material.

RULES FOR ALL TOOLS:
- Adapt and synthesise teaching content aligned to CLASS / SUBJECT / TOPIC / SUBTOPIC. Do not paste the PDF line-by-line into JSON array fields. Do not lightly split textbook paragraphs into "steps" — write fresh, learner-ready structure for the chosen tool only.

TOOL: ${toolLabel}
CONTENT TYPE: ${contentType}
CLASS: ${selectedClass || 'Detect from PDF'}
SUBJECT: ${selectedSubject || 'Detect from PDF'}
TOPIC: ${selectedTopic || 'Detect from PDF'}
SUBTOPIC: ${selectedSubTopic || 'N/A'}

STRICT INSTRUCTION: ${strictHint}

Your output must be ONLY valid JSON (single root object). No markdown fences. Exactly this envelope:
{
  "contentType": "${contentType}",
  "structuredContent": { ... }
}

The structuredContent OBJECT must MATCH the chosen tool schema below. Put ALL activity fields INSIDE structuredContent. Do not omit materials, steps or learningOutcome for Activity.

TOOL-SPECIFIC structuredContent FORMATS:

For "Activity & Project Generator" (critical):
Use CLASS, SUBJECT, TOPIC, SUBTOPIC and the PDF *themes* — do NOT paste or lightly re-split textbook prose into steps.
Produce an ORIGINAL hands-on classroom activity: 6-14 short bullets for materials (real supplies), ONE clear activity title,
5-12 learner-facing procedural steps starting with verbs (Identify, Fold, Discuss, Compare, Present, Reflect...),
each step one or two sentences max, plus one learningOutcome sentence aligned to curriculum.
{
  "title": "Hands-on symmetry exploration (Grade 8)",
  "materials": ["plain paper sheets", "pencils", "rulers", "... "],
  "steps": ["Step 1: In pairs, observe ...", "Step 2: Fold the paper ...", "..." ],
  "learningOutcome": "Students will be able to ..."
}

For "Worksheet & MCQ Generator":
{
  "type": "MCQ",
  "questions": [
    { "question": "Question text?", "options": ["A) option", "B) option", "C) option", "D) option"], "answer": "A) option" }
  ]
}
Minimum 5 questions. Each must have exactly 4 options labeled A) B) C) D) and a correct answer.

For "Concept Mastery Helper":
{
  "concepts": [
    { "title": "Concept name", "explanation": "Detailed explanation...", "examples": ["example1"] }
  ],
  "keyPoints": ["Key point 1", "Key point 2"]
}

For "Lesson Planner" and "Daily Class Plan":
{
  "objectives": ["By end of lesson students will..."],
  "activities": ["Activity 1: ...", "Activity 2: ..."],
  "timeline": ["0-5 min: Introduction", "5-20 min: Main activity"],
  "assessment": "How to assess learning..."
}

For "Homework Creator":
{
  "type": "Homework",
  "questions": [
    { "question": "Question text?", "options": [], "answer": "Expected answer" }
  ]
}

For "Rubrics, Evaluation & Report Card":
{
  "criteria": ["Criterion 1", "Criterion 2"],
  "gradingScale": ["4 - Excellent", "3 - Good", "2 - Satisfactory", "1 - Needs Improvement"]
}

For "Story & Passage Creator":
{
  "title": "Story title",
  "content": "Full story text...",
  "questions": [
    { "question": "Comprehension question?", "options": [], "answer": "Answer" }
  ]
}

For "Short Notes & Summaries":
{
  "headings": [
    { "title": "Section heading", "explanation": "Content of this section..." }
  ],
  "keyPoints": ["Key point 1", "Key point 2"]
}

For "Flashcard Generator":
{
  "cards": [
    {
      "front": "Prompt or cue on the card face",
      "back": "Answer or definition",
      "memory_cue": "Mnemonic or recall hook",
      "skill_focus": "Skill being practised (e.g. Observation)",
      "example_use": "When or where to apply this idea",
      "peer_prompt": "Question for a partner",
      "reflection": "Short reflection prompt"
    }
  ]
}
Minimum 5 flashcards; every card must include all seven fields when possible.

For "Exam Question Paper":
{
  "sections": [
    {
      "sectionName": "Section A - MCQ",
      "questions": [
        { "question": "Question?", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A) ..." }
      ]
    }
  ]
}

Generate content based on this PDF:
${String(pdfText || '').slice(0, 120000)}
`;

  const activitySchemasOnlyPrompt =
    toolSlug === 'activity-project-generator'
      ? `Return ONLY compact JSON:
{"contentType":"Activity Plan","structuredContent":{"title":"…","materials":["6+ items"],"steps":["6+ learner steps with verbs"],"learningOutcome":"one sentence"}} 
Topic ${selectedTopic}; Subtopic ${selectedSubTopic}; Subject hint: ${selectedSubject}.

PDF excerpt:
${String(pdfText || '').slice(0, 65000)}
`
      : '';

  const lessonPlannerPdfCopyPrompt = `You extract a lesson plan from an Indian school PDF into JSON.

Return ONLY valid JSON (single object, no markdown fences):
{"contentType":"${contentType}","structuredContent":{
  "objectives":["…","…"],
  "activities":["…","…"],
  "timeline":["…","…"],
  "assessment":"…"
}}

RULES (critical):
- COPY wording from the PDF into arrays: split each bullet or numbered line into its own string.
- Map sections titled (or similar) Learning Objectives / Outcomes → objectives; Procedure / Teaching-Learning / Activities / Methodology → activities; Duration / Period / Time allocation → timeline; Assessment / Evaluation → assessment.
- Do NOT invent content if the PDF lacks a section — omit empty arrays only if truly absent; otherwise include every substantive line you find.
- If the PDF has multiple lesson variations, fill structuredContent for the FIRST complete variation only (still use arrays with all its lines).

CLASS: ${selectedClass || '—'}  SUBJECT: ${selectedSubject || '—'}  TOPIC: ${selectedTopic || '—'}  SUBTOPIC: ${selectedSubTopic || '—'}

PDF TEXT:
${String(pdfText || '').slice(0, 120000)}
`;

  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const useCompact = toolSlug === 'activity-project-generator' && attempt >= 4;
      const useLessonCopy =
        (toolSlug === 'lesson-planner' || toolSlug === 'daily-class-plan-maker') && attempt >= 3;
      const raw = await geminiService.generateStructuredContent(
        useCompact ? activitySchemasOnlyPrompt : useLessonCopy ? lessonPlannerPdfCopyPrompt : prompt,
        'json',
      );
      const json = extractJsonObject(raw);
      let structuredContent = coerceRegenerationStructuredContent(toolSlug, json);
      if (toolSlug === 'lesson-planner') {
        structuredContent = normalizeLessonPlannerStructuredContent(structuredContent, toolSlug);
      }
      if (toolSlug === 'daily-class-plan-maker') {
        structuredContent = normalizeDailyClassPlanStructuredContent(structuredContent);
      }
      if (toolSlug === 'activity-project-generator') {
        structuredContent = finalizeActivityStructuredContent(structuredContent, selected);
      }
      return {
        contentType: normalizeContentType(json.contentType || contentType),
        structuredContent:
          structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
            ? structuredContent
            : {},
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'Tool regeneration failed');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsKeyword(normalizedText, value) {
  const needle = normalizeText(value);
  if (!needle) return true;
  return normalizedText.includes(needle);
}

export async function classifyPdfContentWithFallback(pdfText, selected = {}) {
  try {
    const result = await classifyPdfContentWithGemini(pdfText, selected);
    return { ...result, analysisMode: 'gemini', isFallback: false };
  } catch (error) {
    const message = String(error?.message || '');
    console.warn('[AI PDF] Gemini classification failed, using fallback. Reason:', message);

    const selectedToolSlug = String(selected.toolType || '').trim();
    const selectedTopic = String(selected.topic || selected.chapter || '').trim();
    const selectedSubject = String(selected.subject || '').trim();
    const selectedClass = String(selected.classLabel || '').trim();
    const selectedSubTopic = String(selected.subTopic || '').trim();
    const normalizedPdf = normalizeText(pdfText);
    const subjectMentioned = containsKeyword(normalizedPdf, selectedSubject);
    const topicMentioned = containsKeyword(normalizedPdf, selectedTopic);

    return {
      classLabel: selectedClass,
      subject: selectedSubject,
      topic: selectedTopic,
      subTopic: selectedSubTopic,
      bestMatchingToolLabel: getToolLabelFromSlug(selectedToolSlug),
      contentType: CONTENT_TYPE_BY_TOOL_SLUG[selectedToolSlug] || 'Notes',
      structuredContent: {
        mode: 'fallback',
        note: 'Gemini classification fallback; structured content will be regenerated.',
      },
      subjectTopicValidation: {
        subjectMatched: true,
        topicMatched: true,
        reason: 'User-confirmed metadata accepted; Gemini classification encountered an error.',
        confidence: 0.8,
      },
      rawGemini: {},
      analysisMode: 'fallback',
      isFallback: true,
      fallbackReason: message || 'Gemini error',
      structuredContentNeedsRegeneration: true,
      fallbackValidation: {
        subjectMentioned,
        topicMentioned,
      },
    };
  }
}

export function resolveToolSlugFromLabel(label) {
  if (isDeprecatedAiToolIdentifier(label)) return '';
  const key = normalizeToolKey(label);
  return TOOL_ALIAS_TO_SLUG[key] || '';
}

export function getToolLabelFromSlug(slug) {
  return getToolDisplayTitle(slug);
}

/**
 * Super Admin AI Generator — structured JSON via aiToolTemplates.js (no PDF).
 * @param {string} toolSlug
 * @param {Record<string, unknown>} params
 */
export async function generateStructuredContentForAiGenerator(toolSlug, params = {}) {
  const slug = String(toolSlug || '').trim();
  if (!isValidAiToolSlug(slug)) {
    throw new Error(`Unsupported AI tool: ${toolSlug}`);
  }

  const defaultContentType = CONTENT_TYPE_BY_TOOL_SLUG[slug] || getContentTypeDefault(slug);
  const prompt = buildAiGeneratorStructuredPrompt(slug, params);
  const meta = {
    classLabel: params.classLabel || params.gradeLevel,
    subject: params.subject,
    topic: params.topic,
    subTopic: params.subTopic || params.subtopic,
    board: params.board,
  };

  let lastError = null;
  let lastValidationMessage = '';

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = await geminiService.generateStructuredContent(prompt, 'json');
      const json = extractJsonObject(raw);
      let structuredContent = coerceRegenerationStructuredContent(slug, json);

      if (slug === 'lesson-planner' || slug === 'daily-class-plan-maker') {
        structuredContent = normalizeLessonPlannerStructuredContent(structuredContent, slug);
      } else if (slug === 'activity-project-generator') {
        structuredContent = finalizeActivityStructuredContent(structuredContent, meta);
      } else if (slug === 'flashcard-generator') {
        structuredContent = normalizeFlashcardDeckStructuredContent(structuredContent);
      } else if (slug === 'concept-mastery-helper') {
        structuredContent = finalizeConceptMasteryStructuredContent(structuredContent, meta);
      }

      const contentType = normalizeContentType(json.contentType || defaultContentType);
      let validation = validateToolSpecificStructuredContent(
        slug,
        structuredContent,
        contentType,
        '',
      );

      if (validation.normalizedStructuredContent) {
        structuredContent = validation.normalizedStructuredContent;
      }

      if (!validation.valid && slug === 'concept-mastery-helper') {
        structuredContent = finalizeConceptMasteryStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          '',
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid) {
        lastValidationMessage = validation.message || 'Structured content failed validation.';
        if (attempt < 4) continue;
        throw new Error(lastValidationMessage);
      }

      const generatedContent = formatStructuredToolOutput(slug, structuredContent);
      if (!generatedContent.trim()) {
        throw new Error('Model returned empty formatted content.');
      }

      return {
        contentType: validation.normalizedType || contentType,
        structuredContent,
        generatedContent,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || lastValidationMessage || 'AI Generator structured content failed');
}

