import { PDFParse } from 'pdf-parse';
import geminiService from './gemini-service.js';
import {
  AI_TOOL_ORDERED_SLUGS,
  buildToolAliasToSlugMap,
  buildStrictOutputHintsMap,
  buildAiGeneratorStructuredPrompt,
  buildMockTestSolutionsFromSections,
  formatMockTestAnswerKeyLinesFromSections,
  formatStructuredToolOutput,
  getToolDisplayTitle,
  getContentTypeDefault,
  isDeprecatedAiToolIdentifier,
  isValidAiToolSlug,
} from '../config/aiToolTemplates.js';
import { splitMergedActivityTailSections } from './activity-section-headers.js';
import { buildPdfRagContextFromText } from './pdf-rag-service.js';
import { cleanActivityTitleForStorage } from './activity-title-utils.js';
import {
  resolveStudyGuideDisplayTitle,
  sanitizeStudyGuideTitle,
} from './study-guide-title-utils.js';
import {
  buildAllFieldsRequiredMessage,
  buildCanonicalFieldsRetryHint,
  isStrictAllFieldsValidation,
  padAiGeneratorCanonicalSections,
  validateAllCanonicalToolFields,
  validateCanonicalFieldsForSave,
} from '../utils/ai-generator-section-pad.js';
import { stripMarkdownSyntax, deepStripMarkdownValues } from '../utils/strip-markdown-syntax.js';
import {
  getAiGeneratorValidationMaxAttempts,
  isAiGeneratorSectionPadEnabled,
  shouldUpgradeFlashOnValidationAttempt,
  shouldUseFlashForAiGeneratorRun,
} from '../utils/ai-generator-batch-config.js';
import { runAiGeneratorQualityGate } from './ai-generator-quality-gate.js';
import { repairMissingSectionsViaLlm } from './ai-generator-section-repair.js';

const TOOL_ALIAS_TO_SLUG = buildToolAliasToSlugMap();

const CONTENT_TYPE_BY_TOOL_SLUG = Object.fromEntries(
  AI_TOOL_ORDERED_SLUGS.map((slug) => [slug, getContentTypeDefault(slug)]),
);

const TOOL_STRICT_OUTPUT_HINTS = buildStrictOutputHintsMap();

const toStringList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);

const MCQ_OPTION_LABEL_RE = /^([A-Da-d])[\).:\-\s]+/;

function labelMcqOptions(options = [], maxOptions = 4) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const texts = (Array.isArray(options) ? options : [])
    .map((opt) => String(opt ?? '').trim())
    .filter(Boolean)
    .map((opt) => opt.replace(MCQ_OPTION_LABEL_RE, '').trim())
    .filter(Boolean);
  return texts.slice(0, maxOptions).map((text, i) => `${letters[i]}) ${text}`);
}

function collectOptionsFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return [];
  let options = Array.isArray(entry.options)
    ? entry.options.map((opt) => String(opt || '').trim()).filter(Boolean)
    : [];
  if (options.length < 2) {
    const loose = [];
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const v =
        entry[letter] ??
        entry[letter.toLowerCase()] ??
        entry[`option_${letter}`] ??
        entry[`option_${letter.toLowerCase()}`] ??
        entry[`option${letter}`];
      if (v != null && String(v).trim()) loose.push(String(v).trim());
    }
    if (loose.length >= 2) options = loose;
  }
  if (options.length >= 2) return labelMcqOptions(options);
  return options;
}

const toQuestionArray = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = entry.trim();
        return text ? { question: text, options: [], answer: '' } : null;
      }
      if (entry && typeof entry === 'object') {
        const question =
          String(
            entry.question ||
              entry.question_text ||
              entry.questionText ||
              entry.prompt ||
              entry.text ||
              entry.statement ||
              entry.title ||
              '',
          ).trim();
        if (!question) return null;
        const options = collectOptionsFromEntry(entry);
        const answer = String(entry.answer || entry.correctAnswer || '').trim();
        return {
          question,
          options,
          answer,
          section: String(entry.section || entry.sectionName || '').trim(),
          question_number: entry.question_number ?? entry.sl_no ?? entry.number,
          type: String(entry.type || entry.question_type || '').trim(),
          marks: entry.marks != null && entry.marks !== '' ? Number(entry.marks) : undefined,
          explanation: String(entry.explanation || '').trim(),
          bloom_level: String(entry.bloom_level || entry.bloomLevel || '').trim(),
        };
      }
      return null;
    })
    .filter(Boolean);


