import { PDFParse } from 'pdf-parse';
import geminiService from './gemini-service.js';
import {
  AI_TOOL_ORDERED_SLUGS,
  buildToolAliasToSlugMap,
  buildStrictOutputHintsMap,
  getToolDisplayTitle,
  getContentTypeDefault,
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

const extractQuestionsFromText = (value) => {
  const text = String(value || '').trim();
  if (!text) return [];

  const blocks = text
    .split(/(?=(?:^|\n|\s)(?:q(?:uestion)?\s*)?\d+[\).:-]\s*)/gi)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => /^(?:q(?:uestion)?\s*)?\d+[\).:-]\s*/i.test(chunk));

  return blocks
    .map((chunk) => {
      const normalized = chunk.replace(/\s+/g, ' ').trim();
      const body = normalized.replace(/^(?:q(?:uestion)?\s*)?\d+[\).:-]\s*/i, '').trim();
      const optionMatches = Array.from(
        body.matchAll(/([A-D])\)\s*([^]+?)(?=(?:\s+[A-D]\)\s*)|(?:\s+(?:answer|correct\s*answer)\s*[:\-])|$)/gi),
      );
      const answerMatch = body.match(/(?:answer|correct\s*answer)\s*[:\-]\s*([^]+)$/i);
      const questionText = optionMatches.length > 0 ? body.slice(0, optionMatches[0].index).trim() : body;
      const options = optionMatches.map((m) => `${m[1].toUpperCase()}) ${String(m[2] || '').trim()}`).filter(Boolean);
      const answer = answerMatch ? String(answerMatch[1] || '').trim() : '';
      return {
        question: questionText.replace(/\s*(?:answer|correct\s*answer)\s*[:\-]\s*[^]+$/i, '').trim(),
        options,
        answer,
      };
    })
    .filter((row) => row.question)
    .filter((row) => !isHeadingLikeLine(row.question))
    .filter((row) => looksLikeQuestionPrompt(row.question) || row.options.length >= 2);
};

