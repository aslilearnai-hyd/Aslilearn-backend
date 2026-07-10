import { PDFParse } from 'pdf-parse';
import geminiService, { isTransientGeminiError } from './gemini-service.js';
import {
  AI_TOOL_ORDERED_SLUGS,
  buildToolAliasToSlugMap,
  buildStrictOutputHintsMap,
  buildAiGeneratorStructuredPrompt,
  buildAiGeneratorPromptParts,
  getToolInformalSchema,
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
import {
  buildCurriculumContextPromptBlock,
  isAssessmentToolSlug,
  isExamScaffoldPaddingAllowed,
} from './curriculum-context-service.js';
import { validateExamPaperPipeline } from './exam-paper-pipeline-validator.js';
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
  ensureHomeworkPracticeQuestions,
} from '../utils/ai-generator-section-pad.js';
import { stripMarkdownSyntax, deepStripMarkdownValues } from '../utils/strip-markdown-syntax.js';
import {
  stripVariantScaffoldFromQuestionText,
  stripAiGeneratorLeakage,
  stripLessonPlanLeakFromLabel,
  isScaffoldFlashcardPair,
  sanitizeAiStructuredTextDeep,
  sanitizeFlashcardTopicLink,
  normalizeFlashcardClassLevel,
} from '../utils/sanitize-ai-question-display.js';
import { extractJsonObject } from '../utils/ai-json-extract.js';
import {
  getAiGeneratorValidationMaxAttempts,
  getAiGeneratorGeminiModel,
  getAiGeneratorLanguageSubjectGeminiModel,
  isAiGeneratorLanguageSubjectFlashOverrideEnabled,
  isAiGeneratorCostSaverEnabled,
  isAiGeneratorFlashLiteOnlyEnabled,
  isAiGeneratorSectionPadEnabled,
  isAiGeneratorUltraEconomyEnabled,
  isAiGeneratorGreatQualityEnabled,
  isAiGeneratorCompleteOnlySaveEnabled,
  shouldUpgradeFlashOnValidationAttempt,
  shouldUseFlashForAiGeneratorRun,
} from '../utils/ai-generator-batch-config.js';
import {
  resolveQualityTierSettings,
  getTemperatureForTool,
} from '../utils/ai-generator-quality-tier.js';
import {
  buildGeminiResponseSchemaForTool,
  isResponseSchemaEnabled,
} from '../utils/ai-generator-response-schema.js';
import { getAiGeneratorVariantAngle, getAiGeneratorVariantScenario } from '../constants/ai-generator-variant-angles.js';
import { resolveSubjectCategory } from '../prompts/shared/subject-awareness.js';
import { resolveScaffoldBand } from '../utils/subject-scaffold-profile.js';
import { runPostGenerationContentValidation } from '../utils/ai-generator-post-validation.js';
import { resolveAllowedGeminiModel } from './gemini-models.js';
import {
  isPlaceholderText,
  runAiGeneratorQualityGate,
  computeScaffoldDensity,
  SCAFFOLD_DENSITY_CEILING,
} from './ai-generator-quality-gate.js';
import {
  repairMissingSectionsViaLlm,
  repairFlashcardCardsViaLlm,
  repairFlashcardFrameworkViaLlm,
  repairPracticeQaViaLlm,
  repairScaffoldQuestionsViaLlm,
  SCAFFOLD_REPAIRABLE_TOOLS,
} from './ai-generator-section-repair.js';
import {
  resolvePracticeQaTopicLabel,
  pickPracticeQaBankQuestion,
  getPracticeQaBankFramework,
} from '../utils/practice-qa-topic-bank.js';
import {
  canonicalStoryPassageSubject,
  isStoryPassagePlaceholderText,
  isStoryPassageLanguageToolSlug,
  validateStoryPassageLanguageCompliance,
  buildStoryPassageLanguageRetryHint,
  mustEnforceStoryPassageLanguageCompliance,
  shouldSkipEnglishScaffoldForLanguageSubject,
  shouldBlockCostSaverForStoryLanguage,
  fillIndicStoryPassageScaffold,
  fillIndicReadingPracticeScaffold,
  fillIndicExamPaperScaffold,
  fillIndicDailyClassPlanScaffold,
  buildIndicScaffoldExamQuestions,
  enforceIndicLanguageStructuredContent,
  resolveLanguageSubjectForGeneration,
  buildStoryPassageLanguagePromptTail,
  textMatchesStoryPassageScript,
} from '../utils/story-passage-subject.js';
import {
  buildPromptEngineRewritePrompt,
  isPromptEngineEnabled,
} from '../prompts/registry.js';
import {
  dedupeIntraRecordQuestions,
  renumberIntraRecordQuestions,
  findSimilarText,
  getQuestionSimilarityThreshold,
} from './ai-generator-uniqueness-engine.js';

function skipEnglishStructuredScaffold(meta = {}) {
  // skipSectionPad only disables canonical section padding — not English finalizers.
  const subject = resolveLanguageSubjectForGeneration(meta?.subject, meta?.bookSubject);
  return shouldSkipEnglishScaffoldForLanguageSubject(subject);
}

function examPaperMeta(meta = {}) {
  const subject = resolveLanguageSubjectForGeneration(meta?.subject, meta?.bookSubject);
  return { ...meta, subject };
}