function cleanWorksheetMcqOptions(options = []) {
  const raw = (Array.isArray(options) ? options : [])
    .map((opt) => String(opt || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((opt) => opt.length <= 220)
    .filter((opt) => !isAnswerKeyLikeQuestion(opt))
    .filter((opt) => !/^(?:answer|correct\s*answer)\s*[:\-]/i.test(opt))
    .slice(0, 6);
  return raw.length >= 2 ? labelMcqOptions(raw) : raw;
}

const sanitizeWorksheetQuestions = (questions = []) => {
  const seenFull = new Set();
  return questions
    .map((row) => ({
      question: cleanWorksheetQuestionText(row?.question),
      options: cleanWorksheetMcqOptions(row?.options),
      answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
      section: String(row?.section || '').trim(),
      type: String(row?.type || '').trim(),
      marks: row?.marks,
      explanation: String(row?.explanation || '').trim(),
      bloom_level: String(row?.bloom_level || '').trim(),
      question_number: row?.question_number ?? row?.sl_no,
    }))
    .filter((row) => row.question)
    .filter((row) => !isHeadingLikeLine(row.question))
    .filter((row) => !isWorksheetPdfChrome(row.question))
    .filter((row) => !isAnswerKeyLikeQuestion(row.question))
    .filter((row) => looksLikeQuestionPrompt(row.question) || row.options.length >= 2 || /_{2,}/.test(row.question))
    .filter((row) => {
      const fullKey = worksheetQuestionDedupeKey(row);
      if (!fullKey) return false;
      if (seenFull.has(fullKey)) return false;
      seenFull.add(fullKey);
      return true;
    });
};

import {
  buildDeterministicQuestionSetFromText,
  cleanWorksheetQuestionText,
  extractQuestionsFromText,
  extractWorksheetItemsFromPdfText,
  isAnswerKeyLikeQuestion,
  isHeadingLikeLine,
  isWorksheetPdfChrome,
  looksLikeQuestionPrompt,
  normalizeWorksheetQuestionKey,
  worksheetQuestionDedupeKey,
} from './pdf-worksheet-extract.js';

export { buildDeterministicQuestionSetFromText, extractWorksheetItemsFromPdfText };

/** Strings or arrays → trimmed non-empty lines (bullets / numbers stripped). */
function coerceBulletLines(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.replace(/^\s*[-*•]\s*|\s*\d+[\).]\s*/i, '').trim();
        if (item && typeof item === 'object') {
          const time = String(item.time || item.duration || item.slot || '').trim();
          const activity = String(
            item.activity ||
              item.task ||
              item.topic ||
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
              '',
          ).trim();
          if (time && activity) return `${time}: ${activity}`;
          if (activity) return activity;
          if (time) return time;
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

/**
 * Clean activity title for storage and UI. Never return a bare template section name.
 */
export function sanitizeActivityTitle(rawTitle, rawName, slNo) {
  return cleanActivityTitleForStorage(rawTitle, rawName, slNo);
}

/**
 * Gemini often uses procedure / instructions / nested activity — map to materials + steps.
 */
function prepareActivitySource(raw) {
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
  return source;
}

function joinActivityLines(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean).join('; ');
  return String(v).trim();
}

function finalizeActivitySteps(steps, materials, learningOutcome) {
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
  return steps;
}

/** Teacher Activity / Project Generator — 13-section workbook format. */
export function normalizeActivityProjectStructuredContent(raw) {
  const source = prepareActivitySource(splitMergedActivityTailSections(raw && typeof raw === 'object' ? raw : {}));

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

  let steps = coerceBulletLines(source.step_by_step_procedure);
  if (!steps.length) steps = coerceBulletLines(source.steps);
  if (!steps.length) steps = coerceBulletLines(source.procedure);
  if (!steps.length) steps = coerceBulletLines(source.procedures);

  let learningObjectives = coerceBulletLines(source.learning_objectives);
  if (!learningObjectives.length) learningObjectives = coerceBulletLines(source.learningObjectives);

  let learningOutcome = String(
    source.expected_learning_outcomes ||
      source.expectedLearningOutcomes ||
      source.learningOutcome ||
      source.learning_outcome ||
      ''
  ).trim();
  if (!learningOutcome) learningOutcome = joinActivityLines(source.learning_outcomes);

  const teacherInstructions = dedupeStringList([
    ...coerceBulletLines(source.teacher_instructions),
    ...coerceBulletLines(source.teacherInstructions),
  ]);
  const studentInstructions = dedupeStringList([
    ...coerceBulletLines(source.student_instructions),
    ...coerceBulletLines(source.studentInstructions),
  ]);
  const rubricLines = dedupeStringList([
    ...coerceBulletLines(source.assessment_criteria_rubric),
    ...coerceBulletLines(source.assessmentRubric),
    ...coerceBulletLines(source.assessment),
    ...coerceBulletLines(source.evaluation),
  ]);

  steps = finalizeActivitySteps(steps, materials, learningOutcome);

  const slNo = source.sl_no ?? source.question_number;
  let title = sanitizeActivityTitle(
    String(source.title || source.activityTitle || source.topic || '').trim(),
    String(source.name || '').trim(),
    slNo,
  );
  if (!title) {
    title = String(source.activity_name || source.activityName || '').trim();
  }
  if (!title) {
    const num = slNo != null && slNo !== '' ? Number(slNo) : NaN;
    title = Number.isFinite(num) ? `Untitled Activity ${num}` : 'Untitled Activity';
  }
  const subtopicLink = String(
    source.subtopic_link_prior_knowledge || source.prior_knowledge || source.subtopic_context || '',
  ).trim();
  const ncfAlignment = source.ncf_competency_alignment ?? source.competencies ?? source.learning_outcomes_ncf ?? '';
  const differentiation =
    source.differentiation != null && source.differentiation !== ''
      ? joinActivityLines(source.differentiation) || String(source.differentiation).trim()
      : joinActivityLines(source.differentiation_plan || source.udl_support);
  const reflectionTicket = String(
    source.reflection_exit_ticket || source.exit_ticket || source.reflection || '',
  ).trim();
  const realLifeApplication = String(source.real_life_application || source.realLifeApplication || '').trim();

  return {
    ...source,
    sl_no: slNo,
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

/** Student Project Idea Lab — 14-section format (no separate teacher/student instruction blocks). */
export function normalizeProjectIdeaLabStructuredContent(raw) {
  const source = prepareActivitySource(raw);

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

  let steps = coerceBulletLines(source.step_by_step_procedure);
  if (!steps.length) steps = coerceBulletLines(source.student_procedure);
  if (!steps.length) steps = coerceBulletLines(source.steps);
  if (!steps.length) steps = coerceBulletLines(source.procedure);
  const studentOnlySteps = coerceBulletLines(source.student_instructions || source.studentInstructions);
  if (studentOnlySteps.length) steps = studentOnlySteps;

  let learningObjectives = coerceBulletLines(source.learning_objectives);
  if (!learningObjectives.length) learningObjectives = coerceBulletLines(source.learningObjectives);

  let learningOutcome = String(
    source.expected_learning_outcomes ||
      source.expectedLearningOutcomes ||
      source.learningOutcome ||
      source.learning_outcome ||
      ''
  ).trim();
  if (!learningOutcome) learningOutcome = joinActivityLines(source.learning_outcomes);

  const safetyCareInstructions = dedupeStringList([
    ...coerceBulletLines(source.safety_care_instructions),
    ...coerceBulletLines(source.safety_instructions),
    ...coerceBulletLines(source.care_instructions),
  ]);
  const observationTable = String(
    source.observation_data_recording_table || source.observation_table || source.data_recording_table || '',
  ).trim();
  const creativeOutput = String(
    source.creative_output_final_product || source.creative_output || source.final_product || '',
  ).trim();
  const selfAssessmentRubric = dedupeStringList([
    ...coerceBulletLines(source.self_assessment_rubric),
    ...coerceBulletLines(source.assessment_criteria_rubric),
    ...coerceBulletLines(source.assessmentRubric),
  ]);

  steps = finalizeActivitySteps(steps, materials, learningOutcome);

  const slNo = source.sl_no ?? source.question_number;
  let title = sanitizeActivityTitle(
    String(source.title || source.activityTitle || source.topic || '').trim(),
    String(source.name || '').trim(),
    slNo,
  );
  if (!title) {
    title = String(source.activity_name || source.activityName || '').trim();
  }
  if (!title) {
    const num = slNo != null && slNo !== '' ? Number(slNo) : NaN;
    title = Number.isFinite(num) ? `Untitled Activity ${num}` : 'Untitled Activity';
  }
  const subtopicLink = String(
    source.subtopic_link_prior_knowledge || source.prior_knowledge || source.subtopic_context || '',
  ).trim();
  const ncfAlignment = source.ncf_competency_alignment ?? source.competencies ?? source.learning_outcomes_ncf ?? '';
  const differentiation =
    source.differentiation_support_extension != null && source.differentiation_support_extension !== ''
      ? joinActivityLines(source.differentiation_support_extension) ||
        String(source.differentiation_support_extension).trim()
      : joinActivityLines(source.differentiation || source.differentiation_plan || source.udl_support);
  const reflectionTicket = String(
    source.reflection_exit_ticket || source.exit_ticket || source.reflection || '',
  ).trim();
  const realLifeApplication = String(source.real_life_application || source.realLifeApplication || '').trim();

  return {
    ...source,
    sl_no: slNo,
    title,
    subtopic_link_prior_knowledge: subtopicLink,
    learning_objectives: learningObjectives.length ? learningObjectives : coerceBulletLines(source.learning_objectives),
    learningObjectives,
    ncf_competency_alignment: ncfAlignment,
    materials_required: materials,
    materials,
    step_by_step_procedure: steps,
    steps,
    safety_care_instructions: safetyCareInstructions,
    observation_data_recording_table: observationTable,
    creative_output_final_product: creativeOutput,
    differentiation_support_extension: differentiation,
    differentiation,
    self_assessment_rubric: selfAssessmentRubric,
    expected_learning_outcomes:
      learningOutcome || String(source.expected_learning_outcomes || '').trim(),
    learningOutcome: learningOutcome || source.learningOutcome || source.learning_outcome || '',
    real_life_application: realLifeApplication,
    realLifeApplication,
    reflection_exit_ticket: reflectionTicket,
  };
}

export function normalizeActivityStructuredContent(raw, toolSlug = 'activity-project-generator') {
  if (String(toolSlug || '').trim() === 'project-idea-lab') {
    return normalizeProjectIdeaLabStructuredContent(raw);
  }
  return normalizeActivityProjectStructuredContent(raw);
}

/** Activity PDF rows: template fields for storage + formatItemToContent. */
export function canonicalizeActivityExtractedItem(raw, toolSlug = 'activity-project-generator') {
  return normalizeActivityStructuredContent(raw, toolSlug);
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
  const variantN = Number(meta.generationVariant) || 0;
  const angle = String(meta.variantAngle || '').trim();
  const scenario = String(meta.variantScenario || '').trim();
  const conceptName = subTopic || topic || `${subject} concept`;
  const focus = subTopic && topic ? `${topic} — ${subTopic}` : subTopic || topic;
  const angleLead = angle
    ? `Frame the lesson using this angle: ${angle}. `
    : variantN > 0
      ? `Use variant ${variantN} with a fresh example set. `
      : '';
  return {
    concepts: [
      normalizeConceptStructuredContent({
        concept_name: angle ? `${conceptName} — ${angle.split('(')[0].trim().slice(0, 48)}` : conceptName,
        simple_definition: `${angleLead}A clear introduction to ${conceptName} as part of ${focus} in ${subject}.`,
        why_important: `Mastering ${conceptName} helps ${classLabel} learners understand ${focus} for class tests and applications.`,
        prior_knowledge_needed: `Familiarity with the main ideas from ${topic || 'the previous unit'}.`,
        lesson: `${angleLead}Explain ${conceptName} step by step: definition, one labelled diagram, a worked example, and a short class discussion tied to ${focus}. Align examples to the NCERT/CBSE treatment of ${subject} for ${classLabel}.`,
        diagram_suggestion: `Labelled diagram or concept map for ${conceptName} (components, flow, or cause–effect as appropriate).`,
        real_example: scenario
          ? `Example while exploring ${scenario}: how ${conceptName} appears in real life.`
          : angle
            ? `Indian-context example for ${conceptName} via: ${angle}.`
            : `Everyday example ${variantN > 0 ? `(set ${variantN}) ` : ''}that illustrates ${conceptName}.`,
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
  if (
    !isStrictAllFieldsValidation(meta) &&
    (!Array.isArray(deck.concepts) || !deck.concepts.length)
  ) {
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
  /** Gemini often returns { concepts: [{ ...all 9 sections }] } — flatten for validation & markdown. */
  let merged = { ...source };
  if (Array.isArray(source.concepts) && source.concepts.length) {
    const row =
      source.concepts.find((c) => c && typeof c === 'object' && Object.keys(c).length > 2) ||
      source.concepts[0];
    if (row && typeof row === 'object') {
      merged = { ...merged, ...row };
    }
  }
  const conceptTitle = String(
    merged.concept_title || merged.concept_name || merged.title || merged.name || '',
  ).trim();
  const simple_definition = String(
    merged.simple_definition || merged.simple_explanation || merged.explanation || '',
  ).trim();
  const breakdown_steps = dedupeStringList([
    ...coerceBulletLines(merged.breakdown_steps),
    ...coerceBulletLines(merged.steps),
  ]);
  const real_life_examples = dedupeStringList([
    ...coerceBulletLines(merged.real_life_examples),
    ...coerceBulletLines(merged.indian_context_examples),
    ...coerceBulletLines(merged.examples),
  ]);
  const important_terms = (Array.isArray(merged.important_terms)
    ? merged.important_terms
    : Array.isArray(merged.keywords)
      ? merged.keywords
      : Array.isArray(merged.terms)
        ? merged.terms
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
    ...coerceBulletLines(merged.concept_check_questions),
    ...coerceBulletLines(merged.quick_check_questions),
  ]);
  const application_thinking_question = String(
    merged.application_thinking_question || merged.application_question || '',
  ).trim();
  const higher_order_thinking_prompt = String(
    merged.higher_order_thinking_prompt ||
      merged.hots_prompt ||
      merged.hots_question ||
      '',
  ).trim();
  const quick_revision_summary = String(
    merged.quick_revision_summary || merged.revision_summary || merged.summary || '',
  ).trim();

  return {
    ...merged,
    concept_title: conceptTitle || 'Concept',
    concept_name: conceptTitle || merged.concept_name || 'Concept',
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

/** AI Generator: flatten concepts[] and default title from subtopic when missing. */
export function finalizeConceptBreakdownStructuredContent(structuredContent, meta = {}) {
  const s = normalizeConceptBreakdownStructuredContent(structuredContent);
  let concept_title = String(s.concept_title || s.concept_name || '').trim();
  if (!concept_title || concept_title === 'Concept') {
    const fromMeta = String(meta.subTopic || meta.subtopic || meta.topic || '').trim();
    if (fromMeta) concept_title = fromMeta;
  }
  if (!concept_title) concept_title = 'Concept';
  return {
    ...s,
    concept_title,
    concept_name: concept_title,
    title: concept_title,
  };
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

/** Reading Practice Room (student) PDF / generator → 13-section template. */
export function normalizeReadingPracticeStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const reading_practice_title = String(
    source.reading_practice_title || source.title || source.passage_title || source.story_title || '',
  ).trim();

  let subtopic_link_prior_knowledge = String(
    source.subtopic_link_prior_knowledge || source.subtopic_link_prior || '',
  ).trim();
  if (!subtopic_link_prior_knowledge) {
    const parts = [
      String(source.subtopic_link || source.subtopic || '').trim(),
      String(source.prior_knowledge || source.prior_knowledge_required || '').trim(),
      String(source.topic_subtopic_connection || '').trim(),
    ].filter(Boolean);
    subtopic_link_prior_knowledge = parts.join('\n');
  }

  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);

  let ncf_competency_alignment = String(source.ncf_competency_alignment || '').trim();
  if (!ncf_competency_alignment) {
    const legacy = String(source.alignment_block || source.alignment || '').trim();
    const nep = String(source.nep_ncf_focus || source.nep_ncf || '').trim();
    if (legacy) ncf_competency_alignment = legacy;
    else if (nep) ncf_competency_alignment = nep;
  }

  const vocabulary_warmup = dedupeStringList([
    ...coerceBulletLines(source.vocabulary_warmup),
    ...coerceBulletLines(source.vocabulary_support),
    ...coerceBulletLines(source.vocabulary),
  ]);

  const passage = String(source.passage || source.content || source.story_text || '').trim();

  const read_and_recall_questions = toQuestionArray([
    ...(Array.isArray(source.read_and_recall_questions) ? source.read_and_recall_questions : []),
    ...(Array.isArray(source.recall_questions) ? source.recall_questions : []),
    ...(Array.isArray(source.questions) && !source.think_and_infer_questions && !source.apply_and_connect_questions
      ? source.questions
      : []),
    ...(Array.isArray(source.comprehension_questions) ? source.comprehension_questions : []),
  ]);

  const think_and_infer_questions = toQuestionArray(
    Array.isArray(source.think_and_infer_questions) ? source.think_and_infer_questions : source.infer_questions,
  );

  const apply_and_connect_questions = toQuestionArray(
    Array.isArray(source.apply_and_connect_questions)
      ? source.apply_and_connect_questions
      : source.connect_questions,
  );

  const vocabulary_practice = dedupeStringList([...coerceBulletLines(source.vocabulary_practice)]);

  const answer_key_suggested_responses = dedupeStringList([
    ...coerceBulletLines(source.answer_key_suggested_responses),
    ...coerceBulletLines(source.answer_hints),
    ...(String(source.answer_hints || '').trim() && !Array.isArray(source.answer_hints)
      ? [String(source.answer_hints)]
      : []),
    ...coerceBulletLines(source.answer_key),
  ]);

  const expected_learning_outcomes = dedupeStringList([
    ...coerceBulletLines(source.expected_learning_outcomes),
    ...(String(source.expected_learning_outcomes || '').trim() &&
    !Array.isArray(source.expected_learning_outcomes)
      ? [String(source.expected_learning_outcomes)]
      : []),
  ]);

  const reflection_exit_ticket = String(
    source.reflection_exit_ticket || source.reflection_prompt || source.reflection || '',
  ).trim();

  const questions = [
    ...read_and_recall_questions,
    ...think_and_infer_questions,
    ...apply_and_connect_questions,
  ];

  return {
    ...source,
    reading_practice_title: reading_practice_title || 'Reading Practice',
    title: reading_practice_title || 'Reading Practice',
    subtopic_link_prior_knowledge,
    learning_objectives,
    ncf_competency_alignment,
    vocabulary_warmup,
    passage,
    content: passage,
    read_and_recall_questions,
    think_and_infer_questions,
    apply_and_connect_questions,
    vocabulary_practice,
    answer_key_suggested_responses,
    expected_learning_outcomes,
    reflection_exit_ticket,
    vocabulary_support: vocabulary_warmup,
    questions,
    answer_hints: answer_key_suggested_responses,
    reflection_prompt: reflection_exit_ticket,
    bloom_level: String(source.bloom_level || source.bloomLevel || '').trim(),
    difficulty_level: String(
      source.difficulty_level || source.difficulty_tag || source.difficulty || '',
    ).trim(),
    class_label: String(source.class_label || source.classLabel || '').trim(),
    subject: String(source.subject || '').trim(),
    subtopic: String(source.subtopic || source.subtopic_link || '').trim(),
  };
}

/** Story and Passage Creator (teacher) PDF / generator → 19-section template. */
export function normalizeStoryPassageStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = String(source.title || source.passage_title || source.story_title || '').trim();

  const topic_subtopic_connection = String(
    source.topic_subtopic_connection ||
      source.topic_and_subtopic_connection ||
      source.topicSubtopicConnection ||
      source.subtopic_link ||
      '',
  ).trim();

  const prior_knowledge_required = String(
    source.prior_knowledge_required || source.prior_knowledge || source.priorKnowledgeRequired || '',
  ).trim();

  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(source.learning_objectives),
    ...coerceBulletLines(source.objectives),
    ...coerceBulletLines(source.learningObjectives),
  ]);

  let ncf_competency_alignment = String(source.ncf_competency_alignment || '').trim();
  if (!ncf_competency_alignment) {
    const legacy = String(source.alignment_block || source.alignment || '').trim();
    const nep = String(source.nep_ncf_focus || source.nep_ncf || '').trim();
    if (legacy) ncf_competency_alignment = legacy;
    else if (nep) ncf_competency_alignment = nep;
  }

  const vocabulary_warmup = dedupeStringList([
    ...coerceBulletLines(source.vocabulary_warmup),
    ...coerceBulletLines(source.vocabulary_support),
    ...coerceBulletLines(source.vocabulary),
  ]);

  const pre_reading_thinking_prompt = String(
    source.pre_reading_thinking_prompt || source.pre_reading_prompt || source.preReadingPrompt || '',
  ).trim();

  const passage = String(
    source.passage || source.content || source.story_text || source.story_passage_content || '',
  ).trim();

  const read_and_recall_questions = toQuestionArray([
    ...(Array.isArray(source.read_and_recall_questions) ? source.read_and_recall_questions : []),
    ...(Array.isArray(source.recall_questions) ? source.recall_questions : []),
    ...(Array.isArray(source.questions) &&
    !source.think_and_infer_questions &&
    !source.apply_and_connect_questions &&
    !source.comprehension_questions
      ? source.questions
      : []),
    ...(Array.isArray(source.comprehension_questions) ? source.comprehension_questions : []),
  ]);

  const think_and_infer_questions = toQuestionArray(
    Array.isArray(source.think_and_infer_questions)
      ? source.think_and_infer_questions
      : source.infer_questions,
  );

  const apply_and_connect_questions = toQuestionArray(
    Array.isArray(source.apply_and_connect_questions)
      ? source.apply_and_connect_questions
      : source.connect_questions,
  );

  const vocabulary_grammar_practice = String(
    source.vocabulary_grammar_practice ||
      (Array.isArray(source.vocabulary_practice)
        ? source.vocabulary_practice.map((x) => String(x || '').trim()).filter(Boolean).join('\n')
        : '') ||
      '',
  ).trim();

  const creative_response_activity = String(source.creative_response_activity || '').trim();

  const answer_key_suggested_responses = dedupeStringList([
    ...coerceBulletLines(source.answer_key_suggested_responses),
    ...coerceBulletLines(source.answer_hints),
    ...coerceBulletLines(source.answer_key),
    ...(String(source.answer_hints || '').trim() && !Array.isArray(source.answer_hints)
      ? [String(source.answer_hints)]
      : []),
  ]);

  const common_mistakes_to_avoid = String(source.common_mistakes_to_avoid || '').trim();

  const differentiation_support = String(source.differentiation_support || '').trim();

  const expected_learning_outcomes = dedupeStringList([
    ...coerceBulletLines(source.expected_learning_outcomes),
    ...(String(source.expected_learning_outcomes || '').trim() &&
    !Array.isArray(source.expected_learning_outcomes)
      ? [String(source.expected_learning_outcomes)]
      : []),
  ]);

  const real_life_application = String(
    source.real_life_application || source.real_life_link || source.realLifeApplication || '',
  ).trim();

  const reflection_exit_ticket = String(
    source.reflection_exit_ticket || source.reflection_prompt || source.reflection || '',
  ).trim();

  const questions = [
    ...read_and_recall_questions,
    ...think_and_infer_questions,
    ...apply_and_connect_questions,
  ];

  return {
    ...source,
    title: title || 'Story',
    topic_subtopic_connection,
    prior_knowledge_required,
    learning_objectives,
    ncf_competency_alignment,
    vocabulary_warmup,
    pre_reading_thinking_prompt,
    passage,
    content: passage,
    story_passage_content: passage,
    read_and_recall_questions,
    think_and_infer_questions,
    apply_and_connect_questions,
    vocabulary_grammar_practice,
    creative_response_activity,
    answer_key_suggested_responses,
    common_mistakes_to_avoid,
    differentiation_support,
    expected_learning_outcomes,
    real_life_application,
    reflection_exit_ticket,
    reflection_prompt: reflection_exit_ticket,
    vocabulary_support: vocabulary_warmup,
    questions,
    bloom_level: String(source.bloom_level || source.bloomLevel || '').trim(),
    difficulty_level: String(
      source.difficulty_level || source.difficulty_tag || source.difficulty || '',
    ).trim(),
    class_label: String(source.class_label || source.classLabel || '').trim(),
    subject: String(source.subject || '').trim(),
    subtopic: String(source.subtopic || source.subtopic_link || '').trim(),
  };
}

function storyPassageTextFilled(value) {
  const t = String(value ?? '').trim();
  return t.length > 8 && !/^(story|passage|title|n\/?a|tbd)$/i.test(t);
}

function storyPassageQuestionCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter((q) => {
    if (typeof q === 'string') return storyPassageTextFilled(q);
    if (q && typeof q === 'object') {
      return storyPassageTextFilled(q.question || q.text || q.prompt);
    }
    return false;
  }).length;
}

/** @returns {string[]} Missing Story and Passage Creator section labels. */
export function getStoryPassageMissingSections(data) {
  const s = normalizeStoryPassageStructuredContent(data && typeof data === 'object' ? data : {});
  const missing = [];
  const scalarChecks = [
    ['title', '1. Story / Passage Title'],
    ['topic_subtopic_connection', '2. Topic and Subtopic Connection'],
    ['prior_knowledge_required', '3. Prior Knowledge Required'],
    ['ncf_competency_alignment', '5. NCF Competency / Learning Outcome Alignment'],
    ['pre_reading_thinking_prompt', '7. Pre-reading Thinking Prompt'],
    ['vocabulary_grammar_practice', '12. Vocabulary and Grammar Practice'],
    ['creative_response_activity', '13. Creative Response Activity'],
    ['common_mistakes_to_avoid', '15. Common Mistakes to Avoid'],
    ['differentiation_support', '16. Differentiation Support'],
    ['real_life_application', '18. Real-life Application'],
    ['reflection_exit_ticket', '19. Reflection / Exit Ticket'],
  ];
  for (const [key, label] of scalarChecks) {
    if (!storyPassageTextFilled(s[key])) missing.push(label);
  }
  if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length < 2) {
    missing.push("4. Learning Objectives – Bloom's Taxonomy Aligned (min 2)");
  }
  if (!Array.isArray(s.vocabulary_warmup) || s.vocabulary_warmup.length < 3) {
    missing.push('6. Vocabulary Warm-up (min 3 words)');
  }
  const passage = String(s.passage || s.content || s.story_passage_content || '').trim();
  if (passage.length < 80) {
    missing.push('8. Story / Passage Content (full story required, not title only)');
  }
  if (storyPassageQuestionCount(s.read_and_recall_questions) < 2) {
    missing.push('9. Read and Recall Questions (min 2)');
  }
  if (storyPassageQuestionCount(s.think_and_infer_questions) < 2) {
    missing.push('10. Think and Infer Questions (min 2)');
  }
  if (storyPassageQuestionCount(s.apply_and_connect_questions) < 2) {
    missing.push('11. Apply and Connect Questions (min 2)');
  }
  const answers = Array.isArray(s.answer_key_suggested_responses) ? s.answer_key_suggested_responses : [];
  if (answers.length < 2) {
    missing.push('14. Answer Key / Suggested Responses (min 2)');
  }
  const outcomes = Array.isArray(s.expected_learning_outcomes) ? s.expected_learning_outcomes : [];
  if (outcomes.length < 2) {
    missing.push('17. Expected Learning Outcomes (min 2)');
  }
  return missing;
}

export function storyPassageStructuredContentIsComplete(data) {
  return getStoryPassageMissingSections(data).length === 0;
}

/** Fill derivable narrative fields from topic context; does not invent full passage. */
export function finalizeStoryPassageStructuredContent(structuredContent, meta = {}) {
  const s = normalizeStoryPassageStructuredContent(
    structuredContent && typeof structuredContent === 'object' ? structuredContent : {},
  );
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'the selected subtopic').trim();
  const subject = String(meta.subject || 'the subject').trim();

  if (!storyPassageTextFilled(s.topic_subtopic_connection)) {
    s.topic_subtopic_connection = `This story connects to ${topic} within ${subject}, building on the class topic sequence.`;
  }
  if (!storyPassageTextFilled(s.prior_knowledge_required)) {
    s.prior_knowledge_required = `Students should recall basic ideas related to ${topic} before reading.`;
  }
  if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length < 2) {
    s.learning_objectives = [
      `Understand key ideas about ${topic} through guided reading.`,
      `Answer comprehension and inference questions about the passage.`,
      `Apply the concept of ${topic} to a short real-life example.`,
    ];
  }
  if (!storyPassageTextFilled(s.ncf_competency_alignment)) {
    s.ncf_competency_alignment = `Aligned to NCF-SE 2023 competencies for ${subject}: reading comprehension, critical thinking, and communication related to ${topic}.`;
  }
  if (!Array.isArray(s.vocabulary_warmup) || s.vocabulary_warmup.length < 3) {
    s.vocabulary_warmup = ['observe', 'evidence', 'conclusion', 'inference'];
  }
  if (!storyPassageTextFilled(s.pre_reading_thinking_prompt)) {
    s.pre_reading_thinking_prompt = `Before you read, predict what you already know about ${topic}. What questions do you have?`;
  }
  if (!storyPassageTextFilled(s.vocabulary_grammar_practice)) {
    s.vocabulary_grammar_practice = `Use vocabulary from the warm-up list in two original sentences about ${topic}.`;
  }
  if (!storyPassageTextFilled(s.creative_response_activity)) {
    s.creative_response_activity = `Create a short comic strip or diary entry showing how ${topic} appears in daily life.`;
  }
  if (!storyPassageTextFilled(s.common_mistakes_to_avoid)) {
    s.common_mistakes_to_avoid = `Avoid copying lines from the passage without explanation; support every answer with evidence from the text.`;
  }
  if (!storyPassageTextFilled(s.differentiation_support)) {
    s.differentiation_support = `Support: sentence starters and vocabulary glossary. Extension: compare two characters or examples linked to ${topic}.`;
  }
  if (!Array.isArray(s.expected_learning_outcomes) || s.expected_learning_outcomes.length < 2) {
    s.expected_learning_outcomes = [
      `Students can explain the main idea of ${topic} in their own words.`,
      `Students can answer recall and inference questions using text evidence.`,
    ];
  }
  if (!storyPassageTextFilled(s.real_life_application)) {
    s.real_life_application = `Discuss where students see ideas related to ${topic} at home, in the news, or in their community.`;
  }
  if (!storyPassageTextFilled(s.reflection_exit_ticket)) {
    s.reflection_exit_ticket = `What is one new idea you learned about ${topic}? What question do you still have?`;
  }

  return s;
}

/** @deprecated Use normalizeReadingPracticeStructuredContent or normalizeStoryPassageStructuredContent */
export function normalizeStoryStructuredContent(raw) {
  return normalizeReadingPracticeStructuredContent(raw);
}

export function canonicalizeStoryExtractedItem(raw, toolSlug = 'reading-practice-room') {
  const slug = String(toolSlug || '').trim();
  if (slug === 'story-passage-creator') return normalizeStoryPassageStructuredContent(raw);
  return normalizeReadingPracticeStructuredContent(raw);
}

/** Viewer payload for Reading Practice Room or Story and Passage Creator. */
export function buildStoryRenderableFromStructured(source, toolSlug = 'reading-practice-room') {
  const slug = String(toolSlug || '').trim();
  const normalize =
    slug === 'story-passage-creator'
      ? normalizeStoryPassageStructuredContent
      : normalizeReadingPracticeStructuredContent;
  const s = normalize(source && typeof source === 'object' && !Array.isArray(source) ? source : {});
  if (slug === 'story-passage-creator') {
    return {
      kind: 'story',
      variant: 'teacher',
      title: String(s.title || 'Story').trim(),
      topicSubtopicConnection: String(s.topic_subtopic_connection || '').trim(),
      priorKnowledgeRequired: String(s.prior_knowledge_required || '').trim(),
      learningObjectives: toStringList(s.learning_objectives),
      ncfCompetencyAlignment: String(s.ncf_competency_alignment || '').trim(),
      vocabularyWarmup: toStringList(s.vocabulary_warmup),
      preReadingThinkingPrompt: String(s.pre_reading_thinking_prompt || '').trim(),
      passage: String(s.passage || '').trim(),
      readAndRecallQuestions: toQuestionArray(s.read_and_recall_questions),
      thinkAndInferQuestions: toQuestionArray(s.think_and_infer_questions),
      applyAndConnectQuestions: toQuestionArray(s.apply_and_connect_questions),
      vocabularyGrammarPractice: String(s.vocabulary_grammar_practice || '').trim(),
      creativeResponseActivity: String(s.creative_response_activity || '').trim(),
      answerKeySuggestedResponses: toStringList(s.answer_key_suggested_responses),
      commonMistakesToAvoid: String(s.common_mistakes_to_avoid || '').trim(),
      differentiationSupport: String(s.differentiation_support || '').trim(),
      expectedLearningOutcomes: toStringList(s.expected_learning_outcomes),
      realLifeApplication: String(s.real_life_application || '').trim(),
      reflectionExitTicket: String(s.reflection_exit_ticket || '').trim(),
      reflectionPrompt: String(s.reflection_exit_ticket || '').trim(),
      questions: toQuestionArray(s.questions),
    };
  }
  return {
    kind: 'story',
    title: String(s.reading_practice_title || s.title || 'Reading Practice').trim(),
    readingPracticeTitle: String(s.reading_practice_title || s.title || 'Reading Practice').trim(),
    subtopicLinkPriorKnowledge: String(s.subtopic_link_prior_knowledge || '').trim(),
    learningObjectives: toStringList(s.learning_objectives),
    ncfCompetencyAlignment: String(s.ncf_competency_alignment || '').trim(),
    passage: String(s.passage || '').trim(),
    vocabularyWarmup: toStringList(s.vocabulary_warmup),
    readAndRecallQuestions: toQuestionArray(s.read_and_recall_questions),
    thinkAndInferQuestions: toQuestionArray(s.think_and_infer_questions),
    applyAndConnectQuestions: toQuestionArray(s.apply_and_connect_questions),
    vocabularyPractice: toStringList(s.vocabulary_practice),
    answerKeySuggestedResponses: toStringList(s.answer_key_suggested_responses),
    expectedLearningOutcomes: toStringList(s.expected_learning_outcomes),
    reflectionExitTicket: String(s.reflection_exit_ticket || '').trim(),
    vocabularySupport: toStringList(s.vocabulary_warmup),
    questions: toQuestionArray(s.questions),
    answerHints: toStringList(s.answer_key_suggested_responses),
    reflectionPrompt: String(s.reflection_exit_ticket || '').trim(),
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
        const rawOpts = Array.isArray(q.options)
          ? q.options.map((o) => String(o ?? '').trim()).filter(Boolean)
          : [];
        return {
          question: String(q.question || '').trim(),
          type,
          answer: String(q.answer || '').trim(),
          options: rawOpts.length >= 2 ? labelMcqOptions(rawOpts) : rawOpts,
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
export function normalizeStudyGuideStructuredContent(raw, meta = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = resolveStudyGuideDisplayTitle(
    String(source.title || source.study_guide_title || '').trim(),
    meta,
    source,
  );
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

function normalizeChapterSummaryFormulaeList(source) {
  const s = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const rows = [];
  const seen = new Set();
  const pushRow = (name, formula, note = '') => {
    const n = String(name || '').trim();
    const f = String(formula || '').trim();
    const nt = String(note || '').trim();
    const text = f || n;
    if (!text) return;
    const key = `${n}|${text}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ name: n, formula: f || n, note: nt });
  };

  for (const key of ['formulae', 'formulas']) {
    const arr = Array.isArray(s[key]) ? s[key] : [];
    for (const f of arr) {
      if (f && typeof f === 'object') {
        pushRow(f.name, f.formula || f.rule, f.note);
      } else {
        pushRow('', String(f ?? ''), '');
      }
    }
  }

  if (Array.isArray(s.rules)) {
    for (const r of s.rules) {
      if (r && typeof r === 'object') {
        pushRow(r.name, r.formula || r.rule, r.note);
      } else if (typeof r === 'string') {
        pushRow('Rule', r, '');
      }
    }
  }

  for (const text of dedupeStringList([
    ...coerceBulletLines(s.important_facts),
    ...coerceBulletLines(s.must_remember_facts),
    ...coerceBulletLines(s.facts),
    ...coerceBulletLines(s.important_exam_points),
    ...coerceBulletLines(s.exam_points),
    ...coerceBulletLines(s.key_takeaways),
  ])) {
    pushRow('Important Fact', text, '');
  }

  return rows;
}

/** Chapter Summary Creator → 10-section template. */
export function normalizeChapterSummaryStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  /** Gemini may return { chapters: [{ ...all fields }] } — flatten for validation & viewers. */
  let merged = { ...source };
  if (Array.isArray(source.chapters) && source.chapters.length) {
    const row =
      source.chapters.find((c) => c && typeof c === 'object' && Object.keys(c).length > 2) ||
      source.chapters[0];
    if (row && typeof row === 'object') merged = { ...merged, ...row };
  }
  const chapter_summary_title = String(
    merged.chapter_summary_title ||
      merged.chapter_title ||
      merged.title ||
      merged.study_guide_title ||
      '',
  ).trim();
  const chapter_overview = String(
    merged.chapter_overview ||
      merged.overview ||
      merged.summary ||
      merged.chapter_summary ||
      merged.chapter_subtopic_overview ||
      merged.chapter_overview_text ||
      '',
  ).trim();
  const learning_objectives = dedupeStringList([
    ...coerceBulletLines(merged.learning_objectives),
    ...coerceBulletLines(merged.objectives),
    ...coerceBulletLines(merged.learningObjectives),
  ]);
  const important_concepts = normalizeStudyGuideKeyConcepts(
    merged.important_concepts ||
      merged.key_concepts ||
      merged.key_concepts_explained ||
      merged.concepts,
  );
  const definitions = (Array.isArray(merged.definitions) ? merged.definitions : [])
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
  const formulae = normalizeChapterSummaryFormulaeList(merged);
  const concept_connections = String(
    merged.concept_connections ||
      merged.connections ||
      merged.concept_flow ||
      merged.concept_flow_mind_map ||
      merged.mind_map ||
      '',
  ).trim();
  const real_life_applications = dedupeStringList([
    ...coerceBulletLines(merged.real_life_applications),
    ...coerceBulletLines(merged.real_life_examples),
    ...coerceBulletLines(merged.applications),
    ...coerceBulletLines(merged.examples),
  ]);
  const important_exam_points = dedupeStringList([
    ...coerceBulletLines(merged.important_exam_points),
    ...coerceBulletLines(merged.exam_points),
    ...coerceBulletLines(merged.key_takeaways),
    ...coerceBulletLines(merged.takeaways),
  ]);
  const quick_revision_notes = dedupeStringList([
    ...coerceBulletLines(merged.quick_revision_notes),
    ...coerceBulletLines(merged.review_points),
    ...coerceBulletLines(merged.quick_review),
  ]);
  const practice_recall_questions = dedupeStringList([
    ...coerceBulletLines(merged.practice_recall_questions),
    ...coerceBulletLines(merged.recall_questions),
    ...coerceBulletLines(merged.quick_check_questions),
    ...normalizeStudyGuidePracticeQuestions(merged.practice_questions).map((q) => q.question),
    ...normalizeStudyGuidePracticeQuestions(merged.questions).map((q) => q.question),
  ]);

  return {
    ...merged,
    chapter_summary_title: chapter_summary_title || 'Chapter Summary',
    chapter_title: chapter_summary_title || merged.chapter_title || 'Chapter Summary',
    title: chapter_summary_title || merged.title || 'Chapter Summary',
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

function normalizeKeyPointsFormulaeList(source) {
  const s = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const rows = [];
  const seen = new Set();
  const pushRow = (name, formula, note = '') => {
    const n = String(name || '').trim();
    const f = String(formula || '').trim();
    const nt = String(note || '').trim();
    const text = f || n;
    if (!text) return;
    const key = `${n}|${text}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ name: n, formula: f || n, note: nt });
  };

  for (const key of ['formulae', 'formulas']) {
    const arr = Array.isArray(s[key]) ? s[key] : [];
    for (const f of arr) {
      if (f && typeof f === 'object') {
        pushRow(f.name, f.formula || f.rule, f.note || f.when_to_use);
      } else {
        pushRow('', String(f ?? ''), '');
      }
    }
  }

  if (Array.isArray(s.rules)) {
    for (const r of s.rules) {
      if (r && typeof r === 'object') {
        pushRow(r.name, r.formula || r.rule, r.note);
      } else if (typeof r === 'string') {
        pushRow('Rule', r, '');
      }
    }
  }

  for (const text of dedupeStringList([
    ...coerceBulletLines(s.important_facts),
    ...coerceBulletLines(s.facts),
  ])) {
    pushRow('Important rule', text, '');
  }

  return rows;
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
  const formulae = normalizeKeyPointsFormulaeList(source);
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

export function keyPointsHasMinimumBody(data) {
  const s = normalizeKeyPointsStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  const hasConcepts = Array.isArray(s.important_concepts) && s.important_concepts.length > 0;
  const hasFormulae = Array.isArray(s.formulae) && s.formulae.length >= 3;
  const hasFacts = Array.isArray(s.must_remember_facts) && s.must_remember_facts.length > 0;
  const hasSummary = String(s.one_minute_revision_summary || '').trim().length > 8;
  return hasConcepts && hasFormulae && (hasFacts || hasSummary);
}

/** Ensure formulae/rules are populated before validation and display. */
export function finalizeKeyPointsStructuredContent(raw, meta = {}) {
  let out = normalizeKeyPointsStructuredContent(raw);
  const title = String(out.topic_title || out.title || '').trim();
  const isGeneric = !title || /^key\s*points$/i.test(title);
  if (isGeneric) {
    const label = [meta.topic, meta.subTopic].filter(Boolean).join(' — ').trim() || 'Topic';
    const nextTitle = `Key Points: ${label}`;
    out = { ...out, topic_title: nextTitle, title: nextTitle };
  }
  if (!Array.isArray(out.formulae) || out.formulae.length < 3) {
    let derived = normalizeKeyPointsFormulaeList(out);
    if (derived.length < 3 && Array.isArray(out.must_remember_facts)) {
      const extras = [];
      for (const text of out.must_remember_facts) {
        if (derived.length + extras.length >= 3) break;
        const line = String(text || '').trim();
        if (!line || derived.some((d) => d.formula === line) || extras.some((d) => d.formula === line)) {
          continue;
        }
        extras.push({ name: 'Rule', formula: line, note: '' });
      }
      derived = [...derived, ...extras];
    }
    if (derived.length < 3 && Array.isArray(out.frequently_asked_exam_points)) {
      const extras = [];
      for (const text of out.frequently_asked_exam_points) {
        if (derived.length + extras.length >= 3) break;
        const line = String(text || '').trim();
        if (!line || derived.some((d) => d.formula === line) || extras.some((d) => d.formula === line)) {
          continue;
        }
        extras.push({ name: 'Exam point', formula: line, note: '' });
      }
      derived = [...derived, ...extras];
    }
    if (derived.length) {
      out = { ...out, formulae: derived, formulas: derived };
    }
  }
  return out;
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

/** Normalize one flashcard card with legacy fallbacks. */
export function normalizeFlashcardCard(raw) {
  if (typeof raw === 'string') {
    const line = String(raw || '').trim();
    if (!line) return { front: '', back: '' };
    const colon = line.match(/^(.+?)\s*[:–—-]\s*(.+)$/);
    if (colon) {
      return normalizeFlashcardCard({ front: colon[1], back: colon[2] });
    }
    return normalizeFlashcardCard({ front: line, back: line });
  }
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const front = String(
    source.front ||
      source.question ||
      source.term ||
      source.prompt ||
      source.cue ||
      source.name ||
      source.title ||
      '',
  ).trim();
  const back = String(
    source.back ||
      source.correct_answer ||
      source.answer ||
      source.definition ||
      source.meaning ||
      source.response ||
      source.description ||
      source.content ||
      '',
  ).trim();
  const memory_cue = String(
    source.memory_cue || source.memoryCue || source.hint || '',
  ).trim();
  const memory_hook_quick_tip = String(
    source.memory_hook_quick_tip || source.memory_cue || source.memoryCue || source.hint || '',
  ).trim();
  const difficulty_tag_for_each_card = String(
    source.difficulty_tag_for_each_card ||
      source.difficulty_tag ||
      source.difficultyLevel ||
      source.difficulty_level ||
      source.skill_focus ||
      source.skillFocus ||
      source.bloom_level ||
      source.topic_tag ||
      '',
  ).trim();
  const skill_focus = String(
    source.skill_focus || source.skillFocus || source.bloom_level || source.topic_tag || '',
  ).trim();
  const example_use = String(
    source.example_use || source.exampleUse || source.real_life_link || source.example || '',
  ).trim();
  const peer_prompt = String(source.peer_prompt || source.peerPrompt || '').trim();
  const self_check_round = String(
    source.self_check_round || source.selfCheckRound || source.peer_prompt || source.self_check || '',
  ).trim();
  const reflection = String(
    source.reflection || source.reflection_prompt || source.self_check || '',
  ).trim();
  const deck_title = String(source.deck_title || source.title || '').trim();
  return {
    ...source,
    front,
    back,
    memory_cue,
    memory_hook_quick_tip,
    difficulty_tag_for_each_card,
    skill_focus,
    example_use,
    peer_prompt,
    self_check_round,
    reflection,
    deck_title,
    hint: memory_cue,
    bloom_level: skill_focus,
    difficulty_tag: difficulty_tag_for_each_card || skill_focus,
    real_life_link: example_use,
    self_check: reflection,
  };
}


/** My Study Decks (student) deck shape — 12-section template. */
export function normalizeMyStudyDecksStructuredContent(raw) {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const deck_title = String(source.deck_title || source.title || '').trim();
  const subtopic_link_prior_knowledge_required = String(
    source.subtopic_link_prior_knowledge_required || source.prior_knowledge_required || source.subtopic_link || '',
  ).trim();
  const ncf_competency_alignment = String(
    source.ncf_competency_alignment || source.learning_outcome_alignment || '',
  ).trim();
  const real_life_application = String(
    source.real_life_application || source.example_use || source.real_life_link || '',
  ).trim();
  const reflection_exit_ticket = String(
    source.reflection_exit_ticket || source.reflection || source.reflection_prompt || '',
  ).trim();
  const toList = (value) =>
    Array.isArray(value)
      ? value.map((v) => String(v || '').trim()).filter(Boolean)
      : String(value || '')
          .split(/\n|;/)
          .map((v) => v.trim())
          .filter(Boolean);
  const learning_objectives = toList(source.learning_objectives || source.objectives);
  const common_mistakes_to_avoid = toList(
    source.common_mistakes_to_avoid || source.common_mistakes,
  );
  const expected_learning_outcomes = toList(source.expected_learning_outcomes);

  const fromList = (list) =>
    (Array.isArray(list) ? list : [])
      .map((c) => normalizeFlashcardCard(c))
      .filter((c) => String(c.front || '').trim() && String(c.back || '').trim());

  const bloomLevels = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
  let cards = [];
  if (Array.isArray(source.cards)) {
    cards = fromList(source.cards);
  } else if (Array.isArray(source.flashcard_set)) {
    cards = fromList(source.flashcard_set);
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

  cards = cards.map((card, i) => {
    const difficulty =
      String(card.difficulty_tag_for_each_card || card.difficulty_tag || '').trim() ||
      bloomLevels[i % bloomLevels.length];
    const memory_hook_quick_tip = String(
      card.memory_hook_quick_tip || card.memory_cue || card.hint || '',
    ).trim();
    const self_check_round = String(
      card.self_check_round || card.peer_prompt || '',
    ).trim();
    return {
      ...card,
      difficulty_tag_for_each_card: difficulty,
      difficulty_tag: difficulty,
      memory_hook_quick_tip:
        memory_hook_quick_tip ||
        (card.back ? `Remember: ${String(card.back).split(/[.!?]/)[0]?.trim().slice(0, 120)}` : ''),
      memory_cue: memory_hook_quick_tip || card.memory_cue,
      self_check_round:
        self_check_round ||
        (card.front ? `Without looking, explain: ${card.front}` : ''),
    };
  });

  return {
    ...source,
    deck_title: deck_title || undefined,
    title: deck_title || String(source.title || '').trim() || undefined,
    subtopic_link_prior_knowledge_required: subtopic_link_prior_knowledge_required || undefined,
    learning_objectives,
    ncf_competency_alignment: ncf_competency_alignment || undefined,
    common_mistakes_to_avoid,
    expected_learning_outcomes,
    real_life_application: real_life_application || undefined,
    reflection_exit_ticket: reflection_exit_ticket || undefined,
    cards,
  };
}

/** Flash Card Generator (teacher) — 5-block deck (Context, Foundations, HOTS cards, Study Aids, Wrap-Up). */
export function normalizeFlashcardDeckStructuredContent(raw) {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const toList = (value) =>
    Array.isArray(value)
      ? value.map((v) => String(v || '').trim()).filter(Boolean)
      : String(value || '')
          .split(/\n|;/)
          .map((v) => v.trim())
          .filter(Boolean);

  const deck_title = String(
    source.flashcard_deck_title || source.deck_title || source.title || '',
  ).trim();
  let topic = String(source.topic || '').trim();
  let subtopic = String(source.subtopic || source.sub_topic || source.subTopic || '').trim();
  const topic_and_subtopic_link = String(
    source.topic_and_subtopic_link || source.subtopic_link || '',
  ).trim();
  if (!topic && topic_and_subtopic_link) {
    const parts = topic_and_subtopic_link.split(/\s*[—–\-:]\s*/);
    topic = String(parts[0] || '').trim();
    if (!subtopic && parts.length > 1) subtopic = String(parts.slice(1).join(' — ') || '').trim();
  }
  const class_level = String(
    source.class_level || source.classLabel || source.class || '',
  ).trim();
  const difficulty_level = String(
    source.difficulty_level || source.difficulty || '',
  ).trim();
  const bloom_level = String(source.bloom_level || source.bloom || '').trim();
  const deck_memory_hook = String(
    source.deck_memory_hook ||
      source.memory_hook_quick_tip ||
      source.memory_cue ||
      '',
  ).trim();
  const prior_knowledge_required = String(
    source.prior_knowledge_required || source.prior_knowledge || '',
  ).trim();
  const ncf_competency_alignment = String(
    source.ncf_competency_alignment || source.learning_outcome_alignment || '',
  ).trim();
  const self_check_rapid_recall_round = String(
    source.self_check_rapid_recall_round ||
      source.self_check_round ||
      source.peer_prompt ||
      '',
  ).trim();
  const differentiation_support = String(
    source.differentiation_support || source.differentiation || '',
  ).trim();
  const real_life_connection = String(
    source.real_life_connection ||
      source.real_life_application ||
      source.example_use ||
      '',
  ).trim();
  const reflection_exit_ticket = String(
    source.reflection_exit_ticket || source.reflection || source.reflection_prompt || '',
  ).trim();
  const learning_objectives = toList(source.learning_objectives || source.objectives);
  const common_mistakes_to_avoid = toList(
    source.common_mistakes_to_avoid || source.common_mistakes,
  );
  const expected_learning_outcomes = toList(source.expected_learning_outcomes);

  const fromList = (list, category) =>
    (Array.isArray(list) ? list : [])
      .map((c) => {
        const card = normalizeFlashcardCard(c);
        if (!String(card.front || '').trim() || !String(card.back || '').trim()) return null;
        return {
          ...card,
          card_category: String(card.card_category || category || '').trim() || category,
        };
      })
      .filter(Boolean);

  const concept_and_definition_cards = fromList(
    source.concept_and_definition_cards,
    'concept',
  );
  const formula_rule_cards = fromList(
    source.formula_rule_cards || source.formula_cards,
    'formula',
  );
  const application_hots_cards = fromList(
    source.application_hots_cards || source.application_cards,
    'application',
  );
  const visual_diagram_suggestion_cards = fromList(
    source.visual_diagram_suggestion_cards || source.visual_cards,
    'visual',
  );

  let cards = [];
  if (application_hots_cards.length) cards = [...application_hots_cards];
  if (!cards.length && Array.isArray(source.cards)) cards = fromList(source.cards, 'application');
  else if (!cards.length && Array.isArray(source.flashcard_set))
    cards = fromList(source.flashcard_set, 'application');
  else if (!cards.length && Array.isArray(source.flashcards))
    cards = fromList(source.flashcards, 'application');
  else if (!cards.length && Array.isArray(raw)) cards = fromList(raw, 'application');
  else if (!cards.length) {
    const single = normalizeFlashcardCard(source);
    if (single.front && single.back) cards = [{ ...single, card_category: 'application' }];
  }

  if (!cards.length) {
    cards = [
      ...application_hots_cards,
      ...concept_and_definition_cards,
      ...formula_rule_cards,
      ...visual_diagram_suggestion_cards,
    ];
  }

  const mergedApplication =
    application_hots_cards.length >= cards.length ? application_hots_cards : cards;

  return {
    ...source,
    flashcard_deck_title: deck_title || undefined,
    deck_title: deck_title || undefined,
    title: deck_title || String(source.title || '').trim() || undefined,
    topic: topic || undefined,
    subtopic: subtopic || undefined,
    topic_and_subtopic_link:
      topic_and_subtopic_link ||
      (topic && subtopic ? `${topic} — ${subtopic}` : topic || subtopic || undefined),
    class_level: class_level || undefined,
    difficulty_level: difficulty_level || undefined,
    bloom_level: bloom_level || undefined,
    deck_memory_hook: deck_memory_hook || undefined,
    prior_knowledge_required: prior_knowledge_required || undefined,
    learning_objectives,
    ncf_competency_alignment: ncf_competency_alignment || undefined,
    concept_and_definition_cards,
    formula_rule_cards,
    application_hots_cards: mergedApplication,
    visual_diagram_suggestion_cards,
    self_check_rapid_recall_round: self_check_rapid_recall_round || undefined,
    common_mistakes_to_avoid,
    differentiation_support: differentiation_support || undefined,
    expected_learning_outcomes,
    real_life_connection: real_life_connection || undefined,
    reflection_exit_ticket: reflection_exit_ticket || undefined,
    cards: mergedApplication,
  };
}

function countValidFlashcardRows(cards = []) {
  return (Array.isArray(cards) ? cards : []).filter(
    (c) => String(c?.front || '').trim().length > 0 && String(c?.back || '').trim().length > 0,
  ).length;
}

/** @returns {string[]} Missing flashcard deck requirements for validation / retries. */
export function getFlashcardDeckMissingSections(data, toolSlug = 'flashcard-generator') {
  const slug = String(toolSlug || '').trim();
  const n =
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent(data)
      : normalizeMyStudyDecksStructuredContent(data);
  const missing = [];
  const minCards = 5;
  if (countValidFlashcardRows(n.cards) < minCards) {
    missing.push(`The Card Set: Application & HOTS (min ${minCards} cards with Task and Solution)`);
  }
  if (slug === 'flashcard-generator') {
    if (!String(n.flashcard_deck_title || n.deck_title || n.title || '').trim()) {
      missing.push('Context & Alignment: Deck Title');
    }
    if (
      !String(n.topic || '').trim() &&
      !String(n.subtopic || '').trim() &&
      !String(n.topic_and_subtopic_link || '').trim()
    ) {
      missing.push('Context & Alignment: Topic / Subtopic');
    }
    if (!String(n.prior_knowledge_required || '').trim()) {
      missing.push('Foundations: Prior Knowledge Required');
    }
    if (!Array.isArray(n.learning_objectives) || n.learning_objectives.length < 2) {
      missing.push('Foundations: Learning Objectives (min 2)');
    }
    if (!String(n.ncf_competency_alignment || '').trim()) {
      missing.push('Foundations: NCF Competency / Learning Outcome Alignment');
    }
    if (!String(n.deck_memory_hook || '').trim()) {
      missing.push('Study Aids: Memory Hook');
    }
    if (!Array.isArray(n.common_mistakes_to_avoid) || n.common_mistakes_to_avoid.length < 1) {
      missing.push('Study Aids: Common Mistakes to Avoid');
    }
    if (!String(n.self_check_rapid_recall_round || '').trim()) {
      missing.push('Study Aids: Rapid Recall');
    }
    if (!String(n.real_life_connection || '').trim()) {
      missing.push('Wrap-Up: Real-life Connection');
    }
    if (!String(n.differentiation_support || '').trim()) {
      missing.push('Wrap-Up: Differentiation');
    }
    if (!String(n.reflection_exit_ticket || '').trim()) {
      missing.push('Wrap-Up: Exit Ticket');
    }
  } else {
    if (!String(n.deck_title || n.title || '').trim()) missing.push('1. Deck Title');
    if (!String(n.subtopic_link_prior_knowledge_required || '').trim()) {
      missing.push('2. Subtopic Link and Prior Knowledge Required');
    }
  }
  return missing;
}

export function flashcardDeckStructuredContentIsComplete(data, toolSlug = 'flashcard-generator') {
  return getFlashcardDeckMissingSections(data, toolSlug).length === 0;
}

/** Merge typed card groups and pad deck narrative fields; build cards from objectives when needed. */
export function finalizeFlashcardDeckStructuredContent(structuredContent, meta = {}, toolSlug = 'flashcard-generator') {
  const slug = String(toolSlug || '').trim();
  const base =
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent(structuredContent)
      : normalizeMyStudyDecksStructuredContent(structuredContent);

  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const bloomLevels = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];

  if (!String(base.flashcard_deck_title || base.deck_title || base.title || '').trim()) {
    base.deck_title = `${topic} — Flashcards`;
    base.title = base.deck_title;
    if (slug === 'flashcard-generator') base.flashcard_deck_title = base.deck_title;
  }

  if (slug === 'flashcard-generator') {
    if (!String(base.topic || '').trim()) {
      base.topic = String(meta.topic || meta.subject || subject).trim() || subject;
    }
    if (!String(base.subtopic || '').trim()) {
      base.subtopic = topic;
    }
    if (!String(base.topic_and_subtopic_link || '').trim()) {
      base.topic_and_subtopic_link = `${base.topic} — ${base.subtopic}`;
    }
    if (!String(base.class_level || '').trim()) {
      base.class_level = String(meta.classLabel || meta.class || meta.grade || 'Class 10').trim();
    }
    if (!String(base.difficulty_level || '').trim()) {
      base.difficulty_level = 'Medium';
    }
    if (!String(base.bloom_level || '').trim()) {
      base.bloom_level = 'Apply / Analyze';
    }
    if (!String(base.prior_knowledge_required || '').trim()) {
      base.prior_knowledge_required = `Students should recall basic ideas about ${topic} before using this deck.`;
    }
    if (!Array.isArray(base.learning_objectives) || base.learning_objectives.length < 2) {
      base.learning_objectives = [
        `Define and explain key ideas about ${topic}.`,
        `Apply ${topic} to short real-life examples.`,
      ];
    }
    if (!String(base.ncf_competency_alignment || '').trim()) {
      base.ncf_competency_alignment = `NCF-aligned: conceptual understanding and application for ${topic} in ${subject}.`;
    }
    if (!String(base.deck_memory_hook || '').trim()) {
      base.deck_memory_hook = `Link each ${topic} idea to a vivid daily-life image to remember the deck.`;
    }
    if (!String(base.self_check_rapid_recall_round || '').trim()) {
      base.self_check_rapid_recall_round = `Rapid recall: cover each card, then explain ${topic} in your own words.`;
    }
    if (!String(base.differentiation_support || '').trim()) {
      base.differentiation_support = `Support: use memory hooks and pair review. Extension: create two new cards for ${topic}.`;
    }
    if (!String(base.real_life_connection || '').trim()) {
      base.real_life_connection = `Relate each card to an observation from daily life linked to ${topic}.`;
    }
  } else {
    if (!String(base.subtopic_link_prior_knowledge_required || '').trim()) {
      base.subtopic_link_prior_knowledge_required = `${topic} — prior knowledge: basic ${subject} vocabulary.`;
    }
    if (!String(base.ncf_competency_alignment || '').trim()) {
      base.ncf_competency_alignment = `Aligned to ${subject} competencies for ${topic}.`;
    }
    if (!String(base.real_life_application || '').trim()) {
      base.real_life_application = `Use these cards to discuss ${topic} at home or in class.`;
    }
  }

  if (!Array.isArray(base.common_mistakes_to_avoid) || !base.common_mistakes_to_avoid.length) {
    base.common_mistakes_to_avoid = [`Mixing opinion with evidence when studying ${topic}.`];
  }
  if (!Array.isArray(base.expected_learning_outcomes) || !base.expected_learning_outcomes.length) {
    base.expected_learning_outcomes = [`Students recall and explain core ideas about ${topic}.`];
  }
  if (!String(base.reflection_exit_ticket || '').trim()) {
    base.reflection_exit_ticket = `Which card was hardest for ${topic}, and why?`;
  }

  let cards = Array.isArray(base.cards) ? [...base.cards] : [];
  if (countValidFlashcardRows(cards) < 5) {
    const objectives = Array.isArray(base.learning_objectives) ? base.learning_objectives : [];
    for (const obj of objectives) {
      const text = String(obj || '').trim();
      if (!text) continue;
      cards.push(
        normalizeFlashcardCard({
          front: `Explain: ${text}`,
          back: text,
          difficulty_tag_for_each_card: bloomLevels[cards.length % bloomLevels.length],
        }),
      );
      if (countValidFlashcardRows(cards) >= 8) break;
    }
    const keyPoints = []
      .concat(
        Array.isArray(base.key_points_to_remember) ? base.key_points_to_remember : [],
        Array.isArray(base.key_points) ? base.key_points : [],
      )
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    for (const kp of keyPoints) {
      if (countValidFlashcardRows(cards) >= 10) break;
      cards.push(
        normalizeFlashcardCard({
          front: kp.includes('?') ? kp : `What is ${kp}?`,
          back: kp,
          difficulty_tag_for_each_card: bloomLevels[cards.length % bloomLevels.length],
        }),
      );
    }
    while (countValidFlashcardRows(cards) < 5) {
      const n = cards.length + 1;
      cards.push(
        normalizeFlashcardCard({
          front: `${topic} — key idea ${n}`,
          back: `Review class notes on ${topic} and write one sentence using evidence.`,
          difficulty_tag_for_each_card: bloomLevels[(n - 1) % bloomLevels.length],
        }),
      );
    }
    base.cards = cards.filter(
      (c) => String(c.front || '').trim() && String(c.back || '').trim(),
    );
    base.application_hots_cards = base.cards;
  }

  return slug === 'flashcard-generator'
    ? normalizeFlashcardDeckStructuredContent(base)
    : normalizeMyStudyDecksStructuredContent(base);
}

export function canonicalizeFlashcardExtractedItem(raw, toolSlug = 'my-study-decks') {
  const slug = String(toolSlug || '').trim();
  if (slug === 'flashcard-generator') return normalizeFlashcardDeckStructuredContent(raw);
  return normalizeMyStudyDecksStructuredContent(raw);
}

/** Viewer payload for My Study Decks or Flash Card Generator. */
export function buildFlashcardRenderableFromStructured(source, toolSlug = 'my-study-decks') {
  const slug = String(toolSlug || '').trim();
  const normalize =
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent
      : normalizeMyStudyDecksStructuredContent;
  const normalized = normalize(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  const cards = normalized.cards || [];
  const deckTitle = String(normalized.deck_title || normalized.title || 'Flashcards').trim();
  if (slug === 'flashcard-generator') {
    return {
      kind: 'flashcards',
      variant: 'teacher',
      title: deckTitle,
      flashcardDeckTitle: deckTitle,
      topic: String(normalized.topic || '').trim(),
      subtopic: String(normalized.subtopic || '').trim(),
      topicAndSubtopicLink: String(normalized.topic_and_subtopic_link || '').trim(),
      classLevel: String(normalized.class_level || '').trim(),
      difficultyLevel: String(normalized.difficulty_level || '').trim(),
      bloomLevel: String(normalized.bloom_level || '').trim(),
      priorKnowledgeRequired: String(normalized.prior_knowledge_required || '').trim(),
      learningObjectives: toStringList(normalized.learning_objectives),
      ncfCompetencyAlignment: String(normalized.ncf_competency_alignment || '').trim(),
      deckMemoryHook: String(normalized.deck_memory_hook || '').trim(),
      selfCheckRapidRecallRound: String(normalized.self_check_rapid_recall_round || '').trim(),
      commonMistakesToAvoid: toStringList(normalized.common_mistakes_to_avoid),
      differentiationSupport: String(normalized.differentiation_support || '').trim(),
      realLifeConnection: String(normalized.real_life_connection || '').trim(),
      reflectionExitTicket: String(normalized.reflection_exit_ticket || '').trim(),
      applicationHotsCards: (normalized.application_hots_cards || normalized.cards || []).length,
      cards: cards.map((c) => ({
        front: c.front,
        back: c.back,
        cardCategory: c.card_category,
        difficultyTagForEachCard:
          c.difficulty_tag_for_each_card || c.difficulty_tag || c.skill_focus,
        memoryCue: c.memory_hook_quick_tip || c.memory_cue,
        memoryHookQuickTip: c.memory_hook_quick_tip || c.memory_cue,
        skillFocus: c.skill_focus,
        exampleUse: c.example_use,
        peerPrompt: c.peer_prompt,
        reflection: c.reflection,
      })),
    };
  }
  const deckSelfCheck = String(
    normalized.self_check_round ||
      normalized.peer_prompt ||
      cards.map((c) => c.self_check_round).find(Boolean) ||
      '',
  ).trim();
  return {
    kind: 'flashcards',
    variant: 'student',
    title: deckTitle,
    deck_title: deckTitle,
    cards: cards.map((c) => ({
      front: c.front,
      back: c.back,
      difficultyTagForEachCard: c.difficulty_tag_for_each_card || c.difficulty_tag || c.skill_focus,
      memoryCue: c.memory_hook_quick_tip || c.memory_cue,
      memoryHookQuickTip: c.memory_hook_quick_tip || c.memory_cue,
      skillFocus: c.skill_focus,
      exampleUse: c.example_use,
      peerPrompt: c.peer_prompt,
      selfCheckRound: c.self_check_round || c.peer_prompt,
      reflection: c.reflection,
    })),
    subtopicLinkPriorKnowledgeRequired: String(
      normalized.subtopic_link_prior_knowledge_required || '',
    ).trim(),
    learningObjectives: toStringList(normalized.learning_objectives),
    ncfCompetencyAlignment: String(normalized.ncf_competency_alignment || '').trim(),
    selfCheckRound: deckSelfCheck,
    commonMistakesToAvoid: toStringList(normalized.common_mistakes_to_avoid),
    expectedLearningOutcomes: toStringList(normalized.expected_learning_outcomes),
    realLifeApplication: String(normalized.real_life_application || '').trim(),
    reflectionExitTicket: String(normalized.reflection_exit_ticket || '').trim(),
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

export const WORKSHEET_SECTION_LABELS = {
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

/** Section 9 — all answers grouped under A, B, C, D, E. */
export function buildWorksheetAnswerKeyFromSections(sections = []) {
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const canonical = buildCanonicalWorksheetSectionList(sections);
  const blocks = [];

  canonical.forEach((sec, idx) => {
    const qs = (Array.isArray(sec?.questions) ? sec.questions : []).filter((q) =>
      String(q?.answer || '').trim(),
    );
    if (!qs.length) return;
    blocks.push(`${letters[idx]}. ${sec.sectionName}`);
    qs.forEach((q, qIdx) => {
      const num = q.question_number ?? q.sl_no ?? qIdx + 1;
      blocks.push(`  Q${num}. ${String(q.answer).trim()}`);
    });
    blocks.push('');
  });

  return blocks.join('\n').trim();
}

export function buildWorksheetAnswerKeySections(sections = []) {
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const canonical = buildCanonicalWorksheetSectionList(sections);
  return canonical
    .map((sec, idx) => {
      const entries = (Array.isArray(sec?.questions) ? sec.questions : [])
        .map((q, qIdx) => ({
          question_number: q.question_number ?? q.sl_no ?? qIdx + 1,
          answer: String(q.answer || '').trim(),
        }))
        .filter((row) => row.answer);
      if (!entries.length) return null;
      return {
        letter: letters[idx],
        sectionName: sec.sectionName,
        entries,
      };
    })
    .filter(Boolean);
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
    const qs = toQuestionArray(sec?.questions || sec?.items || []).map((q) => ({
      ...q,
      section: q.section || name,
    }));
    allQs.push(...qs);
  }
  return groupQuestionsIntoWorksheetSections(allQs);
}

/** Final pass: dedupe, renumber 1..n per section, clean MCQ options, drop answer-key junk. */
function polishWorksheetStructuredContent(source = {}) {
  const canonical = buildCanonicalWorksheetSectionList(source.sections || []);
  const globalSeenFull = new Set();
  const sections = canonical.map((sec) => {
    const cleaned = sanitizeWorksheetQuestions(
      (sec.questions || []).map((q) => ({
        ...q,
        section: sec.sectionName,
      })),
    ).filter((q) => {
      const fullKey = worksheetQuestionDedupeKey(q);
      if (!fullKey) return false;
      if (globalSeenFull.has(fullKey)) return false;
      globalSeenFull.add(fullKey);
      return true;
    });
    const questions = cleaned.map((q, idx) => ({
      ...q,
      question_number: idx + 1,
      section: sec.sectionName,
      options: cleanWorksheetMcqOptions(q.options),
    }));
    return {
      sectionName: sec.sectionName,
      questions,
      count: questions.length,
    };
  });

  const flatQuestions = sections.flatMap((sec) =>
    (sec.questions || []).map((q) => ({ ...q, section: sec.sectionName })),
  );

  const sectionedKey = buildWorksheetAnswerKeyFromSections(sections);
  const pdfAnswerKey = normalizeWorksheetAnswerKeyText(source.answer_key || '');
  let answerKeyOut = sectionedKey || pdfAnswerKey;
  if (sectionedKey && pdfAnswerKey && pdfAnswerKey !== sectionedKey) {
    answerKeyOut = `${sectionedKey}\n\n--- PDF Answer Key ---\n${pdfAnswerKey}`;
  }

  return {
    ...source,
    sections,
    questions: flatQuestions,
    answer_key: answerKeyOut,
  };
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

  const questionsBeforeText = sections.reduce(
    (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
    0,
  );
  const sourceLooksLikeRawPdf =
    String(sourceText || '').length > 1500 &&
    (/\bsection\s+[a-f]\s*:/i.test(sourceText) || (sourceText.match(/\?\s*$/gm) || []).length >= 8);
  const sourceLooksLikeNumberedTemplate =
    /\bsection\s+\d{1,2}\b/i.test(sourceText) &&
    (/\bsection\s+[4-8]\b/i.test(sourceText) || (sourceText.match(/\?/g) || []).length >= 2);
  const sourceLooksLikeSmallGenerationChunk =
    String(sourceText || '').length >= 80 &&
    String(sourceText || '').length < 2500 &&
    sourceLooksLikeNumberedTemplate;
  const sourceLooksLikeStoredMarkdown =
    /^\s*#{1,4}\s+/m.test(sourceText) || /\*\*Q\d+\./i.test(sourceText);
  const sourceLooksLikeWorksheetText =
    (/\bsection\s+[a-f]\s*:/i.test(sourceText) && /\bQ?\d+[\.\):\-]\s+/i.test(sourceText)) ||
    (/\bQ\d+\./i.test(sourceText) && (sourceText.match(/\?/g) || []).length >= 3) ||
    sourceLooksLikeNumberedTemplate;
  const questionMarksInSource = (String(sourceText || '').match(/\?/g) || []).length;
  const numberedInSource = (String(sourceText || '').match(/(?:^|\n)\s*(?:Q\.?\s*)?\d{1,3}[\.\):\-]\s+/gim) || [])
    .length;
  const expectedFromSource = Math.max(questionMarksInSource, numberedInSource);
  const sourceLooksUnderExtracted =
    expectedFromSource > 12 &&
    questionsBeforeText < Math.max(10, Math.floor(expectedFromSource * 0.45));
  if (
    sourceText &&
    (questionsBeforeText < 2 || sourceLooksUnderExtracted || sourceLooksLikeSmallGenerationChunk) &&
    (sourceLooksLikeRawPdf || sourceLooksLikeStoredMarkdown || sourceLooksLikeWorksheetText || sourceLooksLikeNumberedTemplate)
  ) {
    const fromText = sanitizeWorksheetQuestions(extractWorksheetItemsFromPdfText(sourceText, 500));
    if (fromText.length > questionsBeforeText) {
      sections = groupQuestionsIntoWorksheetSections(fromText);
    }
  }

  const draft = {
    ...source,
    title: title || 'Worksheet',
    worksheet_title: title || source.worksheet_title || 'Worksheet',
    instructions,
    learning_objectives,
    objectives: learning_objectives,
    sections,
    answer_key,
    bloom_level,
    difficulty_tag,
    type: String(source.type || 'Worksheet').trim() || 'Worksheet',
  };

  return polishWorksheetStructuredContent(draft);
}

/** Ensure worksheet has sections A–E each with at least one question (AI Generator completeness). */
export function finalizeWorksheetStructuredContent(structuredContent, meta = {}) {
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const base = normalizeWorksheetStructuredContent(
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {},
  );

  const scaffoldForSection = (sectionName, qNum) => {
    if (sectionName === WORKSHEET_SECTION_LABELS.A) {
      return {
        question_number: qNum,
        type: 'MCQ',
        section: sectionName,
        question: `Which statement about ${topic} is most accurate?`,
        options: [
          'A) A guess without evidence',
          'B) A claim supported by observation and reasoning',
          'C) A tradition that cannot be tested',
          'D) An opinion with no examples',
        ],
        answer: 'B) A claim supported by observation and reasoning',
        marks: 1,
      };
    }
    if (sectionName === WORKSHEET_SECTION_LABELS.B) {
      return {
        question_number: qNum,
        type: 'FIB',
        section: sectionName,
        question: `Complete: A key idea in ${topic} is _____.`,
        answer: `A core concept from ${topic} explained in class.`,
        marks: 1,
      };
    }
    if (sectionName === WORKSHEET_SECTION_LABELS.C) {
      return {
        question_number: qNum,
        type: 'VSA',
        section: sectionName,
        question: `Define one important term related to ${topic}.`,
        answer: `A brief definition using evidence about ${topic}.`,
        marks: 2,
      };
    }
    if (sectionName === WORKSHEET_SECTION_LABELS.D) {
      return {
        question_number: qNum,
        type: 'SA',
        section: sectionName,
        question: `Explain how ${topic} applies in daily life. Give one example.`,
        answer: `Students describe a real example connecting ${topic} to everyday ${subject}.`,
        marks: 3,
      };
    }
    return {
      question_number: qNum,
      type: 'COMPETENCY',
      section: sectionName,
      question: `How would you use ideas from ${topic} to solve a problem at home or school?`,
      answer: `A reasoned plan using concepts from ${topic} with steps and evidence.`,
      marks: 4,
    };
  };

  let sections = buildCanonicalWorksheetSectionList(base.sections || []);
  let globalQ = 1;
  sections = sections.map((sec) => {
    const existing = Array.isArray(sec.questions) ? sec.questions.filter((q) => String(q?.question || '').trim()) : [];
    if (existing.length) {
      const renumbered = existing.map((q) => ({
        ...q,
        question_number: globalQ++,
        section: sec.sectionName,
      }));
      return { ...sec, questions: renumbered, count: renumbered.length };
    }
    if (!isAiGeneratorSectionPadEnabled()) {
      return { ...sec, questions: [], count: 0 };
    }
    const scaffold = scaffoldForSection(sec.sectionName, globalQ++);
    return { ...sec, questions: [scaffold], count: 1 };
  });

  const learning_objectives =
    Array.isArray(base.learning_objectives) && base.learning_objectives.length
      ? base.learning_objectives
      : isAiGeneratorSectionPadEnabled()
        ? [
            `Students recall key facts about ${topic}.`,
            `Students apply ${topic} to short ${subject} problems.`,
          ]
        : [];

  const instructions =
    String(base.instructions || '').trim() ||
    (isAiGeneratorSectionPadEnabled()
      ? `Read each section carefully. Answer all questions on ${topic} in your notebook.`
      : '');

  const draft = {
    ...base,
    title: String(base.title || base.worksheet_title || `${topic} — Worksheet`).trim(),
    worksheet_title: String(base.worksheet_title || base.title || `${topic} — Worksheet`).trim(),
    learning_objectives,
    objectives: learning_objectives,
    instructions,
    sections,
    section_a_mcqs: sections[0]?.questions || [],
    section_b_fib: sections[1]?.questions || [],
    section_c_vsa: sections[2]?.questions || [],
    section_d_sa: sections[3]?.questions || [],
    section_e_competency: sections[4]?.questions || [],
    questions: sections.flatMap((s) => s.questions || []),
    answer_key: String(base.answer_key || '').trim() || buildWorksheetAnswerKeyFromSections(sections),
    bloom_level: String(base.bloom_level || 'Apply / Analyze').trim(),
    difficulty_tag: String(base.difficulty_tag || base.difficulty || 'Medium').trim(),
  };

  return polishWorksheetStructuredContent(draft);
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
export function buildWorksheetRenderableFromStructured(source, sourceText = '') {
  const w = normalizeWorksheetStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
    sourceText,
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
    answerKeySections: buildWorksheetAnswerKeySections(canonicalSections),
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

const PRACTICE_QA_SECTION_KEY_PAIRS = [
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

function normalizePracticeQaQuestionRow(entry, sectionHint = '') {
  if (typeof entry === 'string') {
    const text = entry.trim();
    return text ? { question: text, options: [], answer: '', section: sectionHint } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const question = String(
    entry.question ||
      entry.question_text ||
      entry.questionText ||
      entry.prompt ||
      entry.text ||
      entry.statement ||
      entry.stem ||
      entry.title ||
      '',
  ).trim();
  if (!question) return null;
  const options = collectOptionsFromEntry(entry);
  return {
    question,
    options,
    answer: String(entry.answer || entry.correctAnswer || entry.correct_answer || '').trim(),
    question_number: entry.question_number ?? entry.sl_no ?? entry.number,
    section: String(entry.section || sectionHint || '').trim(),
    type: String(entry.type || entry.question_type || '').trim(),
    marks: entry.marks != null && entry.marks !== '' ? Number(entry.marks) : undefined,
    explanation: String(entry.explanation || entry.rationale || '').trim(),
    bloom_level: String(entry.bloom_level || entry.bloomLevel || '').trim(),
    difficulty_tag: String(entry.difficulty_tag || entry.difficulty || entry.difficultyTag || '').trim(),
  };
}

function toPracticeQaQuestionArray(value = [], sectionHint = '') {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizePracticeQaQuestionRow(entry, sectionHint))
    .filter(Boolean);
}

function looksLikePracticeQaQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 8) return false;
  if (isHeadingLikeLine(t)) return false;
  return looksLikeQuestionPrompt(t) || /_{2,}/.test(t) || t.length >= 12;
}

function sanitizePracticeQaQuestions(questions = []) {
  return questions
    .map((row) => ({
      ...row,
      question: String(row?.question || '').replace(/\s+/g, ' ').trim(),
      options: (() => {
        const raw = (Array.isArray(row?.options) ? row.options : [])
          .map((opt) => String(opt || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        return raw.length >= 2 ? labelMcqOptions(raw) : raw;
      })(),
      answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((row) => looksLikePracticeQaQuestion(row.question) || row.options.length >= 2)
    .filter(
      (row, idx, arr) =>
        arr.findIndex((q) => q.question.toLowerCase() === row.question.toLowerCase()) === idx,
    );
}

function extractPracticeQaQuestionsFromBlock(block, sectionHint = '') {
  if (Array.isArray(block)) return toPracticeQaQuestionArray(block, sectionHint);
  if (block && typeof block === 'object') {
    const hint = sectionHint || String(block.sectionName || block.name || block.section || '').trim();
    const nested = block.questions || block.items || block.mcqs;
    if (Array.isArray(nested)) return toPracticeQaQuestionArray(nested, hint);
  }
  return [];
}

export function countPracticeQaQuestions(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  if (String(data.question || '').trim()) return 1;
  let n = 0;
  if (Array.isArray(data.sections)) {
    n += data.sections.reduce(
      (acc, s) => acc + extractPracticeQaQuestionsFromBlock(s?.questions || s).length,
      0,
    );
  }
  for (const [key] of PRACTICE_QA_SECTION_KEY_PAIRS) {
    n += extractPracticeQaQuestionsFromBlock(data[key]).length;
  }
  if (Array.isArray(data.questions)) n += toPracticeQaQuestionArray(data.questions).length;
  if (Array.isArray(data.practice_questions)) n += toPracticeQaQuestionArray(data.practice_questions).length;
  if (Array.isArray(data.real_life_problem_solving_questions)) {
    n += toPracticeQaQuestionArray(data.real_life_problem_solving_questions).length;
  }
  return n;
}

/** Sections A–G that have zero questions after normalization. */
export function getPracticeQaMissingSections(data) {
  const normalized = normalizePracticeQaStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  const canonical = buildCanonicalPracticeQaSectionList(normalized.sections);
  return canonical.filter((sec) => !(Array.isArray(sec?.questions) && sec.questions.length)).map((sec) => sec.sectionName);
}

export function practiceQaHasAllRequiredSections(data) {
  if (countPracticeQaQuestions(data) === 0) return false;
  return getPracticeQaMissingSections(data).length === 0;
}

export function practiceQaValidationMessage(data) {
  if (countPracticeQaQuestions(data) === 0) {
    return 'Practice Q&A must include questions in sections A–G, real-life questions, or a flat questions array.';
  }
  const missing = getPracticeQaMissingSections(data);
  if (!missing.length) return '';
  return `Practice Q&A must include at least one question in each section A–G. Missing: ${missing.join('; ')}.`;
}

function collectPracticeQaParseableText(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  const parts = [];
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length > 15) parts.push(t);
    return parts.join('\n');
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const chunk = collectPracticeQaParseableText(item, depth + 1);
      if (chunk) parts.push(chunk);
    }
    return parts.join('\n\n');
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const chunk = collectPracticeQaParseableText(v, depth + 1);
      if (chunk) parts.push(chunk);
    }
  }
  return parts.join('\n\n');
}

/** Parse questions from prose / loose JSON when section arrays are missing. */
export function repairPracticeQaStructuredContent(raw, meta = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const textBlob = collectPracticeQaParseableText(source);
  let out = normalizePracticeQaStructuredContent(source, textBlob);

  if (countPracticeQaQuestions(out) === 0 && textBlob) {
    const normalized = textBlob
      .replace(/\*\*Q\s*(\d+)\.\*\*/gi, '\nQ$1. ')
      .replace(/\*\*([^*]+)\*\*/g, '$1');
    let parsed = sanitizePracticeQaQuestions(extractWorksheetItemsFromPdfText(normalized, 40));
    if (!parsed.length) {
      parsed = sanitizePracticeQaQuestions(extractQuestionsFromText(normalized));
    }
    if (parsed.length) {
      out = normalizePracticeQaStructuredContent(
        {
          ...source,
          questions: parsed.map((q, i) => ({
            question_number: i + 1,
            question: q.question,
            options: q.options || [],
            answer: q.answer || '',
            section: q.section || PRACTICE_QA_SECTION_LABELS.A,
            type: q.options?.length >= 2 ? 'MCQ' : '',
          })),
        },
        textBlob,
      );
    }
  }

  if (countPracticeQaQuestions(out) === 0) {
    const lifted = [];
    for (const [key, label] of PRACTICE_QA_SECTION_KEY_PAIRS) {
      lifted.push(...extractPracticeQaQuestionsFromBlock(source[key], label));
    }
    if (Array.isArray(source.questions)) {
      lifted.push(...toPracticeQaQuestionArray(source.questions));
    }
    if (lifted.length) {
      out = normalizePracticeQaStructuredContent({ ...source, questions: lifted }, textBlob);
    }
  }

  return out;
}

export function chapterSummaryHasMinimumBody(data) {
  const s = normalizeChapterSummaryStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  const hasOverview = String(s.chapter_overview || '').trim().length > 8;
  const hasConcepts = Array.isArray(s.important_concepts) && s.important_concepts.length > 0;
  const hasRevision = Array.isArray(s.quick_revision_notes) && s.quick_revision_notes.length > 0;
  const hasRecall =
    Array.isArray(s.practice_recall_questions) && s.practice_recall_questions.length > 0;
  const hasFormulae = Array.isArray(s.formulae) && s.formulae.length >= 3;
  return hasOverview && (hasConcepts || hasRevision) && hasRecall && hasFormulae;
}

/** Repair title and lift study-guide mislabels into chapter summary fields. */
export function finalizeChapterSummaryStructuredContent(raw, meta = {}) {
  let out = normalizeChapterSummaryStructuredContent(raw);
  const title = String(out.chapter_summary_title || out.title || '').trim();
  const isGeneric = !title || /^chapter\s*summary$/i.test(title);
  if (isGeneric) {
    const label = [meta.topic, meta.subTopic].filter(Boolean).join(' — ').trim() || 'Chapter';
    const nextTitle = `Chapter Summary: ${label}`;
    out = { ...out, chapter_summary_title: nextTitle, chapter_title: nextTitle, title: nextTitle };
  }
  if (!Array.isArray(out.formulae) || out.formulae.length < 3) {
    let derived = normalizeChapterSummaryFormulaeList(out);
    if (derived.length < 3 && Array.isArray(out.quick_revision_notes)) {
      const extras = [];
      for (const text of out.quick_revision_notes) {
        if (derived.length + extras.length >= 3) break;
        const line = String(text || '').trim();
        if (!line || derived.some((d) => d.formula === line) || extras.some((d) => d.formula === line)) {
          continue;
        }
        extras.push({ name: 'Key rule', formula: line, note: '' });
      }
      derived = [...derived, ...extras];
    }
    if (derived.length) {
      out = { ...out, formulae: derived, formulas: derived };
    }
  }
  return out;
}

/** Ensure practice Q&A has a title and parsed questions before validation. */
export function finalizePracticeQaStructuredContent(raw, meta = {}) {
  let out = repairPracticeQaStructuredContent(raw, meta);

  const allRows = [
    ...(Array.isArray(out.sections) ? out.sections : []).flatMap((sec) =>
      (Array.isArray(sec?.questions) ? sec.questions : []).map((q) => ({
        ...q,
        section:
          q.section ||
          sec.sectionName ||
          inferPracticeQaSectionLabel(sec?.sectionName, q),
      })),
    ),
    ...(Array.isArray(out.questions) ? out.questions : []),
  ];
  if (allRows.length) {
    const regrouped = groupQuestionsIntoPracticeQaSections(allRows);
    out = {
      ...out,
      sections: buildCanonicalPracticeQaSectionList(regrouped),
    };
  } else if (Array.isArray(out.sections)) {
    out = { ...out, sections: buildCanonicalPracticeQaSectionList(out.sections) };
  }

  const title = String(out.title || out.practice_set_title || '').trim();
  const isGeneric = !title || /^practice\s*q\s*&?\s*a$/i.test(title);
  if (isGeneric) {
    const label = [meta.topic, meta.subTopic].filter(Boolean).join(' — ').trim() || 'Practice Set';
    const nextTitle = `Practice Q&A: ${label}`;
    out = { ...out, title: nextTitle, practice_set_title: nextTitle };
  }
  return out;
}

function inferPracticeQaSectionLabel(sectionRaw, question = {}) {
  const s = String(sectionRaw || '').trim();
  const t = String(question.type || '').trim().toUpperCase();
  if (/^A\b|SECTION\s*A|MCQ|MULTIPLE\s*CHOICE/i.test(s) || t === 'MCQ') return PRACTICE_QA_SECTION_LABELS.A;
  if (/^B\b|SECTION\s*B|FILL|FIB|BLANK/i.test(s) || t === 'FIB') return PRACTICE_QA_SECTION_LABELS.B;
  if (/^C\b|SECTION\s*C|MATCH/i.test(s) || t === 'MATCH') return PRACTICE_QA_SECTION_LABELS.C;
  if (/^6\b|section\s*6/i.test(s) && /match/i.test(s)) return PRACTICE_QA_SECTION_LABELS.C;
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
  const cleaned = sanitizePracticeQaQuestions(
    Array.isArray(questions) && questions.length && questions[0]?.question != null
      ? questions.map((q) => normalizePracticeQaQuestionRow(q, q?.section || '')).filter(Boolean)
      : toPracticeQaQuestionArray(questions),
  );
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
    const qs = extractPracticeQaQuestionsFromBlock(sec?.questions || sec, name).map((q) => ({
      ...q,
      section: q.section || name,
    }));
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

  for (const [key, label] of PRACTICE_QA_SECTION_KEY_PAIRS) {
    looseQuestions.push(...extractPracticeQaQuestionsFromBlock(source[key], label));
  }

  const flatPools = [
    source.questions,
    source.practice_questions,
    source.mcqs,
    source.items,
  ];
  for (const pool of flatPools) {
    looseQuestions.push(...toPracticeQaQuestionArray(pool));
  }

  if (looseQuestions.length) {
    sections = mergePracticeQaSections(sections, groupQuestionsIntoPracticeQaSections(looseQuestions));
  }

  if (!sections.length && sourceText) {
    const fromText = sanitizePracticeQaQuestions(extractWorksheetItemsFromPdfText(sourceText, 80));
    if (fromText.length) sections = groupQuestionsIntoPracticeQaSections(fromText);
  }

  const real_life_problem_solving_questions = sanitizePracticeQaQuestions(
    toPracticeQaQuestionArray(source.real_life_problem_solving_questions || source.real_life_questions).map(
      (q) => ({
        ...q,
        section: PRACTICE_QA_REAL_LIFE_SECTION,
      }),
    ),
  );

  const sectionQuestionRows = sections.flatMap((sec) =>
    (sec.questions || []).map((q) => ({ ...q, section: q.section || sec.sectionName })),
  );
  const questions = sanitizePracticeQaQuestions([
    ...sectionQuestionRows,
    ...real_life_problem_solving_questions,
  ]);

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
    sections: buildCanonicalPracticeQaSectionList(sections),
    real_life_problem_solving_questions,
    questions,
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
  const plain = (v) => stripMarkdownSyntax(String(v ?? '').trim());
  return {
    kind: 'homework',
    title: plain(h.title || 'Homework') || 'Homework',
    instructions: plain(h.instructions),
    practiceQuestions: Array.isArray(h.practice_questions) ? h.practice_questions : [],
    applicationTasks: toStringList(h.application_tasks).map((x) => stripMarkdownSyntax(x)),
    creativeThinkingQuestion: plain(h.creative_thinking_question),
    realLifeObservationTask: plain(h.real_life_observation_task),
    challengeQuestion: plain(h.challenge_question),
    supportHint: plain(h.support_hint),
    answerHints: plain(h.answer_hints),
    parentNote: plain(h.parent_note),
  };
}

const EXAM_CANONICAL_SECTION_LABELS = {
  section_a: 'Section A: MCQs',
  section_b: 'Section B: Very Short Answer Questions',
  section_c: 'Section C: Short Answer Questions',
  section_d: 'Section D: Long Answer Questions',
  section_e: 'Section E: Case-based / Competency Questions',
};

function examSectionIdFromLabel(name = '') {
  const n = String(name || '').trim().toLowerCase();
  if (/section\s*a\b|\bmcq|multiple\s*choice/.test(n)) return 'a';
  if (/section\s*b\b|very\s*short|vsa/.test(n)) return 'b';
  if (/section\s*c\b|short\s*answer/.test(n) && !/very\s*short|vsa/.test(n)) return 'c';
  if (/section\s*d\b|long\s*answer|essay/.test(n)) return 'd';
  if (/section\s*e\b|case|competency|competence/.test(n)) return 'e';
  if (/^questions?$/.test(n)) return '';
  return '';
}

function parseBlueprintSectionCounts(blueprint = '') {
  const text = String(blueprint || '');
  const pick = (letter) => {
    const m = text.match(new RegExp(`section\\s*${letter}[^\\d]*(\\d+)`, 'i'));
    return m ? Math.max(0, Number(m[1])) : 0;
  };
  const a = pick('a');
  const b = pick('b');
  const c = pick('c');
  const d = pick('d');
  const e = pick('e');
  if (a + b + c + d + e > 0) return { a, b, c, d, e };
  return { a: 4, b: 3, c: 3, d: 2, e: 1 };
}

function isExamAnswerKeyLineQuestion(q) {
  const t = String(q?.question || '').trim();
  if (!t) return true;
  if (/^Q\s*\d+\s*$/i.test(t)) return true;
  if (/^Q\s*\d+\s*\(/i.test(t) && t.length < 40) return true;
  if (/^section\s*[a-e]\s*:/i.test(t) && /\d+\s*marks?/i.test(t)) return true;
  if (/^#{1,3}\s*\d+\./.test(t)) return true;
  return false;
}

function normalizeExamDedupeKeyText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/\*\*/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function examQuestionDedupeKey(q) {
  const stem = normalizeExamDedupeKeyText(q?.question || '');
  const opts = Array.isArray(q?.options)
    ? q.options.map((o) => normalizeExamDedupeKeyText(o)).filter(Boolean).join('|')
    : '';
  const marks = q?.marks != null ? String(q.marks) : '';
  return `${stem}|${opts}|${marks}`;
}

function stripExamPaperDumpFromQuestionText(text = '') {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return '';

  // If the model pasted another full paper into a question, truncate at the first
  // obvious "paper boundary" marker.
  const boundaryAnywhereRe =
    /(?:section\s*[a-e]\s*:|internal\s+choices\b|marking\s+scheme\b|rubric\s+for\s+open|complete\s+answer\s+key\b|blueprint\b|total\s+marks\b)/i;

  const idx = raw.search(boundaryAnywhereRe);
  if (idx >= 0 && idx > 12) {
    return raw.slice(0, idx).trim();
  }

  // Fallback: line-wise boundary detection.
  const lines = raw.split('\n');
  const lineBoundaryRe =
    /^\s*(?:#{1,4}\s*)?(?:section\s*[a-e]\s*:|internal\s+choices\b|marking\s+scheme\b|rubric\s+for\s+open|complete\s+answer\s+key\b|blueprint\b|total\s+marks\b)/i;
  const firstBoundaryIdx = lines.findIndex((l, idx) => idx > 0 && lineBoundaryRe.test(String(l || '').trim()));
  const kept = (firstBoundaryIdx >= 0 ? lines.slice(0, firstBoundaryIdx) : lines).join('\n');
  return kept.trim();
}

function dedupeExamQuestionRows(questions = []) {
  const seen = new Set();
  const out = [];
  for (const q of toQuestionArray(questions)) {
    if (isExamAnswerKeyLineQuestion(q)) continue;
    const cleaned = {
      ...q,
      question: stripExamPaperDumpFromQuestionText(q.question || ''),
    };
    const key = examQuestionDedupeKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/** Split a flat question list into section_a..e using blueprint counts (order preserved). */
export function redistributeExamPaperToCanonicalSections(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  const buckets = {
    section_a: [],
    section_b: [],
    section_c: [],
    section_d: [],
    section_e: [],
  };
  const loose = [];

  for (const key of Object.keys(buckets)) {
    if (Array.isArray(source[key])) {
      buckets[key].push(...dedupeExamQuestionRows(source[key]));
    }
  }
  if (Array.isArray(source.sections)) {
    for (const sec of source.sections) {
      if (!sec || typeof sec !== 'object') continue;
      const name = String(sec.sectionName || sec.name || sec.title || '').trim();
      const sid = examSectionIdFromLabel(name);
      const qs = dedupeExamQuestionRows(sec.questions || []);
      if (!qs.length) continue;
      if (sid) buckets[`section_${sid}`].push(...qs);
      else loose.push(...qs);
    }
  }

  let all = dedupeExamQuestionRows([
    ...loose,
    ...buckets.section_a,
    ...buckets.section_b,
    ...buckets.section_c,
    ...buckets.section_d,
    ...buckets.section_e,
  ]);

  const filled = Object.values(buckets).filter((arr) => arr.length > 0).length;
  const onlyOneBucket =
    filled <= 1 &&
    all.length >= 3 &&
    (loose.length > 0 || buckets.section_a.length === all.length);

  if (onlyOneBucket || loose.length > 0) {
    for (const key of Object.keys(buckets)) buckets[key] = [];
    const counts = parseBlueprintSectionCounts(source.blueprint);
    const sorted = [...all].sort(
      (a, b) => Number(a.question_number || 0) - Number(b.question_number || 0),
    );
    let idx = 0;
    const take = (n, key) => {
      const slice = sorted.slice(idx, idx + n);
      idx += n;
      buckets[key] = slice.map((q, i) => ({
        ...q,
        question_number: q.question_number ?? idx - slice.length + i + 1,
      }));
    };
    take(counts.a, 'section_a');
    take(counts.b, 'section_b');
    take(counts.c, 'section_c');
    take(counts.d, 'section_d');
    take(counts.e, 'section_e');
    if (idx < sorted.length) {
      buckets.section_e = [...buckets.section_e, ...sorted.slice(idx)];
    }
    all = Object.values(buckets).flat();
  }

  const sections = Object.entries(EXAM_CANONICAL_SECTION_LABELS).map(([key, sectionName]) => ({
    sectionName,
    questions: dedupeExamQuestionRows(buckets[key]),
    count: buckets[key].length,
  }));

  return {
    ...source,
    section_a: buckets.section_a,
    section_b: buckets.section_b,
    section_c: buckets.section_c,
    section_d: buckets.section_d,
    section_e: buckets.section_e,
    sections,
  };
}

/** Group flat exam question rows by PDF section label (Section A, MCQs, etc.). */
export function groupQuestionsIntoExamSections(questions = []) {
  const cleaned = dedupeExamQuestionRows(sanitizeWorksheetQuestions(toQuestionArray(questions)));
  const map = new Map();
  for (const q of cleaned) {
    const label = String(q.section || q.sectionName || '').trim();
    const sid = examSectionIdFromLabel(label);
    const sectionName = sid
      ? EXAM_CANONICAL_SECTION_LABELS[`section_${sid}`]
      : label || 'Questions';
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
  const bucketMap = {
    a: { sectionName: EXAM_CANONICAL_SECTION_LABELS.section_a, questions: [] },
    b: { sectionName: EXAM_CANONICAL_SECTION_LABELS.section_b, questions: [] },
    c: { sectionName: EXAM_CANONICAL_SECTION_LABELS.section_c, questions: [] },
    d: { sectionName: EXAM_CANONICAL_SECTION_LABELS.section_d, questions: [] },
    e: { sectionName: EXAM_CANONICAL_SECTION_LABELS.section_e, questions: [] },
  };
  const loose = [];

  for (const sec of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    if (!sec || typeof sec !== 'object') continue;
    const name = String(sec.sectionName || sec.name || sec.title || '').trim();
    const sid = examSectionIdFromLabel(name);
    const qs = dedupeExamQuestionRows(sec.questions || []);
    if (!qs.length) continue;
    if (sid && bucketMap[sid]) bucketMap[sid].questions.push(...qs);
    else if (name) loose.push(...qs.map((q) => ({ ...q, section: name })));
    else loose.push(...qs);
  }

  const sections = Object.values(bucketMap)
    .filter((b) => b.questions.length > 0)
    .map((b) => ({
      sectionName: b.sectionName,
      questions: b.questions,
      count: b.questions.length,
    }));

  if (loose.length) {
    sections.push({
      sectionName: 'Questions',
      questions: loose,
      count: loose.length,
    });
  }

  return redistributeExamPaperToCanonicalSections({ sections }).sections;
}

/** Exam paper PDF / generator → 11-section template + sections A–E. */
export function normalizeExamPaperStructuredContent(raw, sourceText = '') {
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

  if (Array.isArray(source.question_paper) && source.question_paper.length) {
    sections = mergeExamPaperSections(
      sections,
      groupQuestionsIntoExamSections(toQuestionArray(source.question_paper)),
    );
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
              : 'Section E: Case-based / Competency Questions';
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

  const questionPaperRaw = source.question_paper ?? source.questionPaper;
  if (!sections.length && questionPaperRaw != null) {
    if (Array.isArray(questionPaperRaw)) {
      const fromArray = toQuestionArray(questionPaperRaw);
      if (fromArray.length) {
        sections = mergeExamPaperSections(sections, groupQuestionsIntoExamSections(fromArray));
      }
    } else if (typeof questionPaperRaw === 'object') {
      const qp = questionPaperRaw;
      if (Array.isArray(qp.sections) && qp.sections.length) {
        sections = mergeExamPaperSections(sections, qp.sections);
      }
      const qpQuestions = toQuestionArray(qp.questions || []);
      if (qpQuestions.length) {
        sections = mergeExamPaperSections(sections, groupQuestionsIntoExamSections(qpQuestions));
      }
      for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {
        if (Array.isArray(qp[key]) && qp[key].length) {
          sections = mergeExamPaperSections(
            sections,
            groupQuestionsIntoExamSections(toQuestionArray(qp[key])),
          );
        }
      }
    } else {
      const questionPaperText = String(questionPaperRaw).trim();
      if (questionPaperText && questionPaperText !== '[object Object]') {
        const normalizedPaperText = questionPaperText
          .replace(/\*\*Q\s*(\d+)\.\*\*/gi, '\nQ$1. ')
          .replace(/\*\*([^*]+)\*\*/g, '$1');
        let parsed = sanitizeWorksheetQuestions(
          extractWorksheetItemsFromPdfText(normalizedPaperText, 40),
        );
        if (!parsed.length) {
          parsed = sanitizeWorksheetQuestions(extractQuestionsFromText(normalizedPaperText));
        }
        if (parsed.length) {
          sections = mergeExamPaperSections(sections, groupQuestionsIntoExamSections(parsed));
        }
      }
    }
  }

  if (!sections.length && sourceText) {
    const normalizedSource = String(sourceText)
      .replace(/\*\*Q\s*(\d+)\.\*\*/gi, '\nQ$1. ')
      .replace(/\*\*([^*]+)\*\*/g, '$1');
    const parsed = sanitizeWorksheetQuestions(extractWorksheetItemsFromPdfText(normalizedSource, 40));
    if (parsed.length) {
      sections = mergeExamPaperSections(sections, groupQuestionsIntoExamSections(parsed));
    }
  }

  const sectionQuestionBuckets = {
    section_a: [],
    section_b: [],
    section_c: [],
    section_d: [],
    section_e: [],
  };
  for (const sec of sections) {
    const name = String(sec?.sectionName || sec?.name || '').trim().toLowerCase();
    const questions = toQuestionArray(sec?.questions || []);
    if (!questions.length) continue;
    if (/^section\s*a|mcq|multiple\s*choice/.test(name)) {
      sectionQuestionBuckets.section_a.push(...questions);
    } else if (/^section\s*b|very\s*short|vsa/.test(name)) {
      sectionQuestionBuckets.section_b.push(...questions);
    } else if (/^section\s*c|short\s*answer/.test(name) && !/very\s*short|vsa/.test(name)) {
      sectionQuestionBuckets.section_c.push(...questions);
    } else if (/^section\s*d|long\s*answer|essay/.test(name)) {
      sectionQuestionBuckets.section_d.push(...questions);
    } else if (/^section\s*e|case|competency|competence/.test(name)) {
      sectionQuestionBuckets.section_e.push(...questions);
    }
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

  const normalized = redistributeExamPaperToCanonicalSections({
    ...source,
    title: paperTitle || source.title || 'Exam Paper',
    paper_title: paperTitle || source.paper_title || 'Exam Paper',
    instructions,
    blueprint,
    sections,
    section_a: sectionQuestionBuckets.section_a,
    section_b: sectionQuestionBuckets.section_b,
    section_c: sectionQuestionBuckets.section_c,
    section_d: sectionQuestionBuckets.section_d,
    section_e: sectionQuestionBuckets.section_e,
    internal_choices: internalChoices,
    answer_key: answerKeyOut,
    marking_scheme: markingScheme,
    open_ended_rubric: openEndedRubric,
    total_marks: source.total_marks ?? source.totalMarks,
    estimated_time: source.estimated_time ?? source.estimatedTime ?? source.duration,
  });

  return normalized;
}

function countExamPaperQuestions(data) {
  return countMockTestQuestions(data);
}

/** Curriculum-backed exam questions when the model returns too few items. */
function buildScaffoldExamQuestions(meta = {}, blueprint = '') {
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const counts = parseBlueprintSectionCounts(blueprint);
  const buckets = { section_a: [], section_b: [], section_c: [], section_d: [], section_e: [] };
  let n = 1;
  for (let i = 0; i < counts.a; i += 1) {
    buckets.section_a.push({
      question_number: n++,
      question: `Which of the following best describes ${topic}? (MCQ ${i + 1})`,
      options: [
        'A) Belief without evidence',
        'B) Systematic observation and evidence',
        'C) Superstition only',
        'D) Unquestioned tradition',
      ],
      answer: 'B) Systematic observation and evidence',
      marks: 1,
    });
  }
  for (let i = 0; i < counts.b; i += 1) {
    buckets.section_b.push({
      question_number: n++,
      question: `Define one key term related to ${topic}. (VSA ${i + 1})`,
      answer: `A concise definition using evidence about ${topic}.`,
      marks: 2,
    });
  }
  for (let i = 0; i < counts.c; i += 1) {
    buckets.section_c.push({
      question_number: n++,
      question: `Explain how ${topic} applies in daily life. (SA ${i + 1})`,
      answer: `Students give a reasoned example connected to ${topic}.`,
      marks: 3,
    });
  }
  for (let i = 0; i < counts.d; i += 1) {
    buckets.section_d.push({
      question_number: n++,
      question: `Describe the process of scientific inquiry for ${topic}. (LA ${i + 1})`,
      answer: `A step-by-step explanation with observation, hypothesis, and evidence for ${topic}.`,
      marks: 5,
    });
  }
  for (let i = 0; i < counts.e; i += 1) {
    buckets.section_e.push({
      question_number: n++,
      question: `Case study on ${topic}: read the scenario and answer parts (a)–(d).`,
      answer: `Answers use evidence from the scenario and concepts from ${topic}.`,
      marks: 6,
    });
  }
  return buckets;
}

/** Parse questions from prose when section arrays are missing. */
export function repairExamPaperStructuredContent(raw, meta = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const textBlob = collectMockTestParseableText(source);
  let out = normalizeExamPaperStructuredContent(source, textBlob);

  if (countExamPaperQuestions(out) < 3 && textBlob) {
    const normalized = textBlob
      .replace(/\*\*Q\s*(\d+)\.\*\*/gi, '\nQ$1. ')
      .replace(/\*\*Q\.\*\*/gi, '\nQ. ')
      .replace(/\*\*([^*]+)\*\*/g, '$1');
    let parsed = sanitizeWorksheetQuestions(extractWorksheetItemsFromPdfText(normalized, 40));
    if (!parsed.length) {
      parsed = sanitizeWorksheetQuestions(extractQuestionsFromText(normalized));
    }
    if (parsed.length) {
      out = normalizeExamPaperStructuredContent(
        { ...source, sections: groupQuestionsIntoExamSections(parsed) },
        textBlob,
      );
    }
  }

  if (countExamPaperQuestions(out) < 3 && Array.isArray(source.questions)) {
    const rows = toQuestionArray(source.questions);
    if (rows.length) {
      out = normalizeExamPaperStructuredContent(
        { ...source, sections: groupQuestionsIntoExamSections(rows) },
        textBlob,
      );
    }
  }

  for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {
    if (countExamPaperQuestions(out) >= 3) break;
    if (Array.isArray(source[key]) && source[key].length) {
      out = normalizeExamPaperStructuredContent({ ...out, [key]: source[key] }, textBlob);
    }
  }

  return out;
}

/** @returns {string[]} Missing Exam Question Paper requirements (11-section template). */
export function getExamPaperMissingSections(data, meta = {}) {
  const n = finalizeExamPaperStructuredContent(data, meta);
  const missing = [];
  if (!String(n.paper_title || n.title || '').trim()) {
    missing.push('1. Paper Title and General Instructions');
  }
  if (!String(n.instructions || '').trim()) {
    missing.push('1. Paper Title — general instructions');
  }
  if (!String(n.blueprint || '').trim()) missing.push('2. Blueprint / Design Grid');
  const qCount = countExamPaperQuestions(n);
  if (qCount < 3) missing.push('3–7. Question Paper Sections (min 3 questions across sections A–E)');
  if (!String(n.internal_choices || '').trim()) missing.push('8. Internal Choices');
  if (!String(n.answer_key || '').trim()) missing.push('9. Complete Answer Key');
  if (!String(n.marking_scheme || '').trim()) missing.push('10. Detailed Marking Scheme');
  if (!String(n.open_ended_rubric || '').trim()) {
    missing.push('11. Rubric for Open-ended Questions');
  }
  return missing;
}

export function examPaperStructuredContentIsComplete(data, meta = {}) {
  return getExamPaperMissingSections(data, meta).length === 0;
}

/** Map mock-test-shaped Gemini output into exam paper fields; pad all 11 sections. */
export function finalizeExamPaperStructuredContent(structuredContent, meta = {}) {
  const source =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? { ...structuredContent }
      : {};
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();

  let base = repairExamPaperStructuredContent(source, meta);

  const pickArr = (key) => {
    const fromBase = base[key];
    const fromSource = source[key];
    if (Array.isArray(fromBase) && fromBase.length) return fromBase;
    if (Array.isArray(fromSource) && fromSource.length) return fromSource;
    return fromBase || fromSource;
  };

  const mapped = {
    ...base,
    paper_title: base.paper_title || source.paper_title || source.mock_test_title || source.exam_title || source.title,
    title: base.title || source.title || source.paper_title || source.mock_test_title,
    instructions:
      base.instructions ||
      source.instructions ||
      source.general_instructions ||
      source.test_purpose_subtopic_link ||
      source.test_purpose,
    blueprint: base.blueprint || source.blueprint || source.design_grid || source.blueprint_grid,
    internal_choices: base.internal_choices || source.internal_choices || source.internal_choice,
    answer_key: base.answer_key || source.answer_key || source.answerKey || source.answers,
    marking_scheme: base.marking_scheme || source.marking_scheme || source.markingScheme,
    open_ended_rubric:
      base.open_ended_rubric ||
      source.open_ended_rubric ||
      source.openEndedRubric ||
      source.rubric_open,
    sections: pickArr('sections'),
    section_a: pickArr('section_a'),
    section_b: pickArr('section_b'),
    section_c: pickArr('section_c'),
    section_d: pickArr('section_d'),
    section_e: pickArr('section_e'),
    questions: pickArr('questions') || source.questions,
    question_paper: base.question_paper || source.question_paper,
  };

  base = normalizeExamPaperStructuredContent(mapped);

  // Extra hardening: strip accidental pasted "second paper" dumps and trim to blueprint counts.
  const counts = parseBlueprintSectionCounts(base.blueprint);
  const trimTo = (arr, n) => (Array.isArray(arr) ? arr.slice(0, Math.max(0, n)) : []);
  const cleanAndTrim = (arr, n) => trimTo(dedupeExamQuestionRows(arr), n);
  base.section_a = cleanAndTrim(base.section_a, counts.a);
  base.section_b = cleanAndTrim(base.section_b, counts.b);
  base.section_c = cleanAndTrim(base.section_c, counts.c);
  base.section_d = cleanAndTrim(base.section_d, counts.d);
  base.section_e = cleanAndTrim(base.section_e, counts.e);
  base.sections = Object.entries(EXAM_CANONICAL_SECTION_LABELS).map(([key, sectionName]) => ({
    sectionName,
    questions: base[key] || [],
  }));

  const title = String(base.paper_title || base.title || '').trim();
  if (!title || title === 'Exam Paper' || /^mock\s*test$/i.test(title)) {
    base.paper_title = `${topic} — ${subject} Examination Paper`;
    base.title = base.paper_title;
  }
  if (!String(base.instructions || '').trim()) {
    base.instructions = `Read all instructions carefully. Answer every question in the space provided. Content focus: ${topic}.`;
  }
  if (!String(base.blueprint || '').trim()) {
    base.blueprint = `Blueprint: Section A MCQs on ${topic}; Section B very short answers; Section C short answers; Section D long answers; Section E case-based competency.`;
  }
  if (!String(base.internal_choices || '').trim()) {
    base.internal_choices = `Where OR is shown, attempt one question only. Internal choice applies in Sections D and E where marked.`;
  }
  if (!String(base.marking_scheme || '').trim()) {
    base.marking_scheme = `Award marks for correct concept, working, and units. Deduct for missing steps only when specified. Topic: ${topic}.`;
  }
  if (!String(base.open_ended_rubric || '').trim()) {
    base.open_ended_rubric = `Level 4: Complete, accurate, well-explained; Level 3: Mostly correct; Level 2: Partial; Level 1: Minimal understanding of ${topic}.`;
  }

  if (countExamPaperQuestions(base) < 3) {
    const scaffold = buildScaffoldExamQuestions(meta, base.blueprint);
    base = normalizeExamPaperStructuredContent({
      ...base,
      ...scaffold,
      sections: Object.entries(EXAM_CANONICAL_SECTION_LABELS).map(([key, sectionName]) => ({
        sectionName,
        questions: scaffold[key] || [],
      })),
    });
  }

  const finalized = normalizeExamPaperStructuredContent(base);
  if (!String(finalized.answer_key || '').trim()) {
    const lines = [];
    for (const sec of finalized.sections || []) {
      for (const q of sec.questions || []) {
        if (String(q.answer || '').trim()) {
          const n = q.question_number != null ? `Q${q.question_number}` : 'Q';
          lines.push(`${n}: ${q.answer}`);
        }
      }
    }
    if (lines.length) finalized.answer_key = lines.join('\n');
  }
  return finalized;
}

function countMockTestQuestions(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  if (String(data.question || '').trim()) return 1;
  let n = 0;
  if (Array.isArray(data.sections)) {
    n += data.sections.reduce((acc, s) => acc + toQuestionArray(s?.questions || []).length, 0);
  }
  for (const key of ['section_a', 'section_b', 'section_c', 'section_d', 'section_e']) {
    if (Array.isArray(data[key])) n += toQuestionArray(data[key]).length;
  }
  if (Array.isArray(data.questions)) n += toQuestionArray(data.questions).length;
  return n;
}

/** Prefer populated mock-test fields when Gemini splits data across root and structuredContent. */
function mergeMockTestStructuredLayers(coerced = {}, fromStructured = {}) {
  const out = { ...fromStructured, ...coerced };
  const arrayKeys = [
    'sections',
    'section_a',
    'section_b',
    'section_c',
    'section_d',
    'section_e',
    'questions',
    'learning_objectives',
    'remedial_revision_suggestions',
    'expected_learning_outcomes',
  ];
  for (const key of arrayKeys) {
    const a = Array.isArray(coerced[key]) ? coerced[key] : [];
    const b = Array.isArray(fromStructured[key]) ? fromStructured[key] : [];
    if (a.length && !b.length) out[key] = a;
    else if (b.length && !a.length) out[key] = b;
    else if (a.length && b.length) out[key] = a.length >= b.length ? a : b;
  }
  for (const key of [
    'mock_test_title',
    'paper_title',
    'title',
    'question_paper',
    'instructions',
    'answer_key',
    'step_by_step_solutions_explanations',
  ]) {
    const a = String(coerced[key] ?? '').trim();
    const b = String(fromStructured[key] ?? '').trim();
    if (a && !b) out[key] = coerced[key];
    else if (b && !a) out[key] = fromStructured[key];
    else if (b.length > a.length) out[key] = fromStructured[key];
    else if (a) out[key] = coerced[key];
  }
  return out;
}

function collectMockTestParseableText(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  const parts = [];
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length > 15) parts.push(t);
    return parts.join('\n');
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const chunk = collectMockTestParseableText(item, depth + 1);
      if (chunk) parts.push(chunk);
    }
    return parts.join('\n\n');
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'performance_self_analysis_table' || k === 'self_analysis_table') continue;
      const chunk = collectMockTestParseableText(v, depth + 1);
      if (chunk) parts.push(chunk);
    }
  }
  return parts.join('\n\n');
}

/** Parse questions from prose / loose JSON when section arrays are missing. */
export function repairMockTestStructuredContent(raw, meta = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const textBlob = collectMockTestParseableText(source);
  let out = normalizeMockTestStructuredContent(source, textBlob);

  if (countMockTestQuestions(out) === 0 && textBlob) {
    const normalized = textBlob
      .replace(/\*\*Q\s*(\d+)\.\*\*/gi, '\nQ$1. ')
      .replace(/\*\*([^*]+)\*\*/g, '$1');
    let parsed = sanitizeWorksheetQuestions(extractWorksheetItemsFromPdfText(normalized, 35));
    if (!parsed.length) {
      parsed = sanitizeWorksheetQuestions(extractQuestionsFromText(normalized));
    }
    if (parsed.length) {
      out = normalizeMockTestStructuredContent(
        {
          ...source,
          section_a: parsed.map((q, i) => ({
            question_number: i + 1,
            question: q.question,
            options: q.options || [],
            answer: q.answer || '',
            marks: 1,
            section: q.section || 'Section A: MCQs',
          })),
        },
        textBlob,
      );
    }
  }

  if (countMockTestQuestions(out) === 0 && Array.isArray(source.questions)) {
    const rows = toQuestionArray(source.questions);
    if (rows.length) {
      out = normalizeMockTestStructuredContent(
        {
          ...source,
          section_a: rows.map((q, i) => ({
            question_number: q.question_number ?? i + 1,
            question: q.question,
            options: q.options || [],
            answer: q.answer || '',
            marks: q.marks ?? 1,
          })),
        },
        textBlob,
      );
    }
  }

  return out;
}

/** Ensure mock test has a title and parsed questions before validation. */
export function finalizeMockTestStructuredContent(raw, meta = {}) {
  let out = repairMockTestStructuredContent(raw, meta);
  if (countMockTestQuestions(out) < 3) {
    const scaffold = buildScaffoldExamQuestions(meta, out.blueprint || '');
    out = normalizeMockTestStructuredContent({ ...out, ...scaffold }, collectMockTestParseableText(out));
  }
  let mockTitle = String(out.mock_test_title || out.paper_title || out.title || '').trim();
  const paperTitle = String(out.paper_title || out.title || '').trim();
  const isGenericPlaceholder = !paperTitle || /^exam paper$/i.test(paperTitle);
  if (!mockTitle && (!paperTitle || isGenericPlaceholder)) {
    const label = [meta.topic, meta.subTopic].filter(Boolean).join(' — ').trim() || 'Mock Test';
    mockTitle = `Mock Test: ${label}`;
    out = { ...out, mock_test_title: mockTitle, paper_title: mockTitle, title: mockTitle };
  } else if (!mockTitle && paperTitle) {
    out = { ...out, mock_test_title: paperTitle, title: paperTitle };
  }
  return out;
}

/** Mock Test Builder (student) — 12-section format with remedial guidance and reflection. */
export function normalizeMockTestStructuredContent(raw, sourceText = '') {
  const base = normalizeExamPaperStructuredContent(raw, sourceText);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const toList = (value) =>
    Array.isArray(value)
      ? value.map((v) => String(v || '').trim()).filter(Boolean)
      : String(value || '')
          .split(/\n|;/)
          .map((v) => v.trim())
          .filter(Boolean);

  const mock_test_title = String(
    source.mock_test_title || source.paper_title || base.paper_title || base.title || '',
  ).trim();
  const sections = Array.isArray(base.sections) ? base.sections : [];
  const questionCount = sections.reduce(
    (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
    0,
  );

  let answer_key = String(base.answer_key || source.answer_key || '').trim();
  if (!answer_key && questionCount > 0) {
    const keyLines = formatMockTestAnswerKeyLinesFromSections(sections);
    if (keyLines.length) answer_key = keyLines.join('\n');
  }

  let step_by_step_solutions_explanations = String(
    source.step_by_step_solutions_explanations ||
      source.solutions ||
      source.explanations ||
      '',
  ).trim();
  if (!step_by_step_solutions_explanations && questionCount > 0) {
    step_by_step_solutions_explanations = buildMockTestSolutionsFromSections(sections);
  }

  return {
    ...base,
    answer_key: answer_key || base.answer_key,
    mock_test_title: mock_test_title || undefined,
    title: mock_test_title || base.title,
    paper_title: mock_test_title || base.paper_title,
    test_purpose_subtopic_link: String(
      source.test_purpose_subtopic_link || source.test_purpose || source.subtopic_link || '',
    ).trim() || undefined,
    learning_objectives: toList(source.learning_objectives || source.objectives),
    ncf_competency_alignment: String(
      source.ncf_competency_alignment || source.learning_outcome_alignment || '',
    ).trim() || undefined,
    step_by_step_solutions_explanations: step_by_step_solutions_explanations || undefined,
    remedial_revision_suggestions: toList(
      source.remedial_revision_suggestions ||
        source.revision_suggestions ||
        source.remedial_suggestions,
    ),
    expected_learning_outcomes: toList(source.expected_learning_outcomes),
    real_life_application: String(
      source.real_life_application || source.real_life_connections || '',
    ).trim() || undefined,
    reflection_exit_ticket: String(
      source.reflection_exit_ticket || source.reflection || source.exit_ticket || '',
    ).trim() || undefined,
  };
}

export function canonicalizeExamPaperExtractedItem(raw, toolSlug = 'exam-question-paper-generator') {
  const slug = String(toolSlug || '').trim();
  if (slug === 'mock-test-builder') return normalizeMockTestStructuredContent(raw);
  return normalizeExamPaperStructuredContent(raw);
}

/** Viewer payload for Mock Test Builder (student). */
export function buildMockTestRenderableFromStructured(source) {
  const mt = normalizeMockTestStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  const base = buildExamPaperRenderableFromStructured(mt);
  return {
    ...base,
    kind: 'mockTest',
    variant: 'student',
    mockTestTitle: String(mt.mock_test_title || mt.paper_title || '').trim(),
    testPurposeSubtopicLink: String(mt.test_purpose_subtopic_link || '').trim(),
    learningObjectives: toStringList(mt.learning_objectives),
    ncfCompetencyAlignment: String(mt.ncf_competency_alignment || '').trim(),
    stepByStepSolutionsExplanations: String(mt.step_by_step_solutions_explanations || '').trim(),
    remedialRevisionSuggestions: toStringList(mt.remedial_revision_suggestions),
    expectedLearningOutcomes: toStringList(mt.expected_learning_outcomes),
    realLifeApplication: String(mt.real_life_application || '').trim(),
    reflectionExitTicket: String(mt.reflection_exit_ticket || '').trim(),
  };
}

/** Viewer payload for one Exam Question Paper row (PDF extract or generator). */
export function buildExamPaperRenderableFromStructured(source) {
  const ex = normalizeExamPaperStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
  );
  return {
    kind: 'examPaper',
    variant: 'teacher',
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

function rubricTextFilled(value) {
  const t = String(value ?? '').trim();
  return t.length > 2 && !/^(n\/?a|tbd|todo|pending|none|null|—+|\.\.\.)$/i.test(t);
}

function rubricCriterionRowIsComplete(row) {
  if (!row || typeof row !== 'object') return false;
  return (
    rubricTextFilled(row.name) &&
    rubricTextFilled(row.excellent) &&
    rubricTextFilled(row.good) &&
    rubricTextFilled(row.satisfactory) &&
    rubricTextFilled(row.needs_improvement)
  );
}

/** Rubrics / report card PDF rows → 10-section template + criteria grid. */
export function normalizeRubricStructuredContent(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const criteriaRaw = [
    ...(Array.isArray(source.criteria) ? source.criteria : []),
    ...(Array.isArray(source.rubric_criteria) ? source.rubric_criteria : []),
    ...(Array.isArray(source.evaluation_rubric) ? source.evaluation_rubric : []),
  ];
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
      source.next_step_remedial_enrichment ||
        source.next_steps ||
        source.remedial_enrichment ||
        source.enrichment_activity ||
        '',
    ).trim(),
  };
}

/** @returns {string[]} Human-readable missing section labels for rubric validation / retries. */
export function getRubricMissingSections(data) {
  const r = normalizeRubricStructuredContent(data && typeof data === 'object' ? data : {});
  const missing = [];
  const scalarChecks = [
    ['assessment_purpose', '1. Assessment Purpose'],
    ['competency_assessed', '2. Competency / Learning Outcome Assessed'],
    ['grading_criteria', '4. Grading Criteria'],
    ['strengths_observed', '5. Strengths Observed'],
    ['areas_for_improvement', '6. Areas for Improvement'],
    ['teacher_remarks', '7. Teacher Remarks'],
    ['actionable_suggestions', '8. Actionable Improvement Suggestions'],
    ['parent_friendly_feedback', '9. Parent-friendly Feedback'],
    ['next_step_remedial_enrichment', '10. Next-step Remedial / Enrichment Activity'],
  ];
  for (const [key, label] of scalarChecks) {
    if (!rubricTextFilled(r[key])) missing.push(label);
  }
  const completeCriteria = (Array.isArray(r.criteria) ? r.criteria : []).filter(rubricCriterionRowIsComplete);
  if (completeCriteria.length < 3) {
    missing.push(
      '3. Evaluation Rubric with 4 Performance Levels (min 3 criteria; each needs Excellent, Good, Satisfactory, Needs Improvement)',
    );
  }
  return missing;
}

export function rubricStructuredContentIsComplete(data) {
  return getRubricMissingSections(data).length === 0;
}

/** Pad derivable rubric narrative fields; does not invent full criteria grid. */
export function finalizeRubricStructuredContent(structuredContent, meta = {}) {
  const s = normalizeRubricStructuredContent(
    structuredContent && typeof structuredContent === 'object' ? structuredContent : {},
  );
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const completeCriteria = (Array.isArray(s.criteria) ? s.criteria : []).filter(rubricCriterionRowIsComplete);

  if (!rubricTextFilled(s.grading_criteria) && completeCriteria.length) {
    s.grading_criteria =
      'Each criterion is scored on a 4-level scale: Excellent, Good, Satisfactory, and Needs Improvement. Overall performance reflects mastery of the competency assessed across all criteria.';
  }

  if (!rubricTextFilled(s.actionable_suggestions) && rubricTextFilled(s.areas_for_improvement)) {
    s.actionable_suggestions = `Focus on the identified improvement areas: ${s.areas_for_improvement} Use short guided practice, peer discussion, and a brief self-check quiz on ${topic} before the next assessment.`;
  }

  if (!rubricTextFilled(s.next_step_remedial_enrichment)) {
    if (rubricTextFilled(s.areas_for_improvement)) {
      s.next_step_remedial_enrichment = `Remedial: Targeted worksheet on ${topic} addressing weak areas noted above. Enrichment: Open-ended project connecting ${topic} to a real-life observation or interview task for advanced learners.`;
    } else {
      s.next_step_remedial_enrichment = `Enrichment: Extension investigation on ${topic} with a real-life application prompt for students who demonstrate Excellent on all rubric criteria.`;
    }
  }

  return s;
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
    ...(toolSlug === 'study-schedule-maker'
      ? [
          ...coerceBulletLines(source.study_plan_table),
          ...coerceBulletLines(source.studyPlanTable),
        ]
      : []),
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
    } else if (toolSlug === 'study-schedule-maker') {
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

  const lessonTitle = String(
    source.study_schedule_title || source.lesson_name || source.title || source.name || '',
  ).trim();

  const priorKnowledgeDiagnostic = String(
    source.prior_knowledge_readiness_check ||
      source.prior_knowledge_diagnostic ||
      source.diagnostic_question ||
      source.prior_knowledge ||
      '',
  ).trim();

  const introductionWarmup = String(
    source.introduction_warmup || source.warmup || source.warm_up || '',
  ).trim();

  const teachingStrategy = String(
    source.teaching_strategy || source.pedagogy || source.methodology_summary || '',
  ).trim();

  const differentiationPlan = String(
    source.support_extension_plan ||
      source.differentiation_plan ||
      source.differentiation ||
      source.udl_support ||
      '',
  ).trim();

  const homeworkPractice = String(
    source.homework_practice || source.homework || source.practice || '',
  ).trim();

  const closureExitTicket = String(
    source.reflection_exit_ticket ||
      source.closure_exit_ticket ||
      source.exit_ticket ||
      '',
  ).trim();

  const base = {
    ...source,
    lesson_name: lessonTitle || source.lesson_name,
    study_schedule_title: lessonTitle || source.study_schedule_title,
    title: String(source.title || lessonTitle || '').trim() || source.title,
    learning_objectives: objectives.length ? objectives : coerceBulletLines(source.learning_objectives),
    objectives,
    teaching_activities: activitiesOut,
    activities: activitiesOut,
    timeline,
    materials_required: materialsRequired,
    teaching_aids_required: teachingAidsRequired,
    ncf_competency_alignment: ncfCompetencyAlignment,
    prior_knowledge_diagnostic: priorKnowledgeDiagnostic,
    prior_knowledge_readiness_check: priorKnowledgeDiagnostic,
    introduction_warmup: introductionWarmup,
    teaching_strategy: teachingStrategy,
    teacher_talk_points: teacherTalkPoints,
    student_tasks: studentTasks,
    formative_assessment_questions: formativeAssessmentQuestions,
    differentiation_plan: differentiationPlan,
    homework_practice: homeworkPractice,
    closure_exit_ticket: closureExitTicket,
    assessment,
  };

  if (toolSlug !== 'study-schedule-maker') {
    return base;
  }

  const study_goal_subtopic_link = String(
    source.study_goal_subtopic_link || source.subtopic_link || source.subtopic || source.topic || '',
  ).trim();

  let study_plan_table = dedupeStringList([
    ...coerceBulletLines(source.study_plan_table),
    ...coerceBulletLines(source.studyPlanTable),
    ...timeline,
  ]);
  if (!study_plan_table.length && activitiesOut.length) {
    study_plan_table = activitiesOut.map((a, i) => `${i + 1}. ${a}`).slice(0, 40);
  }

  const concept_learning_slot = String(
    source.concept_learning_slot ||
      source.conceptLearningSlot ||
      [introductionWarmup, teachingStrategy, ...activitiesOut.slice(0, 12)].filter(Boolean).join('\n\n'),
  ).trim();

  const practice_slot = String(
    source.practice_slot ||
      source.practiceSlot ||
      [homeworkPractice, ...studentTasks].filter(Boolean).join('\n\n'),
  ).trim();

  const breaks_focus_tips = String(
    source.breaks_focus_tips || source.breaksFocusTips || introductionWarmup || '',
  ).trim();

  const self_assessment_checkpoint = String(
    source.self_assessment_checkpoint ||
      source.selfAssessmentCheckpoint ||
      formativeAssessmentQuestions.join('\n') ||
      assessment ||
      '',
  ).trim();

  if (!study_plan_table.length) {
    const synthesized = [];
    const goalLine = String(
      source.study_goal_subtopic_link || source.studyGoalSubtopicLink || '',
    ).trim();
    if (goalLine) synthesized.push(`Focus: ${goalLine}`);
    if (concept_learning_slot) synthesized.push(`Concept learning: ${concept_learning_slot}`);
    if (practice_slot) synthesized.push(`Practice: ${practice_slot}`);
    if (breaks_focus_tips) synthesized.push(`Breaks & focus: ${breaks_focus_tips}`);
    if (self_assessment_checkpoint) synthesized.push(`Self-assessment: ${self_assessment_checkpoint}`);
    if (synthesized.length) study_plan_table = synthesized;
  }

  const support_extension_plan = differentiationPlan;

  const expected_learning_outcomes = dedupeStringList([
    ...coerceBulletLines(source.expected_learning_outcomes),
    ...coerceBulletLines(source.learning_outcomes),
  ]);

  const reflection_exit_ticket = closureExitTicket;

  return {
    ...base,
    study_schedule_title: lessonTitle || 'Study Schedule',
    study_goal_subtopic_link,
    prior_knowledge_readiness_check: priorKnowledgeDiagnostic,
    study_plan_table,
    concept_learning_slot,
    practice_slot,
    breaks_focus_tips,
    self_assessment_checkpoint,
    support_extension_plan,
    expected_learning_outcomes,
    reflection_exit_ticket,
  };
}

export function normalizeStudyScheduleStructuredContent(raw) {
  return normalizeLessonPlannerStructuredContent(raw, 'study-schedule-maker');
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

/** @returns {string[]} Missing Daily Class Plan sections (9-section template). */
export function getDailyClassPlanMissingSections(data) {
  const n = normalizeDailyClassPlanStructuredContent(data);
  const missing = [];
  if (!String(n.day_period_topic_breakup || n.title || '').trim()) {
    missing.push('1. Day / Period-wise Topic Break-up');
  }
  if (!Array.isArray(n.objectives) || n.objectives.length < 1) {
    missing.push('2. Learning Objective for Each Period (min 1)');
  }
  if (!Array.isArray(n.teaching_methods) || n.teaching_methods.length < 1) {
    missing.push('3. Teaching Method per Period (min 1)');
  }
  if (!Array.isArray(n.classroom_activity) || n.classroom_activity.length < 1) {
    missing.push('4. Classroom Activity / Demonstration (min 1)');
  }
  if (!String(n.exit_ticket || '').trim()) {
    missing.push('5. Quick Assessment / Exit Ticket');
  }
  if (!String(n.differentiated_support || '').trim()) {
    missing.push('6. Differentiated Support');
  }
  if (!String(n.homework_followup || '').trim()) {
    missing.push('7. Homework / Follow-up Task');
  }
  if (!Array.isArray(n.teaching_aids) || n.teaching_aids.length < 1) {
    missing.push('8. Required Teaching Aids (min 1)');
  }
  if (!String(n.teacher_reflection_notes || '').trim()) {
    missing.push('9. Teacher Reflection Notes');
  }
  return missing;
}

export function dailyClassPlanStructuredContentIsComplete(data) {
  return getDailyClassPlanMissingSections(data).length === 0;
}

/** Map lesson-shaped Gemini output into 9-section daily plan and pad gaps. */
export function finalizeDailyClassPlanStructuredContent(structuredContent, meta = {}) {
  const source =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? { ...structuredContent }
      : {};
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const subject = String(meta.subject || 'Science').trim();

  const mapped = {
    ...source,
    title: source.title || source.lesson_name || `${topic} — Daily Plan`,
    day_period_topic_breakup:
      source.day_period_topic_breakup ||
      source.topic_breakup ||
      source.lesson_name ||
      source.title ||
      `${topic} (${subject})`,
    objectives: dedupeStringList([
      ...coerceBulletLines(source.objectives),
      ...coerceBulletLines(source.period_objectives),
      ...coerceBulletLines(source.learning_objectives),
      ...coerceBulletLines(source.learningObjectives),
    ]),
    teaching_methods: dedupeStringList([
      ...coerceBulletLines(source.teaching_methods),
      ...coerceBulletLines(source.teaching_strategy),
      ...coerceBulletLines(source.methodology),
      ...coerceBulletLines(source.pedagogy),
      ...coerceBulletLines(source.introduction_warmup),
    ]),
    classroom_activity: dedupeStringList([
      ...coerceBulletLines(source.classroom_activity),
      ...coerceBulletLines(source.classroom_activities),
      ...coerceBulletLines(source.teaching_activities),
      ...coerceBulletLines(source.activities),
      ...coerceBulletLines(source.demonstration),
      ...coerceBulletLines(source.student_tasks),
    ]),
    exit_ticket: String(
      source.exit_ticket ||
        source.formative_check ||
        source.closure_exit_ticket ||
        source.quick_assessment ||
        (Array.isArray(source.formative_questions)
          ? source.formative_questions.join('\n')
          : '') ||
        '',
    ).trim(),
    differentiated_support: String(
      source.differentiated_support ||
        source.differentiation ||
        source.differentiation_plan ||
        source.support_extension_plan ||
        '',
    ).trim(),
    homework_followup: String(
      source.homework_followup ||
        source.homework ||
        source.homework_practice ||
        source.follow_up ||
        '',
    ).trim(),
    teaching_aids: dedupeStringList([
      ...coerceBulletLines(source.teaching_aids),
      ...coerceBulletLines(source.materials),
      ...coerceBulletLines(source.materials_required),
    ]),
    teacher_reflection_notes: String(
      source.teacher_reflection_notes ||
        source.reflection ||
        source.reflection_exit_ticket ||
        source.teacher_notes ||
        '',
    ).trim(),
    time_slots: source.time_slots,
    timeline: source.timeline,
  };

  let base = normalizeDailyClassPlanStructuredContent(mapped);

  if (!String(base.day_period_topic_breakup || '').trim()) {
    base.day_period_topic_breakup = `${topic} — period-wise plan for ${subject}.`;
  }
  if (!String(base.title || '').trim()) {
    base.title = base.day_period_topic_breakup;
  }
  if (!Array.isArray(base.objectives) || base.objectives.length < 1) {
    base.objectives = [
      `Students explain core ideas about ${topic}.`,
      `Students apply ${topic} using evidence from class examples.`,
    ];
  }
  if (!Array.isArray(base.teaching_methods) || base.teaching_methods.length < 1) {
    base.teaching_methods = [
      'Interactive discussion',
      'Demonstration',
      'Think-pair-share',
    ];
  }
  if (!Array.isArray(base.classroom_activity) || base.classroom_activity.length < 1) {
    base.classroom_activity = [
      `Hands-on observation or sorting task linked to ${topic}.`,
    ];
  }
  if (!String(base.exit_ticket || '').trim()) {
    base.exit_ticket = `Exit ticket: In one sentence, explain what makes ${topic} important in science.`;
  }
  if (!String(base.differentiated_support || '').trim()) {
    base.differentiated_support = `Support: sentence stems and visuals. Extension: students create two new examples for ${topic}.`;
  }
  if (!String(base.homework_followup || '').trim()) {
    base.homework_followup = `Review notes on ${topic} and answer two short questions in the notebook.`;
  }
  if (!Array.isArray(base.teaching_aids) || base.teaching_aids.length < 1) {
    base.teaching_aids = ['Whiteboard', 'Chart paper', 'Subject textbook'];
  }
  if (!String(base.teacher_reflection_notes || '').trim()) {
    base.teacher_reflection_notes = `Reflect on pacing and student responses during ${topic}; note one change for the next period.`;
  }
  if (!Array.isArray(base.time_slots) || !base.time_slots.length) {
    base.time_slots = base.objectives.slice(0, 4).map((obj, i) => ({
      time: `Period ${i + 1}`,
      activity: String(obj || '').trim(),
      type: i === 0 ? 'teach' : 'activity',
    }));
  }

  return normalizeDailyClassPlanStructuredContent(base);
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

/** Viewer payload for Study Schedule Maker / Lesson Planner row (PDF extract or generator). */
export function buildLessonPlanRenderableFromStructured(source, toolSlug = 'lesson-planner') {
  const lp = normalizeLessonPlannerStructuredContent(
    source && typeof source === 'object' && !Array.isArray(source) ? source : {},
    toolSlug,
  );
  const ncf = lp.ncf_competency_alignment;
  const title = String(lp.study_schedule_title || lp.lesson_name || lp.title || 'Study Schedule').trim();
  if (toolSlug === 'study-schedule-maker') {
    return {
      kind: 'lessonPlan',
      title,
      studyScheduleTitle: title,
      studyGoalSubtopicLink: String(lp.study_goal_subtopic_link || '').trim(),
      priorKnowledgeReadinessCheck: String(lp.prior_knowledge_readiness_check || '').trim(),
      objectives: toStringList(lp.objectives),
      ncfAlignment: Array.isArray(ncf) ? toStringList(ncf) : String(ncf || '').trim(),
      studyPlanTable: toStringList(lp.study_plan_table),
      conceptLearningSlot: String(lp.concept_learning_slot || '').trim(),
      practiceSlot: String(lp.practice_slot || '').trim(),
      breaksFocusTips: String(lp.breaks_focus_tips || '').trim(),
      selfAssessmentCheckpoint: String(lp.self_assessment_checkpoint || '').trim(),
      supportExtensionPlan: String(lp.support_extension_plan || '').trim(),
      expectedLearningOutcomes: toStringList(lp.expected_learning_outcomes),
      reflectionExitTicket: String(lp.reflection_exit_ticket || '').trim(),
      lesson_name: title,
      timeline: toStringList(lp.study_plan_table || lp.timeline),
    };
  }
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
  if (toolSlug === 'activity-project-generator' || toolSlug === 'project-idea-lab') {
    const normalized = normalizeActivityStructuredContent(source, toolSlug);
    return { normalizedStructuredContent: normalized };
  }
  if (toolSlug === 'lesson-planner' || toolSlug === 'study-schedule-maker') {
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
  if (toolSlug === 'reading-practice-room') {
    return { normalizedStructuredContent: normalizeReadingPracticeStructuredContent(source) };
  }
  if (toolSlug === 'story-passage-creator') {
    return { normalizedStructuredContent: normalizeStoryPassageStructuredContent(source) };
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
  if (toolSlug === 'mock-test-builder') {
    return { normalizedStructuredContent: normalizeMockTestStructuredContent(source, sourceText) };
  }
  if (toolSlug === 'exam-question-paper-generator') {
    return { normalizedStructuredContent: normalizeExamPaperStructuredContent(source, sourceText) };
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
  if (toolSlug === 'my-study-decks') {
    return { normalizedStructuredContent: normalizeMyStudyDecksStructuredContent(source) };
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
      const si = Array.isArray(data?.studentInstructions) ? data.studentInstructions : [];
      const si2 = Array.isArray(data?.student_instructions) ? data.student_instructions : [];
      const ar = Array.isArray(data?.assessmentRubric) ? data.assessmentRubric : [];
      const ar2 = Array.isArray(data?.assessment_criteria_rubric) ? data.assessment_criteria_rubric : [];
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
        si.length > 0 ||
        si2.length > 0 ||
        ar.length > 0 ||
        ar2.length > 0 ||
        exp.length > 8 ||
        rla.length > 8
      );
    },
    message:
      'Activity content must include at least one filled template section (materials, procedure, objectives, teacher notes, outcomes, rubric, or real-life application).',
  },
  'project-idea-lab': {
    allowedTypes: ['Activity Plan', 'Activity'],
    validate: (data) => {
      const steps = Array.isArray(data?.steps) ? data.steps : [];
      const materials = Array.isArray(data?.materials) ? data.materials : [];
      const lo = Array.isArray(data?.learningObjectives) ? data.learningObjectives : [];
      const lo2 = Array.isArray(data?.learning_objectives) ? data.learning_objectives : [];
      const safety = Array.isArray(data?.safety_care_instructions) ? data.safety_care_instructions : [];
      const rub = Array.isArray(data?.self_assessment_rubric) ? data.self_assessment_rubric : [];
      const exp = String(data?.learningOutcome || data?.expected_learning_outcomes || '').trim();
      const errOnlyPlaceholders =
        steps.length === 1 &&
        /^no structured steps were returned/i.test(String(steps[0] || '').trim());
      const hasUsableSteps = steps.length > 0 && !errOnlyPlaceholders;
      return (
        materials.length > 0 ||
        hasUsableSteps ||
        lo.length > 0 ||
        lo2.length > 0 ||
        safety.length > 0 ||
        rub.length > 0 ||
        exp.length > 8
      );
    },
    message:
      'Project Idea Lab content must include materials, student procedure, objectives, safety notes, rubric, or outcomes.',
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
      const talk = Array.isArray(data?.teacher_talk_points) ? data.teacher_talk_points.length : 0;
      const s = String(data?.assessment || '').trim().length;
      return o > 0 || a > 0 || t > 0 || talk > 0 || s > 24;
    },
    message:
      'Lesson plan must include at least one of: objectives, activities, timeline, teacher talk points, or assessment (from the PDF).',
  },
  'study-schedule-maker': {
    allowedTypes: ['Study Schedule', 'Lesson Plan'],
    validate: (data) => {
      const plan = Array.isArray(data?.study_plan_table) ? data.study_plan_table.length : 0;
      const t = Array.isArray(data?.timeline) ? data.timeline.length : 0;
      const o = Array.isArray(data?.objectives) ? data.objectives.length : 0;
      const concept = String(data?.concept_learning_slot || '').trim().length;
      const practice = String(data?.practice_slot || '').trim().length;
      return plan > 0 || t > 0 || o > 0 || concept > 12 || practice > 12;
    },
    message:
      'Study schedule must include a study plan table, objectives, concept slot, or practice slot.',
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
    validate: (data) => rubricStructuredContentIsComplete(data),
    message:
      'Rubric must include all 10 sections: purpose, competency, min 3 criteria with four performance levels each, grading criteria, strengths, improvements, remarks, actionable suggestions, parent feedback, and next-step activity.',
  },
  'reading-practice-room': {
    allowedTypes: ['Reading Practice', 'Story'],
    validate: (data) =>
      String(data?.passage || data?.content || '').trim().length > 0 ||
      String(data?.reading_practice_title || data?.title || '').trim().length > 0,
    message: 'Reading practice must include a non-empty passage or title.',
  },
  'story-passage-creator': {
    allowedTypes: ['Story', 'Reading Practice'],
    validate: (data) => storyPassageStructuredContentIsComplete(data),
    message:
      'Story and Passage Creator must include all 19 sections: full passage, objectives, vocabulary, three question sets (min 2 each), answer key, and reflection.',
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
  'my-study-decks': {
    allowedTypes: ['Flashcards'],
    validate: (data) => flashcardDeckStructuredContentIsComplete(data, 'my-study-decks'),
    message: 'My Study Decks must include at least 5 flashcards with non-empty front and back values.',
  },
  'flashcard-generator': {
    allowedTypes: ['Flashcards'],
    validate: (data) => flashcardDeckStructuredContentIsComplete(data, 'flashcard-generator'),
    message: 'Flashcards content must include at least 5 cards with non-empty front and back values.',
  },
  'daily-class-plan-maker': {
    allowedTypes: ['Daily Plan'],
    validate: (data) => dailyClassPlanStructuredContentIsComplete(data),
    message:
      'Daily Class Plan must include all 9 sections: topic break-up, objectives, teaching methods, classroom activity, exit ticket, differentiation, homework, teaching aids, and teacher reflection.',
  },
  'mock-test-builder': {
    allowedTypes: ['Mock Test', 'Exam Paper'],
    validate: (data) =>
      Boolean(String(data?.mock_test_title || data?.paper_title || data?.title || '').trim()) &&
      countMockTestQuestions(data) > 0,
    message: 'Mock Test Builder must include a title and at least one question.',
  },
  'exam-question-paper-generator': {
    allowedTypes: ['Exam Paper'],
    validate: (data) => examPaperStructuredContentIsComplete(data),
    message:
      'Exam Question Paper must include paper title, instructions, blueprint, at least 3 questions across sections A–E, internal choices, answer key, marking scheme, and open-ended rubric.',
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
    allowedTypes: ['Practice Q&A', 'Homework', 'MCQ', 'Worksheet'],
    validate: (data) => practiceQaHasAllRequiredSections(data),
    message:
      'Practice Q&A must include at least one question in every section A–G (including Match the Following in Section C).',
  },
  'chapter-summary-creator': {
    allowedTypes: ['Chapter Summary', 'Summary', 'Notes', 'Study Guide'],
    validate: (data) => chapterSummaryHasMinimumBody(data),
    message:
      'Chapter summary must use the 10-section Chapter Summary format (overview, important concepts, at least 3 formulae/rules/facts, quick revision notes, and practice recall questions). Do not use Smart Study Guide section names.',
  },
  'key-points-formula-extractor': {
    allowedTypes: ['Key Points', 'Notes'],
    validate: (data) => keyPointsHasMinimumBody(data),
    message:
      'Key points must include important concepts, at least 3 formulae/rules/facts (section 4), and must-remember facts or a one-minute summary.',
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

  const normalizeLooseJson = (value) =>
    String(value || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00A0/g, ' ')
      .replace(/,\s*([}\]])/g, '$1')
      .trim();

  const parseCandidate = (value) => {
    const cleaned = normalizeLooseJson(value);
    if (!cleaned) return null;
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  };

  const pickObject = (parsed) => {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed)) {
      const firstObject = parsed.find((row) => row && typeof row === 'object' && !Array.isArray(row));
      return firstObject || {};
    }
    return null;
  };

  const direct = pickObject(parseCandidate(raw));
  if (direct) return direct;

  const startIndices = [];
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{' || ch === '[') startIndices.push(i);
  }

  for (const start of startIndices) {
    const open = raw[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === open) depth += 1;
      else if (ch === close) depth -= 1;

      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        const parsed = pickObject(parseCandidate(candidate));
        if (parsed) return parsed;
        break;
      }
    }
  }

  throw new Error('Gemini returned invalid JSON payload');
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

  if (toolSlug === 'activity-project-generator' || toolSlug === 'project-idea-lab') {
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
  } else if (toolSlug === 'mock-test-builder') {
    const rootPick = {
      ...(root.mock_test_title ? { mock_test_title: root.mock_test_title } : {}),
      ...(root.test_purpose_subtopic_link ? { test_purpose_subtopic_link: root.test_purpose_subtopic_link } : {}),
      ...(Array.isArray(root.learning_objectives) ? { learning_objectives: root.learning_objectives } : {}),
      ...(root.ncf_competency_alignment ? { ncf_competency_alignment: root.ncf_competency_alignment } : {}),
      ...(root.step_by_step_solutions_explanations
        ? { step_by_step_solutions_explanations: root.step_by_step_solutions_explanations }
        : {}),
      ...(Array.isArray(root.remedial_revision_suggestions)
        ? { remedial_revision_suggestions: root.remedial_revision_suggestions }
        : {}),
      ...(Array.isArray(root.expected_learning_outcomes)
        ? { expected_learning_outcomes: root.expected_learning_outcomes }
        : {}),
      ...(root.real_life_application ? { real_life_application: root.real_life_application } : {}),
      ...(root.reflection_exit_ticket ? { reflection_exit_ticket: root.reflection_exit_ticket } : {}),
      ...(root.paper_title ? { paper_title: root.paper_title } : {}),
      ...(root.title ? { title: root.title } : {}),
      ...(root.instructions ? { instructions: root.instructions } : {}),
      ...(root.question_paper ? { question_paper: root.question_paper } : {}),
      ...(root.questionPaper ? { question_paper: root.questionPaper } : {}),
      ...(Array.isArray(root.questions) ? { questions: root.questions } : {}),
      ...(root.question ? { question: root.question } : {}),
      ...(Array.isArray(root.sections) ? { sections: root.sections } : {}),
      ...(Array.isArray(root.section_a) ? { section_a: root.section_a } : {}),
      ...(Array.isArray(root.section_b) ? { section_b: root.section_b } : {}),
      ...(Array.isArray(root.section_c) ? { section_c: root.section_c } : {}),
      ...(Array.isArray(root.section_d) ? { section_d: root.section_d } : {}),
      ...(Array.isArray(root.section_e) ? { section_e: root.section_e } : {}),
      ...(root.answer_key ? { answer_key: root.answer_key } : {}),
    };
    if (Object.keys(rootPick).length) {
      inner = { ...rootPick, ...inner };
    }
    if (Object.keys(inner).length === 0) {
      const { contentType: _ct, structuredContent: _sc, ...rest } = root;
      if (Object.keys(rest).length) inner = { ...rest };
    }
  } else if (toolSlug === 'smart-qa-practice-generator') {
    const rootPick = {
      ...(root.title ? { title: root.title } : {}),
      ...(root.practice_set_title ? { practice_set_title: root.practice_set_title } : {}),
      ...(Array.isArray(root.learning_objectives) ? { learning_objectives: root.learning_objectives } : {}),
      ...(root.instructions ? { instructions: root.instructions } : {}),
      ...(Array.isArray(root.sections) ? { sections: root.sections } : {}),
      ...(Array.isArray(root.questions) ? { questions: root.questions } : {}),
      ...(Array.isArray(root.practice_questions) ? { practice_questions: root.practice_questions } : {}),
      ...(root.answer_key ? { answer_key: root.answer_key } : {}),
      ...(root.answer_key_with_explanations
        ? { answer_key_with_explanations: root.answer_key_with_explanations }
        : {}),
      ...(root.question ? { question: root.question } : {}),
      ...(root.options ? { options: root.options } : {}),
      ...(root.answer ? { answer: root.answer } : {}),
    };
    for (const [key] of PRACTICE_QA_SECTION_KEY_PAIRS) {
      if (root[key] != null) rootPick[key] = root[key];
    }
    if (Object.keys(rootPick).length) {
      inner = { ...rootPick, ...inner };
    }
    if (Object.keys(inner).length === 0) {
      const { contentType: _ct, structuredContent: _sc, ...rest } = root;
      if (Object.keys(rest).length) inner = { ...rest };
    }
  } else if (toolSlug === 'exam-question-paper-generator') {
    const rootPick = {
      ...(root.paper_title ? { paper_title: root.paper_title } : {}),
      ...(root.title ? { title: root.title } : {}),
      ...(root.instructions ? { instructions: root.instructions } : {}),
      ...(root.blueprint ? { blueprint: root.blueprint } : {}),
      ...(Array.isArray(root.sections) ? { sections: root.sections } : {}),
      ...(Array.isArray(root.section_a) ? { section_a: root.section_a } : {}),
      ...(Array.isArray(root.section_b) ? { section_b: root.section_b } : {}),
      ...(Array.isArray(root.section_c) ? { section_c: root.section_c } : {}),
      ...(Array.isArray(root.section_d) ? { section_d: root.section_d } : {}),
      ...(Array.isArray(root.section_e) ? { section_e: root.section_e } : {}),
      ...(root.internal_choices ? { internal_choices: root.internal_choices } : {}),
      ...(root.answer_key ? { answer_key: root.answer_key } : {}),
      ...(root.marking_scheme ? { marking_scheme: root.marking_scheme } : {}),
      ...(root.open_ended_rubric ? { open_ended_rubric: root.open_ended_rubric } : {}),
      ...(root.question ? { question: root.question } : {}),
      ...(root.answer ? { answer: root.answer } : {}),
      ...(root.options ? { options: root.options } : {}),
      ...(root.marks != null ? { marks: root.marks } : {}),
      ...(root.question_number != null ? { question_number: root.question_number } : {}),
      ...(root.section ? { section: root.section } : {}),
      ...(root.internal_choice_group ? { internal_choice_group: root.internal_choice_group } : {}),
    };
    if (Object.keys(rootPick).length) {
      inner = { ...rootPick, ...inner };
    }
  } else if (toolSlug === 'lesson-planner' || toolSlug === 'study-schedule-maker') {
    const rootPick = {
      ...(root.objectives ? { objectives: root.objectives } : {}),
      ...(root.learning_objectives ? { learning_objectives: root.learning_objectives } : {}),
      ...(root.activities ? { activities: root.activities } : {}),
      ...(root.timeline ? { timeline: root.timeline } : {}),
      ...(root.time_slots ? { time_slots: root.time_slots } : {}),
      ...(root.study_schedule_title ? { study_schedule_title: root.study_schedule_title } : {}),
      ...(root.study_plan_table ? { study_plan_table: root.study_plan_table } : {}),
      ...(root.studyPlanTable ? { study_plan_table: root.studyPlanTable } : {}),
      ...(root.concept_learning_slot ? { concept_learning_slot: root.concept_learning_slot } : {}),
      ...(root.conceptLearningSlot ? { concept_learning_slot: root.conceptLearningSlot } : {}),
      ...(root.practice_slot ? { practice_slot: root.practice_slot } : {}),
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

  if (toolSlug === 'flashcard-generator' || toolSlug === 'my-study-decks') {
    if (Array.isArray(inner) && inner.length) {
      inner = { cards: inner };
    }
    if (Array.isArray(root.cards) && root.cards.length) {
      inner = { ...inner, cards: inner.cards?.length ? inner.cards : root.cards };
    }
    for (const key of [
      'flashcard_set',
      'flashcards',
      'concept_and_definition_cards',
      'formula_rule_cards',
      'application_hots_cards',
      'visual_diagram_suggestion_cards',
    ]) {
      if (Array.isArray(root[key]) && root[key].length && (!Array.isArray(inner[key]) || !inner[key].length)) {
        inner = { ...inner, [key]: root[key] };
      }
    }
    if (!String(inner.flashcard_deck_title || inner.deck_title || inner.title || '').trim()) {
      inner = {
        ...inner,
        flashcard_deck_title: root.flashcard_deck_title || root.deck_title || root.title,
        deck_title: root.deck_title || root.title,
        title: root.title || root.deck_title,
      };
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
  const variantN = Number(meta.generationVariant) || 0;
  const angle = String(meta.variantAngle || '').trim();
  const scenario = String(meta.variantScenario || '').trim();
  const tp = subTopic ? `${topic} — ${subTopic}` : topic;
  const angleShort = angle ? angle.split('(')[0].trim().slice(0, 42) : '';
  return {
    title: angleShort
      ? `${angleShort}: ${topic}`
      : variantN > 0
        ? `Activity variant ${variantN}: ${topic}`
        : `Hands-on activity: ${topic}`,
    materials: [
      'Notebook / loose paper',
      'Pencils and coloured pencils or markers',
      'Plain A4 sheets for folding/cutting tasks (if needed)',
      'Ruler',
      `${subject} textbook or excerpt from the uploaded PDF`,
      'Chart paper / whiteboard markers for gallery walk (optional)',
    ],
    steps: [
      scenario
        ? `Set the scene: ${scenario}. In pairs, list four key ideas or vocabulary for ${topic} linked to this setting.`
        : angle
          ? `Start with the angle "${angle}". In pairs, list four vocabulary terms or diagrams for ${topic} on one half-sheet.`
          : `In pairs, skim the material for ${topic} and list four key vocabulary terms or diagrams on one half-sheet.`,
      variantN > 0
        ? `Variant ${variantN}: compare lists with another pair — each pair must add one unique example not used in other variants.`
        : 'Compare lists with another pair — merge duplicates and circle the two concepts that seemed most challenging.',
      angle
        ? `Build a mini task for "${tp}" using the angle (${angleShort || angle})${scenario ? ` in the setting: ${scenario}` : ''}. Keep it doable in 15 minutes.`
        : `Design one mini-demonstration or table that explains one idea from "${tp}"${scenario ? ` during ${scenario}` : ''}. Keep it doable in 15 minutes.`,
      scenario
        ? `Groups present findings from ${scenario}; each group explains one design choice in two sentences.`
        : 'Groups post their artefact on the board; each group explains one design choice in two sentences.',
      `Whole class agrees on three success checkpoints for understanding ${topic} (variant ${variantN || 1} focus).`,
      `Exit slip: one new idea about ${subTopic || topic}, one question, one link to ${scenario || 'everyday life'} (${subject}).`,
    ],
    learningOutcome: angle
      ? `Through "${angleShort || angle}", learners demonstrate understanding of ${tp} in ${subject} (${classLabel}).`
      : variantN > 0
        ? `Variant ${variantN}: learners apply ${tp} in ${subject} using a distinct classroom task (${classLabel}).`
        : `Learners collaborate to represent and verbalise central ideas about ${topic} in ${subject} (${classLabel}), using models or diagrams grounded in authentic classroom tasks.`,
  };
}

function augmentActivityStructuredContent(normalizedFlat, meta, toolSlug = 'activity-project-generator') {
  const n = normalizeActivityStructuredContent(normalizedFlat, toolSlug);
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

  if (isStrictAllFieldsValidation(meta)) {
    return n;
  }

  if (meta?.generationVariant) {
    console.warn(
      `[AI Generator] Activity scaffold fallback for variant ${meta.generationVariant} — model output was incomplete; consider Flash model or higher token limit.`,
    );
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

  return normalizeActivityStructuredContent(
    {
      ...n,
      title,
      materials,
      steps,
      learningOutcome,
    },
    toolSlug,
  );
}

export function finalizeActivityStructuredContent(structuredContent, meta = {}, toolSlug = 'activity-project-generator') {
  const raw =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {};
  return augmentActivityStructuredContent(raw, meta, toolSlug);
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

function normalizeExtractedPdfText(raw) {
  return String(raw || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Extract full PDF text + page count (page count is metadata only — never used to create records).
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
export async function extractPdfTextWithMeta(buffer) {
  let text = '';
  let pageCount = 0;

  const textParser = new PDFParse({ data: buffer });
  try {
    const parsed = await textParser.getText();
    text = normalizeExtractedPdfText(parsed?.text || '');
    pageCount = Number(parsed?.total ?? 0) || 0;
  } finally {
    await textParser.destroy().catch(() => {});
  }

  if (!pageCount) {
    const footerMatch = String(text).match(/--\s*\d+\s+of\s+(\d+)\s*--/i);
    if (footerMatch) pageCount = Number(footerMatch[1]) || 0;
  }

  if (!pageCount) {
    const infoParser = new PDFParse({ data: buffer });
    try {
      const info = await infoParser.getInfo();
      pageCount = Number(info?.total ?? info?.pages ?? 0) || 0;
    } catch (infoErr) {
      console.warn('[PDF] getInfo failed (non-fatal):', infoErr?.message || infoErr);
    } finally {
      await infoParser.destroy().catch(() => {});
    }
  }

  console.log('[PDF] Extracted text length:', text.length, '| pages:', pageCount);
  return { text, pageCount };
}

export async function extractTextFromPdfBuffer(buffer) {
  const { text } = await extractPdfTextWithMeta(buffer);
  return text;
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
  if (key.includes('practice') && key.includes('q')) return 'Practice Q&A';
  if (key.includes('rubric')) return 'Rubric';
  if (key.includes('story') || key.includes('passage')) return 'Story';
  if (key.includes('summary')) return 'Summary';
  if (key.includes('note')) return 'Notes';
  return raw;
}

export function validateToolSpecificStructuredContent(
  toolSlug,
  structuredContent,
  contentType,
  sourceText = '',
  meta = {},
) {
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

  if (normalizedTool === 'exam-question-paper-generator') {
    const finalized = finalizeExamPaperStructuredContent(
      structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
        ? structuredContent
        : {},
      meta,
    );
    if (!allowed.includes(resolvedType)) {
      return {
        valid: false,
        message: `Detected content type "${resolvedType}" is not allowed for selected tool.`,
        normalizedType: resolvedType,
        normalizedStructuredContent: finalized,
      };
    }
    if (!examPaperStructuredContentIsComplete(finalized, meta)) {
      const missing = getExamPaperMissingSections(finalized, meta);
      return {
        valid: false,
        message: missing.join('; ') || rule.message,
        normalizedType: resolvedType,
        normalizedStructuredContent: finalized,
        missingSections: missing,
      };
    }
    const paddedExam = padAiGeneratorCanonicalSections(normalizedTool, finalized, meta);
    return {
      valid: true,
      message: '',
      normalizedType: resolvedType,
      normalizedStructuredContent: paddedExam,
    };
  }

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
  let contentForValidate = normalizedStructuredContent;
  if (normalizedTool === 'worksheet-mcq-generator' && meta.skipWorksheetPad !== true) {
    contentForValidate = finalizeWorksheetStructuredContent(contentForValidate, meta);
  }
  if (!rule.validate(contentForValidate) && normalizedTool === 'daily-class-plan-maker') {
    const finalized = finalizeDailyClassPlanStructuredContent(contentForValidate, {
      subTopic:
        contentForValidate.day_period_topic_breakup ||
        contentForValidate.title ||
        contentForValidate.lesson_name,
      subject: contentForValidate.subject || 'Science',
    });
    if (rule.validate(finalized)) {
      contentForValidate = finalized;
    }
  }
  if (!rule.validate(contentForValidate) && normalizedTool === 'exam-question-paper-generator') {
    const finalized = finalizeExamPaperStructuredContent(contentForValidate, {
      subTopic: contentForValidate.paper_title || contentForValidate.title,
      subject: contentForValidate.subject || 'Science',
    });
    if (rule.validate(finalized)) {
      contentForValidate = finalized;
    }
  }
  if (
    !rule.validate(contentForValidate) &&
    (normalizedTool === 'flashcard-generator' || normalizedTool === 'my-study-decks')
  ) {
    const finalized = finalizeFlashcardDeckStructuredContent(
      contentForValidate,
      {
        subTopic:
          contentForValidate.topic_and_subtopic_link ||
          contentForValidate.subtopic_link_prior_knowledge_required ||
          contentForValidate.deck_title ||
          contentForValidate.flashcard_deck_title ||
          contentForValidate.title,
        subject: contentForValidate.subject || 'Science',
      },
      normalizedTool,
    );
    if (rule.validate(finalized)) {
      contentForValidate = finalized;
    }
  }

  if (!rule.validate(contentForValidate)) {
    const customMessage =
      normalizedTool === 'smart-qa-practice-generator'
        ? practiceQaValidationMessage(contentForValidate) || rule.message
        : normalizedTool === 'flashcard-generator' || normalizedTool === 'my-study-decks'
          ? (getFlashcardDeckMissingSections(contentForValidate, normalizedTool).join('; ') ||
            rule.message)
          : normalizedTool === 'daily-class-plan-maker'
            ? (getDailyClassPlanMissingSections(contentForValidate).join('; ') || rule.message)
            : normalizedTool === 'exam-question-paper-generator'
              ? (getExamPaperMissingSections(contentForValidate).join('; ') || rule.message)
              : rule.message;
    return {
      valid: false,
      message: customMessage,
      normalizedType: resolvedType,
      normalizedStructuredContent: contentForValidate,
    };
  }

  const requireAllFields = isStrictAllFieldsValidation(meta);
  if (isAiGeneratorSectionPadEnabled()) {
    contentForValidate = padAiGeneratorCanonicalSections(normalizedTool, contentForValidate, meta);
  }

  if (requireAllFields) {
    const allFields = validateAllCanonicalToolFields(normalizedTool, contentForValidate);
    if (!allFields.valid) {
      return {
        valid: false,
        message: buildAllFieldsRequiredMessage(allFields.missingSections),
        normalizedType: resolvedType,
        normalizedStructuredContent: contentForValidate,
        missingSections: allFields.missingSections,
      };
    }
  } else {
    const fieldGate = validateCanonicalFieldsForSave(normalizedTool, contentForValidate, meta);
    if (!fieldGate.valid) {
      return {
        valid: false,
        message: fieldGate.message || buildAllFieldsRequiredMessage(fieldGate.missingSections),
        normalizedType: resolvedType,
        normalizedStructuredContent: contentForValidate,
        missingSections: fieldGate.missingSections,
      };
    }
  }

  return {
    valid: true,
    message: '',
    normalizedType: resolvedType,
    normalizedStructuredContent: contentForValidate,
  };
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
  if (toolSlug === 'reading-practice-room' || toolSlug === 'story-passage-creator') {
    return buildStoryRenderableFromStructured(source, toolSlug);
  }
  if (toolSlug === 'lesson-planner' || toolSlug === 'study-schedule-maker') {
    return buildLessonPlanRenderableFromStructured(source, toolSlug);
  }
  if (toolSlug === 'daily-class-plan-maker') {
    return buildDailyClassPlanRenderableFromStructured(source);
  }
  if (toolSlug === 'my-study-decks' || toolSlug === 'flashcard-generator') {
    return buildFlashcardRenderableFromStructured(source, toolSlug);
  }
  if (toolSlug === 'rubrics-evaluation-generator') {
    return buildRubricRenderableFromStructured(source);
  }
  if (toolSlug === 'mock-test-builder') {
    return buildMockTestRenderableFromStructured(source);
  }
  if (toolSlug === 'exam-question-paper-generator') {
    return buildExamPaperRenderableFromStructured(source);
  }
  if (toolSlug === 'project-idea-lab') {
    const act = canonicalizeActivityExtractedItem(source, toolSlug);
    const ncf = act.ncf_competency_alignment;
    return {
      kind: 'activity',
      variant: 'student',
      title: String(act.title || type || 'Activity').trim(),
      subtopicLink: String(act.subtopic_link_prior_knowledge || '').trim(),
      learningObjectives: toStringList(act.learning_objectives || act.learningObjectives),
      ncfAlignment: Array.isArray(ncf) ? toStringList(ncf) : String(ncf || '').trim(),
      materials: toStringList(act.materials_required || act.materials),
      steps: toStringList(act.step_by_step_procedure || act.steps),
      safetyCareInstructions: toStringList(act.safety_care_instructions),
      observationDataRecordingTable: String(act.observation_data_recording_table || '').trim(),
      creativeOutputFinalProduct: String(act.creative_output_final_product || '').trim(),
      differentiationSupportExtension: String(act.differentiation_support_extension || act.differentiation || '').trim(),
      selfAssessmentRubric: toStringList(act.self_assessment_rubric || act.assessment_criteria_rubric),
      learningOutcome: String(act.expected_learning_outcomes || act.learningOutcome || '').trim(),
      realLifeApplication: String(act.real_life_application || act.realLifeApplication || '').trim(),
      reflectionExitTicket: String(act.reflection_exit_ticket || '').trim(),
    };
  }
  if (toolSlug === 'activity-project-generator') {
    const act = canonicalizeActivityExtractedItem(source, toolSlug);
    const ncf = act.ncf_competency_alignment;
    return {
      kind: 'activity',
      variant: 'teacher',
      title: String(act.title || type || 'Activity').trim(),
      subtopicLink: String(act.subtopic_link_prior_knowledge || '').trim(),
      learningObjectives: toStringList(act.learning_objectives || act.learningObjectives),
      ncfAlignment: Array.isArray(ncf) ? toStringList(ncf) : String(ncf || '').trim(),
      materials: toStringList(act.materials_required || act.materials),
      steps: toStringList(act.step_by_step_procedure || act.steps),
      teacherInstructions: toStringList(act.teacher_instructions || act.teacherInstructions),
      studentInstructions: toStringList(act.student_instructions || act.studentInstructions),
      differentiation: String(act.differentiation || '').trim(),
      assessmentRubric: toStringList(act.assessment_criteria_rubric || act.assessmentRubric),
      learningOutcome: String(act.expected_learning_outcomes || act.learningOutcome || '').trim(),
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
  "title": "Story / Passage Title",
  "topic_subtopic_connection": "Topic and subtopic link",
  "prior_knowledge_required": "Prior knowledge required",
  "learning_objectives": ["Objective 1", "Objective 2"],
  "ncf_competency_alignment": "NCF alignment text",
  "vocabulary_warmup": ["word – meaning"],
  "pre_reading_thinking_prompt": "Before you read, think about...",
  "passage": "Full story / passage text...",
  "read_and_recall_questions": ["Question 1"],
  "think_and_infer_questions": ["Question 1"],
  "apply_and_connect_questions": ["Question 1"],
  "vocabulary_grammar_practice": "Practice tasks...",
  "creative_response_activity": "Creative task...",
  "answer_key_suggested_responses": ["Answer 1"],
  "common_mistakes_to_avoid": "Mistake and correction",
  "differentiation_support": "Support for struggling learners",
  "expected_learning_outcomes": ["Outcome 1"],
  "real_life_application": "Real-life prompt",
  "reflection_exit_ticket": "Reflection prompt"
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
      if (toolSlug === 'lesson-planner' || toolSlug === 'study-schedule-maker') {
        structuredContent = normalizeLessonPlannerStructuredContent(structuredContent, toolSlug);
      }
      if (toolSlug === 'daily-class-plan-maker') {
        structuredContent = finalizeDailyClassPlanStructuredContent(structuredContent, selected);
      }
      if (toolSlug === 'activity-project-generator' || toolSlug === 'project-idea-lab') {
        structuredContent = finalizeActivityStructuredContent(structuredContent, selected, toolSlug);
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

/** No Gemini call — use when user already chose tool/metadata and content is parsed locally (regex worksheets). */
export function buildLocalPdfAnalysisFromSelection(selected = {}) {
  const selectedToolSlug = String(selected.toolType || '').trim();
  const selectedClass = String(selected.classLabel || '').trim();
  const selectedSubject = String(selected.subject || '').trim();
  const selectedTopic = String(selected.topic || selected.chapter || '').trim();
  const selectedSubTopic = String(selected.subTopic || '').trim();
  return {
    classLabel: selectedClass,
    subject: selectedSubject,
    topic: selectedTopic,
    subTopic: selectedSubTopic,
    bestMatchingToolLabel: getToolLabelFromSlug(selectedToolSlug),
    contentType: CONTENT_TYPE_BY_TOOL_SLUG[selectedToolSlug] || 'Worksheet',
    structuredContent: {},
    subjectTopicValidation: {
      subjectMatched: true,
      topicMatched: true,
      reason: 'User-provided metadata; PDF parsed locally without LLM.',
      confidence: 1,
    },
    rawGemini: {},
    analysisMode: 'local',
    isFallback: false,
  };
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
 * AI PDF — RAG context from uploaded PDF + same structured pipeline as AI Generator.
 * @param {string} toolSlug
 * @param {string} pdfText
 * @param {Record<string, unknown>} params
 */
export async function generateStructuredContentFromPdf(toolSlug, pdfText, params = {}) {
  const ragContext = buildPdfRagContextFromText(String(pdfText || ''), {
    subject: String(params.subject || '').trim(),
    topic: String(params.topic || params.chapter || '').trim(),
    subTopic: String(params.subTopic || params.subtopic || '').trim(),
  });
  const ragChunkCount = (ragContext.match(/\[Chunk \d+\]/g) || []).length;
  const extra = params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {};
  const questionCount = Number(params.questionCount ?? extra.questionCount ?? extra.numberOfQuestions);
  const result = await generateStructuredContentForAiGenerator(toolSlug, {
    ...params,
    pdfContext: ragContext,
    extraParams: {
      ...extra,
      ...(Number.isFinite(questionCount) && questionCount > 0
        ? { questionCount, numberOfQuestions: questionCount }
        : {}),
    },
  });
  return { ...result, ragChunkCount, generationMode: 'rag' };
}

/**
 * Super Admin AI Generator — structured JSON via aiToolTemplates.js (optional PDF RAG context).
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
  const pdfContext = String(params.pdfContext || '').trim();
  const historicalBlock = String(params.historicalPromptBlock || '').trim();
  const basePrompt = pdfContext
    ? `${prompt}${historicalBlock ? `\n\n${historicalBlock}` : ''}

REFERENCE PDF CONTEXT (RAG — primary factual source for this generation):
Use the passages below to ground facts, terminology, and curriculum alignment.
Synthesize into the tool schema above — do not paste PDF blocks verbatim or mirror textbook layout.
${pdfContext}`
    : `${prompt}${historicalBlock ? `\n\n${historicalBlock}` : ''}`;
  const extra = params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {};
  const generationVariant = Number(extra.generationVariant ?? extra.variantIndex);
  const isBatchVariant = Number.isFinite(generationVariant) && generationVariant > 0;
  const recoveryPass = extra.recoveryPass === true || params.recoveryPass === true;
  const upgradeToFlash = shouldUseFlashForAiGeneratorRun({
    upgradeRequested: params.upgradeToFlash === true,
    recoveryPass,
  });
  const batchModel = String(process.env.AI_GENERATOR_GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
  const upgradeModel = String(process.env.AI_GENERATOR_UPGRADE_MODEL || 'gemini-2.5-flash').trim();
  const { getAiGeneratorMaxTokens } = await import('../utils/ai-generator-llm-budget.js');
  const maxTokens = getAiGeneratorMaxTokens(slug);

  const buildLlmOptions = (attempt) => {
    const useFlash =
      upgradeToFlash ||
      shouldUpgradeFlashOnValidationAttempt(isBatchVariant, attempt, recoveryPass);
    if (useFlash) {
      return {
        isBatchVariant,
        temperature: 0.55,
        primaryModel: upgradeModel,
        maxTokens,
      };
    }
    if (isBatchVariant) {
      return {
        isBatchVariant: true,
        temperature: 0.88,
        primaryModel: batchModel,
        maxTokens,
      };
    }
    return { maxTokens };
  };

  const meta = {
    classLabel: params.classLabel || params.gradeLevel,
    subject: params.subject,
    topic: params.topic,
    subTopic: params.subTopic || params.subtopic,
    board: params.board,
    questionCount: Number(extra.questionCount ?? extra.numberOfQuestions ?? params.questionCount),
    generationVariant: isBatchVariant ? generationVariant : undefined,
    variantAngle: isBatchVariant ? String(extra.variantAngle || '').trim() : undefined,
    variantScenario: isBatchVariant ? String(extra.variantScenario || '').trim() : undefined,
    requireAllCanonicalFields: true,
  };

  let lastError = null;
  let lastValidationMessage = '';

  let activePrompt = basePrompt;
  const maxValidationAttempts = getAiGeneratorValidationMaxAttempts(isBatchVariant, recoveryPass);

  for (let attempt = 1; attempt <= maxValidationAttempts; attempt += 1) {
    const llmOptions = buildLlmOptions(attempt);
    try {
      const raw = await geminiService.generateStructuredContent(activePrompt, 'json', llmOptions);
      const json = extractJsonObject(raw);
      let structuredContent = coerceRegenerationStructuredContent(slug, json);
      if (slug === 'mock-test-builder' && json && typeof json === 'object') {
        const fromStructured =
          json.structuredContent && typeof json.structuredContent === 'object' && !Array.isArray(json.structuredContent)
            ? json.structuredContent
            : {};
        structuredContent = mergeMockTestStructuredLayers(structuredContent, fromStructured);
      }

      if (slug === 'lesson-planner' || slug === 'study-schedule-maker') {
        structuredContent = normalizeLessonPlannerStructuredContent(structuredContent, slug);
      } else if (slug === 'daily-class-plan-maker') {
        structuredContent = finalizeDailyClassPlanStructuredContent(structuredContent, meta);
      } else if (slug === 'activity-project-generator' || slug === 'project-idea-lab') {
        structuredContent = finalizeActivityStructuredContent(structuredContent, meta, slug);
      } else if (slug === 'my-study-decks') {
        structuredContent = finalizeFlashcardDeckStructuredContent(structuredContent, meta, 'my-study-decks');
      } else if (slug === 'flashcard-generator') {
        structuredContent = finalizeFlashcardDeckStructuredContent(structuredContent, meta, 'flashcard-generator');
      } else if (slug === 'concept-mastery-helper') {
        structuredContent = finalizeConceptMasteryStructuredContent(structuredContent, meta);
      } else if (slug === 'mock-test-builder') {
        structuredContent = finalizeMockTestStructuredContent(structuredContent, meta);
      } else if (slug === 'smart-qa-practice-generator') {
        structuredContent = finalizePracticeQaStructuredContent(structuredContent, meta);
      } else if (slug === 'chapter-summary-creator') {
        structuredContent = finalizeChapterSummaryStructuredContent(structuredContent, meta);
      } else if (slug === 'key-points-formula-extractor') {
        structuredContent = finalizeKeyPointsStructuredContent(structuredContent, meta);
      } else if (slug === 'exam-question-paper-generator') {
        structuredContent = finalizeExamPaperStructuredContent(structuredContent, meta);
      } else if (slug === 'smart-study-guide-generator') {
        structuredContent = normalizeStudyGuideStructuredContent(structuredContent, meta);
      } else if (slug === 'concept-breakdown-explainer') {
        structuredContent = finalizeConceptBreakdownStructuredContent(structuredContent, meta);
      } else if (slug === 'rubrics-evaluation-generator') {
        structuredContent = finalizeRubricStructuredContent(structuredContent, meta);
      } else if (slug === 'story-passage-creator') {
        structuredContent = finalizeStoryPassageStructuredContent(structuredContent, meta);
      } else if (slug === 'worksheet-mcq-generator') {
        structuredContent = finalizeWorksheetStructuredContent(structuredContent, meta);
      }

      const contentType = normalizeContentType(json.contentType || defaultContentType);
      const validationSourceText =
        slug === 'smart-qa-practice-generator'
          ? collectPracticeQaParseableText(structuredContent)
          : collectMockTestParseableText(structuredContent);
      let validation = validateToolSpecificStructuredContent(
        slug,
        structuredContent,
        contentType,
        validationSourceText,
        meta,
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
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'mock-test-builder') {
        structuredContent = finalizeMockTestStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'smart-qa-practice-generator') {
        structuredContent = finalizePracticeQaStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'chapter-summary-creator') {
        structuredContent = finalizeChapterSummaryStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'key-points-formula-extractor') {
        structuredContent = finalizeKeyPointsStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'rubrics-evaluation-generator') {
        structuredContent = finalizeRubricStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'story-passage-creator') {
        structuredContent = finalizeStoryPassageStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (
        !validation.valid &&
        (slug === 'flashcard-generator' || slug === 'my-study-decks')
      ) {
        structuredContent = finalizeFlashcardDeckStructuredContent(structuredContent, meta, slug);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'daily-class-plan-maker') {
        structuredContent = finalizeDailyClassPlanStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
          meta,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid && slug === 'exam-question-paper-generator') {
        structuredContent = finalizeExamPaperStructuredContent(structuredContent, meta);
        validation = validateToolSpecificStructuredContent(
          slug,
          structuredContent,
          contentType,
          validationSourceText,
          meta,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        }
      }

      if (!validation.valid) {
        lastValidationMessage = validation.message || 'Structured content failed validation.';
        const missingList = Array.isArray(validation.missingSections) ? validation.missingSections : [];
        const allFieldsHint =
          missingList.length > 0
            ? buildCanonicalFieldsRetryHint(slug, missingList)
            : lastValidationMessage;
        if (attempt < maxValidationAttempts) {
          activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): ${allFieldsHint} Return structuredContent with EVERY canonical field filled — no empty strings, no empty arrays.`;
          if (slug === 'mock-test-builder') {
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}. You MUST return structuredContent with mock_test_title and at least 8 questions in section_a..section_e (each with "question" text). Do not return only metadata without question arrays.`;
          } else if (slug === 'smart-qa-practice-generator') {
            const target = Number(meta?.questionCount) > 0 ? Number(meta.questionCount) : 12;
            const missing = getPracticeQaMissingSections(structuredContent);
            const missingHint = missing.length
              ? ` You MUST add questions to: ${missing.join('; ')}.`
              : '';
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return structuredContent with title and sections[] — all seven section names exactly (Section A: MCQs … Section G: HOTS / Analytical Questions), each with at least one question. Section C MUST be type "MATCH" with a match-the-following prompt and options as Column A / Column B pairs (e.g. "1. Observation | A. Step before hypothesis"). Include short answers in Section E and application/case-based in Section F. Do NOT duplicate questions in sections[] and questions[]. Total at least ${target} questions.`;
          } else if (slug === 'chapter-summary-creator') {
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}. Return Chapter Summary Creator JSON only — use chapter_summary_title, chapter_overview, important_concepts[] (min 3), formulae[] (min 3: name + formula where formula is an equation OR a must-know rule/fact sentence), quick_revision_notes[] (min 3), practice_recall_questions[] (min 3). Do NOT use Smart Study Guide fields (study_guide_title, prior_knowledge, key_concepts_explained, practice_questions with MCQ options).`;
          } else if (slug === 'key-points-formula-extractor') {
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}. Return Key Points JSON with topic_title, important_concepts[] (min 3), essential_definitions[], formulae[] (min 3 — name + formula; formula may be an equation OR a must-know rule), keywords_terminologies[], must_remember_facts[], real_life_connections[], frequently_asked_exam_points[], mnemonics_memory_tricks[], one_minute_revision_summary. Never leave formulae[] empty.`;
          } else if (slug === 'rubrics-evaluation-generator') {
            const missing = getRubricMissingSections(structuredContent);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return ALL 10 rubric sections. criteria[] MUST have at least 3 objects; each MUST include name, excellent, good, satisfactory, needs_improvement (non-empty strings). Include grading_criteria, actionable_suggestions, and next_step_remedial_enrichment.`;
          } else if (slug === 'story-passage-creator') {
            const missing = getStoryPassageMissingSections(structuredContent);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return ALL 19 Story and Passage Creator fields. passage MUST be a complete story (120+ words), not just the title. Include at least 2 questions in read_and_recall_questions, think_and_infer_questions, and apply_and_connect_questions.`;
          } else if (slug === 'flashcard-generator' || slug === 'my-study-decks') {
            const missing = getFlashcardDeckMissingSections(structuredContent, slug);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            const targetCards = Number(meta?.cardCount) > 0 ? Number(meta.cardCount) : 10;
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return structuredContent with cards[] array (min ${targetCards} items). EVERY card MUST use "front" and "back" keys with non-empty strings — not term/definition only. Include difficulty_tag_for_each_card and memory_hook_quick_tip on each card.`;
          } else if (slug === 'daily-class-plan-maker') {
            const missing = getDailyClassPlanMissingSections(structuredContent);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return Daily Class Plan JSON with ALL 9 sections (day_period_topic_breakup, objectives[], teaching_methods[], classroom_activity[], exit_ticket, differentiated_support, homework_followup, teaching_aids[], teacher_reflection_notes). This is NOT a 13-section lesson planner — do not use lesson_name, introduction_warmup, or teaching_strategy as primary fields.`;
          } else if (slug === 'exam-question-paper-generator') {
            const missing = getExamPaperMissingSections(structuredContent, meta);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            const examTarget =
              Number(meta?.questionCount) > 0 ? Number(meta.questionCount) : 12;
            activePrompt = `${basePrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return Exam Question Paper JSON with ALL 11 sections. Use paper_title, instructions, blueprint, section_a..section_e (each an array of question objects with question, options for MCQs, answer, marks). Include internal_choices, answer_key, marking_scheme, open_ended_rubric. This is NOT Mock Test Builder — do not use mock_test_title, test_purpose_subtopic_link, or ncf_competency_alignment. Minimum ${examTarget} questions across sections.`;
          }
          continue;
        }
        throw new Error(lastValidationMessage);
      }

      let sectionRepairCount = 0;
      for (let repairRound = 0; repairRound < 2; repairRound += 1) {
        const quality = runAiGeneratorQualityGate(slug, structuredContent, meta);
        if (quality.valid) break;

        if (!isAiGeneratorSectionPadEnabled() && quality.missingSections?.length) {
          structuredContent = await repairMissingSectionsViaLlm(
            slug,
            structuredContent,
            quality.missingSections,
            meta,
            historicalBlock,
          );
          sectionRepairCount += 1;
          validation = validateToolSpecificStructuredContent(
            slug,
            structuredContent,
            contentType,
            validationSourceText,
            meta,
          );
          if (validation.normalizedStructuredContent) {
            structuredContent = validation.normalizedStructuredContent;
          }
          if (!validation.valid) {
            lastValidationMessage = validation.message || quality.errors.join('; ');
            throw new Error(lastValidationMessage);
          }
          continue;
        }

        if (quality.errors.length) {
          lastValidationMessage = quality.errors.join('; ');
          throw new Error(lastValidationMessage);
        }
      }

      const finalQuality = runAiGeneratorQualityGate(slug, structuredContent, meta);
      if (!finalQuality.valid) {
        lastValidationMessage = finalQuality.errors.join('; ');
        throw new Error(lastValidationMessage);
      }

      if (isAiGeneratorSectionPadEnabled()) {
        structuredContent = padAiGeneratorCanonicalSections(slug, structuredContent, meta);
        if (slug === 'worksheet-mcq-generator') {
          structuredContent = finalizeWorksheetStructuredContent(structuredContent, meta);
        }
      } else if (slug === 'worksheet-mcq-generator') {
        structuredContent = finalizeWorksheetStructuredContent(structuredContent, meta);
      }

      const generatedContent = stripMarkdownSyntax(
        formatStructuredToolOutput(slug, deepStripMarkdownValues(structuredContent)),
      );
      structuredContent = deepStripMarkdownValues(structuredContent);
      if (!generatedContent.trim()) {
        throw new Error('Model returned empty formatted content.');
      }

      return {
        contentType: validation.normalizedType || contentType,
        structuredContent,
        generatedContent,
        sectionRepairCount,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const requireAllFieldsEnv =
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== 'false' &&
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== '0' &&
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== 'off';
  const upgradeOnFail =
    requireAllFieldsEnv &&
    !isAiGeneratorSectionPadEnabled() &&
    String(process.env.AI_GENERATOR_UPGRADE_ON_VALIDATION_FAIL ?? 'true').toLowerCase() !== 'false';
  const shouldUpgrade =
    isBatchVariant && upgradeOnFail && !upgradeToFlash && params._upgradeAttempted !== true;

  if (shouldUpgrade) {
    return generateStructuredContentForAiGenerator(toolSlug, {
      ...params,
      upgradeToFlash: true,
      _upgradeAttempted: true,
    });
  }

  throw new Error(lastError?.message || lastValidationMessage || 'AI Generator structured content failed');
}