export function buildDeterministicQuestionSetFromText(pdfText, maxQuestions = 15) {
  const base = sanitizeWorksheetQuestions(extractQuestionsFromText(pdfText));
  return {
    type: 'Worksheet',
    questions: base.slice(0, maxQuestions),
  };
}

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
  let assessmentRubric = coerceBulletLines(source.assessment_criteria_rubric);
  if (!assessmentRubric.length) assessmentRubric = coerceBulletLines(source.assessmentRubric);
  if (!assessmentRubric.length) assessmentRubric = coerceBulletLines(source.assessment);
  if (!assessmentRubric.length) assessmentRubric = coerceBulletLines(source.evaluation);

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

  return {
    ...source,
    title,
    materials,
    steps,
    learningObjectives,
    teacherInstructions,
    studentInstructions,
    learningOutcome: learningOutcome || source.learningOutcome || source.learning_outcome || '',
    assessmentRubric,
    realLifeApplication,
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

  const assessment = String(
    source.assessment ||
      source.evaluation ||
      source.assessment_strategy ||
      source.assessment_strategies ||
      source.formative_assessment ||
      source.summative_assessment ||
      source.assessment_criteria ||
      source.evaluation_criteria ||
      '',
  ).trim();

  const lessonTitle = String(source.lesson_name || source.title || source.name || '').trim();

  return {
    ...source,
    lesson_name: lessonTitle || source.lesson_name,
    title: String(source.title || lessonTitle || '').trim() || source.title,
    objectives,
    activities: activitiesOut,
    timeline,
    assessment,
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
  if (toolSlug === 'lesson-planner' || toolSlug === 'daily-class-plan-maker') {
    return { normalizedStructuredContent: normalizeLessonPlannerStructuredContent(source, toolSlug) };
  }
  if (toolSlug === 'worksheet-mcq-generator' || toolSlug === 'homework-creator') {
    const candidateGroups = [
      source.questions,
      source.mcqs,
      source.multipleChoiceQuestions,
      source.shortQuestions,
      source.longQuestions,
      source.fillInTheBlanks,
      source.exerciseQuestions,
      source.exercises,
      source.practiceProblems,
      source.qaPairs,
      source.items,
    ];
    const mergedQuestions = candidateGroups.flatMap((group) => toQuestionArray(group));
    const textBasedQuestions = [
      source.content,
      source.text,
      source.body,
      source.summary,
      source.rawText,
      source.instructions,
      sourceText,
    ].flatMap((candidate) => extractQuestionsFromText(candidate));
    const finalQuestions = sanitizeWorksheetQuestions(
      mergedQuestions.length > 0 ? mergedQuestions : textBasedQuestions,
    );
    if (finalQuestions.length > 0) {
      return {
        normalizedStructuredContent: {
          ...source,
          type: String(source.type || contentType || '').trim() || 'Worksheet',
          questions: finalQuestions,
        },
      };
    }
  }
  return { normalizedStructuredContent: source };
};

const TOOL_STRUCTURED_RULES = {
  'worksheet-mcq-generator': {
    allowedTypes: ['MCQ', 'Worksheet'],
    validate: (data) => Array.isArray(data?.questions) && data.questions.length > 0,
    message: 'Worksheet & MCQ content must include a non-empty questions array.',
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
    validate: (data) => Array.isArray(data?.concepts) && data.concepts.length > 0,
    message: 'Concept content must include a non-empty concepts array.',
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
    validate: (data) => Array.isArray(data?.questions) && data.questions.length > 0,
    message: 'Homework content must include a non-empty questions array.',
  },
  'rubrics-evaluation-generator': {
    allowedTypes: ['Rubric'],
    validate: (data) => Array.isArray(data?.criteria) && data.criteria.length > 0,
    message: 'Rubric content must include a non-empty criteria array.',
  },
  'story-passage-creator': {
    allowedTypes: ['Story'],
    validate: (data) => typeof data?.content === 'string' && data.content.trim().length > 0,
    message: 'Story content must include non-empty content text.',
  },
  'short-notes-summaries-maker': {
    allowedTypes: ['Notes', 'Summary'],
    validate: (data) =>
      (Array.isArray(data?.keyPoints) && data.keyPoints.length > 0) ||
      (Array.isArray(data?.headings) && data.headings.length > 0),
    message: 'Summary content must include keyPoints or headings.',
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
    validate: (data) => Array.isArray(data?.timeline) && data.timeline.length > 0,
    message: 'Daily plan content must include a non-empty timeline.',
  },
  'exam-question-paper-generator': {
    allowedTypes: ['Exam Paper'],
    validate: (data) => Array.isArray(data?.sections) && data.sections.length > 0,
    message: 'Exam paper content must include a non-empty sections array.',
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
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini returned invalid JSON payload');
  }
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
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

  if (toolSlug === 'lesson-planner' || toolSlug === 'daily-class-plan-maker') {
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
5. bestMatchingTool from this exact list:
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

export function buildRenderableContent(toolSlug, contentType, structuredContent) {
  const type = normalizeContentType(contentType) || normalizeContentType(CONTENT_TYPE_BY_TOOL_SLUG[String(toolSlug || '').trim()]);
  const source = structuredContent && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
    ? structuredContent
    : {};

  if (toolSlug === 'worksheet-mcq-generator' || toolSlug === 'homework-creator') {
    const cleanedQuestions = sanitizeWorksheetQuestions(toQuestionArray(source.questions || source.mcqs || source.items || []));
    return {
      kind: 'questionSet',
      title: type || 'Worksheet',
      questions: cleanedQuestions,
    };
  }
  if (toolSlug === 'concept-mastery-helper' || toolSlug === 'short-notes-summaries-maker') {
    return {
      kind: 'notes',
      title: type || 'Notes',
      sections: (Array.isArray(source.concepts) ? source.concepts : source.headings || []).map((entry) => ({
        heading: String(entry?.title || entry?.heading || entry || '').trim(),
        explanation: String(entry?.explanation || entry?.description || '').trim(),
      })),
      keyPoints: toStringList(source.keyPoints),
    };
  }
  if (toolSlug === 'story-passage-creator') {
    return {
      kind: 'story',
      title: String(source.title || 'Story').trim(),
      passage: String(source.content || source.passage || '').trim(),
      questions: toQuestionArray(source.questions || []),
    };
  }
  if (toolSlug === 'lesson-planner' || toolSlug === 'daily-class-plan-maker') {
    const lp = normalizeLessonPlannerStructuredContent(source, toolSlug);
    return {
      kind: 'lessonPlan',
      title: String(lp.lesson_name || lp.title || type || 'Lesson Plan').trim(),
      objectives: toStringList(lp.objectives),
      activities: toStringList(lp.activities),
      timeline: toStringList(lp.timeline),
      assessment: String(lp.assessment || '').trim(),
    };
  }
  if (toolSlug === 'flashcard-generator') {
    return {
      kind: 'flashcards',
      title: type || 'Flashcards',
      cards: (Array.isArray(source.cards) ? source.cards : [])
        .map((card) => ({
          front: String(card?.front || '').trim(),
          back: String(card?.back || '').trim(),
        }))
        .filter((card) => card.front && card.back),
    };
  }
  if (toolSlug === 'rubrics-evaluation-generator') {
    return {
      kind: 'rubric',
      title: type || 'Rubric',
      criteria: toStringList(source.criteria),
      gradingScale: toStringList(source.gradingScale),
    };
  }
  if (toolSlug === 'exam-question-paper-generator') {
    return {
      kind: 'examPaper',
      title: type || 'Exam Paper',
      sections: (Array.isArray(source.sections) ? source.sections : []).map((section) => ({
        sectionName: String(section?.sectionName || section?.title || 'Section').trim(),
        questions: toQuestionArray(section?.questions || []),
      })),
    };
  }
  if (toolSlug === 'activity-project-generator') {
    const act = normalizeActivityStructuredContent(source);
    return {
      kind: 'activity',
      title: String(act.title || type || 'Activity').trim(),
      learningObjectives: toStringList(act.learningObjectives || act.learning_objectives),
      materials: toStringList(act.materials),
      steps: toStringList(act.steps),
      teacherInstructions: toStringList(act.teacherInstructions || act.teacher_instructions),
      studentInstructions: toStringList(act.studentInstructions || act.student_instructions),
      learningOutcome: String(act.learningOutcome || '').trim(),
      assessmentRubric: toStringList(act.assessmentRubric || act.assessment_criteria_rubric),
      realLifeApplication: String(act.realLifeApplication || act.real_life_application || '').trim(),
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
    { "front": "Term or question", "back": "Definition or answer" }
  ]
}
Minimum 5 flashcards.

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
      if (toolSlug === 'lesson-planner' || toolSlug === 'daily-class-plan-maker') {
        structuredContent = normalizeLessonPlannerStructuredContent(structuredContent, toolSlug);
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
  const key = normalizeToolKey(label);
  return TOOL_ALIAS_TO_SLUG[key] || '';
}

export function getToolLabelFromSlug(slug) {
  return getToolDisplayTitle(slug);
}