function buildBatchEconomyRetryPrompt({ slug, meta, attemptNum, maxAttempts, hint, languageHint = '' }) {
  const langBlock = buildStoryPassageLanguagePromptTail(meta?.subject || '');
  return [
    `Regenerate ONE ${slug} record as valid JSON only (validation retry ${attemptNum}/${maxAttempts}).`,
    `${meta?.classLabel || meta?.gradeLevel || ''} · ${meta?.subject || ''} · ${meta?.topic || ''}${
      meta?.subTopic ? ` · ${meta.subTopic}` : ''
    }`,
    langBlock,
    `Fix these validation errors: ${hint}`,
    languageHint,
    'Return structuredContent with every required field filled. No markdown, no code fences.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

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
          // Preserve the internal scaffold marker so the density guard stays phrase-independent.
          ...(entry._scaffold === true ? { _scaffold: true } : {}),
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

/** Homework Creator: keep real questions; avoid worksheet filters that drop short valid stems. */
function sanitizeHomeworkPracticeQuestions(questions = []) {
  const seen = new Set();
  return questions
    .map((row) => ({
      question_number: row?.question_number ?? row?.sl_no,
      type: String(row?.type || '').trim(),
      marks: row?.marks,
      answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
      explanation: String(row?.explanation || '').trim(),
      options: cleanWorksheetMcqOptions(row?.options),
      question: stripAiGeneratorLeakage(
        stripVariantScaffoldFromQuestionText(cleanWorksheetQuestionText(row?.question)),
      ),
    }))
    .filter((row) => row.question && row.question.length >= 8)
    .filter((row) => !isAnswerKeyLikeQuestion(row.question))
    .filter((row) => {
      const key = worksheetQuestionDedupeKey(row);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const sanitizeWorksheetQuestions = (questions = []) => {
  const seenFull = new Set();
  return questions
    .map((row) => ({
      question: stripVariantScaffoldFromQuestionText(cleanWorksheetQuestionText(row?.question)),
      options: cleanWorksheetMcqOptions(row?.options),
      answer: String(row?.answer || '').replace(/\s+/g, ' ').trim(),
      section: String(row?.section || '').trim(),
      type: String(row?.type || '').trim(),
      marks: row?.marks,
      explanation: String(row?.explanation || '').trim(),
      bloom_level: String(row?.bloom_level || '').trim(),
      question_number: row?.question_number ?? row?.sl_no,
      ...(row?._scaffold === true ? { _scaffold: true } : {}),
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
  const conceptName = subTopic || topic || `${subject} concept`;
  const focus = subTopic && topic ? `${topic} — ${subTopic}` : subTopic || topic;
  const angleLead = variantN > 0 ? `Variant ${variantN}: ` : '';
  return {
    concepts: [
      normalizeConceptStructuredContent({
        concept_name: conceptName,
        simple_definition: `${angleLead}A clear definition of ${conceptName} as part of ${focus} in ${subject}.`,
        why_important: `Mastering ${conceptName} helps ${classLabel} learners understand ${focus} for class tests and applications.`,
        prior_knowledge_needed: `Familiarity with the main ideas from ${topic || 'the previous unit'}.`,
        lesson: `${angleLead}Explain ${conceptName} step by step: definition, labelled diagram, worked example, and one check question tied to ${focus}. Align to the NCERT/CBSE treatment of ${subject} for ${classLabel}.`,
        diagram_suggestion: `Labelled diagram or concept map for ${conceptName} (components, flow, or cause–effect as appropriate).`,
        real_example: `One concrete example that illustrates ${conceptName} directly (device, formula application, or phenomenon).`,
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
  if (skipEnglishStructuredScaffold(meta)) return deck;
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
  if (isAiGeneratorSectionPadEnabled()) {
    deck = padAiGeneratorCanonicalSections('concept-mastery-helper', deck, meta);
  } else if (Array.isArray(deck.concepts) && deck.concepts.length) {
    deck = {
      ...deck,
      concepts: deck.concepts.map((row) => {
        const concept = row && typeof row === 'object' ? { ...row } : {};
        if (!String(concept.diagram_suggestion || concept.visualisation || '').trim()) {
          const name = String(concept.concept_name || concept.title || meta.subTopic || 'Concept').trim();
          concept.diagram_suggestion = `Labelled diagram showing ${name} with key parts and arrows for cause–effect.`;
        }
        return concept;
      }),
    };
  }
  const deckTitle = String(
    deck.title || deck.concepts?.[0]?.concept_name || meta.subTopic || meta.topic || '',
  ).trim();
  const variantN = Number(meta.generationVariant) || 0;
  const angleShort = String(meta.variantAngle || '')
    .split('(')[0]
    .trim()
    .slice(0, 48);
  if (variantN > 0 && angleShort) {
    deck = {
      ...deck,
      title: `${String(meta.subTopic || meta.topic || 'Concept').trim()} — ${angleShort}`,
    };
  } else if (variantN > 1) {
    deck = {
      ...deck,
      title: `${String(meta.subTopic || meta.topic || 'Concept').trim()} — Concept Mastery (Guide ${variantN})`,
    };
  } else if (deckTitle.length >= 4) {
    deck = { ...deck, title: deckTitle };
  } else {
    deck = {
      ...deck,
      title: `${String(meta.subTopic || meta.topic || 'Concept').trim()} — Concept Mastery`,
    };
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
  if (skipEnglishStructuredScaffold(meta)) return s;
  let concept_title = String(s.concept_title || s.concept_name || '').trim();
  if (!concept_title || concept_title === 'Concept') {
    const fromMeta = String(meta.subTopic || meta.subtopic || meta.topic || '').trim();
    if (fromMeta) concept_title = fromMeta;
  }
  if (!concept_title) concept_title = 'Concept';
  let out = {
    ...s,
    concept_title,
    concept_name: concept_title,
    title: concept_title,
  };
  if (isAiGeneratorSectionPadEnabled()) {
    out = padAiGeneratorCanonicalSections('concept-breakdown-explainer', out, meta);
  }
  return out;
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
  const practice_questions = sanitizeHomeworkPracticeQuestions(toQuestionArray(practiceRaw));

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
  if (t.length <= 8 || /^(story|passage|title|n\/?a|tbd|reading practice)$/i.test(t)) return false;
  if (isStoryPassagePlaceholderText(t)) return false;
  return true;
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
  if (passage.length < 80 || isStoryPassagePlaceholderText(passage)) {
    missing.push('8. Story / Passage Content (full story required, not a section label)');
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

/** @returns {string[]} Missing Reading Practice Room section labels. */
export function getReadingPracticeMissingSections(data) {
  const s = normalizeReadingPracticeStructuredContent(data && typeof data === 'object' ? data : {});
  const missing = [];
  const scalarChecks = [
    ['reading_practice_title', '1. Reading Practice Title'],
    ['subtopic_link_prior_knowledge', '2. Subtopic Link and Prior Knowledge Required'],
    ['ncf_competency_alignment', '4. NCF Competency / Learning Outcome Alignment'],
    ['reflection_exit_ticket', '13. Reflection / Exit Ticket'],
  ];
  for (const [key, label] of scalarChecks) {
    if (!storyPassageTextFilled(s[key])) missing.push(label);
  }
  if (!Array.isArray(s.learning_objectives) || s.learning_objectives.length < 2) {
    missing.push("3. Learning Objectives - Bloom's Taxonomy Aligned (min 2)");
  } else if (s.learning_objectives.some((row) => isStoryPassagePlaceholderText(row))) {
    missing.push("3. Learning Objectives - Bloom's Taxonomy Aligned (real objectives required)");
  }
  if (!Array.isArray(s.vocabulary_warmup) || s.vocabulary_warmup.length < 3) {
    missing.push('5. Vocabulary Warm-up (min 3 words)');
  } else if (s.vocabulary_warmup.some((row) => isStoryPassagePlaceholderText(row))) {
    missing.push('5. Vocabulary Warm-up (real words required)');
  }
  const passage = String(s.passage || s.content || '').trim();
  if (passage.length < 80 || isStoryPassagePlaceholderText(passage)) {
    missing.push('6. Passage / Story (full passage required, not a section label)');
  }
  if (storyPassageQuestionCount(s.read_and_recall_questions) < 2) {
    missing.push('7. Read and Recall Questions (min 2 real questions)');
  }
  if (storyPassageQuestionCount(s.think_and_infer_questions) < 2) {
    missing.push('8. Think and Infer Questions (min 2 real questions)');
  }
  if (storyPassageQuestionCount(s.apply_and_connect_questions) < 2) {
    missing.push('9. Apply and Connect Questions (min 2 real questions)');
  }
  if (!Array.isArray(s.vocabulary_practice) || s.vocabulary_practice.length < 1) {
    missing.push('10. Vocabulary Practice');
  } else if (s.vocabulary_practice.some((row) => isStoryPassagePlaceholderText(row))) {
    missing.push('10. Vocabulary Practice (real tasks required)');
  }
  const answers = Array.isArray(s.answer_key_suggested_responses) ? s.answer_key_suggested_responses : [];
  if (answers.length < 2) {
    missing.push('11. Answer Key / Suggested Responses (min 2)');
  } else if (answers.some((row) => isStoryPassagePlaceholderText(row))) {
    missing.push('11. Answer Key / Suggested Responses (real answers required)');
  }
  const outcomes = Array.isArray(s.expected_learning_outcomes) ? s.expected_learning_outcomes : [];
  if (outcomes.length < 2) {
    missing.push('12. Expected Learning Outcomes (min 2)');
  } else if (outcomes.some((row) => isStoryPassagePlaceholderText(row))) {
    missing.push('12. Expected Learning Outcomes (real outcomes required)');
  }
  return missing;
}

export function readingPracticeStructuredContentIsComplete(data) {
  return getReadingPracticeMissingSections(data).length === 0;
}

/** Fill derivable narrative fields from topic context; does not invent full passage. */
export function finalizeStoryPassageStructuredContent(structuredContent, meta = {}) {
  const s = normalizeStoryPassageStructuredContent(
    structuredContent && typeof structuredContent === 'object' ? structuredContent : {},
  );
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'the selected subtopic').trim();
  const subject = String(meta.subject || 'the subject').trim();
  const storyLanguage = canonicalStoryPassageSubject(subject);

  // Never inject English scaffold text for Hindi or Telugu — use Indic-language scaffolds instead.
  if (storyLanguage === 'Hindi' || storyLanguage === 'Telugu') {
    return fillIndicStoryPassageScaffold(s, meta);
  }

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

/** Pad short-notes gaps so validation and viewers receive a complete 10-section note. */
export function finalizeShortNotesStructuredContent(raw, meta = {}) {
  let out = normalizeShortNotesStructuredContent(raw);
  if (skipEnglishStructuredScaffold(meta)) return out;
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this topic').trim();
  const subject = String(meta.subject || 'Science').trim();
  if (!String(out.short_note_summary || out.summary || '').trim()) {
    const summary = `${topic}: concise revision notes covering definitions, key processes, and exam-ready facts for ${subject}.`;
    out = { ...out, short_note_summary: summary, summary };
  }
  if (!Array.isArray(out.key_points_to_remember) || out.key_points_to_remember.length < 3) {
    out.key_points_to_remember = [
      `Define the central idea of ${topic}.`,
      `List two processes or examples linked to ${topic}.`,
      `State one common exam mistake to avoid for ${topic}.`,
    ];
    out.key_points = out.key_points_to_remember;
  }
  if (!Array.isArray(out.learning_objectives) || out.learning_objectives.length < 2) {
    out.learning_objectives = [
      `Recall key facts about ${topic}.`,
      `Apply ${topic} to short answer questions.`,
    ];
  }
  if (!String(out.common_misconception_correction || '').trim()) {
    out.common_misconception_correction = `Students often confuse related terms in ${topic}; compare definitions using one example each.`;
  }
  if (!Array.isArray(out.quick_check_questions) || out.quick_check_questions.length < 2) {
    out.quick_check_questions = [
      `What is the main function described in ${topic}?`,
      `Give one real-life example connected to ${topic}.`,
    ];
  }
  return out;
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

/** Pad study-guide sections when the model returns sparse JSON. */
export function finalizeStudyGuideStructuredContent(raw, meta = {}) {
  let out = normalizeStudyGuideStructuredContent(raw, meta);
  if (skipEnglishStructuredScaffold(meta)) return out;
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this topic').trim();
  const subject = String(meta.subject || 'Science').trim();
  if (!String(out.chapter_subtopic_overview || '').trim()) {
    out.chapter_subtopic_overview = `${topic} in ${subject}: overview of definitions, processes, and how ideas connect across the chapter.`;
  }
  if (!Array.isArray(out.learning_objectives) || out.learning_objectives.length < 2) {
    out.learning_objectives = [
      `Explain the main ideas of ${topic}.`,
      `Solve short application questions on ${topic}.`,
    ];
    out.learningObjectives = out.learning_objectives;
  }
  if (!Array.isArray(out.key_concepts) || !out.key_concepts.length) {
    out.key_concepts = [
      {
        name: topic,
        explanation: `Central concept for ${topic} with cause–effect links and one labelled diagram cue.`,
        examples: [`Classroom example for ${topic}.`],
      },
    ];
  }
  if (!Array.isArray(out.quick_revision_notes) || out.quick_revision_notes.length < 3) {
    out.quick_revision_notes = [
      `Definition: ${topic} in one sentence.`,
      `Process: step-by-step mechanism for ${topic}.`,
      `Exam tip: common ${topic} question pattern.`,
    ];
  }
  if (!Array.isArray(out.practice_questions) || !out.practice_questions.length) {
    out.practice_questions = [
      { question: `Define ${topic} and give one example.`, answer: `Open response using ${topic} vocabulary.` },
    ];
  }
  return out;
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
  if (skipEnglishStructuredScaffold(meta)) return out;
  const title = String(out.topic_title || out.title || '').trim();
  const isGeneric = !title || /^key\s*points$/i.test(title);
  if (isGeneric) {
    const label = [meta.topic, meta.subTopic].filter(Boolean).join(' — ').trim() || 'Topic';
    const nextTitle = `Key Points: ${label}`;
    out = { ...out, topic_title: nextTitle, title: nextTitle };
  }
  if (!Array.isArray(out.formulae) || out.formulae.length < 3) {
    let derived = normalizeKeyPointsFormulaeList(out);
    if (derived.length < 3 && Array.isArray(out.important_concepts)) {
      for (const concept of out.important_concepts) {
        if (derived.length >= 3) break;
        const line = String(concept || '').trim();
        if (!line) continue;
        derived.push({ name: 'Concept', formula: line, note: '' });
      }
    }
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
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this topic').trim();
  if (!Array.isArray(out.important_concepts) || !out.important_concepts.length) {
    out.important_concepts = [
      `Core idea 1 about ${topic}.`,
      `Core idea 2 about ${topic}.`,
      `Core idea 3 about ${topic}.`,
    ];
  }
  if (!Array.isArray(out.formulae) || out.formulae.length < 3) {
    out.formulae = out.important_concepts.slice(0, 3).map((line, i) => ({
      name: `Rule ${i + 1}`,
      formula: String(line),
      note: '',
    }));
    out.formulas = out.formulae;
  }
  if (!Array.isArray(out.must_remember_facts) || !out.must_remember_facts.length) {
    out.must_remember_facts = [`Remember the main process in ${topic}.`];
    out.key_points = out.must_remember_facts;
  }
  if (!String(out.one_minute_revision_summary || '').trim()) {
    out.one_minute_revision_summary = `One-minute recap of ${topic} for quick revision.`;
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

/** AI Generator: pad all 11 assignment sections before validation. */
export function finalizeQuickAssignmentStructuredContent(structuredContent, meta = {}) {
  const raw =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {};
  let out = normalizeQuickAssignmentStructuredContent(raw);
  if (skipEnglishStructuredScaffold(meta)) return out;
  if (isAiGeneratorSectionPadEnabled()) {
    out = padAiGeneratorCanonicalSections('quick-assignment-builder', out, meta);
    out = normalizeQuickAssignmentStructuredContent(out);
  }
  let assignmentTitle = String(out.assignment_title || out.title || '').trim();
  const isGenericTitle =
    !assignmentTitle ||
    /^assignment$/i.test(assignmentTitle) ||
    /^quick\s*assignment$/i.test(assignmentTitle) ||
    assignmentTitle.length < 8;
  if (isGenericTitle) {
    const label = [meta.subTopic || meta.subtopic, meta.topic].filter(Boolean).join(' — ').trim();
    assignmentTitle = label ? `${label} — Quick Assignment` : 'Quick Assignment';
    out = { ...out, assignment_title: assignmentTitle, title: assignmentTitle };
  }
  return out;
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
  const front = stripAiGeneratorLeakage(
    String(
      source.front ||
        source.task ||
        source.question ||
        source.term ||
        source.prompt ||
        source.cue ||
        source.name ||
        source.title ||
        '',
    ).trim(),
  );
  const back = stripAiGeneratorLeakage(
    String(
      source.back ||
        source.solution ||
        source.correct_answer ||
        source.answer ||
        source.definition ||
        source.meaning ||
        source.response ||
        source.description ||
        source.content ||
        '',
    ).trim(),
  );
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

  const deck_title = stripAiGeneratorLeakage(
    String(source.flashcard_deck_title || source.deck_title || source.title || '').trim(),
  );
  let topic = stripLessonPlanLeakFromLabel(String(source.topic || '').trim());
  let subtopic = stripLessonPlanLeakFromLabel(
    String(source.subtopic || source.sub_topic || source.subTopic || '').trim(),
  );
  if (/classlevel|difficultylevel|bloom_level|bloomlevel/i.test(topic)) topic = '';
  if (/classlevel|difficultylevel|bloom_level|bloomlevel/i.test(subtopic)) subtopic = '';
  let topic_and_subtopic_link = sanitizeFlashcardTopicLink(
    String(source.topic_and_subtopic_link || source.subtopic_link || '').trim(),
  );
  if (!topic && topic_and_subtopic_link) {
    const parts = topic_and_subtopic_link.split(/\s*[—–\-:]\s*/);
    topic = String(parts[0] || '').trim();
    if (!subtopic && parts.length > 1) subtopic = String(parts.slice(1).join(' — ') || '').trim();
  }
  const class_level = normalizeFlashcardClassLevel(
    String(source.class_level || source.classLabel || source.class || ''),
  );
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

function filterFlashcardRowsByScript(cards = [], script) {
  if (!script) return cards;
  return cards.filter((c) => {
    const front = String(c?.front || c?.task || c?.question || c?.term || '').trim();
    const back = String(c?.back || c?.solution || c?.answer || c?.definition || '').trim();
    if (front.length < 4 || back.length < 4) return false;
    return (
      textMatchesStoryPassageScript(front, script, { strict: false }) &&
      textMatchesStoryPassageScript(back, script, { strict: false })
    );
  });
}

function countValidFlashcardRows(cards = []) {
  return (Array.isArray(cards) ? cards : []).filter((c) => {
    const row = normalizeFlashcardCard(c);
    if (isScaffoldFlashcardPair(row.front, row.back)) return false;
    return (
      String(row.front || '').trim().length >= 4 && String(row.back || '').trim().length >= 4
    );
  }).length;
}

/** Count cards with front/back text — includes intentional scaffold padding rows. */
function countFlashcardRowsWithFaces(cards = []) {
  return (Array.isArray(cards) ? cards : []).filter((c) => {
    const row = normalizeFlashcardCard(c);
    return (
      String(row.front || '').trim().length >= 4 && String(row.back || '').trim().length >= 4
    );
  }).length;
}

function dropScaffoldFlashcardRows(cards = []) {
  return (Array.isArray(cards) ? cards : []).filter((c) => {
    const row = normalizeFlashcardCard(c);
    return !isScaffoldFlashcardPair(row.front, row.back);
  });
}

function resolveFlashcardCardsForSave(cards = [], minCards = 5, opts = {}) {
  const keepScaffoldIfNeeded = opts.keepScaffoldIfNeeded === true;
  const faced = (Array.isArray(cards) ? cards : [])
    .map((c) => normalizeFlashcardCard(c))
    .filter(
      (c) =>
        String(c.front || '').trim().length >= 4 && String(c.back || '').trim().length >= 4,
    );
  const real = faced.filter((c) => !isScaffoldFlashcardPair(c.front, c.back));
  if (real.length >= minCards) return real;
  if (real.length > 0 && !keepScaffoldIfNeeded) return real;
  if (keepScaffoldIfNeeded && faced.length >= minCards) return faced;
  if (faced.length > 0) return faced;
  return real;
}

function structuredContentHasPromptLeak(value) {
  const blob = JSON.stringify(value || {});
  return (
    /\bNo filler content\b/i.test(blob) ||
    /\bValid JSON output required\b/i.test(blob) ||
    (/\bReady\b/gi.test(blob) && (blob.match(/\bReady\b/gi) || []).length >= 4)
  );
}

function shouldRelaxFlashcardBatchSave(meta = {}, toolSlug = '') {
  const slug = String(toolSlug || '').trim();
  return (
    meta.batchOrchestrator === true &&
    (slug === 'flashcard-generator' || slug === 'my-study-decks')
  );
}

function flashcardDeckNeedsCardRepair(data, toolSlug = 'flashcard-generator', minOverride) {
  const slug = String(toolSlug || '').trim();
  const minCards =
    Number(minOverride) > 0 ? Number(minOverride) : slug === 'my-study-decks' ? 10 : 5;
  const n =
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent(data)
      : normalizeMyStudyDecksStructuredContent(data);
  return countValidFlashcardRows(n.cards) < minCards;
}

function isFlashcardFrameworkScaffoldText(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  return (
    /^Students should recall basic ideas about .+ before using this deck\.?$/i.test(s) ||
    /^Define and explain key ideas about .+\.?$/i.test(s) ||
    /^Apply .+ to short real-life examples\.?$/i.test(s) ||
    /^NCF-aligned: conceptual understanding and application for .+ in .+\.?$/i.test(s) ||
    /^Link each .+ idea to a vivid daily-life image to remember the deck\.?$/i.test(s) ||
    /^Rapid recall: cover each card, then explain .+ in your own words\.?$/i.test(s) ||
    /^Support: use memory hooks and pair review\. Extension: create two new cards for .+\.?$/i.test(s) ||
    /^Relate each card to an observation from daily life linked to .+\.?$/i.test(s) ||
    /^Which card was hardest for .+, and why\?$/i.test(s) ||
    /^Mixing opinion with evidence when studying .+\.?$/i.test(s)
  );
}

function flashcardDeckNeedsFrameworkRepair(data, toolSlug = 'flashcard-generator') {
  const slug = String(toolSlug || '').trim();
  if (slug !== 'flashcard-generator') return false;
  const n = normalizeFlashcardDeckStructuredContent(data);
  const frameworkFields = [
    n.prior_knowledge_required,
    n.ncf_competency_alignment,
    n.deck_memory_hook,
    n.self_check_rapid_recall_round,
    n.real_life_connection,
    n.differentiation_support,
    n.reflection_exit_ticket,
    ...(Array.isArray(n.learning_objectives) ? n.learning_objectives : []),
    ...(Array.isArray(n.common_mistakes_to_avoid) ? n.common_mistakes_to_avoid : []),
  ];
  if (frameworkFields.some((row) => isFlashcardFrameworkScaffoldText(row))) return true;
  if (!String(n.prior_knowledge_required || '').trim()) return true;
  if (!Array.isArray(n.learning_objectives) || n.learning_objectives.length < 2) return true;
  if (!String(n.ncf_competency_alignment || '').trim()) return true;
  if (!String(n.deck_memory_hook || '').trim()) return true;
  if (!Array.isArray(n.common_mistakes_to_avoid) || n.common_mistakes_to_avoid.length < 1) return true;
  if (!String(n.self_check_rapid_recall_round || '').trim()) return true;
  if (!String(n.real_life_connection || '').trim()) return true;
  if (!String(n.differentiation_support || '').trim()) return true;
  if (!String(n.reflection_exit_ticket || '').trim()) return true;
  return false;
}

async function ensureFlashcardDeckQuality(structuredContent, meta, slug, historicalBlock = '') {
  const minCards = slug === 'my-study-decks' ? 10 : 5;
  let content = structuredContent;
  const needsCards = flashcardDeckNeedsCardRepair(content, slug, minCards);
  const needsFramework = flashcardDeckNeedsFrameworkRepair(content, slug);

  if (needsCards) {
    console.log(
      `[AI Generator] ${slug} repairing cards via LLM (${countValidFlashcardRows(content?.cards)}/${minCards} valid).`,
    );
    content = await repairFlashcardCardsViaLlm(slug, content, meta, historicalBlock);
  }
  if (needsFramework) {
    console.log(`[AI Generator] ${slug} repairing deck framework sections via LLM.`);
    content = await repairFlashcardFrameworkViaLlm(slug, content, meta, historicalBlock);
  }
  if (needsCards || needsFramework) {
    content = finalizeFlashcardDeckStructuredContent(
      content,
      { ...meta, skipCardPadding: true, skipFrameworkScaffold: true },
      slug,
    );
  }
  return content;
}

function hasSubstantiveGenerationOutput(slug, structured) {
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return false;
  const s = String(slug || '').trim();
  if (s === 'flashcard-generator' || s === 'my-study-decks') {
    return countValidFlashcardRows(structured.cards) >= 3;
  }
  const blob = JSON.stringify(structured);
  if (blob.length < 160) return false;
  const title = String(
    structured.title ||
      structured.lesson_name ||
      structured.worksheet_title ||
      structured.mock_test_title ||
      structured.paper_title ||
      structured.flashcard_deck_title ||
      structured.chapter_summary_title ||
      structured.study_guide_title ||
      '',
  ).trim();
  return title.length >= 4 || blob.length >= 400;
}

async function lastChanceRecoverAiGeneratorOutput(
  slug,
  structuredContent,
  meta,
  historicalBlock,
  contentType,
  validationSourceText,
) {
  let content =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? { ...structuredContent }
      : {};
  const recoveryMeta = { ...meta, strictValidation: false, skipCardPadding: true };

  content = padAiGeneratorCanonicalSections(slug, content, recoveryMeta);

  if (slug === 'activity-project-generator' || slug === 'project-idea-lab') {
    content = finalizeActivityStructuredContent(content, recoveryMeta, slug);
  } else if (slug === 'worksheet-mcq-generator') {
    content = finalizeWorksheetStructuredContent(content, recoveryMeta);
  } else if (slug === 'concept-mastery-helper') {
    content = finalizeConceptMasteryStructuredContent(content, recoveryMeta);
  } else if (slug === 'lesson-planner' || slug === 'study-schedule-maker') {
    content = normalizeLessonPlannerStructuredContent(content, slug);
  } else if (slug === 'homework-creator') {
    content = finalizeHomeworkStructuredContent(content, recoveryMeta);
  } else if (slug === 'reading-practice-room') {
    content = fillIndicReadingPracticeScaffold(
      normalizeReadingPracticeStructuredContent(content),
      recoveryMeta,
    );
  } else if (slug === 'story-passage-creator') {
    content = finalizeStoryPassageStructuredContent(content, recoveryMeta);
  } else if (slug === 'short-notes-summaries-maker') {
    content = finalizeShortNotesStructuredContent(content, recoveryMeta);
  } else if (slug === 'flashcard-generator' || slug === 'my-study-decks') {
    content = finalizeFlashcardDeckStructuredContent(content, recoveryMeta, slug);
    content = await ensureFlashcardDeckQuality(content, recoveryMeta, slug, historicalBlock);
  } else if (slug === 'daily-class-plan-maker') {
    content = finalizeDailyClassPlanStructuredContent(content, recoveryMeta);
  } else if (slug === 'mock-test-builder') {
    content = finalizeMockTestStructuredContent(content, recoveryMeta);
  } else if (slug === 'exam-question-paper-generator') {
    content = finalizeExamPaperStructuredContent(content, recoveryMeta);
  } else if (slug === 'smart-study-guide-generator') {
    content = finalizeStudyGuideStructuredContent(content, recoveryMeta);
  } else if (slug === 'concept-breakdown-explainer') {
    content = finalizeConceptBreakdownStructuredContent(content, recoveryMeta);
  } else if (slug === 'smart-qa-practice-generator') {
    content = finalizePracticeQaStructuredContent(content, recoveryMeta);
    content = await ensurePracticeQaQuality(content, recoveryMeta, historicalBlock);
    content = ensurePracticeQaAllSectionsFilled(content, recoveryMeta);
  } else if (slug === 'chapter-summary-creator') {
    content = finalizeChapterSummaryStructuredContent(content, recoveryMeta);
  } else if (slug === 'key-points-formula-extractor') {
    content = finalizeKeyPointsStructuredContent(content, recoveryMeta);
  } else if (slug === 'quick-assignment-builder') {
    content = finalizeQuickAssignmentStructuredContent(content, recoveryMeta);
  }

  const fieldCheck = validateAllCanonicalToolFields(slug, content);
  let missing = [...(fieldCheck.missingSections || [])];
  const probe = validateToolSpecificStructuredContent(
    slug,
    content,
    contentType,
    validationSourceText,
    recoveryMeta,
  );
  if (!probe.valid) {
    if (Array.isArray(probe.missingSections) && probe.missingSections.length) {
      missing = [...new Set([...missing, ...probe.missingSections])];
    } else if (probe.message) {
      missing.push(probe.message);
    }
  }
  missing = missing.filter(Boolean).slice(0, 10);

  if (missing.length) {
    console.log(`[AI Generator] ${slug} last-chance LLM repair for ${missing.length} gap(s).`);
    content = await repairMissingSectionsViaLlm(slug, content, missing, recoveryMeta, historicalBlock);
  }

  if ((slug === 'flashcard-generator' || slug === 'my-study-decks') && flashcardDeckNeedsCardRepair(content, slug)) {
    content = await ensureFlashcardDeckQuality(content, recoveryMeta, slug, historicalBlock);
  }

  return content;
}

function flashcardBatchHasSaveableContent(data, toolSlug = 'flashcard-generator') {
  const slug = String(toolSlug || '').trim();
  const minCards = slug === 'my-study-decks' ? 10 : 5;
  const n =
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent(data)
      : normalizeMyStudyDecksStructuredContent(data);
  const title = String(n.flashcard_deck_title || n.deck_title || n.title || '').trim();
  return Boolean(title) && countValidFlashcardRows(n.cards) >= minCards;
}

/** @returns {string[]} Missing flashcard deck requirements for validation / retries. */
export function getFlashcardDeckMissingSections(
  data,
  toolSlug = 'flashcard-generator',
  meta = {},
) {
  const slug = String(toolSlug || '').trim();
  const n =
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent(data)
      : normalizeMyStudyDecksStructuredContent(data);
  const missing = [];
  const minCards = slug === 'my-study-decks' ? 10 : 5;
  const relaxedBatch = shouldRelaxFlashcardBatchSave(meta, slug);
  const cardCount = countValidFlashcardRows(n.cards);
  if (cardCount < minCards) {
    missing.push(
      slug === 'my-study-decks'
        ? `Flashcard set (need ${minCards}+ cards, each with front and back)`
        : `The Card Set: Application & HOTS (min ${minCards} cards with Task and Solution)`,
    );
  }
  if (slug === 'flashcard-generator') {
    if (!String(n.flashcard_deck_title || n.deck_title || n.title || '').trim()) {
      missing.push('Context & Alignment: Deck Title');
    }
    if (relaxedBatch) {
      return missing;
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

function resolveFlashcardTopicLabel(meta = {}) {
  const candidates = [
    meta.subTopic,
    meta.subtopic,
    meta.topic,
    meta.topicName,
    meta.chapter,
  ]
    .map((x) => stripLessonPlanLeakFromLabel(stripAiGeneratorLeakage(String(x || '').trim())))
    .filter(Boolean)
    .filter((x) => !/^this subtopic$/i.test(x));
  if (candidates.length) return candidates[0];
  const subject = stripAiGeneratorLeakage(String(meta.subject || '').trim());
  return subject || 'Lesson';
}

function replaceThisSubtopicPlaceholder(text, topic) {
  return String(text || '').replace(/\bthis subtopic\b/gi, topic);
}

/** Merge typed card groups and pad deck narrative fields; build cards from objectives when needed. */
export function finalizeFlashcardDeckStructuredContent(structuredContent, meta = {}, toolSlug = 'flashcard-generator') {
  const slug = String(toolSlug || '').trim();
  const base =
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent(structuredContent)
      : normalizeMyStudyDecksStructuredContent(structuredContent);

  const topic = resolveFlashcardTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const skipEnglishScaffold = mustEnforceStoryPassageLanguageCompliance(subject);
  const isBatchDeck = meta.batchOrchestrator === true;
  const skipFrameworkScaffold = meta.skipFrameworkScaffold === true || isBatchDeck || meta.skipCardPadding === true;
  const generationFailed = structuredContentHasPromptLeak(structuredContent);
  const skipEnglishScaffoldDueToLeak = !skipEnglishScaffold && generationFailed && !isBatchDeck;
  const allowFrameworkScaffold =
    !skipEnglishScaffold && !skipEnglishScaffoldDueToLeak && !skipFrameworkScaffold;
  const bloomLevels = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];

  // Model sometimes copies the prompt placeholder "this subtopic" into titles.
  for (const key of ['flashcard_deck_title', 'deck_title', 'title']) {
    if (base[key] != null) base[key] = replaceThisSubtopicPlaceholder(base[key], topic);
  }
  for (const key of ['learning_objectives', 'expected_learning_outcomes']) {
    if (Array.isArray(base[key])) {
      base[key] = base[key].map((row) => replaceThisSubtopicPlaceholder(row, topic));
    }
  }
  for (const key of [
    'subtopic_link_prior_knowledge_required',
    'ncf_competency_alignment',
    'prior_knowledge_required',
  ]) {
    if (base[key] != null) base[key] = replaceThisSubtopicPlaceholder(base[key], topic);
  }

  if (!skipEnglishScaffold && !skipEnglishScaffoldDueToLeak && !String(base.flashcard_deck_title || base.deck_title || base.title || '').trim()) {
    base.deck_title = `${topic} — Flashcards`;
    base.title = base.deck_title;
    if (slug === 'flashcard-generator') base.flashcard_deck_title = base.deck_title;
  }

  if (slug === 'flashcard-generator' && allowFrameworkScaffold) {
    if (!String(base.topic || '').trim()) {
      base.topic = String(meta.topic || meta.subject || subject).trim() || subject;
    }
    if (!String(base.subtopic || '').trim()) {
      base.subtopic = topic;
    }
    if (!String(base.topic_and_subtopic_link || '').trim()) {
      base.topic_and_subtopic_link = sanitizeFlashcardTopicLink(`${base.topic} — ${base.subtopic}`);
    }
    if (!String(base.class_level || '').trim()) {
      base.class_level = normalizeFlashcardClassLevel(
        String(meta.classLabel || meta.class || meta.grade || '10').trim(),
      );
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
  } else if (allowFrameworkScaffold) {
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

  if (allowFrameworkScaffold && (!Array.isArray(base.common_mistakes_to_avoid) || !base.common_mistakes_to_avoid.length)) {
    base.common_mistakes_to_avoid = [`Mixing opinion with evidence when studying ${topic}.`];
  }
  if (allowFrameworkScaffold && (!Array.isArray(base.expected_learning_outcomes) || !base.expected_learning_outcomes.length)) {
    base.expected_learning_outcomes = [`Students recall and explain core ideas about ${topic}.`];
  }
  if (allowFrameworkScaffold && !String(base.reflection_exit_ticket || '').trim()) {
    base.reflection_exit_ticket = `Which card was hardest for ${topic}, and why?`;
  }

  if (allowFrameworkScaffold && (!Array.isArray(base.learning_objectives) || base.learning_objectives.length < 2)) {
    base.learning_objectives = [
      `Define and explain key ideas about ${topic}.`,
      `Apply ${topic} to short real-life examples.`,
    ];
  }

  const minCards = slug === 'my-study-decks' ? 10 : 5;
  let cards = Array.isArray(base.cards) ? base.cards.map((c) => normalizeFlashcardCard(c)) : [];
  const initialValidCards = countValidFlashcardRows(cards);
  const skipCardPadding = meta.skipCardPadding === true || isBatchDeck;
  const skipScaffoldPadding =
    skipCardPadding || (!isBatchDeck && skipEnglishScaffoldDueToLeak && initialValidCards === 0);
  if (!skipEnglishScaffold && !skipScaffoldPadding) {
  let padSafety = 0;
  while (countFlashcardRowsWithFaces(cards) < minCards && padSafety < minCards + 8) {
    padSafety += 1;
    const objectives = Array.isArray(base.learning_objectives) ? base.learning_objectives : [];
    for (const obj of objectives) {
      if (countFlashcardRowsWithFaces(cards) >= minCards) break;
      const text = String(obj || '').trim();
      if (!text) continue;
      const stem = text
        .replace(/^Define and explain (key ideas about )?/i, '')
        .replace(/^Apply\s+/i, '')
        .replace(/\s+to short real-life examples\.?$/i, '')
        .replace(/\.$/, '')
        .trim() || topic;
      if (/^Apply\b/i.test(text) || /short real-life examples/i.test(text)) continue;
      cards.push(
        normalizeFlashcardCard({
          front: `What are the key ideas about ${stem}?`,
          back: `Students should define the concept, give one example, and explain how it connects to ${topic} in ${subject}.`,
          difficulty_tag_for_each_card: bloomLevels[cards.length % bloomLevels.length],
          memory_hook_quick_tip: `Link this idea about ${topic} to a story you know.`,
          self_check_round: `Can you explain this without looking at the card?`,
        }),
      );
    }
    const keyPoints = []
      .concat(
        Array.isArray(base.key_points_to_remember) ? base.key_points_to_remember : [],
        Array.isArray(base.key_points) ? base.key_points : [],
      )
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    for (const kp of keyPoints) {
      if (countFlashcardRowsWithFaces(cards) >= minCards) break;
      cards.push(
        normalizeFlashcardCard({
          front: kp.includes('?') ? kp : `What is ${kp}?`,
          back: kp,
          difficulty_tag_for_each_card: bloomLevels[cards.length % bloomLevels.length],
          memory_hook_quick_tip: `Picture ${kp} in a scene from ${topic}.`,
          self_check_round: `State ${kp} in one clear sentence.`,
        }),
      );
    }
    if (countFlashcardRowsWithFaces(cards) >= minCards) break;
    const n = cards.length + 1;
    cards.push(
      normalizeFlashcardCard({
        front: `${topic} — key idea ${n}`,
        back: `Summarize one key idea about ${topic} and support it with a fact or example.`,
        difficulty_tag_for_each_card: bloomLevels[(n - 1) % bloomLevels.length],
        memory_hook_quick_tip: `Associate card ${n} with a vivid image from ${topic}.`,
        self_check_round: `Explain card ${n} to a partner without peeking.`,
      }),
    );
  }
  }

  if (!skipEnglishScaffold) {
    base.cards = resolveFlashcardCardsForSave(
      cards.filter(
        (c) => String(c.front || '').trim().length >= 4 && String(c.back || '').trim().length >= 4,
      ),
      minCards,
      { keepScaffoldIfNeeded: false },
    );
    base.application_hots_cards = base.cards;
    base.flashcard_set = base.cards;
  }

  if (skipEnglishScaffold) {
    const canonical = canonicalStoryPassageSubject(subject);
    const script = canonical === 'Hindi' ? 'devanagari' : canonical === 'Telugu' ? 'telugu' : null;
    cards = filterFlashcardRowsByScript(cards, script);
    const classLabel = String(meta.classLabel || meta.class || meta.grade || '').trim();
    if (slug === 'flashcard-generator') {
      if (!String(base.topic || '').trim()) base.topic = String(meta.topic || subject).trim() || subject;
      if (!String(base.subtopic || '').trim()) base.subtopic = topic;
      if (!String(base.topic_and_subtopic_link || '').trim()) {
        base.topic_and_subtopic_link = sanitizeFlashcardTopicLink(`${base.topic} — ${base.subtopic}`);
      }
      if (!String(base.class_level || '').trim() && classLabel) {
        base.class_level = normalizeFlashcardClassLevel(classLabel);
      }
      const deckTitleRaw = String(base.flashcard_deck_title || base.deck_title || base.title || '').trim();
      if (!deckTitleRaw || /this subtopic/i.test(deckTitleRaw)) {
        base.flashcard_deck_title =
          canonical === 'Hindi'
            ? `${topic} — फ़्लैशकार्ड`
            : canonical === 'Telugu'
              ? `${topic} — ఫ్లాష్‌కార్డ్‌లు`
              : `${topic} — flashcards`;
        base.deck_title = base.flashcard_deck_title;
        base.title = base.flashcard_deck_title;
      }
      if (!String(base.prior_knowledge_required || '').trim()) {
        base.prior_knowledge_required =
          canonical === 'Hindi'
            ? 'छात्रों को इस पाठ की बुनियादी समझ पहले से होनी चाहिए।'
            : canonical === 'Telugu'
              ? 'విద్యార్థులకు ఈ పాఠం యొక్క ప్రాథమిక అవగాహన ఉండాలి.'
              : '';
      }
      if (!Array.isArray(base.learning_objectives) || base.learning_objectives.length < 2) {
        base.learning_objectives =
          canonical === 'Hindi'
            ? ['पाठ के मुख्य विचारों को अपनी भाषा में समझाना।', 'पाठ से संबंधित प्रश्नों का उत्तर देना।']
            : canonical === 'Telugu'
              ? ['పాఠం ప్రధాన అంశాలను వివరించడం.', 'పాఠానికి సంబంధించిన ప్రశ్నలకు సమాధానం ఇవ్వడం.']
              : base.learning_objectives || [];
      }
      if (!String(base.ncf_competency_alignment || '').trim()) {
        base.ncf_competency_alignment =
          canonical === 'Hindi'
            ? 'एनसीएफ: पाठ की अवधारणात्मक समझ और अनुप्रयोग।'
            : canonical === 'Telugu'
              ? 'NCF: పాఠం యొక్క సంభావనాత్మక అవగాహన.'
              : '';
      }
      if (!String(base.deck_memory_hook || '').trim()) {
        base.deck_memory_hook =
          canonical === 'Hindi'
            ? 'प्रत्येक कार्ड को पाठ की कहानी या चित्र से जोड़कर याद रखें।'
            : canonical === 'Telugu'
              ? 'ప్రతి కార్డ్‌ను పాఠంలోని చిత్రంతో అనుసంధానించి గుర్తుంచుకోండి.'
              : '';
      }
      if (!String(base.self_check_rapid_recall_round || '').trim()) {
        base.self_check_rapid_recall_round =
          canonical === 'Hindi'
            ? 'कार्ड ढककर पाठ के मुख्य बिंदु बिना देखे बताएँ।'
            : canonical === 'Telugu'
              ? 'కార్డ్‌ను మూసి పాఠం ప్రధాన అంశాలు చెప్పండి.'
              : '';
      }
      if (!Array.isArray(base.common_mistakes_to_avoid) || !base.common_mistakes_to_avoid.length) {
        base.common_mistakes_to_avoid =
          canonical === 'Hindi'
            ? ['पाठ को समझे बिना केवल शब्द रटना।']
            : canonical === 'Telugu'
              ? ['పాఠం అర్థం చేసుకోకుండా పాఠం గుర్తు పెట్టుకోవడం.']
              : [];
      }
      if (!String(base.real_life_connection || '').trim()) {
        base.real_life_connection =
          canonical === 'Hindi'
            ? 'पाठ से जुड़ा एक दैनिक जीवन का उदाहरण सोचें और कार्ड से जोड़ें।'
            : canonical === 'Telugu'
              ? 'పాఠానికి సంబంధించిన నిత్యజీవిత ఉదాహరణను కార్డ్‌తో అనుసంధానించండి.'
              : '';
      }
      if (!String(base.differentiation_support || '').trim()) {
        base.differentiation_support =
          canonical === 'Hindi'
            ? 'कमज़ोर छात्र: साथी के साथ कार्ड पढ़ें। उन्नत: पाठ पर दो नए प्रश्न बनाएँ।'
            : canonical === 'Telugu'
              ? 'బలహీన విద్యార్థులు: భాగస్వామితో కార్డ్‌లు చదవండి. అధునాతన: పాఠంపై రెండు కొత్త ప్రశ్నలు.'
              : '';
      }
      if (!String(base.reflection_exit_ticket || '').trim()) {
        base.reflection_exit_ticket =
          canonical === 'Hindi'
            ? 'इस पाठ पर सबसे कठिन कार्ड कौन-सा था और क्यों?'
            : canonical === 'Telugu'
              ? 'ఈ పాఠంలో అత్యంత కష్టమైన కార్డ్ ఏది? ఎందుకు?'
              : '';
      }
    } else {
      // my-study-decks (and other non-flashcard-generator decks)
      const needsTitle =
        !String(base.deck_title || base.title || '').trim() ||
        /this subtopic/i.test(String(base.deck_title || base.title || ''));
      if (needsTitle) {
        base.deck_title =
          canonical === 'Hindi'
            ? `${topic} — फ़्लैशकार्ड`
            : canonical === 'Telugu'
              ? `${topic} — ఫ్లాష్‌కార్డ్‌లు`
              : `${topic} — Flashcards`;
        base.title = base.deck_title;
      }
      if (!String(base.subtopic_link_prior_knowledge_required || '').trim()) {
        base.subtopic_link_prior_knowledge_required =
          canonical === 'Hindi'
            ? `${topic} — पूर्व ज्ञान: पाठ की बुनियादी शब्दावली।`
            : canonical === 'Telugu'
              ? `${topic} — ముందస్తు జ్ఞానం: ప్రాథమిక పదజాలం.`
              : `${topic} — prior knowledge.`;
      }
      if (!Array.isArray(base.learning_objectives) || base.learning_objectives.length < 2) {
        base.learning_objectives =
          canonical === 'Hindi'
            ? [`${topic} के मुख्य विचारों को अपनी भाषा में समझाना।`, `${topic} से संबंधित प्रश्नों का उत्तर देना।`]
            : canonical === 'Telugu'
              ? [`${topic} ప్రధాన అంశాలను వివరించడం.`, `${topic}కి సంబంధించిన ప్రశ్నలకు సమాధానం ఇవ్వడం.`]
              : [`Define and explain key ideas about ${topic}.`, `Apply ${topic} to short examples.`];
      } else {
        base.learning_objectives = base.learning_objectives.map((row) =>
          replaceThisSubtopicPlaceholder(row, topic),
        );
      }
      if (!String(base.ncf_competency_alignment || '').trim() || /this subtopic/i.test(String(base.ncf_competency_alignment))) {
        base.ncf_competency_alignment =
          canonical === 'Hindi'
            ? `एनसीएफ: ${topic} की अवधारणात्मक समझ और अनुप्रयोग।`
            : canonical === 'Telugu'
              ? `NCF: ${topic} యొక్క సంభావనాత్మక అవగాహన.`
              : `Aligned to ${subject} competencies for ${topic}.`;
      }
    }

    while (countFlashcardRowsWithFaces(cards) < minCards) {
      const n = cards.length + 1;
      if (canonical === 'Hindi') {
        cards.push(
          normalizeFlashcardCard({
            front: `प्रश्न ${n}: इस पाठ का मुख्य संदेश क्या है?`,
            back: `उत्तर ${n}: पाठ में बताए गए महत्वपूर्ण विचार को अपने शब्दों में लिखें।`,
            difficulty_tag_for_each_card: 'समझ',
            memory_hook_quick_tip: 'पाठ की कहानी से इस बिंदु को जोड़कर याद रखें।',
            self_check_round: 'बिना कार्ड देखे अपने शब्दों में उत्तर दें।',
          }),
        );
      } else if (canonical === 'Telugu') {
        cards.push(
          normalizeFlashcardCard({
            front: `ప్రశ్న ${n}: ఈ పాఠం యొక్క ప్రధాన సందేశం ఏమిటి?`,
            back: `సమాధానం ${n}: పాఠంలో చెప్పిన ముఖ్య అంశాన్ని మీ మాటల్లో రాయండి.`,
            difficulty_tag_for_each_card: 'అవగాహన',
            memory_hook_quick_tip: 'పాఠాన్ని ఈ అంశంతో అనుసంధానించి గుర్తుంచుకోండి.',
            self_check_round: 'కార్డ్ చూడకుండా మీ మాటల్లో సమాధానం ఇవ్వండి.',
          }),
        );
      } else {
        break;
      }
    }
    base.cards = cards.filter(
      (c) => String(c.front || '').trim().length >= 4 && String(c.back || '').trim().length >= 4,
    );
    base.application_hots_cards = base.cards;
    base.flashcard_set = base.cards;
  }

  if (slug === 'my-study-decks' && !skipEnglishScaffold) {
    const lead = base.cards[0];
    if (!String(base.difficulty_tag_for_each_card || '').trim()) {
      base.difficulty_tag_for_each_card =
        lead?.difficulty_tag_for_each_card || lead?.difficulty_tag || 'Understand';
    }
    if (!String(base.memory_hook_quick_tip || '').trim()) {
      base.memory_hook_quick_tip =
        lead?.memory_hook_quick_tip ||
        lead?.memory_cue ||
        `Use a picture or rhyme to remember ideas about ${topic}.`;
    }
    if (!String(base.self_check_round || '').trim()) {
      base.self_check_round =
        lead?.self_check_round ||
        lead?.peer_prompt ||
        `Cover each card, then explain ${topic} in your own words.`;
    }
  }

  return sanitizeAiStructuredTextDeep(
    slug === 'flashcard-generator'
      ? normalizeFlashcardDeckStructuredContent(base)
      : normalizeMyStudyDecksStructuredContent(base),
  );
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

/** Prefer sub-topic, then topic, then book title — never bare "this topic" in batch saves. */
export function resolveWorksheetTopicLabel(meta = {}) {
  const label = String(
    meta.subTopic ||
      meta.subtopic ||
      meta.topic ||
      meta.bookTitle ||
      meta.chapter ||
      '',
  ).trim();
  if (label && !/^this\s+topic$/i.test(label)) return label;
  const subject = String(meta.subject || meta.bookSubject || '').trim();
  const book = String(meta.bookTitle || '').trim();
  const variant = Number(meta.generationVariant) || 0;
  if (subject && book) return `${subject} — ${book.slice(0, 56)}`;
  if (book) return book;
  if (subject) return `${subject} lesson`;
  return variant > 0 ? `Lesson focus (set ${variant})` : 'Lesson focus';
}

/** Ensure question stem does not match any text already used in this batch. */
function guaranteeBatchUniqueQuestionText(text, usedTexts = [], salt = 0) {
  const threshold = getQuestionSimilarityThreshold();
  const avoid = Array.isArray(usedTexts) ? usedTexts.filter(Boolean) : [];
  let stem = String(text || '').trim();
  if (!stem) return stem;
  for (let i = 0; i < 48; i += 1) {
    const dup = findSimilarText(stem, avoid, threshold);
    if (!dup.duplicate) return stem;
    stem = `${String(text || '').trim()} [Worksheet ${salt + i + 1}]`;
  }
  return `${text} · unique ${salt}-${hashSeedToInt(avoid.join('|'))}`;
}

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
  const raw = stripPdfAnswerKeyMarker(text);
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

/** Strip internal merge marker; keep only the canonical sectioned answer key block. */
function stripPdfAnswerKeyMarker(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(/\n*---\s*PDF Answer Key\s*---\s*\n?/gi)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] || '';
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

/** Ensure sections A–E each have at least one valid question (post-dedupe / post-repair safety net). */
function padMissingWorksheetSections(sections = [], meta = {}) {
  const topic = resolveWorksheetTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const greatQuality = isAiGeneratorGreatQualityEnabled() || meta.greatQuality === true;
  const preferBook =
    !greatQuality &&
    Boolean(meta.bookGenerator || String(meta.pdfContext || meta.sourceText || '').trim().length > 80);
  const pdfContext = String(meta.pdfContext || meta.sourceText || '')
    .replace(/USER-SELECTED CURRICULUM[\s\S]*?(?=\[Chunk|\n{2,}|$)/i, '')
    .trim();
  const sentences = preferBook ? extractBookGroundedSentences(pdfContext, topic) : [];
  const canonical = buildCanonicalWorksheetSectionList(sections);
  let globalQ = 1;

  return canonical.map((sec, secIdx) => {
    const valid = (sec.questions || []).filter((q) => String(q?.question || '').trim().length >= 10);
    if (valid.length) {
      const questions = valid.map((q, idx) => ({
        ...q,
        question_number: idx + 1,
        section: sec.sectionName,
      }));
      return { ...sec, questions, count: questions.length };
    }
    const fillerMeta = {
      ...meta,
      generationVariant: (Number(meta.generationVariant) || 1) + secIdx * 17,
      uniqueSeed: `${meta.uniqueSeed || 'pad'}-sec${secIdx}-v${meta.generationVariant || 1}`,
      sectionPadIndex: secIdx + 1,
    };
    let filler;
    if (preferBook && sentences.length) {
      const sentence = sentences[(secIdx + fillerMeta.generationVariant) % sentences.length];
      filler = buildBookGroundedWorksheetQuestion(
        sec.sectionName,
        sentence,
        topic,
        subject,
        globalQ,
        { ...fillerMeta, pdfContext },
      );
    } else {
      filler = buildTopicGroundedWorksheetQuestion(sec.sectionName, topic, subject, globalQ, fillerMeta);
    }
    globalQ += 1;
    return { ...sec, questions: [filler], count: 1 };
  });
}

/** Final pass: dedupe, renumber 1..n per section, clean MCQ options, drop answer-key junk. */
function polishWorksheetStructuredContent(source = {}, meta = {}) {
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

  const filledSections = canPadWorksheetSections(meta)
    ? padMissingWorksheetSections(sections, meta)
    : canonical.map((sec) => ({
        ...sec,
        questions: (sec.questions || []).map((q, idx) => ({
          ...q,
          question_number: idx + 1,
          section: sec.sectionName,
          options: cleanWorksheetMcqOptions(q.options),
        })),
        count: (sec.questions || []).length,
      }));

  const flatQuestions = filledSections.flatMap((sec) =>
    (sec.questions || []).map((q) => ({ ...q, section: sec.sectionName })),
  );

  const sectionedKey = buildWorksheetAnswerKeyFromSections(filledSections);
  const pdfAnswerKey = normalizeWorksheetAnswerKeyText(source.answer_key || '');
  // Structured section answers are canonical — never append legacy PDF answer text.
  const answerKeyOut = sectionedKey || pdfAnswerKey;

  return syncWorksheetLegacyMirrors(
    {
      ...source,
      answer_key: answerKeyOut,
    },
    filledSections,
  );
}

/** Worksheet / MCQ PDF rows → 10-section template + sections A–E. */
export function normalizeWorksheetStructuredContent(raw, sourceText = '', meta = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const title = sanitizeAiGeneratorWorksheetTitle(
    String(source.title || source.worksheet_title || source.name || source.topic || '').trim(),
    {},
  );
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

  const sectionsHaveQuestions = sections.some(
    (sec) => Array.isArray(sec?.questions) && sec.questions.length > 0,
  );
  if (looseQuestions.length && !sectionsHaveQuestions) {
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

  return polishWorksheetStructuredContent(draft, meta);
}

function canPadWorksheetSections(meta = {}) {
  const topic = resolveWorksheetTopicLabel(meta);
  return Boolean(topic) && !/^lesson focus\b/i.test(topic);
}

function countWorksheetSectionQuestions(sections = []) {
  return (Array.isArray(sections) ? sections : []).reduce(
    (n, sec) => n + (Array.isArray(sec?.questions) ? sec.questions.length : 0),
    0,
  );
}

function countWorksheetQuestionsInStructured(structured = {}) {
  const sections = Array.isArray(structured?.sections) ? structured.sections : [];
  const flat = Array.isArray(structured?.questions) ? structured.questions.length : 0;
  return Math.max(countWorksheetSectionQuestions(sections), flat);
}

function worksheetQuestionRows(structured = {}) {
  const rows = [];
  for (const sec of Array.isArray(structured?.sections) ? structured.sections : []) {
    for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
      if (q && typeof q === 'object') rows.push(q);
    }
  }
  for (const q of Array.isArray(structured?.questions) ? structured.questions : []) {
    if (q && typeof q === 'object') rows.push(q);
  }
  return rows;
}

function worksheetHasPlaceholderQuestions(structured = {}) {
  const rows = worksheetQuestionRows(structured);
  if (!rows.length) return false;
  const placeholderCount = rows.filter((row) =>
    isPlaceholderText(String(row?.question || row?.prompt || row?.text || '')),
  ).length;
  return placeholderCount >= Math.max(1, Math.ceil(rows.length * 0.5));
}

function worksheetHasSaveableContent(structured = {}) {
  const rows = worksheetQuestionRows(structured);
  const real = rows.filter((row) => {
    const text = String(row?.question || row?.prompt || row?.text || '').trim();
    return text.length >= 10 && !isPlaceholderText(text) && row?._scaffold !== true;
  });
  return real.length >= 3 || Boolean(structured?.bookGroundedFallback) || Boolean(structured?.topicGroundedFallback);
}

function shouldRelaxBatchWorksheetSave(meta = {}, slug = '') {
  if (String(slug || meta.toolSlug || '').trim() !== 'worksheet-mcq-generator') return false;
  return meta.bookGenerator === true || meta.batchOrchestrator === true;
}

/** AI Generator batches must save Practice Q&A after A–G scaffold fill — never burn 10+ min on Premium retries. */
function shouldRelaxPracticeQaBatchSave(meta = {}, slug = '') {
  if (String(slug || meta.toolSlug || '').trim() !== 'smart-qa-practice-generator') return false;
  return meta.bookGenerator === true || meta.batchOrchestrator === true;
}

/** Book RAG batches must save after repair — do not burn tokens retrying placeholder labels. */
function shouldRelaxBookBatchSave(meta = {}, slug = '') {
  if (!(meta.bookGenerator === true || meta.batchOrchestrator === true)) return false;
  const s = String(slug || meta.toolSlug || '').trim();
  return Boolean(s);
}

function shouldRelaxBookGeneratorSave(meta = {}) {
  return meta.bookGenerator === true;
}

function activityHasSaveableContent(structured = {}) {
  const title = String(structured?.title || structured?.activity_name || '').trim();
  const steps = Array.isArray(structured?.step_by_step_procedure)
    ? structured.step_by_step_procedure
    : Array.isArray(structured?.steps)
      ? structured.steps
      : [];
  const materials = Array.isArray(structured?.materials_required)
    ? structured.materials_required
    : Array.isArray(structured?.materials)
      ? structured.materials
      : [];
  const realSteps = steps.filter((s) => {
    const t = String(s || '').trim();
    return t.length >= 12 && !isStoryPassagePlaceholderText(t);
  });
  return title.length >= 4 && realSteps.length >= 3 && materials.length >= 2;
}

function isHeadingEchoFieldValue(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (isStoryPassagePlaceholderText(t)) return true;
  if (/^(?:\d+\.\s*)?(?:subtopic link|prior knowledge|learning objectives|ncf competency|materials required|step[- ]by[- ]step|teacher instructions|student instructions|differentiation|assessment|expected learning|real[- ]life|reflection|safety|observation|creative output|self[- ]assessment)\b/i.test(t) && t.length < 160) {
    return true;
  }
  return false;
}

/** Replace section-heading echoes ("Subtopic Link … for X") with real curriculum prose. */
function repairActivityHeadingEchoFields(structured, meta = {}, toolSlug = 'activity-project-generator') {
  const n =
    structured && typeof structured === 'object' && !Array.isArray(structured) ? { ...structured } : {};
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'the selected topic').trim();
  const subject = String(meta.subject || 'Science').trim();
  const classLabel = String(meta.classLabel || meta.className || '').trim();
  const fb = buildCurriculumBackedActivityFallback(meta);

  const fillText = (key, fallback) => {
    const cur = String(n[key] || '').trim();
    if (!cur || isHeadingEchoFieldValue(cur)) n[key] = fallback;
  };

  fillText(
    'subtopic_link_prior_knowledge',
    `This project connects to ${topic} in ${subject}${classLabel ? ` (${classLabel})` : ''}. Learners should already know basic observation skills and simple cause–effect ideas from earlier class work.`,
  );
  fillText(
    'prior_knowledge',
    `Recall everyday examples of observing carefully, stating a simple hypothesis, and checking an idea with a fair test related to ${topic}.`,
  );
  fillText(
    'ncf_competency_alignment',
    `Aligns with scientific inquiry competencies: observe, hypothesise, plan a simple experiment, record evidence, and communicate findings for ${topic}.`,
  );
  fillText(
    'expected_learning_outcomes',
    fb.learningOutcome ||
      `Learners will design and explain a small inquiry task on ${topic}, using observation, hypothesis, and evidence.`,
  );
  fillText(
    'real_life_application',
    `Transfer: apply observation–hypothesis–experiment thinking to a home or neighbourhood problem connected to ${topic} (for example moisture, spoilage, shadow length, or floating objects).`,
  );
  fillText(
    'reflection_exit_ticket',
    `Exit ticket: (1) One observation you made, (2) your hypothesis, (3) one change for a fairer test next time.`);
  fillText(
    'safety_care_instructions',
    'Use only teacher-approved materials. No tasting chemicals. Keep liquids away from sockets. Wash hands after the activity.',
  );
  fillText(
    'observation_data_recording_table',
    `Trial | What I observed | Hypothesis supported? (Y/N) | Notes\n1 |  |  |  \n2 |  |  |  \n3 |  |  |`,
  );
  fillText(
    'creative_output_final_product',
    `Final product: a one-page poster or science-fair card showing the question, method, results table, and conclusion for ${topic}.`,
  );
  fillText(
    'differentiation_support_extension',
    'Support: sentence starters and paired roles (recorder / tester). Extension: redesign the experiment with one changed variable and predict the new result.',
  );
  fillText(
    'differentiation',
    'Support: checklist of steps. Extension: compare two hypotheses and justify which evidence is stronger.',
  );

  if (!String(n.title || '').trim() || isHeadingEchoFieldValue(n.title) || /^untitled/i.test(n.title)) {
    n.title = fb.title;
  }

  const objectives = Array.isArray(n.learning_objectives)
    ? n.learning_objectives
    : Array.isArray(n.learningObjectives)
      ? n.learningObjectives
      : [];
  const cleanedObjectives = objectives
    .map((o) => String(o || '').trim())
    .filter((o) => o && !isHeadingEchoFieldValue(o));
  if (cleanedObjectives.length < 2) {
    n.learning_objectives = [
      `Observe and record patterns related to ${topic}.`,
      `Form a simple testable hypothesis about ${topic}.`,
      `Explain findings using evidence from a small experiment.`,
    ];
    n.learningObjectives = n.learning_objectives;
  }

  let materials = Array.isArray(n.materials_required)
    ? n.materials_required
    : Array.isArray(n.materials)
      ? n.materials
      : [];
  materials = materials.map((m) => String(m || '').trim()).filter((m) => m && !isHeadingEchoFieldValue(m));
  if (materials.length < 3) {
    materials = fb.materials;
  }
  n.materials = materials;
  n.materials_required = materials;

  let steps = Array.isArray(n.step_by_step_procedure)
    ? n.step_by_step_procedure
    : Array.isArray(n.steps)
      ? n.steps
      : [];
  steps = steps.map((s) => String(s || '').trim()).filter((s) => s && !isHeadingEchoFieldValue(s) && s.length >= 12);
  if (steps.length < 5) {
    steps = fb.steps;
  }
  n.steps = steps;
  n.step_by_step_procedure = steps;

  const rubric = Array.isArray(n.self_assessment_rubric)
    ? n.self_assessment_rubric
    : Array.isArray(n.assessment_criteria_rubric)
      ? n.assessment_criteria_rubric
      : [];
  const cleanedRubric = rubric.map((r) => String(r || '').trim()).filter((r) => r && !isHeadingEchoFieldValue(r));
  if (cleanedRubric.length < 2) {
    const filled = [
      'Level 4: Clear hypothesis, fair test, accurate recording, evidence-based conclusion.',
      'Level 3: Mostly complete method and results with minor gaps.',
      'Level 2: Incomplete steps or weak link between evidence and conclusion.',
      'Level 1: Little planning or recording; conclusion not supported.',
    ];
    n.self_assessment_rubric = filled;
    n.assessment_criteria_rubric = filled;
  }

  if (!String(n.expected_learning_outcomes || n.learningOutcome || '').trim()) {
    n.expected_learning_outcomes = fb.learningOutcome;
    n.learningOutcome = fb.learningOutcome;
  }

  n.bookGroundedFallback = Boolean(meta.bookGenerator) || Boolean(n.bookGroundedFallback);
  return normalizeActivityStructuredContent(n, toolSlug);
}

function extractBookChunkBodies(pdfContext = '') {
  const text = String(pdfContext || '');
  const bodies = [];
  const re = /\[\d+\]\s*\([^)]*\)\s*([\s\S]*?)(?=\[\d+\]\s*\(|$)/gi;
  let match = re.exec(text);
  while (match) {
    const body = String(match[1] || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (body.length >= 40) bodies.push(body);
    match = re.exec(text);
  }
  return bodies;
}

function isBookContextMetaLine(sentence = '') {
  const t = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 20) return true;
  const metaPatterns = [
    /^follow textbook terminology/i,
    /^use the (?:passages|textbook)/i,
    /^reference textbook content/i,
    /^textbook content \(primary/i,
    /^priority:\s*\(1\)/i,
    /^do not invent facts/i,
    /^synthesize into the tool schema/i,
    /^generate (?:mcqs|questions|questions and content)/i,
    /^uploaded book/i,
    /^gemini knowledge/i,
    /^textbook-grounded generation/i,
    /^classroom textbook methodology/i,
    /^precision mode/i,
    /^mandatory when passages/i,
    /^align output with this curriculum/i,
    /^ask directly about the subtopic/i,
    /^when passages are thin/i,
    /^quote or paraphrase textbook ideas/i,
    /^variant \d+:/i,
    /^build questions directly/i,
    /build questions directly from these passages/i,
    /book:\s*.+subject:\s*.+class:/i,
    /^book:\s/i,
    /^subject:\s/i,
    /^class:\s/i,
    /mathematics\s+10th/i,
    /<<<textbook_instructions>>>/i,
    /<<<end_textbook_instructions>>>/i,
    /^use terminology, definitions/i,
    /^tool:\s/i,
    /^sub-?topic:\s/i,
    /^topic:\s/i,
    /primary (?:source|factual source)/i,
    /no fictional scenario/i,
    /students recall key facts about/i,
    /students apply .+ to short/i,
  ];
  return metaPatterns.some((re) => re.test(t));
}

function isSubstantiveBookSentence(sentence = '', subject = '') {
  const t = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!t || isBookContextMetaLine(t)) return false;
  const cat = resolveSubjectCategory(subject);
  if (cat === 'maths') {
    return /sin|cos|tan|cot|sec|cosec|angle|ratio|trigonometric|°|degree|\d+\s*°|=\s*[\d./]+|evaluate|prove|find the value|calculate|^\s*\d+[\s.)]/i.test(
      t,
    );
  }
  return /[a-z]{4,}/i.test(t) && !/^it matches the textbook/i.test(t);
}

function extractBookGroundedSentences(pdfContext = '', topic = '') {
  const chunkBodies = extractBookChunkBodies(pdfContext);
  const rawFromChunks = chunkBodies.join(' ').trim();
  const raw =
    rawFromChunks.length >= 80
      ? rawFromChunks
      : String(pdfContext || '')
          .replace(/<<<TEXTBOOK_INSTRUCTIONS>>>[\s\S]*?<<<END_TEXTBOOK_INSTRUCTIONS>>>/gi, ' ')
          .replace(/\[Chunk \d+\]/gi, '\n')
          .replace(/\[\d+\]\s*\([^)]+\)\s*/g, '\n')
          .replace(/TEXTBOOK CONTENT[^:]*:/gi, ' ')
          .replace(/REFERENCE TEXTBOOK CONTENT[^:]*:/gi, ' ')
          .replace(/USER-SELECTED CURRICULUM[^]*?(?=\n\n|$)/gi, ' ')
          .replace(/TEXTBOOK-GROUNDED GENERATION[^]*?(?=\[|\n\n|$)/gi, ' ')
          .replace(/CLASSROOM TEXTBOOK METHODOLOGY[^]*?(?=\[|\n\n|$)/gi, ' ')
          .replace(/PRECISION MODE[^]*?(?=\[|\n\n|$)/gi, ' ')
          .replace(/Follow textbook terminology[^.!?]*[.!?]/gi, ' ')
          .replace(/Build questions directly[^.!?]*[.!?]/gi, ' ')
          .replace(/Generate (?:MCQs|questions)[^.!?]*[.!?]/gi, ' ')
          .replace(/Book:\s[^.!?\n]+/gi, ' ')
          .replace(/Subject:\s[^.!?\n]+/gi, ' ')
          .replace(/Class:\s[^.!?\n]+/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
  if (!raw || raw.length < 80) return [];
  const topicLower = String(topic || '').toLowerCase();
  return raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 35 && s.length <= 320)
    .filter((s) => !isBookContextMetaLine(s))
    .filter((s) => !/^(page|figure|table|chapter|unit|exercise)\b/i.test(s))
    .filter((s) => !/copyright|all rights reserved/i.test(s))
    .filter((s) => !/user-selected curriculum|generate content for this exact scope/i.test(s))
    .filter((s) => !/^board:|^class:|^subject:|^topic:|^sub-topic:|^tool:/i.test(s))
    .sort((a, b) => {
      const aHit = topicLower && a.toLowerCase().includes(topicLower) ? 1 : 0;
      const bHit = topicLower && b.toLowerCase().includes(topicLower) ? 1 : 0;
      return bHit - aHit;
    })
    .slice(0, 28);
}

function worksheetRowHasRagLeak(text = '') {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    isBookContextMetaLine(t) ||
    /build questions directly from these passages/i.test(t) ||
    /it matches the textbook explanation/i.test(t) ||
    /students summarise the textbook explanation using evidence/i.test(t) ||
    /structured response with definition, steps, and conclusion for/i.test(t) ||
    /according to the chapter on .+, which choice reflects/i.test(t)
  );
}

function worksheetSectionsHaveRagLeak(sections = []) {
  for (const sec of Array.isArray(sections) ? sections : []) {
    for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
      const blob = [q?.question, q?.answer, ...(Array.isArray(q?.options) ? q.options : [])]
        .filter(Boolean)
        .join(' ');
      if (worksheetRowHasRagLeak(blob)) return true;
    }
  }
  return false;
}

function worksheetSectionsLackMathsNumericals(sections = [], subject = '', topic = '') {
  if (resolveSubjectCategory(subject) !== 'maths') return false;
  if (!/trigonometric|trigonometry|angle|sin|cos|tan|ratio/i.test(topic)) return false;
  const blob = JSON.stringify(sections);
  return !/sin|cos|tan|cot|sec|cosec|°|degree|evaluate|calculate|numerical|\d+\s*°|\/\s*2|√/i.test(blob);
}

function buildTrigWorksheetQuestion(sectionName, topicLabel, subjectLabel, qNum, meta, mix, pickStem) {
  const variantIndex = Number(meta.generationVariant) || 1;
  if (sectionName === WORKSHEET_SECTION_LABELS.A) {
    const stems = [
      'What is the value of sin 30°?',
      'What is the value of cos 45°?',
      'tan 60° equals:',
      'Which is equal to sin 45°?',
      'For angle 30°, sin θ equals:',
    ];
    const options = [
      ['A) 1/2', 'B) √3/2', 'C) 1', 'D) 0'],
      ['A) 1/√2', 'B) √3/2', 'C) 1/2', 'D) √3'],
      ['A) √3', 'B) 1/√3', 'C) 1', 'D) 1/2'],
      ['A) 1/√2', 'B) √3', 'C) 1/2', 'D) 0'],
      ['A) 1/2', 'B) √3/2', 'C) 1/√2', 'D) √3'],
    ];
    const idx = ((Number(mix) % stems.length) + stems.length) % stems.length;
    return {
      question_number: qNum,
      type: 'MCQ',
      section: sectionName,
      question: `${pickStem(stems, mix)} (${topicLabel})`,
      options: options[idx],
      answer: `${options[idx][0]}`,
      marks: 1,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.B) {
    const stems = [
      'sin 45° = _____',
      'The value of cos 60° is _____',
      'tan 45° = _____',
      'sin 30° + cos 60° = _____',
      'For a right triangle, if one acute angle is 30°, the other acute angle is _____°',
    ];
    const answers = ['1/√2', '1/2', '1', '1', '60'];
    const idx = ((Number(mix) % stems.length) + stems.length) % stems.length;
    return {
      question_number: qNum,
      type: 'FIB',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: answers[idx],
      marks: 1,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.C) {
    const stems = [
      'Write the value of sin 60°.',
      'State the value of cos 30°.',
      'Write tan 45° in simplest form.',
      'State sin 90°.',
      'Write cos 45° as a fraction.',
    ];
    const answers = ['√3/2', '√3/2', '1', '1', '1/√2'];
    const idx = ((Number(mix) % stems.length) + stems.length) % stems.length;
    return {
      question_number: qNum,
      type: 'VSA',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: answers[idx],
      marks: 2,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.D) {
    const stems = [
      `Find sin 30° + cos 60°. Show working.`,
      `Evaluate tan 45° + sin 45°. Show each step.`,
      `Using the table of standard angles, find cos 30° and explain how it is obtained.`,
      `Show that sin² 30° + cos² 30° = 1.`,
    ];
    return {
      question_number: qNum,
      type: 'SA',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: 'Show substitution from the standard trigonometric table with clear working.',
      marks: 3,
    };
  }
  const stems = [
    `Evaluate: (sin 45° + cos 45°) × tan 60°. Show all working.`,
    `If sin A = 1/2 for A = 30°, find cos A. Show steps.`,
    `Prove using values: sin 60° cos 30° + sin 30° cos 60° = 1.`,
    `A ladder makes 60° with the ground. If sin 60° = √3/2, write the ratio used for height. Calculate height when ladder length is 4 m.`,
  ];
  return {
    question_number: qNum,
    type: 'COMPETENCY',
    section: sectionName,
    question: pickStem(stems, mix),
    answer: 'Given, formula/ratio, step-by-step calculation, and final answer with units if needed.',
    marks: 4,
  };
}

function buildBookGroundedWorksheetQuestion(sectionName, sentence, topic, subject, qNum, meta = {}) {
  const legacySeed = typeof meta === 'number' ? meta : Number(meta?.generationVariant ?? meta?.variantSeed) || 0;
  const metaObj = typeof meta === 'object' && meta !== null ? meta : { generationVariant: legacySeed };
  const fact = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!isSubstantiveBookSentence(fact, subject)) {
    return buildTopicGroundedWorksheetQuestionRaw(sectionName, topic, subject, qNum, meta);
  }
  const shortFact = fact.length > 150 ? `${fact.slice(0, 147).trim()}…` : fact;
  const topicLabel = String(topic || subject || 'the lesson').trim();
  const subjectLabel = String(subject || 'Science').trim();
  const variantIndex = Number(metaObj.generationVariant) || legacySeed || 1;
  const avoidTexts = Array.isArray(metaObj.avoidQuestionTexts) ? metaObj.avoidQuestionTexts : [];
  const pickStem = (stems, mix) => pickBatchAwareTopicTemplate(stems, mix, avoidTexts);
  const angle =
    String(metaObj.variantAngle || '').trim() ||
    getAiGeneratorVariantAngle(variantIndex, subjectLabel);
  const scenario =
    String(metaObj.variantScenario || '').trim() ||
    getAiGeneratorVariantScenario(variantIndex, subjectLabel);
  const mix =
    variantIndex * 997 +
    hashSeedToInt(metaObj.uniqueSeed) +
    qNum * 13 +
    hashSeedToInt(`${sectionName}:${shortFact.slice(0, 48)}`);
  const snippet = `${shortFact.slice(0, 88)}${shortFact.length > 88 ? '…' : ''}`;
  const words = fact.split(/\s+/).filter(Boolean);
  const pickWord = words[Math.min(3 + (variantIndex % 7), Math.max(0, words.length - 1))] || topicLabel;

  if (sectionName === WORKSHEET_SECTION_LABELS.A) {
    const stems = [
      `Which option best matches the textbook on ${topicLabel}: "${snippet}"?`,
      `According to the chapter on ${topicLabel}, which choice reflects "${snippet}"?`,
      `MCQ: Which statement about ${topicLabel} is supported by "${snippet}"?`,
      `Which answer correctly explains the textbook idea: "${snippet}"?`,
      `Pick the best option linking "${snippet}" to ${topicLabel}.`,
    ];
    return {
      question_number: qNum,
      type: 'MCQ',
      section: sectionName,
      question: pickStem(stems, mix),
      options: [
        'A) It matches the textbook explanation',
        'B) It reverses cause and effect from the textbook',
        'C) It is unrelated to the chapter content',
        'D) It contradicts the definitions in the chapter',
      ],
      answer: 'A) It matches the textbook explanation',
      marks: 1,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.B) {
    const stems = [
      `Complete using the textbook on ${topicLabel}: ${pickWord} _____.`,
      `Fill in the blank: In ${topicLabel}, ${pickWord} _____.`,
      `From the passage on ${topicLabel}, evidence shows ${pickWord} _____.`,
      `One textbook fact about ${topicLabel} is that ${pickWord} _____.`,
      `Using the chapter on ${topicLabel}, ${pickWord} _____.`,
    ];
    return {
      question_number: qNum,
      type: 'FIB',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: fact.slice(0, 140),
      marks: 1,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.C) {
    const stems = [
      `State one key point about ${topicLabel} from the textbook passage.`,
      `Name one idea about ${topicLabel} mentioned in the chapter.`,
      `Write one fact from the textbook about ${topicLabel}.`,
      `Give one precise point about ${topicLabel} using evidence from the passage.`,
      `List one characteristic of ${topicLabel} from the textbook section.`,
    ];
    return {
      question_number: qNum,
      type: 'VSA',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: shortFact,
      marks: 2,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.D) {
    const stems = [
      `Explain this textbook statement about ${topicLabel}: "${shortFact.slice(0, 110)}${shortFact.length > 110 ? '…' : ''}"`,
      `Explain how "${shortFact.slice(0, 90)}${shortFact.length > 90 ? '…' : ''}" helps understand ${topicLabel}.`,
      `Describe the textbook idea about ${topicLabel} using the passage evidence.`,
      `Explain how the passage supports understanding of ${topicLabel} in ${subjectLabel}.`,
      `Write a brief explanation linking "${snippet}" to ${topicLabel}.`,
    ];
    return {
      question_number: qNum,
      type: 'SA',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: `Students summarise the textbook explanation using evidence from the chapter on ${topicLabel}.`,
      marks: 3,
    };
  }
  const stems = [
    `Apply the textbook idea about ${topicLabel} using this passage: "${snippet}"`,
    `Solve or explain a problem on ${topicLabel} based on the chapter content.`,
    `Use the formula or principle from ${topicLabel} to answer with evidence from: "${snippet}"`,
    `Explain how ${topicLabel} applies to the data or facts in the textbook passage.`,
    `Write an extended answer on ${topicLabel} using "${snippet}" as evidence.`,
  ];
  return {
    question_number: qNum,
    type: 'COMPETENCY',
    section: sectionName,
    question: pickStem(stems, mix),
    answer: `Structured answer with definition, formula, steps, and conclusion for ${topicLabel}.`,
    marks: 4,
  };
}

/** Build worksheet sections from retrieved textbook text when the model omits questions. */
function buildBookGroundedWorksheetSections(meta = {}) {
  const pdfContext = String(meta.pdfContext || '')
    .replace(/USER-SELECTED CURRICULUM[\s\S]*?(?=\[Chunk|\n{2,}|$)/i, '')
    .trim();
  const topic = resolveWorksheetTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const target = Math.max(5, Number(meta.questionCount) > 0 ? Number(meta.questionCount) : 10);
  const variantSeed = Number(meta.generationVariant) || 0;

  const rotateExtracted = (items) => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return list;
    const start = (variantSeed * 2) % list.length;
    return [...list.slice(start), ...list.slice(0, start)];
  };

  if (pdfContext.length > 120) {
    const extracted = sanitizeWorksheetQuestions(
      extractWorksheetItemsFromPdfText(pdfContext, target + 8 + variantSeed),
    );
    if (extracted.length >= 3) {
      return padMissingWorksheetSections(
        groupQuestionsIntoWorksheetSections(rotateExtracted(extracted)),
        meta,
      );
    }
    let loose = sanitizeWorksheetQuestions(extractQuestionsFromText(pdfContext));
    if (loose.length >= 3) {
      return padMissingWorksheetSections(
        groupQuestionsIntoWorksheetSections(rotateExtracted(loose)),
        meta,
      );
    }
  }

  const sentences = extractBookGroundedSentences(pdfContext, topic).filter((s) =>
    isSubstantiveBookSentence(s, subject),
  );
  if (!sentences.length) {
    return buildTopicGroundedWorksheetSections(meta);
  }

  const sectionOrder = Object.values(WORKSHEET_SECTION_LABELS);
  let qNum = 1;
  const sections = sectionOrder.map((sectionName, idx) => {
    const sentence = sentences[(idx + variantSeed * 3) % sentences.length];
    const questionMeta = {
      ...meta,
      generationVariant: variantSeed + idx * 11,
      uniqueSeed: `${meta.uniqueSeed || ''}-book-sec${idx}-v${variantSeed}`,
    };
    return {
      sectionName,
      questions: [
        buildBookGroundedWorksheetQuestion(sectionName, sentence, topic, subject, qNum++, questionMeta),
      ],
      count: 1,
    };
  });
  return sections;
}

function hashSeedToInt(raw = '') {
  const s = String(raw || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickTopicTemplate(templates, seed) {
  const list = Array.isArray(templates) ? templates : [];
  if (!list.length) return '';
  const idx = ((Number(seed) % list.length) + list.length) % list.length;
  return list[idx];
}

/** Pick a stem that does not closely match questions already saved in this batch. */
function pickBatchAwareTopicTemplate(stems, mix, avoidTexts = []) {
  const list = Array.isArray(stems) ? stems.filter(Boolean) : [];
  if (!list.length) return '';
  const avoid = Array.isArray(avoidTexts) ? avoidTexts.filter(Boolean) : [];
  if (!avoid.length) return pickTopicTemplate(list, mix);
  const threshold = getQuestionSimilarityThreshold();
  const start = ((Number(mix) % list.length) + list.length) % list.length;
  for (let offset = 0; offset < list.length; offset += 1) {
    const idx = (start + offset) % list.length;
    const candidate = list[idx];
    const dup = findSimilarText(candidate, avoid, threshold);
    if (!dup.duplicate) return candidate;
  }
  const suffix = ` (Record ${mix})`;
  for (let offset = 0; offset < list.length; offset += 1) {
    const idx = (start + offset) % list.length;
    const candidate = `${list[idx]}${suffix}`;
    const dup = findSimilarText(candidate, avoid, threshold);
    if (!dup.duplicate) return candidate;
  }
  return guaranteeBatchUniqueQuestionText(
    `${list[start]} — variant ${mix} · ${hashSeedToInt(`${mix}:${avoid.length}:${avoid[0] || ''}`)}`,
    avoid,
    mix,
  );
}

/** Rebuild all worksheet sections A–E with batch-unique topic-grounded questions (book batch recovery). */
export function rebuildWorksheetBatchVariant(structuredContent, meta = {}) {
  const topic = resolveWorksheetTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const variant = Number(meta.generationVariant) || 1;
  const avoid = Array.isArray(meta.avoidQuestionTexts) ? meta.avoidQuestionTexts.filter(Boolean) : [];
  const threshold = getQuestionSimilarityThreshold();
  const sectionOrder = Object.values(WORKSHEET_SECTION_LABELS);
  const usedTexts = [...avoid];
  let qNum = 1;

  const sections = sectionOrder.map((sectionName, idx) => {
    let question = null;
    for (let salt = 0; salt < 32; salt += 1) {
      const attemptMeta = {
        ...meta,
        subTopic: topic,
        subtopic: topic,
        topic,
        bookGenerator: false,
        batchOrchestrator: true,
        generationVariant: variant + idx * 41 + salt * 1009,
        uniqueSeed: `${meta.uniqueSeed || 'rb'}-sec${idx}-s${salt}`,
        avoidQuestionTexts: usedTexts,
      };
      const candidate = buildTopicGroundedWorksheetQuestion(
        sectionName,
        topic,
        subject,
        qNum,
        attemptMeta,
      );
      const text = String(candidate.question || '').trim();
      const uniqueText = guaranteeBatchUniqueQuestionText(text, usedTexts, variant + idx + salt);
      const dup = uniqueText ? findSimilarText(uniqueText, usedTexts, threshold) : { duplicate: true };
      if (!dup.duplicate) {
        question = { ...candidate, question: uniqueText };
        usedTexts.push(uniqueText);
        break;
      }
    }
    if (!question) {
      const forced = buildTopicGroundedWorksheetQuestion(sectionName, topic, subject, qNum, {
        ...meta,
        subTopic: topic,
        subtopic: topic,
        topic,
        bookGenerator: false,
        batchOrchestrator: true,
        generationVariant: variant + idx * 41 + 99991,
        uniqueSeed: `${meta.uniqueSeed || 'rb'}-force-${idx}-${Date.now()}`,
        avoidQuestionTexts: usedTexts,
      });
      const uniqueText = guaranteeBatchUniqueQuestionText(
        String(forced.question || '').trim(),
        usedTexts,
        variant + idx + 99991,
      );
      question = { ...forced, question: uniqueText };
      if (uniqueText) usedTexts.push(uniqueText);
    }
    qNum += 1;
    return { sectionName, questions: [question], count: 1 };
  });

  const title = sanitizeAiGeneratorWorksheetTitle(
    String(
      structuredContent?.title ||
        structuredContent?.worksheet_title ||
        `${topic} — Worksheet (Set ${variant})`,
    ).trim(),
    { ...meta, subTopic: topic, topic },
  );

  return polishWorksheetStructuredContent(
    {
      ...(structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
        ? structuredContent
        : {}),
      title,
      worksheet_title: title,
      sections,
      topicGroundedFallback: true,
    },
    { ...meta, subTopic: topic, subtopic: topic, topic },
  );
}

/** Rebuild A–E from textbook sentences (book batch) with batch-unique stems. */
export function rebuildWorksheetBookBatchVariant(structuredContent, meta = {}) {
  const topic = resolveWorksheetTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const variant = Number(meta.generationVariant) || 1;
  const avoid = Array.isArray(meta.avoidQuestionTexts) ? meta.avoidQuestionTexts.filter(Boolean) : [];
  const threshold = getQuestionSimilarityThreshold();
  const pdfContext = String(meta.pdfContext || '')
    .replace(/USER-SELECTED CURRICULUM[\s\S]*?(?=\[Chunk|\n{2,}|$)/i, '')
    .trim();
  const sentences = extractBookGroundedSentences(pdfContext, topic).filter((s) =>
    isSubstantiveBookSentence(s, subject),
  );
  if (!sentences.length) {
    return rebuildWorksheetBatchVariant(structuredContent, { ...meta, pdfContext, topic, subTopic: topic });
  }
  const sectionOrder = Object.values(WORKSHEET_SECTION_LABELS);
  const usedTexts = [...avoid];
  let qNum = 1;

  const sections = sectionOrder.map((sectionName, idx) => {
    let question = null;
    for (let salt = 0; salt < 32; salt += 1) {
      const sentence =
        sentences[(idx + variant + salt) % Math.max(1, sentences.length)] ||
        sentences[0] ||
        topic;
      const attemptMeta = {
        ...meta,
        subTopic: topic,
        subtopic: topic,
        topic,
        bookGenerator: true,
        batchOrchestrator: true,
        pdfContext,
        generationVariant: variant + idx * 41 + salt * 1009,
        uniqueSeed: `${meta.uniqueSeed || 'bkb'}-sec${idx}-s${salt}`,
        avoidQuestionTexts: usedTexts,
      };
      const candidate = buildBookGroundedWorksheetQuestion(
        sectionName,
        sentence,
        topic,
        subject,
        qNum,
        attemptMeta,
      );
      const text = String(candidate.question || '').trim();
      const uniqueText = guaranteeBatchUniqueQuestionText(text, usedTexts, variant + idx + salt);
      const dup = uniqueText ? findSimilarText(uniqueText, usedTexts, threshold) : { duplicate: true };
      if (!dup.duplicate) {
        question = { ...candidate, question: uniqueText };
        usedTexts.push(uniqueText);
        break;
      }
    }
    if (!question) {
      const forced = buildBookGroundedWorksheetQuestion(
        sectionName,
        sentences[idx % Math.max(1, sentences.length)] || topic,
        topic,
        subject,
        qNum,
        {
          ...meta,
          subTopic: topic,
          subtopic: topic,
          topic,
          bookGenerator: true,
          pdfContext,
          generationVariant: variant + idx * 41 + 99991,
          uniqueSeed: `${meta.uniqueSeed || 'bkb'}-force-${idx}`,
          avoidQuestionTexts: usedTexts,
        },
      );
      const uniqueText = guaranteeBatchUniqueQuestionText(
        String(forced.question || '').trim(),
        usedTexts,
        variant + idx + 99991,
      );
      question = { ...forced, question: uniqueText };
      if (uniqueText) usedTexts.push(uniqueText);
    }
    qNum += 1;
    return { sectionName, questions: [question], count: 1 };
  });

  const title = sanitizeAiGeneratorWorksheetTitle(
    String(
      structuredContent?.title ||
        structuredContent?.worksheet_title ||
        `${topic} — Textbook Worksheet (Set ${variant})`,
    ).trim(),
    { ...meta, subTopic: topic, topic },
  );

  return polishWorksheetStructuredContent(
    {
      ...(structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
        ? structuredContent
        : {}),
      title,
      worksheet_title: title,
      sections,
      bookGroundedFallback: true,
    },
    { ...meta, subTopic: topic, subtopic: topic, topic, pdfContext },
  );
}

/** Book-grounded rebuild when RAG text exists; otherwise topic-grounded. */
export function rebuildWorksheetBatchVariantSmart(structuredContent, meta = {}) {
  const topic = resolveWorksheetTopicLabel(meta);
  const pdfContext = String(meta.pdfContext || '')
    .replace(/USER-SELECTED CURRICULUM[\s\S]*?(?=\[Chunk|\n{2,}|$)/i, '')
    .trim();
  const preferBook =
    Boolean(meta.bookGenerator) &&
    pdfContext.length > 120 &&
    extractBookGroundedSentences(pdfContext, topic).filter((s) => isSubstantiveBookSentence(s, subject))
      .length >= 3;
  if (preferBook) {
    return rebuildWorksheetBookBatchVariant(structuredContent, { ...meta, pdfContext, topic, subTopic: topic });
  }
  return rebuildWorksheetBatchVariant(structuredContent, meta);
}

function buildTopicGroundedWorksheetQuestion(sectionName, topic, subject, qNum, meta = {}) {
  const row = buildTopicGroundedWorksheetQuestionRaw(sectionName, topic, subject, qNum, meta);
  return row && typeof row === 'object' ? { ...row, _scaffold: true } : row;
}

function buildTopicGroundedWorksheetQuestionRaw(sectionName, topic, subject, qNum, meta = {}) {
  const topicLabel = String(resolveWorksheetTopicLabel(meta) || topic || 'the selected sub-topic').trim();
  const subjectLabel = String(subject || 'Science').trim();
  const variantIndex = Number(meta.generationVariant) || 1;
  const avoidTexts = Array.isArray(meta.avoidQuestionTexts) ? meta.avoidQuestionTexts : [];
  const pickStem = (stems, mix) => pickBatchAwareTopicTemplate(stems, mix, avoidTexts);
  const angle =
    String(meta.variantAngle || '').trim() ||
    getAiGeneratorVariantAngle(variantIndex, subjectLabel);
  const scenario =
    String(meta.variantScenario || '').trim() ||
    getAiGeneratorVariantScenario(variantIndex, subjectLabel);
  const mix =
    variantIndex * 997 +
    hashSeedToInt(meta.uniqueSeed) +
    qNum * 13 +
    hashSeedToInt(`${sectionName}:${topicLabel}`);

  const band = resolveScaffoldBand(subjectLabel);
  const trigTopic = /trigonometric|trigonometry|angle|sin|cos|tan|ratio/i.test(topicLabel);
  if (band === 'maths' && trigTopic) {
    return buildTrigWorksheetQuestion(sectionName, topicLabel, subjectLabel, qNum, meta, mix, pickStem);
  }

  if (sectionName === WORKSHEET_SECTION_LABELS.A) {
    const stems = [
      `Which statement about ${topicLabel} is correct in ${subjectLabel}?`,
      `Which option best defines ${topicLabel}?`,
      `Which formula or principle applies to ${topicLabel}?`,
      `Which SI unit is associated with ${topicLabel}?`,
      `Which option explains ${topicLabel} with correct evidence?`,
      `Which statement about ${topicLabel} is incorrect?`,
      `Which step is correct when solving problems on ${topicLabel}?`,
      `Which property is essential to ${topicLabel}?`,
      `Which example correctly illustrates ${topicLabel}?`,
      `Which option avoids a common error in ${topicLabel}?`,
      `Which relation in ${topicLabel} is stated correctly?`,
      `Pick the best answer about ${topicLabel} for ${subjectLabel} revision.`,
    ];
    const correct = [
      'Observation and reasoning support the claim',
      'A claim supported by evidence from the lesson',
      'The idea matches textbook/class explanation',
      'Data or examples back the statement',
    ];
    const wrongA = pickStem(
      ['A guess without checking', 'An opinion with no example', 'A tradition only'],
      mix + 1,
    );
    const correctB = pickStem(correct, mix + 2);
    const wrongC = pickStem(['Unrelated everyday hearsay', 'A reversed cause-effect claim'], mix + 3);
    const wrongD = pickStem(['Ignores the lesson concept', 'Contradicts class notes'], mix + 4);
    return {
      question_number: qNum,
      type: 'MCQ',
      section: sectionName,
      question: pickStem(stems, mix),
      options: [`A) ${wrongA}`, `B) ${correctB}`, `C) ${wrongC}`, `D) ${wrongD}`],
      answer: `B) ${correctB}`,
      marks: 1,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.B) {
    const stems = [
      `Complete: ${topicLabel} is defined as _____.`,
      `Fill in: The formula for ${topicLabel} is _____.`,
      `Complete: The SI unit of ${topicLabel} is _____.`,
      `Fill in: One key property of ${topicLabel} is _____.`,
      `Complete: ${topicLabel} is related to _____ because _____.`,
      `Fill in the blank: A core term in ${topicLabel} is _____.`,
      `Complete: Evidence for ${topicLabel} shows _____.`,
      `Fill in: When ${topicLabel} increases, _____ changes.`,
      `Complete: The symbol used in ${topicLabel} equations is _____.`,
      `Fill in: One cause of ${topicLabel} is _____.`,
    ];
    return {
      question_number: qNum,
      type: 'FIB',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: `Expected term or phrase about ${topicLabel} (variant ${variantIndex}).`,
      marks: 1,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.C) {
    const stems = [
      `Define the central term in ${topicLabel}.`,
      `State one essential fact about ${topicLabel}.`,
      `Name the formula used in ${topicLabel} (if any).`,
      `State the SI unit for ${topicLabel}.`,
      `Give one precise point about ${topicLabel} in ${subjectLabel}.`,
      `List one characteristic of ${topicLabel}.`,
      `State one cause–effect link in ${topicLabel}.`,
      `Name one quantity measured in ${topicLabel}.`,
      `State one law or rule that applies to ${topicLabel}.`,
      `Write one definition from ${topicLabel} in one sentence.`,
    ];
    return {
      question_number: qNum,
      type: 'VSA',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: `Short accurate point about ${topicLabel} (set ${variantIndex}).`,
      marks: 2,
    };
  }
  if (sectionName === WORKSHEET_SECTION_LABELS.D) {
    const stems = [
      `Explain ${topicLabel}: definition and one example.`,
      `Describe the principle behind ${topicLabel} in ${subjectLabel}.`,
      `Explain the cause–effect relationship in ${topicLabel}.`,
      `Explain how to use the formula for ${topicLabel} with one calculation.`,
      `Describe two key properties of ${topicLabel}.`,
      `Explain why ${topicLabel} is important in ${subjectLabel}.`,
      `Explain the difference between related terms in ${topicLabel}.`,
      `Describe how ${topicLabel} is measured and calculated.`,
    ];
    return {
      question_number: qNum,
      type: 'SA',
      section: sectionName,
      question: pickStem(stems, mix),
      answer: `Clear, accurate explanation of ${topicLabel} with definition and example.`,
      marks: 3,
    };
  }
  const stems = [
    `Solve a two-step problem on ${topicLabel}. Show all working.`,
    `Apply the formula for ${topicLabel} to given data. Show each step.`,
    `Explain ${topicLabel} and solve one numerical with correct units.`,
    `Analyse ${topicLabel}: state the principle, substitute values, and find the answer.`,
    `Write an extended answer on ${topicLabel} with definition, formula, and calculation.`,
    `Derive the result for ${topicLabel} from given values and justify each step.`,
    `Compare two methods for solving ${topicLabel} problems and choose the better one.`,
    `Solve a multi-part problem on ${topicLabel}: (a) define, (b) calculate, (c) state units.`,
  ];
  return {
    question_number: qNum,
    type: 'COMPETENCY',
    section: sectionName,
    question: pickStem(stems, mix),
    answer: `Structured response with definition, steps, and conclusion for ${topicLabel}.`,
    marks: 4,
  };
}

/** Local worksheet repair for AI Generator batches when the model omits section questions. */
function buildTopicGroundedWorksheetSections(meta = {}) {
  const topic = resolveWorksheetTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const variantSeed = Number(meta.generationVariant) || 1;
  const sectionOrder = Object.values(WORKSHEET_SECTION_LABELS);
  let qNum = 1;
  return sectionOrder.map((sectionName, idx) => {
    const question = buildTopicGroundedWorksheetQuestion(sectionName, topic, subject, qNum++, {
      ...meta,
      generationVariant: variantSeed,
      sectionPadIndex: idx + 1,
      uniqueSeed: `${meta.uniqueSeed || ''}-sec${idx + 1}-v${variantSeed}`,
    });
    return { sectionName, questions: [question], count: 1 };
  });
}

/** Strip echoed batch prompt metadata and runaway parenthetical repeats from worksheet titles. */
function sanitizeAiGeneratorWorksheetTitle(title, meta = {}) {
  let t = String(title || '').trim();
  t = t.replace(/\s*—\s*Precision Worksheet\s+\d+/gi, '');
  t = t.replace(/\s*—\s*book\s*—\s*v\d+/gi, '');
  t = t.replace(/\s*—\s*a\d+\s*—/gi, ' — ');
  t = t.replace(/\s*—\s*Focus:\s*[^—]+/gi, '');
  t = t.replace(/\s*\(Class\s+\d+\s*—\s*CBSE[^)]*\)/gi, '');
  t = t.replace(/\s*\(Uniqueness\s+Seed:[^)]*\)/gi, '');
  t = t.replace(/\s*\(Distinct from all other variants[^)]*\)/gi, '');
  t = t.replace(/\s*\(The title reflects the creative angle\.\)/gi, '');
  t = t.replace(/\s*[-—]\s*Variant\s+\d+\s+of\s+\d+\s*\([^)]*\)/gi, '');
  for (let i = 0; i < 4; i += 1) {
    const next = t.replace(/(\([^)]{12,140}\))\s*(?:\1\s*)+/g, '$1');
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+\)/g, ')').replace(/\s+—\s+—/g, ' — ').trim();
  if (t.length > 120) {
    const topic = String(meta.subTopic || meta.subtopic || meta.topic || '').trim();
    if (topic && t.includes(topic)) {
      const idx = t.indexOf(topic);
      t = t.slice(0, idx + topic.length).trim();
    } else if (topic) {
      t = `${String(meta.subject || 'Worksheet').trim()} — ${topic}`;
    }
  }
  if (t.length > 200) t = `${t.slice(0, 197).trim()}…`;
  if (!t || t.length < 4) {
    const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'Worksheet').trim();
    const angle = String(meta.variantAngle || '')
      .split('(')[0]
      .trim()
      .slice(0, 48);
    t = angle ? `${topic} — ${angle}` : `${topic} — Worksheet`;
  }
  return t;
}

function syncWorksheetLegacyMirrors(structured, sections = null) {
  const canonical = buildCanonicalWorksheetSectionList(sections ?? structured?.sections ?? []);
  return {
    ...structured,
    sections: canonical,
    section_a_mcqs: canonical[0]?.questions || [],
    section_b_fib: canonical[1]?.questions || [],
    section_c_vsa: canonical[2]?.questions || [],
    section_d_sa: canonical[3]?.questions || [],
    section_e_competency: canonical[4]?.questions || [],
    section_a: canonical[0]?.questions || [],
    section_b: canonical[1]?.questions || [],
    section_c: canonical[2]?.questions || [],
    section_d: canonical[3]?.questions || [],
    section_e: canonical[4]?.questions || [],
    questions: canonical.flatMap((s) => s.questions || []),
  };
}

/** Rewrite only worksheet questions that duplicate earlier batch records (keeps LLM content when possible). */
export function repairWorksheetBatchDuplicates(structuredContent, meta = {}) {
  const avoid = Array.isArray(meta.avoidQuestionTexts) ? meta.avoidQuestionTexts.filter(Boolean) : [];
  if (!avoid.length) return structuredContent;
  const topic = resolveWorksheetTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const threshold = getQuestionSimilarityThreshold();
  let base = syncWorksheetLegacyMirrors(
    normalizeWorksheetStructuredContent(
      structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
        ? structuredContent
        : {},
      '',
    ),
  );
  if (!Array.isArray(base.sections) || !base.sections.length) return base;

  let repairCount = 0;
  const maxPasses = 5;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let passRepairs = 0;
    const usedTexts = [];
    let globalQ = 1;

    for (const section of base.sections) {
      const nextQuestions = [];
      for (const q of section.questions || []) {
        const canonicalSection = inferWorksheetSectionLabel(section?.sectionName, q);
        const text = String(q?.question || '').trim();
        const against = [...avoid, ...usedTexts];
        const exactHit = text && against.some((t) => String(t || '').trim() === text);
        const dup = exactHit
          ? { duplicate: true }
          : text
            ? findSimilarText(text, against, threshold)
            : { duplicate: false };
        if (dup.duplicate) {
          const salt =
            hashSeedToInt(`${meta.uniqueSeed || 'repair'}:${repairCount}:${globalQ}:${canonicalSection}:${pass}`) +
            repairCount * 131 +
            pass * 17;
          const repairVariant = (Number(meta.generationVariant) || 1) + repairCount * 41 + salt;
          const repairMeta = {
            ...meta,
            generationVariant: repairVariant,
            uniqueSeed: `${meta.uniqueSeed || 'repair'}-bq${repairCount}-q${globalQ}-p${pass}`,
            avoidQuestionTexts: against,
          };
          const useBookRepair = Boolean(meta.bookGenerator || meta.pdfContext);
          let replacement;
          if (useBookRepair && String(meta.pdfContext || '').trim().length > 80) {
            const sentences = extractBookGroundedSentences(meta.pdfContext, topic);
            const sentence =
              sentences[(repairCount + globalQ + pass) % Math.max(1, sentences.length)] ||
              sentences[0] ||
              topic;
            replacement = buildBookGroundedWorksheetQuestion(
              canonicalSection,
              sentence,
              topic,
              subject,
              globalQ,
              repairMeta,
            );
          } else {
            replacement = buildTopicGroundedWorksheetQuestion(canonicalSection, topic, subject, globalQ, repairMeta);
          }
          const repairedText = String(replacement.question || '').trim();
          nextQuestions.push({
            ...q,
            ...replacement,
            section: canonicalSection,
            question_number: globalQ,
          });
          if (repairedText) usedTexts.push(repairedText);
          repairCount += 1;
          passRepairs += 1;
        } else {
          nextQuestions.push({ ...q, question_number: globalQ });
          if (text) usedTexts.push(text);
        }
        globalQ += 1;
      }
      section.questions = nextQuestions;
    }

    base = syncWorksheetLegacyMirrors(base, base.sections);
    if (passRepairs === 0) break;
  }

  base.sections = padMissingWorksheetSections(base.sections, meta);
  if (repairCount > 0) base.topicGroundedFallback = true;
  return syncWorksheetLegacyMirrors(base, base.sections);
}

/** Ensure worksheet has sections A–E each with at least one question (AI Generator completeness). */
export function finalizeWorksheetStructuredContent(structuredContent, meta = {}) {
  const topic = resolveWorksheetTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const sourceText = String(meta.pdfContext || meta.sourceText || '').trim();
  const strictFinalize = meta.strictValidation === true;
  const allowSectionPad = isAiGeneratorSectionPadEnabled() && !strictFinalize;
  const base = normalizeWorksheetStructuredContent(
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {},
    sourceText,
    meta,
  );
  if (skipEnglishStructuredScaffold(meta) && !strictFinalize) {
    const indicScaffold = buildIndicScaffoldExamQuestions(meta, '');
    const sectionLabels =
      canonicalStoryPassageSubject(meta.subject) === 'Telugu'
        ? {
            A: 'విభాగం A: బహువికల్ప ప్రశ్నలు',
            B: 'విభాగం B: చాలా చిన్న సమాధాన ప్రశ్నలు',
            C: 'విభాగం C: చిన్న సమాధాన ప్రశ్నలు',
            D: 'విభాగం D: పొడవైన సమాధాన ప్రశ్నలు',
            E: 'విభాగం E: పరిస్థితి ఆధారిత ప్రశ్నలు',
          }
        : {
            A: 'खंड क: बहुविकल्पीय प्रश्न',
            B: 'खंड ख: अति लघु उत्तर प्रश्न',
            C: 'खंड ग: लघु उत्तर प्रश्न',
            D: 'खंड घ: दीर्घ उत्तर प्रश्न',
            E: 'खंड घर: प्रसंग आधारित प्रश्न',
          };
    const keyMap = { A: 'section_a', B: 'section_b', C: 'section_c', D: 'section_d', E: 'section_e' };
    if (!Array.isArray(base.sections) || !base.sections.length) {
      base.sections = Object.entries(keyMap).map(([letter, key]) => ({
        sectionName: sectionLabels[letter],
        questions: Array.isArray(indicScaffold[key]) ? indicScaffold[key] : [],
      }));
    }
    return base;
  }

  const needsBookRepair =
    (meta.bookGenerator || sourceText.length > 120) &&
    (countWorksheetSectionQuestions(base.sections) < 3 || worksheetHasPlaceholderQuestions(base));
  let bookGroundedFallback = Boolean(meta.bookGroundedFallback);
  let topicGroundedFallback = Boolean(meta.topicGroundedFallback);
  if (needsBookRepair) {
    const fromBook = buildBookGroundedWorksheetSections({ ...meta, pdfContext: sourceText || meta.pdfContext });
    if (fromBook?.length) {
      if (worksheetHasPlaceholderQuestions(base) && countWorksheetSectionQuestions(base.sections) >= 3) {
        base.sections = fromBook;
      } else {
        base.sections = mergeWorksheetSections(base.sections || [], fromBook);
      }
      base.questions = (base.sections || []).flatMap((s) => s.questions || []);
      bookGroundedFallback = true;
      if (Array.isArray(meta.avoidQuestionTexts) && meta.avoidQuestionTexts.length) {
        const repaired = repairWorksheetBatchDuplicates(base, meta);
        base.sections = repaired.sections || base.sections;
        base.questions = (base.sections || []).flatMap((s) => s.questions || []);
        if (repaired.topicGroundedFallback) topicGroundedFallback = true;
      }
    }
  }

  const needsTopicRepair =
    meta.batchOrchestrator &&
    !meta.bookGenerator &&
    sourceText.length < 120 &&
    !bookGroundedFallback &&
    (countWorksheetSectionQuestions(base.sections) < 3 || worksheetHasPlaceholderQuestions(base));
  if (needsTopicRepair) {
    const fromTopic = buildTopicGroundedWorksheetSections(meta);
    if (fromTopic?.length) {
      if (worksheetHasPlaceholderQuestions(base) && countWorksheetSectionQuestions(base.sections) >= 3) {
        base.sections = fromTopic;
      } else {
        base.sections = mergeWorksheetSections(base.sections || [], fromTopic);
      }
      base.questions = (base.sections || []).flatMap((s) => s.questions || []);
      topicGroundedFallback = true;
    }
  }

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
        question: `Explain ${topic} with definition and one example.`,
        answer: `Clear explanation of ${topic} with definition and supporting example.`,
        marks: 3,
      };
    }
    return {
      question_number: qNum,
      type: 'COMPETENCY',
      section: sectionName,
      question: `Solve or explain an extended problem on ${topic}. Show definition, steps, and conclusion.`,
      answer: `Structured response using concepts from ${topic} with steps and evidence.`,
      marks: 4,
    };
  };

  let sections = buildCanonicalWorksheetSectionList(base.sections || []);
  const greatQuality = isAiGeneratorGreatQualityEnabled() || meta.greatQuality === true;
  const preferTopicPad =
    !greatQuality &&
    (Boolean(meta.batchOrchestrator) || topicGroundedFallback || bookGroundedFallback);
  let globalQ = 1;
  sections = sections.map((sec, secIdx) => {
    const fillerMeta = {
      ...meta,
      generationVariant: Number(meta.generationVariant) || 1,
      sectionPadIndex: secIdx + 1,
      uniqueSeed: `${meta.uniqueSeed || ''}-pad${globalQ}-v${meta.generationVariant || 1}`,
    };
    const existing = Array.isArray(sec.questions)
      ? sec.questions.filter((q) => String(q?.question || '').trim().length >= 10)
      : [];
    const needsReplacement =
      existing.length > 0 &&
      topicGroundedFallback &&
      existing.every((q) => isPlaceholderText(String(q?.question || '')));
    if (existing.length && !needsReplacement) {
      const renumbered = existing.map((q) => {
        const blob = [q?.question, q?.answer, ...(Array.isArray(q?.options) ? q.options : [])]
          .filter(Boolean)
          .join(' ');
        if (!worksheetRowHasRagLeak(blob)) {
          return { ...q, question_number: globalQ++, section: sec.sectionName };
        }
        const replacement = buildTopicGroundedWorksheetQuestion(
          sec.sectionName,
          topic,
          subject,
          globalQ++,
          fillerMeta,
        );
        topicGroundedFallback = true;
        bookGroundedFallback = false;
        return { ...replacement, question_number: replacement.question_number, section: sec.sectionName };
      });
      return { ...sec, questions: renumbered, count: renumbered.length };
    }
    if (!allowSectionPad && !preferTopicPad) {
      return { ...sec, questions: [], count: 0 };
    }
    const filler = preferTopicPad
      ? buildTopicGroundedWorksheetQuestion(sec.sectionName, topic, subject, globalQ++, fillerMeta)
      : scaffoldForSection(sec.sectionName, globalQ++);
    return { ...sec, questions: [filler], count: 1 };
  });

  if (
    worksheetSectionsHaveRagLeak(sections) ||
    worksheetSectionsLackMathsNumericals(sections, subject, topic)
  ) {
    const repaired = buildTopicGroundedWorksheetSections({ ...meta, subTopic: topic, topic, subtopic: topic });
    if (repaired?.length) {
      sections = buildCanonicalWorksheetSectionList(repaired);
      topicGroundedFallback = true;
      bookGroundedFallback = false;
    }
  }

  const learning_objectives =
    Array.isArray(base.learning_objectives) && base.learning_objectives.length
      ? base.learning_objectives
      : allowSectionPad || bookGroundedFallback || topicGroundedFallback
        ? [
            `Students will recall key facts for the subtopic "${topic}".`,
            `Students will solve ${subject} exercises and numericals on "${topic}".`,
          ]
        : [];

  const instructions =
    String(base.instructions || '').trim() ||
    (allowSectionPad || bookGroundedFallback || topicGroundedFallback
      ? meta.bookGenerator || bookGroundedFallback
        ? `Read each section. Use the textbook ideas on ${topic} while answering.`
        : `Read each section carefully. Answer all questions on ${topic}.`
      : '');

  const draft = {
    ...base,
    title: sanitizeAiGeneratorWorksheetTitle(
      String(base.title || base.worksheet_title || `${topic} — Worksheet`).trim(),
      meta,
    ),
    worksheet_title: sanitizeAiGeneratorWorksheetTitle(
      String(base.worksheet_title || base.title || `${topic} — Worksheet`).trim(),
      meta,
    ),
    learning_objectives,
    objectives: learning_objectives,
    instructions,
    sections,
    bookGroundedFallback,
    topicGroundedFallback,
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

  return polishWorksheetStructuredContent(draft, meta);
}

/** Guarantee sections A–E are populated (use after batch repair/dedupe before save). */
export function ensureWorksheetSectionsComplete(structuredContent, meta = {}) {
  const base =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {};
  return polishWorksheetStructuredContent(base, meta);
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
    ...(entry._scaffold === true ? { _scaffold: true } : {}),
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
      question: stripVariantScaffoldFromQuestionText(String(row?.question || '').replace(/\s+/g, ' ').trim()),
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
  if (skipEnglishStructuredScaffold(meta)) return out;
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

function isGenericPracticeQaScaffoldQuestion(q) {
  const text = [
    q?.question,
    q?.answer,
    q?.explanation,
    ...(Array.isArray(q?.options) ? q.options : []),
  ]
    .join(' ')
    .toLowerCase();
  if (!text.trim()) return true;
  const patterns = [
    /claim without evidence/,
    /personal opinion only/,
    /unrelated fact/,
    /statement supported by observation/,
    /precise term or process from/,
    /students cite a brief evidence-based observation/,
    /short paragraph connecting .+ to daily life/,
    /students justify their choice using concepts/,
    /students compare reasoning and evidence/,
    /pick the claim that fits/,
    /core idea of .+\s*\|\s*a\.\s*definition/,
    /observable clue\s*\|\s*b\.\s*evidence from classroom/,
    /match column a with column b for .+ \(variant/,
    /during .+, one key term students must recall/,
    /for .+, pick the claim/,
  ];
  return patterns.some((re) => re.test(text));
}

function isPracticeQaFrameworkScaffoldText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 12) return true;
  const lower = t.toLowerCase();
  return (
    /^learning objectives for \d/.test(lower) ||
    /^instructions to students for \d/.test(lower) ||
    /^instructions to students for .+ in science$/i.test(t) ||
    lower.includes('students cite a brief evidence-based') ||
    lower.includes('a precise term or process from')
  );
}

function sanitizePracticeQaTitle(title, meta = {}) {
  let t = sanitizeAiGeneratorWorksheetTitle(title, meta);
  const topic = resolvePracticeQaTopicLabel(meta);
  t = t.replace(/^\d+(?:\.\d+)*\s+/, '').trim();
  if (
    t.length > 88 ||
    /edition for class/i.test(t) ||
    (/science fair|floral anatomy challenge/i.test(t) && t.length > 48)
  ) {
    const bank = getPracticeQaBankFramework(topic);
    t = bank?.title || `${topic} — Practice Set`;
  }
  if (t.length > 88) t = `${t.slice(0, 85).trim()}…`;
  if (!t || t.length < 4) t = `${topic} — Practice Set`;
  return t;
}

function ensurePracticeQaFrameworkContent(out, meta = {}) {
  const topic = resolvePracticeQaTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const classLabel = String(meta.classLabel || meta.class || '10').trim();
  const bank = getPracticeQaBankFramework(topic);

  let learning_objectives = dedupeStringList([
    ...(Array.isArray(out.learning_objectives) ? out.learning_objectives : []),
    ...(Array.isArray(out.objectives) ? out.objectives : []),
  ]).filter((row) => !isPracticeQaFrameworkScaffoldText(row));
  if (learning_objectives.length < 2) {
    learning_objectives =
      bank?.learning_objectives ||
      [
        `Recall key terms and processes related to ${topic}.`,
        `Explain ${topic} with labelled diagrams and NCERT-aligned examples.`,
        `Apply ${topic} to everyday observations and simple case-based problems in ${subject}.`,
      ];
  }

  let instructions = String(out.instructions || out.student_instructions || '').trim();
  if (isPracticeQaFrameworkScaffoldText(instructions)) {
    instructions =
      bank?.instructions ||
      `Class ${classLabel} ${subject}: attempt Sections A–G in order. Use precise textbook terms for ${topic}. Write complete answers in Sections D–G with at least one real-life Indian example where asked.`;
  }

  const title = sanitizePracticeQaTitle(out.title || out.practice_set_title, meta);
  return {
    ...out,
    title,
    practice_set_title: title,
    learning_objectives,
    objectives: learning_objectives,
    instructions,
    student_instructions: instructions,
  };
}

function buildPracticeQaFallbackQuestion(sectionName, topicLabel, subject, questionNumber, meta = {}) {
  const row = buildPracticeQaFallbackQuestionRaw(sectionName, topicLabel, subject, questionNumber, meta);
  return row && typeof row === 'object' ? { ...row, _scaffold: true } : row;
}

function buildPracticeQaFallbackQuestionRaw(sectionName, topicLabel, subject, questionNumber, meta = {}) {
  const variant = Number(meta.generationVariant) || 1;
  const avoid = Array.isArray(meta.avoidQuestionTexts) ? meta.avoidQuestionTexts : [];
  const mix =
    variant * 997 +
    hashSeedToInt(meta.uniqueSeed) +
    questionNumber * 13 +
    hashSeedToInt(`${sectionName}:${topicLabel}`);
  const uniqueQ = (text) => guaranteeBatchUniqueQuestionText(String(text || '').trim(), avoid, mix);

  if (sectionName === PRACTICE_QA_SECTION_LABELS.A) {
    return {
      question_number: questionNumber,
      type: 'MCQ',
      section: sectionName,
      question: uniqueQ(`Which statement about ${topicLabel} is correct according to the NCERT lesson?`),
      options: [
        `A) A process unrelated to ${topicLabel}`,
        `B) A definition or fact taught in the ${subject} chapter`,
        `C) A guess without textbook support`,
        `D) An opinion with no example`,
      ],
      answer: `B) A definition or fact taught in the ${subject} chapter`,
      marks: 1,
    };
  }
  if (sectionName === PRACTICE_QA_SECTION_LABELS.B) {
    return {
      question_number: questionNumber,
      type: 'FIB',
      section: sectionName,
      question: uniqueQ(`A key term associated with ${topicLabel} is _____.`),
      answer: `Correct NCERT term for ${topicLabel}.`,
      marks: 1,
    };
  }
  if (sectionName === PRACTICE_QA_SECTION_LABELS.C) {
    return {
      question_number: questionNumber,
      type: 'MATCH',
      section: sectionName,
      question: uniqueQ(`Match terms related to ${topicLabel} with their meanings.`),
      options: [
        '1. Key structure | A. Main function',
        '2. Process step | B. What happens in the lesson',
        '3. End product | C. Outcome described in class',
      ],
      answer: '1-A, 2-B, 3-C',
      marks: 2,
    };
  }
  if (sectionName === PRACTICE_QA_SECTION_LABELS.D) {
    return {
      question_number: questionNumber,
      type: 'VSA',
      section: sectionName,
      question: uniqueQ(`Define one important term from ${topicLabel}.`),
      answer: `Accurate one-line definition from the ${topicLabel} lesson.`,
      marks: 2,
    };
  }
  if (sectionName === PRACTICE_QA_SECTION_LABELS.E) {
    return {
      question_number: questionNumber,
      type: 'SA',
      section: sectionName,
      question: uniqueQ(`Explain ${topicLabel} in 3–4 sentences with one everyday example.`),
      answer: `Clear explanation of ${topicLabel} with a relevant example.`,
      marks: 3,
    };
  }
  if (sectionName === PRACTICE_QA_SECTION_LABELS.F) {
    return {
      question_number: questionNumber,
      type: 'APPLICATION',
      section: sectionName,
      question: uniqueQ(
        `A student observes a real-life situation connected to ${topicLabel}. Explain what concept applies and why.`,
      ),
      answer: `Concept from ${topicLabel} applied to the situation with reasoning.`,
      marks: 4,
    };
  }
  return {
    question_number: questionNumber,
    type: 'HOTS',
    section: sectionName,
    question: uniqueQ(
      `Compare two statements about ${topicLabel}. Which is scientifically stronger? Give reasons.`,
    ),
    answer: `Evaluates both statements using evidence from ${topicLabel}.`,
    marks: 5,
  };
}

/** Topic-grounded Practice Q&A filler — uses fact bank when available, never generic "claim without evidence" junk. */
function buildTopicGroundedPracticeQaQuestion(sectionName, topic, subject, questionNumber, meta = {}) {
  const topicLabel = resolvePracticeQaTopicLabel({ ...meta, subTopic: topic, subtopic: topic });
  const avoid = Array.isArray(meta.avoidQuestionTexts) ? meta.avoidQuestionTexts : [];
  const mix =
    (Number(meta.generationVariant) || 1) * 997 +
    questionNumber * 13 +
    hashSeedToInt(`${sectionName}:${topicLabel}`);

  const bankQ = pickPracticeQaBankQuestion(sectionName, topicLabel, {
    ...meta,
    questionNumber,
  });
  if (bankQ) {
    const uniqueText = guaranteeBatchUniqueQuestionText(String(bankQ.question || '').trim(), avoid, mix);
    return {
      ...bankQ,
      section: sectionName,
      question_number: questionNumber,
      question: uniqueText,
    };
  }
  return buildPracticeQaFallbackQuestion(sectionName, topicLabel, subject, questionNumber, meta);
}

export function practiceQaNeedsContentRepair(data) {
  const normalized = normalizePracticeQaStructuredContent(
    data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  );
  const questions = (normalized.sections || []).flatMap((s) => s.questions || []);
  if (!questions.length) return true;
  const genericCount = questions.filter((q) => isGenericPracticeQaScaffoldQuestion(q)).length;
  if (genericCount >= Math.ceil(questions.length * 0.4)) return true;
  const los = Array.isArray(normalized.learning_objectives) ? normalized.learning_objectives : [];
  if (los.length < 2 || los.some((row) => isPracticeQaFrameworkScaffoldText(row))) return true;
  if (isPracticeQaFrameworkScaffoldText(normalized.instructions)) return true;
  const title = String(normalized.title || '').trim();
  if (title.length > 100 || /edition for class/i.test(title)) return true;
  return false;
}

async function ensurePracticeQaQuality(structuredContent, meta, historicalBlock = '') {
  let content = structuredContent;
  if (!practiceQaNeedsContentRepair(content)) return content;
  console.log('[AI Generator] smart-qa-practice-generator repairing questions via LLM (scaffold/generic detected).');
  content = await repairPracticeQaViaLlm('smart-qa-practice-generator', content, meta, historicalBlock);
  content = finalizePracticeQaStructuredContent(content, { ...meta, skipPracticeQaScaffold: true });
  return content;
}

/** Re-canonicalize a repaired question tool's structure so downstream stays valid. */
function refinalizeQuestionTool(slug, content, meta) {
  switch (slug) {
    case 'worksheet-mcq-generator':
      return finalizeWorksheetStructuredContent(content, meta);
    case 'mock-test-builder':
      return finalizeMockTestStructuredContent(content, meta);
    case 'exam-question-paper-generator':
      return finalizeExamPaperStructuredContent(content, meta);
    case 'homework-creator':
      return finalizeHomeworkStructuredContent(content, meta);
    case 'quick-assignment-builder':
      return finalizeQuickAssignmentStructuredContent(content, meta);
    default:
      return content;
  }
}

/**
 * Generic detect -> LLM repair -> re-measure loop for all question tools (except
 * Smart Q&A, which has ensurePracticeQaQuality). Only repairs when scaffold
 * density exceeds the ceiling; keeps whichever result has lower density so a
 * failed/worse repair never degrades content. Never throws — the save-decision
 * scaffold guard is the backstop.
 */
async function ensureQuestionToolScaffoldQuality(slug, structuredContent, meta, historicalBlock = '') {
  if (!SCAFFOLD_REPAIRABLE_TOOLS.has(slug)) return structuredContent;
  const before = computeScaffoldDensity(slug, structuredContent);
  if (before.total < 3 || before.density <= SCAFFOLD_DENSITY_CEILING) return structuredContent;
  try {
    console.log(
      `[AI Generator] ${slug} repairing scaffold questions via LLM (${Math.round(before.density * 100)}% filler).`,
    );
    let repaired = await repairScaffoldQuestionsViaLlm(slug, structuredContent, meta, historicalBlock);
    repaired = refinalizeQuestionTool(slug, repaired, meta);
    if (repaired && typeof repaired === 'object' && !Array.isArray(repaired)) {
      repaired = sanitizeAiStructuredTextDeep(repaired);
    }
    const after = computeScaffoldDensity(slug, repaired);
    return after.density <= before.density ? repaired : structuredContent;
  } catch (err) {
    console.warn(`[AI Generator] ${slug} scaffold repair failed: ${err?.message || err}`);
    return structuredContent;
  }
}

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

  if (skipEnglishStructuredScaffold(meta) && !shouldRelaxPracticeQaBatchSave(meta, 'smart-qa-practice-generator')) {
    return ensurePracticeQaFrameworkContent(out, meta);
  }

  const title = String(out.title || out.practice_set_title || '').trim();
  const isGeneric = !title || /^practice\s*q\s*&?\s*a$/i.test(title);
  if (isGeneric) {
    const label = resolvePracticeQaTopicLabel(meta);
    const nextTitle = `Practice Q&A: ${label}`;
    out = { ...out, title: nextTitle, practice_set_title: nextTitle };
  }

  out = ensurePracticeQaFrameworkContent(out, meta);
  if (!meta.skipPracticeQaScaffold) {
    out = ensurePracticeQaAllSectionsFilled(out, meta);
  }
  return out;
}

/** Force every Practice Q&A section A–G to have at least one unique question (batch-safe). */
export function ensurePracticeQaAllSectionsFilled(structured, meta = {}) {
  let out =
    structured && typeof structured === 'object' && !Array.isArray(structured) ? { ...structured } : {};
  const topic = resolvePracticeQaTopicLabel(meta);
  const subject = String(meta.subject || 'Science').trim();
  const avoid = Array.isArray(meta.avoidQuestionTexts) ? meta.avoidQuestionTexts.filter(Boolean) : [];
  const used = [...avoid];
  const threshold = getQuestionSimilarityThreshold();
  const canonical = buildCanonicalPracticeQaSectionList(out.sections || []);
  const byName = new Map(canonical.map((sec) => [sec.sectionName, { ...sec, questions: [...(sec.questions || [])] }]));
  let n = 1;

  const rebuildQuestion = (sectionName, qNum, extraMeta = {}) =>
    buildTopicGroundedPracticeQaQuestion(sectionName, topic, subject, qNum, {
      ...meta,
      ...extraMeta,
      generationVariant: (Number(meta.generationVariant) || 1) + qNum * 17,
      uniqueSeed: `${meta.uniqueSeed || 'pqa'}-${sectionName}-${qNum}`,
      avoidQuestionTexts: used,
    });

  for (const sectionName of Object.values(PRACTICE_QA_SECTION_LABELS)) {
    const sec = byName.get(sectionName) || { sectionName, questions: [], count: 0 };
    let questions = Array.isArray(sec.questions) ? sec.questions.filter((q) => String(q?.question || '').trim()) : [];

    questions = questions.map((q) => {
      const text = String(q?.question || '').trim();
      const isScaffold = isGenericPracticeQaScaffoldQuestion(q);
      const dup = text && !isScaffold ? findSimilarText(text, used, threshold) : { duplicate: isScaffold };
      if (!dup.duplicate && !isScaffold) {
        used.push(text);
        n += 1;
        return q;
      }
      const rebuilt = rebuildQuestion(sectionName, n, { questionNumber: n });
      const uniqueText = guaranteeBatchUniqueQuestionText(String(rebuilt.question || '').trim(), used, n);
      used.push(uniqueText);
      n += 1;
      return { ...rebuilt, question: uniqueText, question_number: q?.question_number || rebuilt.question_number };
    });

    if (!questions.length) {
      const rebuilt = rebuildQuestion(sectionName, n, { questionNumber: n });
      const uniqueText = guaranteeBatchUniqueQuestionText(String(rebuilt.question || '').trim(), used, n);
      used.push(uniqueText);
      questions = [{ ...rebuilt, question: uniqueText }];
      n += 1;
    }

    byName.set(sectionName, { ...sec, questions, count: questions.length });
  }

  const sections = Object.values(PRACTICE_QA_SECTION_LABELS).map((label) => byName.get(label));
  const flat = sections.flatMap((s) => s.questions || []);
  const title = sanitizePracticeQaTitle(out.title || out.practice_set_title, meta);
  out = ensurePracticeQaFrameworkContent(
    {
      ...out,
      title,
      practice_set_title: title,
      sections,
      questions: flat,
      practice_questions: flat,
    },
    meta,
  );
  return out;
}

/** AI Generator: pad homework sections (objectives, question objects) before validation. */
export function finalizeHomeworkStructuredContent(structuredContent, meta = {}) {
  const raw =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {};
  if (skipEnglishStructuredScaffold(meta)) return raw;

  let out = normalizeHomeworkStructuredContent(raw);
  out = ensureHomeworkPracticeQuestions(out, meta);

  if (isAiGeneratorSectionPadEnabled()) {
    out = padAiGeneratorCanonicalSections('homework-creator', out, meta);
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

  let answerKeyOut = '';
  if (questions.length) {
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

const EXAM_BLUEPRINT_SECTION_DEFAULTS = { a: 4, b: 3, c: 3, d: 2, e: 1 };

function parseBlueprintSectionCounts(blueprint = '') {
  const text = String(blueprint || '');
  const pick = (letter) => {
    const m = text.match(new RegExp(`section\\s*${letter}[^\\d]*(\\d+)`, 'i'));
    return m ? Math.max(0, Number(m[1])) : 0;
  };
  const parsed = {
    a: pick('a'),
    b: pick('b'),
    c: pick('c'),
    d: pick('d'),
    e: pick('e'),
  };
  if (parsed.a + parsed.b + parsed.c + parsed.d + parsed.e === 0) {
    return { ...EXAM_BLUEPRINT_SECTION_DEFAULTS };
  }
  // Blueprint often lists A–C only; missing D/E must not trim those sections to zero.
  return {
    a: parsed.a || EXAM_BLUEPRINT_SECTION_DEFAULTS.a,
    b: parsed.b || EXAM_BLUEPRINT_SECTION_DEFAULTS.b,
    c: parsed.c || EXAM_BLUEPRINT_SECTION_DEFAULTS.c,
    d: parsed.d || EXAM_BLUEPRINT_SECTION_DEFAULTS.d,
    e: parsed.e || EXAM_BLUEPRINT_SECTION_DEFAULTS.e,
  };
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
    return stripVariantScaffoldFromQuestionText(raw.slice(0, idx).trim());
  }

  // Fallback: line-wise boundary detection.
  const lines = raw.split('\n');
  const lineBoundaryRe =
    /^\s*(?:#{1,4}\s*)?(?:section\s*[a-e]\s*:|internal\s+choices\b|marking\s+scheme\b|rubric\s+for\s+open|complete\s+answer\s+key\b|blueprint\b|total\s+marks\b)/i;
  const firstBoundaryIdx = lines.findIndex((l, idx) => idx > 0 && lineBoundaryRe.test(String(l || '').trim()));
  const kept = (firstBoundaryIdx >= 0 ? lines.slice(0, firstBoundaryIdx) : lines).join('\n');
  return stripVariantScaffoldFromQuestionText(kept.trim());
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
function examScaffoldVariantContext(meta = {}) {
  const topic = String(meta.subTopic || meta.subtopic || meta.topic || 'this subtopic').trim();
  const variant = Number(meta.generationVariant ?? meta.variantIndex) || 1;
  return { topic, variant, frame: `Set ${variant}` };
}

function buildScaffoldExamQuestions(meta = {}, blueprint = '') {
  const { topic, variant, frame } = examScaffoldVariantContext(meta);
  const counts = parseBlueprintSectionCounts(blueprint);
  const buckets = { section_a: [], section_b: [], section_c: [], section_d: [], section_e: [] };
  const mcqStems = [
    (t) => `Which statement about ${t} is most accurate?`,
    (t) => `Identify the correct idea related to ${t}.`,
    (t) => `Choose the best description of ${t}.`,
    (t) => `Which option correctly applies ${t}?`,
  ];
  const vsaStems = [
    (t) => `Define a key term linked to ${t}.`,
    (t) => `State one essential fact about ${t}.`,
    (t) => `Name and define a core concept in ${t}.`,
  ];
  const saStems = [
    (t) => `Explain ${t} with definition and one example.`,
    (t) => `Describe the principle behind ${t}.`,
    (t) => `Explain how to apply the formula or rule for ${t}.`,
  ];
  const laStems = [
    (t) => `Explain ${t} in detail: definition, formula, and one worked example.`,
    (t) => `Analyse the main principles of ${t} with steps and evidence.`,
    (t) => `Discuss ${t} with definition, numerical application, and conclusion.`,
  ];
  const caseStems = [
    (t) => `Extended problem on ${t}: use given data and answer all parts.`,
    (t) => `Applied question on ${t}: calculate and explain with full working.`,
    (t) => `Multi-part question on ${t}: define, explain, and solve numerically.`,
  ];
  let n = 1;
  for (let i = 0; i < counts.a; i += 1) {
    const stem = mcqStems[(variant + i) % mcqStems.length](topic);
    buckets.section_a.push({
      question_number: n++,
      question: stem,
      options: [
        'A) Belief without evidence',
        'B) Systematic observation and evidence',
        'C) Superstition only',
        'D) Unquestioned tradition',
      ],
      answer: 'B) Systematic observation and evidence',
      marks: 1,
      _scaffold: true,
    });
  }
  for (let i = 0; i < counts.b; i += 1) {
    buckets.section_b.push({
      question_number: n++,
      question: vsaStems[(variant + i) % vsaStems.length](topic),
      answer: `A concise definition and explanation of ${topic}.`,
      marks: 2,
      _scaffold: true,
    });
  }
  for (let i = 0; i < counts.c; i += 1) {
    buckets.section_c.push({
      question_number: n++,
      question: saStems[(variant + i) % saStems.length](topic),
      answer: `Clear explanation of ${topic} with definition and example.`,
      marks: 3,
      _scaffold: true,
    });
  }
  for (let i = 0; i < counts.d; i += 1) {
    buckets.section_d.push({
      question_number: n++,
      question: laStems[(variant + i) % laStems.length](topic),
      answer: `Step-by-step explanation with definition, formula, and evidence for ${topic}.`,
      marks: 5,
      _scaffold: true,
    });
  }
  for (let i = 0; i < counts.e; i += 1) {
    buckets.section_e.push({
      question_number: n++,
      question: caseStems[(variant + i) % caseStems.length](topic),
      answer: `Structured answer using concepts and calculations from ${topic}.`,
      marks: 6,
      _scaffold: true,
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
  const m = examPaperMeta(meta);
  const skipRefinalize = meta.skipExamRefinalize === true;
  const n = skipRefinalize
    ? enforceIndicLanguageStructuredContent('exam-question-paper-generator', data, m)
    : enforceIndicLanguageStructuredContent(
        'exam-question-paper-generator',
        finalizeExamPaperStructuredContent(data, m),
        m,
      );
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
  const sectionKeys = ['section_a', 'section_b', 'section_c', 'section_d', 'section_e'];
  const emptySections = sectionKeys.filter((k) => {
    const rows = Array.isArray(n[k]) ? n[k] : [];
    return !rows.some((q) => String(q?.question || q?.prompt || '').trim().length >= 10);
  });
  if (emptySections.length && emptySections.length < sectionKeys.length && qCount >= 3) {
    missing.push(`3–7. Question Paper Sections (missing: ${emptySections.join(', ')})`);
  }
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
  if (skipEnglishStructuredScaffold(meta)) {
    return fillIndicExamPaperScaffold(base, meta);
  }

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
  const cleanAndTrim = (arr, n) => {
    const cleaned = dedupeExamQuestionRows(arr);
    if (!n || n <= 0) return cleaned;
    return cleaned.slice(0, n);
  };
  const examSectionKeys = ['section_a', 'section_b', 'section_c', 'section_d', 'section_e'];
  const countKeys = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 0; i < examSectionKeys.length; i += 1) {
    base[examSectionKeys[i]] = cleanAndTrim(base[examSectionKeys[i]], counts[countKeys[i]]);
  }

  if (isExamScaffoldPaddingAllowed() && isAiGeneratorSectionPadEnabled() && meta.strictValidation !== true) {
    const scaffold = buildScaffoldExamQuestions(meta, base.blueprint);
    let qNum = 1;
    for (let i = 0; i < examSectionKeys.length; i += 1) {
      const key = examSectionKeys[i];
      const minCount = Math.max(1, counts[countKeys[i]] || 1);
      let rows = Array.isArray(base[key])
        ? base[key].filter((q) => String(q?.question || '').trim().length >= 10)
        : [];
      const scaffoldRows = Array.isArray(scaffold[key]) ? scaffold[key] : [];
      if (rows.length < minCount && scaffoldRows.length) {
        for (let j = rows.length; j < minCount; j += 1) {
          const pick = scaffoldRows[j] || scaffoldRows[scaffoldRows.length - 1];
          rows.push({ ...pick, question_number: qNum + j });
        }
      }
      base[key] = rows.map((q) => {
        const row = { ...q, question_number: qNum };
        qNum += 1;
        return row;
      });
    }
  }

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

  if (isExamScaffoldPaddingAllowed() && countExamPaperQuestions(base) < 3 && meta.strictValidation !== true) {
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
  if (skipEnglishStructuredScaffold(meta)) {
    if (countMockTestQuestions(out) < 3) {
      const scaffold = buildIndicScaffoldExamQuestions(meta, out.blueprint || '');
      out = normalizeMockTestStructuredContent({ ...out, ...scaffold }, collectMockTestParseableText(out));
    }
    const mockTitle = String(out.mock_test_title || out.paper_title || out.title || '').trim();
    if (!mockTitle) {
      const lang = canonicalStoryPassageSubject(meta.subject);
      const label =
        [meta.topic, meta.subTopic].filter(Boolean).join(' — ').trim() ||
        (lang === 'Telugu' ? 'మాక్ పరీక్ష' : 'मॉक परीक्षा');
      const mockTitleFull = lang === 'Telugu' ? `మాక్ పరీక్ష: ${label}` : `मॉक परीक्षा: ${label}`;
      out = { ...out, mock_test_title: mockTitleFull, paper_title: label, title: label };
    }
    return out;
  }
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
  if (skipEnglishStructuredScaffold(meta)) return s;
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
  if (skipEnglishStructuredScaffold(meta)) return fillIndicDailyClassPlanScaffold(base, meta);

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
  if (toolSlug === '__removed-rubrics-tool__') {
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
  '__removed-rubrics-tool__': {
    allowedTypes: ['Rubric'],
    validate: (data) => rubricStructuredContentIsComplete(data),
    message:
      'Rubric must include all 10 sections: purpose, competency, min 3 criteria with four performance levels each, grading criteria, strengths, improvements, remarks, actionable suggestions, parent feedback, and next-step activity.',
  },
  'reading-practice-room': {
    allowedTypes: ['Reading Practice', 'Story'],
    validate: (data) => readingPracticeStructuredContentIsComplete(data),
    message:
      'Reading Practice Room must include all 13 sections: full passage (120+ words), objectives, vocabulary, three question sets (min 2 each), answer key, and reflection — not section labels as content.',
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
  } else if (toolSlug === 'worksheet-mcq-generator') {
    const rootPick = {
      ...(root.title ? { title: root.title } : {}),
      ...(root.worksheet_title ? { worksheet_title: root.worksheet_title } : {}),
      ...(Array.isArray(root.learning_objectives) ? { learning_objectives: root.learning_objectives } : {}),
      ...(Array.isArray(root.objectives) ? { objectives: root.objectives } : {}),
      ...(root.instructions ? { instructions: root.instructions } : {}),
      ...(Array.isArray(root.sections) ? { sections: root.sections } : {}),
      ...(Array.isArray(root.questions) ? { questions: root.questions } : {}),
      ...(Array.isArray(root.mcqs) ? { mcqs: root.mcqs } : {}),
      ...(Array.isArray(root.section_a_mcqs) ? { section_a_mcqs: root.section_a_mcqs } : {}),
      ...(Array.isArray(root.section_a) ? { section_a: root.section_a } : {}),
      ...(Array.isArray(root.section_b_fib) ? { section_b_fib: root.section_b_fib } : {}),
      ...(Array.isArray(root.section_b) ? { section_b: root.section_b } : {}),
      ...(Array.isArray(root.section_c_vsa) ? { section_c_vsa: root.section_c_vsa } : {}),
      ...(Array.isArray(root.section_c) ? { section_c: root.section_c } : {}),
      ...(Array.isArray(root.section_d_sa) ? { section_d_sa: root.section_d_sa } : {}),
      ...(Array.isArray(root.section_d) ? { section_d: root.section_d } : {}),
      ...(Array.isArray(root.section_e_competency) ? { section_e_competency: root.section_e_competency } : {}),
      ...(Array.isArray(root.section_e) ? { section_e: root.section_e } : {}),
      ...(root.answer_key ? { answer_key: root.answer_key } : {}),
      ...(root.bloom_level ? { bloom_level: root.bloom_level } : {}),
      ...(root.difficulty_tag ? { difficulty_tag: root.difficulty_tag } : {}),
      ...(root.question ? { question: root.question } : {}),
      ...(root.options ? { options: root.options } : {}),
      ...(root.answer ? { answer: root.answer } : {}),
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
      ...(root.question_paper ? { question_paper: root.question_paper } : {}),
      ...(Array.isArray(root.questions) ? { questions: root.questions } : {}),
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
    if (Object.keys(inner).length === 0) {
      const { contentType: _ct, structuredContent: _sc, ...rest } = root;
      if (Object.keys(rest).length) inner = { ...rest };
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
  const tp = subTopic ? `${topic} — ${subTopic}` : topic;
  return {
    title: variantN > 0 ? `${topic} — practice activity ${variantN}` : `Activity: ${topic}`,
    materials: [
      'Notebook / loose paper',
      'Pencils and coloured pencils or markers',
      'Plain A4 sheets (if needed)',
      'Ruler',
      `${subject} textbook or excerpt from the uploaded PDF`,
      'Board or chart paper for sharing answers (optional)',
    ],
    steps: [
      `Read the section on ${topic} and list four key terms or formulas on one half-sheet.`,
      `Compare lists — merge duplicates and mark the two terms that need the most clarification.`,
      `Solve or explain one core problem on "${tp}" using definition, formula, and working.`,
      `Each group writes one complete answer on the board: definition + one example or calculation.`,
      `Whole class agrees on three checkpoints for understanding ${topic}.`,
      `Exit slip: one definition, one numerical or evidence point, one question about ${subTopic || topic} (${subject}).`,
    ],
    learningOutcome: `Learners demonstrate understanding of ${tp} in ${subject} through precise definitions and worked examples (${classLabel}).`,
  };
}

function augmentActivityStructuredContent(normalizedFlat, meta, toolSlug = 'activity-project-generator') {
  // Always replace heading-echo placeholders first (prevents Premium burn + 0 saves).
  let n = repairActivityHeadingEchoFields(
    normalizeActivityStructuredContent(normalizedFlat, toolSlug),
    meta,
    toolSlug,
  );
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

  // Strict Premium used to skip fallback entirely — that caused retries + cost with 0 saved.
  // Book / batch generations must still get curriculum fallback so records can save.
  const allowFallback =
    !isStrictAllFieldsValidation(meta) ||
    meta.bookGenerator === true ||
    meta.batchOrchestrator === true ||
    meta.strictValidation === false;

  if (!allowFallback) {
    return n;
  }

  if (meta?.generationVariant) {
    console.warn(
      `[AI Generator] Activity scaffold fallback for variant ${meta.generationVariant} — model output was incomplete; applying curriculum fallback so the record can save.`,
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

  return repairActivityHeadingEchoFields(
    normalizeActivityStructuredContent(
      {
        ...n,
        title,
        materials,
        steps,
        learningOutcome,
      },
      toolSlug,
    ),
    meta,
    toolSlug,
  );
}

export function finalizeActivityStructuredContent(structuredContent, meta = {}, toolSlug = 'activity-project-generator') {
  const raw =
    structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? structuredContent
      : {};
  if (skipEnglishStructuredScaffold(meta)) {
    return repairActivityHeadingEchoFields(
      normalizeActivityStructuredContent(raw, toolSlug),
      meta,
      toolSlug,
    );
  }
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
    const examMeta = examPaperMeta(meta);
    const finalized = enforceIndicLanguageStructuredContent(
      normalizedTool,
      finalizeExamPaperStructuredContent(
        structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
          ? structuredContent
          : {},
        examMeta,
      ),
      examMeta,
    );
    if (!allowed.includes(resolvedType)) {
      return {
        valid: false,
        message: `Detected content type "${resolvedType}" is not allowed for selected tool.`,
        normalizedType: resolvedType,
        normalizedStructuredContent: finalized,
      };
    }
    if (!examPaperStructuredContentIsComplete(finalized, { ...examMeta, skipExamRefinalize: true })) {
      const missing = getExamPaperMissingSections(finalized, { ...examMeta, skipExamRefinalize: true });
      return {
        valid: false,
        message: missing.join('; ') || rule.message,
        normalizedType: resolvedType,
        normalizedStructuredContent: finalized,
        missingSections: missing,
      };
    }
    let contentForValidate = padAiGeneratorCanonicalSections(normalizedTool, finalized, examMeta);

    if (mustEnforceStoryPassageLanguageCompliance(examMeta.subject)) {
      const languageCheck = validateStoryPassageLanguageCompliance(
        examMeta.subject,
        contentForValidate,
        {
          requirePassage: false,
          toolSlug: normalizedTool,
        },
      );
      if (!languageCheck.valid) {
        return {
          valid: false,
          message: languageCheck.errors.join(' '),
          normalizedType: resolvedType,
          normalizedStructuredContent: contentForValidate,
          missingSections: [],
        };
      }
    }

    const requireAllFields = isStrictAllFieldsValidation(meta);
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
    contentForValidate = finalizeWorksheetStructuredContent(
      contentForValidate,
      shouldRelaxBatchWorksheetSave(meta, normalizedTool) ? { ...meta, strictValidation: false } : meta,
    );
  }
  if (normalizedTool === 'homework-creator') {
    contentForValidate = finalizeHomeworkStructuredContent(contentForValidate, meta);
  }
  if (normalizedTool === 'smart-qa-practice-generator') {
    contentForValidate = finalizePracticeQaStructuredContent(contentForValidate, meta);
  }
  if (normalizedTool === 'quick-assignment-builder') {
    contentForValidate = finalizeQuickAssignmentStructuredContent(contentForValidate, meta);
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
        ...meta,
        subTopic: meta.subTopic || meta.subtopic || meta.topic,
        topic: meta.topic,
        subject: meta.subject || contentForValidate.subject || 'Science',
        classLabel: meta.classLabel || meta.class,
      },
      normalizedTool,
    );
    contentForValidate = finalized;
  }

  if (
    !rule.validate(contentForValidate) &&
    shouldRelaxFlashcardBatchSave(meta, normalizedTool) &&
    flashcardBatchHasSaveableContent(contentForValidate, normalizedTool)
  ) {
    return {
      valid: true,
      message: '',
      normalizedType: resolvedType,
      normalizedStructuredContent: contentForValidate,
    };
  }

  if (!rule.validate(contentForValidate)) {
    const customMessage =
      normalizedTool === 'smart-qa-practice-generator'
        ? practiceQaValidationMessage(contentForValidate) || rule.message
        : normalizedTool === 'flashcard-generator' || normalizedTool === 'my-study-decks'
          ? (getFlashcardDeckMissingSections(contentForValidate, normalizedTool, meta).join('; ') ||
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

  if (mustEnforceStoryPassageLanguageCompliance(meta.subject || contentForValidate.subject)) {
    const languageCheck = validateStoryPassageLanguageCompliance(
      meta.subject || contentForValidate.subject,
      contentForValidate,
      {
        requirePassage: isStoryPassageLanguageToolSlug(normalizedTool),
        toolSlug: normalizedTool,
      },
    );
    if (!languageCheck.valid) {
      return {
        valid: false,
        message: languageCheck.errors.join(' '),
        normalizedType: resolvedType,
        normalizedStructuredContent: contentForValidate,
        missingSections: [],
      };
    }
  }

  const requireAllFields = isStrictAllFieldsValidation(meta);
  if (isAiGeneratorSectionPadEnabled()) {
    contentForValidate = padAiGeneratorCanonicalSections(normalizedTool, contentForValidate, meta);
  }

  if (mustEnforceStoryPassageLanguageCompliance(meta.subject || contentForValidate.subject)) {
    const postPadLanguageCheck = validateStoryPassageLanguageCompliance(
      meta.subject || contentForValidate.subject,
      contentForValidate,
      {
        requirePassage: isStoryPassageLanguageToolSlug(normalizedTool),
        toolSlug: normalizedTool,
      },
    );
    if (!postPadLanguageCheck.valid) {
      return {
        valid: false,
        message: postPadLanguageCheck.errors.join(' '),
        normalizedType: resolvedType,
        normalizedStructuredContent: contentForValidate,
        missingSections: [],
      };
    }
  }

  if (requireAllFields) {
    const allFields = validateAllCanonicalToolFields(normalizedTool, contentForValidate);
    if (!allFields.valid) {
      if (
        shouldRelaxFlashcardBatchSave(meta, normalizedTool) &&
        flashcardBatchHasSaveableContent(contentForValidate, normalizedTool)
      ) {
        return {
          valid: true,
          message: '',
          normalizedType: resolvedType,
          normalizedStructuredContent: contentForValidate,
        };
      }
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
      if (
        shouldRelaxFlashcardBatchSave(meta, normalizedTool) &&
        flashcardBatchHasSaveableContent(contentForValidate, normalizedTool)
      ) {
        return {
          valid: true,
          message: '',
          normalizedType: resolvedType,
          normalizedStructuredContent: contentForValidate,
        };
      }
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
  if (toolSlug === '__removed-rubrics-tool__') {
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
  const extra = params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {};
  const qualityTierSettings = resolveQualityTierSettings(
    params.qualityTier || extra.qualityTier,
    {
      qualityTier: params.qualityTier || extra.qualityTier,
      batchSize: Number(extra.batchSize) || Number(params.batchSize) || 0,
    },
  );
  const resolvedSubject = resolveLanguageSubjectForGeneration(
    params.subject,
    params.bookSubject || extra.bookSubject,
  );
  const useResponseSchema =
    qualityTierSettings.useResponseSchema && isResponseSchemaEnabled(slug);
  const pdfContextParam = String(params.pdfContext || '').trim();
  let pdfContext = pdfContextParam;
  let curriculumSources = [];

  if (!pdfContext && isAssessmentToolSlug(slug)) {
    const curriculumBlock = await buildCurriculumContextPromptBlock({
      board: params.board,
      classLabel: params.classLabel || params.gradeLevel,
      subject: resolvedSubject,
      topic: params.topic,
      subTopic: params.subTopic || params.subtopic,
      toolSlug: slug,
    });
    if (curriculumBlock) {
      pdfContext = curriculumBlock;
      curriculumSources = ['curriculum-resolver'];
    }
  }

  const hasBookContext = Boolean(
    pdfContext && (extra.bookGenerator || extra.bookId || /TEXTBOOK CONTENT|REFERENCE TEXTBOOK|\[Chunk \d+\]/i.test(pdfContext)),
  );

  const promptParts = buildAiGeneratorPromptParts(slug, {
    ...params,
    subject: resolvedSubject,
    useResponseSchema,
    hasBookContext,
    pdfContext: hasBookContext ? pdfContext : undefined,
  });
  const responseSchema = useResponseSchema
    ? buildGeminiResponseSchemaForTool(
        getToolInformalSchema(slug),
        promptParts.contentTypeDefault || defaultContentType,
      )
    : null;

  const historicalBlock = String(params.historicalPromptBlock || '').trim();
  const storyLanguageTail =
    mustEnforceStoryPassageLanguageCompliance(resolvedSubject)
      ? buildStoryPassageLanguagePromptTail(resolvedSubject)
      : '';
  const ragLanguageNote =
    pdfContext && mustEnforceStoryPassageLanguageCompliance(resolvedSubject)
      ? `\nBOOK SOURCE LANGUAGE NOTE: Reference passages may be in English — you MUST still write ALL output string values in the required output language (translate/synthesize; never copy English into student-facing fields).`
      : '';
  const ragBlock = pdfContext
    ? `${historicalBlock ? `\n\n${historicalBlock}` : ''}

REFERENCE TEXTBOOK CONTENT (RAG — PRIMARY factual source for this generation):
Use the passages below as the PRIMARY source. Follow textbook terminology, definitions, examples, formulae, and explanations.
Generate MCQs, worksheets, and practice in the same formats as the textbook Exercises and Activities (not generic AI-style prompts).
Generate questions and content DIRECTLY on the selected subtopic using these passages — no fictional scenario wrappers.
Do not invent facts that contradict the book. Only use general knowledge when the book is silent, and stay on the same subtopic.
Priority: (1) Uploaded Book  (2) Uploaded Notes  (3) Gemini knowledge.
Synthesize into the tool schema above — do not paste blocks verbatim.${ragLanguageNote}
${pdfContext}${storyLanguageTail ? `\n\n${storyLanguageTail}` : ''}`
    : `${historicalBlock ? `\n\n${historicalBlock}` : ''}${storyLanguageTail ? `\n\n${storyLanguageTail}` : ''}`.trim();

  const baseUserPrompt = [promptParts.userPrompt, ragBlock].filter(Boolean).join('\n\n');
  const systemPrompt = promptParts.systemPrompt;
  const generationVariant = Number(extra.generationVariant ?? extra.variantIndex);
  const isBatchVariant = Number.isFinite(generationVariant) && generationVariant > 0;
  const recoveryPass = extra.recoveryPass === true || params.recoveryPass === true;
  const upgradeToFlash = shouldUseFlashForAiGeneratorRun({
    upgradeRequested: params.upgradeToFlash === true,
    recoveryPass,
  });
  const flashLiteOnly = isAiGeneratorFlashLiteOnlyEnabled();
  const batchModel = getAiGeneratorGeminiModel();
  const liteModel = resolveAllowedGeminiModel(batchModel);
  const { getAiGeneratorMaxTokens } = await import('../utils/ai-generator-llm-budget.js');
  const maxTokens = getAiGeneratorMaxTokens(slug, {
    qualityTier: qualityTierSettings.tier,
    skipUltraEconomyCaps: qualityTierSettings.skipUltraEconomyCaps === true,
  });

  const batchEconomy =
    isBatchVariant &&
    qualityTierSettings.tier === 'fast' &&
    isAiGeneratorCostSaverEnabled();
  // Tier flag wins — Premium can use Pro even when global FLASH_LITE_ONLY=true.
  const effectiveFlashLiteOnly =
    typeof qualityTierSettings.flashLiteOnly === 'boolean'
      ? qualityTierSettings.flashLiteOnly
      : flashLiteOnly || batchEconomy;
  const tierPrimaryModel = effectiveFlashLiteOnly
    ? liteModel
    : resolveAllowedGeminiModel(qualityTierSettings.primaryGeminiModel || batchModel);
  const tierGeminiRetries = qualityTierSettings.geminiRetriesPerModel || 3;
  const languageSubjectEnforced = mustEnforceStoryPassageLanguageCompliance(resolvedSubject);
  const preferIndicFlash =
    languageSubjectEnforced &&
    isAiGeneratorLanguageSubjectFlashOverrideEnabled() &&
    qualityTierSettings.tier === 'fast';
  const indicFlashModel = getAiGeneratorLanguageSubjectGeminiModel();

  const buildLlmOptions = (attempt) => {
    const tierTemp = getTemperatureForTool(slug, qualityTierSettings);
    const baseOpts = {
      isBatchVariant,
      maxTokens,
      systemPrompt,
      responseSchema,
      maxAttemptsPerModel: tierGeminiRetries,
      modelOverflow: effectiveFlashLiteOnly ? liteModel : (qualityTierSettings.modelOverflow || liteModel),
    };
    if (preferIndicFlash) {
      return {
        ...baseOpts,
        temperature: attempt === 1 ? Math.max(0.55, tierTemp - 0.15) : 0.55,
        primaryModel: indicFlashModel,
        flashLiteOnly: true,
      };
    }
    const useFlashUpgrade =
      effectiveFlashLiteOnly &&
      (upgradeToFlash ||
        shouldUpgradeFlashOnValidationAttempt(isBatchVariant, attempt, recoveryPass));
    if (useFlashUpgrade) {
      return {
        ...baseOpts,
        temperature: 0.55,
        primaryModel: tierPrimaryModel !== batchModel ? tierPrimaryModel : indicFlashModel,
        flashLiteOnly: false,
      };
    }
    if (isBatchVariant) {
      return {
        ...baseOpts,
        isBatchVariant: true,
        temperature: tierTemp,
        primaryModel: tierPrimaryModel,
        flashLiteOnly: effectiveFlashLiteOnly,
      };
    }
    return {
      ...baseOpts,
      temperature: tierTemp,
      primaryModel: tierPrimaryModel,
      flashLiteOnly: effectiveFlashLiteOnly,
    };
  };

  const isBookBatch = isBatchVariant && Boolean(extra.bookId || extra.bookGenerator);
  const meta = {
    classLabel: params.classLabel || params.gradeLevel,
    subject: resolvedSubject,
    bookSubject: params.bookSubject || extra.bookSubject,
    topic: params.topic,
    subTopic: params.subTopic || params.subtopic,
    board: params.board,
    questionCount: Number(extra.questionCount ?? extra.numberOfQuestions ?? params.questionCount),
    generationVariant: isBatchVariant ? generationVariant : undefined,
    variantAngle: isBatchVariant ? String(extra.variantAngle || '').trim() : undefined,
    variantScenario: isBatchVariant ? String(extra.variantScenario || '').trim() : undefined,
    batchOrchestrator: isBatchVariant,
    bookGenerator: isBookBatch,
    pdfContext: pdfContext || undefined,
    curriculumSources: curriculumSources.length ? curriculumSources : undefined,
    uniqueSeed: String(extra.uniqueSeed || extra.generationVariant || ''),
    avoidQuestionTexts: Array.isArray(extra.avoidQuestionTexts) ? extra.avoidQuestionTexts : [],
    qualityTier: qualityTierSettings.tier,
    // Book RAG batches must save after repair — never burn tokens on strict placeholder loops.
    strictValidation:
      shouldRelaxBookBatchSave(
        {
          bookGenerator: isBookBatch,
          batchOrchestrator: isBatchVariant,
        },
        slug,
      )
        ? false
        : qualityTierSettings.strictValidation === true,
    skipSectionPad: !qualityTierSettings.sectionPadEnabled,
    greatQuality: isAiGeneratorGreatQualityEnabled(),
    requireAllCanonicalFields:
      !isBookBatch &&
      !(slug === 'worksheet-mcq-generator' && isBatchVariant) &&
      !(slug === 'smart-qa-practice-generator' && isBatchVariant) &&
      (qualityTierSettings.tier === 'premium' ||
        (!isBatchVariant && !isAiGeneratorCostSaverEnabled())),
  };
  const isPremiumStrict =
    meta.strictValidation === true &&
    !shouldRelaxBatchWorksheetSave(meta, slug) &&
    !shouldRelaxPracticeQaBatchSave(meta, slug);

  let lastError = null;
  let lastValidationMessage = '';

  let activeUserPrompt = baseUserPrompt;
  const baseValidationAttempts = Math.max(
    getAiGeneratorValidationMaxAttempts(isBatchVariant, recoveryPass),
    qualityTierSettings.maxValidationAttempts,
  );
  const isLanguageFlashcardBatch =
    isBatchVariant &&
    languageSubjectEnforced &&
    (slug === 'flashcard-generator' || slug === 'my-study-decks');
  // Language flashcards: keep validation cheap, but allow one extra attempt for invalid JSON
  // (Hindi/Telugu model output often breaks JSON with bare newlines / truncation).
  let maxValidationAttempts = isLanguageFlashcardBatch && !isBookBatch
    ? 2
    : languageSubjectEnforced
      ? Math.max(3, baseValidationAttempts)
      : Math.max(2, baseValidationAttempts);
  // Practice Q&A batches fill A–G programmatically — don't burn Premium retries for 10+ minutes.
  if (slug === 'smart-qa-practice-generator' && isBatchVariant) {
    maxValidationAttempts = Math.min(maxValidationAttempts, 2);
  }

  for (let attempt = 1; attempt <= maxValidationAttempts; attempt += 1) {
    const llmOptions = buildLlmOptions(attempt);
    const attemptStartedAt = Date.now();
    console.log(
      `[AI Generator] ${slug} validation attempt ${attempt}/${maxValidationAttempts} (batch=${isBatchVariant}, tier=${qualityTierSettings.tier})`,
    );
    try {
      const raw = await geminiService.generateStructuredContent(activeUserPrompt, 'json', llmOptions);
      console.log(
        `[AI Generator] ${slug} Gemini returned in ${Date.now() - attemptStartedAt}ms (attempt ${attempt})`,
      );
      let json;
      try {
        json = extractJsonObject(raw);
      } catch (parseError) {
        if (attempt < maxValidationAttempts) {
          console.warn(
            `[AI Generator] Invalid JSON on attempt ${attempt}/${maxValidationAttempts} (${slug}); retrying with strict JSON instruction.`,
          );
          activeUserPrompt = `${baseUserPrompt}

CRITICAL RETRY: Your previous reply was NOT valid JSON and could not be parsed.
Return ONLY one valid JSON object. Rules:
- No markdown fences, no commentary before/after JSON
- Escape every quote and newline inside strings (use \\n, not bare line breaks)
- Do not truncate mid-string or mid-object
- Use double quotes for all keys and string values
- For flashcards use cards[] with "front" and "back" on every card
Write all student-facing text in the required output language.`;
          lastError = parseError;
          continue;
        }
        throw parseError;
      }
      let structuredContent = coerceRegenerationStructuredContent(slug, json);
      const promptLeakDetected = isBatchVariant && structuredContentHasPromptLeak(json);
      if (promptLeakDetected) {
        maxValidationAttempts = Math.min(maxValidationAttempts, 2);
        console.warn(
          `[AI Generator] Prompt leakage detected for ${slug}; capping validation retries at ${maxValidationAttempts}.`,
        );
      }
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
        if (
          flashcardDeckNeedsCardRepair(structuredContent, slug) ||
          flashcardDeckNeedsFrameworkRepair(structuredContent, slug)
        ) {
          structuredContent = await ensureFlashcardDeckQuality(
            structuredContent,
            meta,
            slug,
            historicalBlock,
          );
        }
      } else if (slug === 'flashcard-generator') {
        structuredContent = finalizeFlashcardDeckStructuredContent(structuredContent, meta, 'flashcard-generator');
        if (
          flashcardDeckNeedsCardRepair(structuredContent, slug) ||
          flashcardDeckNeedsFrameworkRepair(structuredContent, slug)
        ) {
          structuredContent = await ensureFlashcardDeckQuality(
            structuredContent,
            meta,
            slug,
            historicalBlock,
          );
        }
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
        structuredContent = finalizeStudyGuideStructuredContent(structuredContent, meta);
      } else if (slug === 'short-notes-summaries-maker') {
        structuredContent = finalizeShortNotesStructuredContent(structuredContent, meta);
      } else if (slug === 'concept-breakdown-explainer') {
        structuredContent = finalizeConceptBreakdownStructuredContent(structuredContent, meta);
      } else if (slug === 'homework-creator') {
        structuredContent = finalizeHomeworkStructuredContent(structuredContent, meta);
      } else if (slug === 'quick-assignment-builder') {
        structuredContent = finalizeQuickAssignmentStructuredContent(structuredContent, meta);
      } else if (slug === '__removed-rubrics-tool__') {
        structuredContent = finalizeRubricStructuredContent(structuredContent, meta);
      } else if (slug === 'story-passage-creator') {
        structuredContent = finalizeStoryPassageStructuredContent(structuredContent, meta);
      } else if (slug === 'reading-practice-room') {
        structuredContent = normalizeReadingPracticeStructuredContent(structuredContent);
        if (languageSubjectEnforced) {
          structuredContent = fillIndicReadingPracticeScaffold(structuredContent, meta);
        }
      } else if (slug === 'worksheet-mcq-generator') {
        structuredContent = finalizeWorksheetStructuredContent(
          structuredContent,
          shouldRelaxBatchWorksheetSave(meta, slug) ? { ...meta, strictValidation: false } : meta,
        );
      }

      if (languageSubjectEnforced) {
        structuredContent = enforceIndicLanguageStructuredContent(slug, structuredContent, meta);
      }

      if (structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)) {
        structuredContent = sanitizeAiStructuredTextDeep(structuredContent);
      }
      if (slug === 'smart-qa-practice-generator') {
        structuredContent = finalizePracticeQaStructuredContent(structuredContent, meta);
        structuredContent = ensurePracticeQaAllSectionsFilled(structuredContent, meta);
      } else if (SCAFFOLD_REPAIRABLE_TOOLS.has(slug)) {
        // PDF-regeneration path: apply the same scaffold detect -> LLM repair as the batch path.
        structuredContent = await ensureQuestionToolScaffoldQuality(slug, structuredContent, meta, '');
      }

      const contentType = normalizeContentType(json.contentType || defaultContentType);
      const validationSourceText =
        slug === 'smart-qa-practice-generator'
          ? collectPracticeQaParseableText(structuredContent)
          : slug === 'worksheet-mcq-generator'
            ? [collectMockTestParseableText(structuredContent), pdfContext].filter(Boolean).join('\n\n')
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

      if (!validation.valid && slug === '__removed-rubrics-tool__') {
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

      if (!validation.valid && slug === 'reading-practice-room') {
        structuredContent = normalizeReadingPracticeStructuredContent(structuredContent);
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
          if (flashcardDeckNeedsCardRepair(structuredContent, slug)) {
            structuredContent = await ensureFlashcardDeckQuality(
              structuredContent,
              meta,
              slug,
              historicalBlock,
            );
          }
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
        structuredContent = enforceIndicLanguageStructuredContent(
          slug,
          finalizeExamPaperStructuredContent(structuredContent, examPaperMeta(meta)),
          examPaperMeta(meta),
        );
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

      if (!validation.valid && slug === 'homework-creator') {
        structuredContent = finalizeHomeworkStructuredContent(structuredContent, meta);
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

      if (!validation.valid && slug === 'worksheet-mcq-generator') {
        structuredContent = finalizeWorksheetStructuredContent(
          structuredContent,
          shouldRelaxBatchWorksheetSave(meta, slug) ? { ...meta, strictValidation: false } : meta,
        );
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

      if (!validation.valid && slug === 'quick-assignment-builder') {
        structuredContent = finalizeQuickAssignmentStructuredContent(structuredContent, meta);
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

      if (!validation.valid && slug === 'concept-breakdown-explainer') {
        structuredContent = finalizeConceptBreakdownStructuredContent(structuredContent, meta);
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

      if (
        validation.valid &&
        (slug === 'exam-question-paper-generator' || slug === 'mock-test-builder')
      ) {
        const examPipeline = validateExamPaperPipeline(
          {
            subject: resolvedSubject || meta.subject,
            subtopic: meta.subTopic || meta.subtopic || meta.topic,
            structured: structuredContent,
          },
          { blockSave: qualityTierSettings.tier !== 'fast' && isPremiumStrict },
        );
        if (!examPipeline.valid && (examPipeline.hardErrors || []).length > 0) {
          validation = {
            valid: false,
            message:
              (examPipeline.hardErrors || examPipeline.errors).join('; ') ||
              'Exam paper failed subject-accuracy and quality pipeline.',
            missingSections: validation.missingSections || [],
          };
        } else if ((examPipeline.warnings || []).length > 0) {
          structuredContent = {
            ...structuredContent,
            _qualityWarnings: examPipeline.warnings,
          };
        }
      }

      if (
        !validation.valid &&
        slug === 'exam-question-paper-generator' &&
        Array.isArray(validation.missingSections) &&
        validation.missingSections.length > 0
      ) {
        const repairedExam = await repairMissingSectionsViaLlm(
          slug,
          structuredContent,
          validation.missingSections,
          meta,
          historicalBlock,
        );
        validation = validateToolSpecificStructuredContent(
          slug,
          repairedExam,
          contentType,
          validationSourceText,
          meta,
        );
        if (validation.normalizedStructuredContent) {
          structuredContent = validation.normalizedStructuredContent;
        } else {
          structuredContent = repairedExam;
        }
      }

      if (!validation.valid) {
        console.warn(
          `[AI Generator] ${slug} validation failed (attempt ${attempt}/${maxValidationAttempts}): ${validation.message || 'unknown'}`,
        );
        if (slug === 'flashcard-generator' || slug === 'my-study-decks') {
          structuredContent = finalizeFlashcardDeckStructuredContent(structuredContent, meta, slug);
          if (flashcardDeckNeedsCardRepair(structuredContent, slug)) {
            structuredContent = await ensureFlashcardDeckQuality(
              structuredContent,
              meta,
              slug,
              historicalBlock,
            );
          }
        }
        if (slug === 'worksheet-mcq-generator' && shouldRelaxBatchWorksheetSave(meta, slug)) {
          structuredContent = finalizeWorksheetStructuredContent(structuredContent, {
            ...meta,
            strictValidation: false,
          });
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
        if (
          isBatchVariant &&
          slug === 'homework-creator' &&
          isAiGeneratorCompleteOnlySaveEnabled()
        ) {
          structuredContent = finalizeHomeworkStructuredContent(structuredContent, meta);
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
        if (
          isBatchVariant &&
          isAiGeneratorSectionPadEnabled() &&
          !isPremiumStrict &&
          !isAiGeneratorCompleteOnlySaveEnabled()
        ) {
          structuredContent = padAiGeneratorCanonicalSections(slug, structuredContent, meta);
          if (slug === 'worksheet-mcq-generator') {
            structuredContent = finalizeWorksheetStructuredContent(structuredContent, meta);
          }
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
        if (
          !validation.valid &&
          shouldRelaxFlashcardBatchSave(meta, slug) &&
          flashcardBatchHasSaveableContent(structuredContent, slug)
        ) {
          console.log(
            `[AI Generator] Saving flashcard batch record for ${slug} (${countValidFlashcardRows(structuredContent?.cards)} valid cards).`,
          );
          validation = {
            valid: true,
            normalizedStructuredContent: structuredContent,
            normalizedType: contentType,
          };
        }
        if (
          !validation.valid &&
          (shouldRelaxBatchWorksheetSave(meta, slug) ||
            (isAiGeneratorCostSaverEnabled() && !isPremiumStrict))
        ) {
          const canBypassBookWorksheet =
            slug === 'worksheet-mcq-generator' &&
            shouldRelaxBatchWorksheetSave(meta, slug) &&
            worksheetHasSaveableContent(structuredContent);
          const blockBypass =
            !canBypassBookWorksheet &&
            shouldBlockCostSaverForStoryLanguage(
              slug,
              meta.subject,
              structuredContent,
              validation.message || '',
            );
          if (!blockBypass) {
            validation = {
              valid: true,
              normalizedStructuredContent: structuredContent,
              normalizedType: contentType,
            };
          }
        }
        lastValidationMessage = validation.message || 'Structured content failed validation.';
        const missingList = Array.isArray(validation.missingSections) ? validation.missingSections : [];
        const allFieldsHint =
          missingList.length > 0
            ? buildCanonicalFieldsRetryHint(slug, missingList)
            : lastValidationMessage;
        if (!validation.valid && attempt < maxValidationAttempts) {
          const languageHint = buildStoryPassageLanguageRetryHint(meta.subject || '');
          const promptEngineRewrite =
            isPromptEngineEnabled()
              ? buildPromptEngineRewritePrompt(slug, {
                  ...meta,
                  attempt: attempt + 1,
                  validationMessage: lastValidationMessage,
                  missingSections: missingList,
                  classLabel: meta.classLabel || meta.gradeLevel,
                  subTopic: meta.subTopic || meta.subtopic,
                })
              : '';
          if (isBatchVariant && isAiGeneratorCostSaverEnabled() && !isPremiumStrict) {
            activeUserPrompt = buildBatchEconomyRetryPrompt({
              slug,
              meta,
              attemptNum: attempt + 1,
              maxAttempts: maxValidationAttempts,
              hint: allFieldsHint,
              languageHint,
            });
            continue;
          }
          if (promptEngineRewrite) {
            activeUserPrompt = `${baseUserPrompt}\n\n${promptEngineRewrite}${languageHint ? `\n\n${languageHint}` : ''}`;
          } else {
          activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): ${allFieldsHint} Return structuredContent with EVERY canonical field filled — no empty strings, no empty arrays.${languageHint ? ` ${languageHint}` : ''}`;
          if (slug === 'mock-test-builder') {
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}. You MUST return structuredContent with mock_test_title and at least 8 questions in section_a..section_e (each with "question" text). Do not return only metadata without question arrays.`;
          } else if (slug === 'smart-qa-practice-generator') {
            const target = Number(meta?.questionCount) > 0 ? Number(meta.questionCount) : 12;
            const missing = getPracticeQaMissingSections(structuredContent);
            const missingHint = missing.length
              ? ` You MUST add questions to: ${missing.join('; ')}.`
              : '';
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return structuredContent with title and sections[] — all seven section names exactly (Section A: MCQs … Section G: HOTS / Analytical Questions), each with at least one question. Section C MUST be type "MATCH" with a match-the-following prompt and options as Column A / Column B pairs (e.g. "1. Observation | A. Step before hypothesis"). Include short answers in Section E and application/case-based in Section F. Do NOT duplicate questions in sections[] and questions[]. Total at least ${target} questions.`;
          } else if (slug === 'worksheet-mcq-generator') {
            const wsTarget = Number(meta?.questionCount) > 0 ? Number(meta.questionCount) : 10;
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}. Return structuredContent with title, learning_objectives[], instructions, sections[] (Section A: MCQs through Section E: Competency / Real-life Application Questions). Include at least ${wsTarget} unique questions total across sections A–E — no duplicate question stems. Put questions ONLY in sections[].questions (not also in top-level questions[] or section_a_mcqs). Each MCQ needs four labeled options A)–D) and an answer.`;
          } else if (slug === 'chapter-summary-creator') {
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}. Return Chapter Summary Creator JSON only — use chapter_summary_title, chapter_overview, important_concepts[] (min 3), formulae[] (min 3: name + formula where formula is an equation OR a must-know rule/fact sentence), quick_revision_notes[] (min 3), practice_recall_questions[] (min 3). Do NOT use Smart Study Guide fields (study_guide_title, prior_knowledge, key_concepts_explained, practice_questions with MCQ options).`;
          } else if (slug === 'key-points-formula-extractor') {
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}. Return Key Points JSON with topic_title, important_concepts[] (min 3), essential_definitions[], formulae[] (min 3 — name + formula; formula may be an equation OR a must-know rule), keywords_terminologies[], must_remember_facts[], real_life_connections[], frequently_asked_exam_points[], mnemonics_memory_tricks[], one_minute_revision_summary. Never leave formulae[] empty.`;
          } else if (slug === '__removed-rubrics-tool__') {
            const missing = getRubricMissingSections(structuredContent);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return ALL 10 rubric sections. criteria[] MUST have at least 3 objects; each MUST include name, excellent, good, satisfactory, needs_improvement (non-empty strings). Include grading_criteria, actionable_suggestions, and next_step_remedial_enrichment.`;
          } else if (slug === 'story-passage-creator') {
            const missing = getStoryPassageMissingSections(structuredContent);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            const languageHint = buildStoryPassageLanguageRetryHint(meta.subject || '');
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return ALL 19 Story and Passage Creator fields with REAL content in the output language — never section headings like "Passage / Story for … in Hindi." passage MUST be a complete story (120+ words). Include at least 2 real questions in read_and_recall_questions, think_and_infer_questions, and apply_and_connect_questions.${languageHint ? ` ${languageHint}` : ''}`;
          } else if (slug === 'reading-practice-room') {
            const missing = getReadingPracticeMissingSections(structuredContent);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            const languageHint = buildStoryPassageLanguageRetryHint(meta.subject || '');
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return ALL 13 Reading Practice Room fields with REAL content in the output language — never section headings like "Passage / Story for … in Hindi." passage MUST be a full reading passage (120+ words). Include at least 2 real questions in read_and_recall_questions, think_and_infer_questions, and apply_and_connect_questions. Title must be a creative passage name, not "Reading Practice".${languageHint ? ` ${languageHint}` : ''}`;
          } else if (slug === 'flashcard-generator' || slug === 'my-study-decks') {
            const missing = getFlashcardDeckMissingSections(structuredContent, slug, meta);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            const targetCards = Number(meta?.cardCount) > 0 ? Number(meta.cardCount) : 10;
            const languageHint = buildStoryPassageLanguageRetryHint(meta.subject || '');
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return structuredContent with cards[] array (min ${targetCards} items). EVERY card MUST use "front" and "back" keys with non-empty strings — not term/definition only. Include difficulty_tag_for_each_card and memory_hook_quick_tip on each card. Write prior_knowledge_required, learning_objectives[], ncf_competency_alignment, and ALL card text in the output language — not English.${languageHint ? ` ${languageHint}` : ''}`;
          } else if (slug === 'daily-class-plan-maker') {
            const missing = getDailyClassPlanMissingSections(structuredContent);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return Daily Class Plan JSON with ALL 9 sections (day_period_topic_breakup, objectives[], teaching_methods[], classroom_activity[], exit_ticket, differentiated_support, homework_followup, teaching_aids[], teacher_reflection_notes). This is NOT a 13-section lesson planner — do not use lesson_name, introduction_warmup, or teaching_strategy as primary fields.`;
          } else if (slug === 'exam-question-paper-generator') {
            const missing = getExamPaperMissingSections(structuredContent, meta);
            const missingHint = missing.length ? ` Missing: ${missing.join('; ')}.` : '';
            const examTarget =
              Number(meta?.questionCount) > 0 ? Number(meta.questionCount) : 12;
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Previous output failed validation: ${lastValidationMessage}.${missingHint} Return Exam Question Paper JSON with ALL 11 sections. Use paper_title, instructions, blueprint, section_a..section_e (each an array of question objects with question, options for MCQs, answer, marks). Include internal_choices, answer_key, marking_scheme, open_ended_rubric. This is NOT Mock Test Builder — do not use mock_test_title, test_purpose_subtopic_link, or ncf_competency_alignment. Minimum ${examTarget} questions across sections.`;
          }
          }
          continue;
        }
        if (!validation.valid) {
          structuredContent = await lastChanceRecoverAiGeneratorOutput(
            slug,
            structuredContent,
            meta,
            historicalBlock,
            contentType,
            validationSourceText,
          );
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
            lastValidationMessage = validation.message || lastValidationMessage;
          }
        }
        if (!validation.valid) {
        throw new Error(lastValidationMessage);
        }
      }

      let sectionRepairCount = 0;
      for (let repairRound = 0; repairRound < 2; repairRound += 1) {
        const quality = runAiGeneratorQualityGate(slug, structuredContent, {
          ...meta,
          bookGroundedFallback: Boolean(structuredContent?.bookGroundedFallback),
          topicGroundedFallback: Boolean(structuredContent?.topicGroundedFallback),
        });
        if (quality.valid) break;

        if (!isAiGeneratorSectionPadEnabled() && quality.missingSections?.length) {
          if (
            (slug === 'flashcard-generator' || slug === 'my-study-decks') &&
            structuredContentHasPromptLeak(structuredContent) &&
            !shouldRelaxFlashcardBatchSave(meta, slug)
          ) {
            throw new Error(
              'Flashcard output contained prompt junk and could not be repaired. Regenerate with a shorter subtopic.',
            );
          }
          console.log(
            `[AI Generator] ${slug} LLM section repair for: ${quality.missingSections.slice(0, 4).join('; ')}`,
          );
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
          if (
            isAiGeneratorSectionPadEnabled() ||
            shouldRelaxBatchWorksheetSave(meta, slug) ||
            shouldRelaxPracticeQaBatchSave(meta, slug) ||
            shouldRelaxBookBatchSave(meta, slug) ||
            (shouldRelaxFlashcardBatchSave(meta, slug) &&
              flashcardBatchHasSaveableContent(structuredContent, slug))
          ) {
            if (
              slug === 'worksheet-mcq-generator' &&
              shouldRelaxBatchWorksheetSave(meta, slug) &&
              !worksheetHasSaveableContent(structuredContent)
            ) {
              structuredContent = finalizeWorksheetStructuredContent(structuredContent, {
                ...meta,
                strictValidation: false,
              });
              continue;
            }
            if (slug === 'smart-qa-practice-generator' && shouldRelaxPracticeQaBatchSave(meta, slug)) {
              structuredContent = ensurePracticeQaAllSectionsFilled(
                finalizePracticeQaStructuredContent(structuredContent, {
                  ...meta,
                  strictValidation: false,
                }),
                { ...meta, strictValidation: false },
              );
              break;
            }
            if (
              (slug === 'project-idea-lab' || slug === 'activity-project-generator') &&
              shouldRelaxBookBatchSave(meta, slug) &&
              !activityHasSaveableContent(structuredContent)
            ) {
              structuredContent = finalizeActivityStructuredContent(structuredContent, {
                ...meta,
                strictValidation: false,
              }, slug);
              continue;
            }
            break;
          }
          throw new Error(lastValidationMessage);
        }
      }

      if (isAiGeneratorSectionPadEnabled() && !meta.strictValidation) {
        if (slug === 'flashcard-generator' || slug === 'my-study-decks') {
          structuredContent = finalizeFlashcardDeckStructuredContent(structuredContent, meta, slug);
        }
        structuredContent = padAiGeneratorCanonicalSections(slug, structuredContent, meta);
        if (slug === 'worksheet-mcq-generator') {
          structuredContent = finalizeWorksheetStructuredContent(structuredContent, meta);
        } else if (slug === 'exam-question-paper-generator') {
          structuredContent = finalizeExamPaperStructuredContent(structuredContent, meta);
        }
      } else if (slug === 'worksheet-mcq-generator') {
        structuredContent = finalizeWorksheetStructuredContent(structuredContent, meta);
      }

      structuredContent = dedupeIntraRecordQuestions(slug, structuredContent);
      structuredContent = renumberIntraRecordQuestions(slug, structuredContent);

      const postContentValidation = runPostGenerationContentValidation(slug, structuredContent, {
        checkHots: qualityTierSettings.hotsHedgingRegen,
      });
      if (!postContentValidation.valid) {
        lastValidationMessage = postContentValidation.errors.join('; ');
        if (
          shouldRelaxBatchWorksheetSave(meta, slug) &&
          slug === 'worksheet-mcq-generator' &&
          worksheetHasSaveableContent(structuredContent)
        ) {
          /* book-grounded worksheet — save despite minor post-check noise */
        } else if (attempt < maxValidationAttempts) {
          activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): ${lastValidationMessage}`;
          continue;
        } else {
          throw new Error(lastValidationMessage);
        }
      }

      if (languageSubjectEnforced) {
        structuredContent = enforceIndicLanguageStructuredContent(slug, structuredContent, meta);
      }

      if (structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)) {
        structuredContent = sanitizeAiStructuredTextDeep(structuredContent);
      }
      if (slug === 'smart-qa-practice-generator') {
        structuredContent = await ensurePracticeQaQuality(structuredContent, meta, historicalBlock);
        structuredContent = ensurePracticeQaAllSectionsFilled(
          finalizePracticeQaStructuredContent(structuredContent, meta),
          meta,
        );
      } else if (SCAFFOLD_REPAIRABLE_TOOLS.has(slug)) {
        structuredContent = await ensureQuestionToolScaffoldQuality(
          slug,
          structuredContent,
          meta,
          historicalBlock,
        );
      }

      const finalQuality = runAiGeneratorQualityGate(slug, structuredContent, {
        ...meta,
        bookGroundedFallback: Boolean(structuredContent?.bookGroundedFallback),
      });
      if (!finalQuality.valid) {
        const finalQualityMessage = finalQuality.errors.join('; ');
        // Scaffold density: retry on single-record Premium; batch/book orchestrators save with a warning.
        const scaffoldStats = computeScaffoldDensity(slug, structuredContent);
        const allowScaffoldBatchSave = Boolean(meta.bookGenerator || meta.batchOrchestrator);
        if (
          !allowScaffoldBatchSave &&
          scaffoldStats.total >= 3 &&
          scaffoldStats.density > SCAFFOLD_DENSITY_CEILING
        ) {
          const pct = Math.round(scaffoldStats.density * 100);
          if (attempt < maxValidationAttempts) {
            lastValidationMessage = `Scaffold-heavy output (${pct}% filler questions)`;
            activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): ${pct}% of questions were generic scaffold/filler. Return real, chapter-specific questions AND answers in every section — no template placeholders, no "expected term or phrase" style answers.`;
            continue;
          }
          throw new Error(
            `Rejected: ${pct}% of questions are scaffold/filler (ceiling ${Math.round(SCAFFOLD_DENSITY_CEILING * 100)}%). Not saving placeholder content.`,
          );
        }
        if (
          allowScaffoldBatchSave &&
          scaffoldStats.total >= 3 &&
          scaffoldStats.density > SCAFFOLD_DENSITY_CEILING
        ) {
          console.warn(
            `[AI Generator] ${slug} saving scaffold-heavy batch content (${Math.round(scaffoldStats.density * 100)}% filler questions).`,
          );
        }
        if (attempt < maxValidationAttempts && !shouldRelaxPracticeQaBatchSave(meta, slug)) {
          lastValidationMessage = finalQualityMessage;
          activeUserPrompt = `${baseUserPrompt}\n\nRETRY (attempt ${attempt + 1}): Quality gate failed: ${finalQualityMessage}. Return complete, non-placeholder content in every field.`;
          continue;
        }
        const blockStoryLanguageSave = shouldBlockCostSaverForStoryLanguage(
          slug,
          meta.subject,
          structuredContent,
          finalQualityMessage,
        );
        const canSaveBatchWorksheet =
          shouldRelaxBatchWorksheetSave(meta, slug) &&
          slug === 'worksheet-mcq-generator' &&
          worksheetHasSaveableContent(structuredContent);
        const canSavePracticeQaBatch =
          shouldRelaxPracticeQaBatchSave(meta, slug) &&
          practiceQaHasAllRequiredSections(structuredContent);
        const canSaveBookActivity =
          shouldRelaxBookBatchSave(meta, slug) &&
          (slug === 'project-idea-lab' || slug === 'activity-project-generator') &&
          activityHasSaveableContent(structuredContent);
        const canSaveBookBatch =
          shouldRelaxBookBatchSave(meta, slug) &&
          meta.bookGenerator === true &&
          (canSaveBatchWorksheet ||
            canSaveBookActivity ||
            Boolean(structuredContent?.bookGroundedFallback) ||
            Boolean(structuredContent?.title || structuredContent?.paper_title || structuredContent?.lesson_name));
        const canSaveFlashcardBatch =
          shouldRelaxFlashcardBatchSave(meta, slug) &&
          (slug === 'flashcard-generator' || slug === 'my-study-decks') &&
          flashcardBatchHasSaveableContent(structuredContent, slug);
        if (
          isBatchVariant &&
          !blockStoryLanguageSave &&
          (canSaveFlashcardBatch ||
            canSavePracticeQaBatch ||
            (!isAiGeneratorCompleteOnlySaveEnabled() &&
              (canSaveBatchWorksheet ||
                canSaveBookActivity ||
                canSaveBookBatch ||
                (!isPremiumStrict &&
                  !meta.skipSectionPad &&
                  (isAiGeneratorCostSaverEnabled() || isAiGeneratorSectionPadEnabled())))))
        ) {
          /* batch economy / book-grounded fallback — save usable output without another LLM call */
        } else if (meta.qualityTier === 'fast' && hasSubstantiveGenerationOutput(slug, structuredContent)) {
          /* fast-tier smoke: allow padded/repaired output when core body exists */
        } else if (canSavePracticeQaBatch) {
          /* Premium Practice Q&A batch: A–G filled programmatically — save */
        } else {
          lastValidationMessage = finalQualityMessage;
          throw new Error(lastValidationMessage);
        }
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
      if (isTransientGeminiError(error)) {
        throw error;
      }
      const msg = String(error?.message || error || '');
      if (/invalid JSON/i.test(msg) && attempt < maxValidationAttempts) {
        activeUserPrompt = `${baseUserPrompt}

CRITICAL RETRY: Previous output was invalid JSON. Return ONLY one valid JSON object with escaped strings and no markdown.`;
        continue;
      }
    }
  }

  const requireAllFieldsEnv =
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== 'false' &&
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== '0' &&
    String(process.env.AI_GENERATOR_REQUIRE_ALL_FIELDS ?? 'true').trim().toLowerCase() !== 'off';
  const upgradeOnFail =
    !isAiGeneratorFlashLiteOnlyEnabled() &&
    requireAllFieldsEnv &&
    !isAiGeneratorSectionPadEnabled() &&
    !isAiGeneratorCostSaverEnabled() &&
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

