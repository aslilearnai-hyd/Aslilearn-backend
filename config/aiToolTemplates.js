/**
 * Single source of truth for all 17 AI curriculum tools (NEP / NCF / Bloom / CBE / UDL).
 * Consumed by: Gemini PDF extract, validation, regeneration, formatItemToContent, parsers, UI contracts.
 *
 * @module config/aiToolTemplates
 */

/** Pedagogy tags applied across tools (subset per tool in `pedagogyFrameworkTags`). */
export const UNIVERSAL_PEDAGOGY_TAGS = Object.freeze([
  'NEP 2020',
  'NCF-SE 2023',
  "Bloom's Taxonomy",
  'Competency-Based Learning',
  'Formative Assessment',
  'UDL + Differentiation',
  'Real-life Application',
  'Reflection / Exit Ticket',
]);

/** Narrative order every tool output should conceptually follow. */
export const UNIVERSAL_SECTION_ORDER = Object.freeze([
  'input',
  'alignment',
  'output',
  'assessment',
  'differentiation',
  'realLife',
  'reflection',
]);

export const AI_TOOL_ORDERED_SLUGS = Object.freeze([
  'activity-project-generator',
  'worksheet-mcq-generator',
  'concept-mastery-helper',
  'lesson-planner',
  'homework-creator',
  'rubrics-evaluation-generator',
  'story-passage-creator',
  'short-notes-summaries-maker',
  'flashcard-generator',
  'daily-class-plan-maker',
  'exam-question-paper-generator',
  'smart-study-guide-generator',
  'concept-breakdown-explainer',
  'smart-qa-practice-generator',
  'chapter-summary-creator',
  'key-points-formula-extractor',
  'quick-assignment-builder',
]);

/** Normalize tool label/slug for comparison (lowercase alphanumeric only). */
export function normalizeAiToolIdentifierKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Retired formats — not part of the 11-tool curriculum system. */
export const DEPRECATED_AI_TOOL_LABELS = Object.freeze([
  'Enrichment / HOTS Task Generator',
  'Remedial Support Plan Generator',
]);

const _deprecatedToolKeys = new Set(
  DEPRECATED_AI_TOOL_LABELS.map((label) => normalizeAiToolIdentifierKey(label)),
);

/** @param {unknown} value Tool slug, display label, or legacy contentType string */
export function isDeprecatedAiToolIdentifier(value) {
  const key = normalizeAiToolIdentifierKey(value);
  if (!key) return false;
  if (_deprecatedToolKeys.has(key)) return true;
  if (key.includes('enrichment') && (key.includes('hots') || key.includes('hotstask'))) return true;
  if (key.includes('remedial') && key.includes('support')) return true;
  return false;
}

const _slugSet = new Set(AI_TOOL_ORDERED_SLUGS);

/** @param {string} slug */
export function isValidAiToolSlug(slug) {
  return _slugSet.has(String(slug || '').trim());
}

/**
 * Compulsory curriculum context (enforced at API / UI layer; listed here for prompts & validation copy).
 * `subTopic` is mandatory per product policy.
 */
export const COMPULSORY_CONTEXT_FIELDS = Object.freeze([
  { key: 'classLabel', label: 'Class', required: true },
  { key: 'subject', label: 'Subject', required: true },
  { key: 'topic', label: 'Topic', required: true },
  { key: 'subTopic', label: 'Subtopic', required: true },
  { key: 'bloomLevel', label: "Bloom's / cognitive level target", required: true },
]);

/** @type {Record<string, object>} */
const TEMPLATES = {
  'activity-project-generator': {
    slug: 'activity-project-generator',
    title: 'Activity & Project Generator',
    contentTypeDefault: 'Activity Plan',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Title of Activity / Project', universalBlock: 'output', storageKeys: ['title', 'name'], strictLineRegexes: [/^1\.\s*Title\b/i], fuzzyContains: ['title of activity', 'activity title'] },
      { order: 2, id: 'subtopic_prior', label: 'Subtopic Link and Prior Knowledge Required', universalBlock: 'input', storageKeys: ['subtopic_link_prior_knowledge', 'prior_knowledge', 'subtopic_context'], strictLineRegexes: [/subtopic|prior knowledge/i], fuzzyContains: ['prior knowledge', 'subtopic'] },
      { order: 3, id: 'learning_objectives', label: 'Learning Objectives', universalBlock: 'alignment', storageKeys: ['learning_objectives', 'learningObjectives'], strictLineRegexes: [/^2\.\s*Learning Objectives?\b/i], fuzzyContains: ['learning objective'] },
      { order: 4, id: 'ncf_alignment', label: 'NCF Competency / Learning Outcome Alignment', universalBlock: 'alignment', storageKeys: ['ncf_competency_alignment', 'competencies', 'learning_outcomes'], strictLineRegexes: [/ncf|competenc/i], fuzzyContains: ['ncf', 'competency', 'learning outcome'] },
      { order: 5, id: 'materials', label: 'Materials Required', universalBlock: 'output', storageKeys: ['materials_required', 'materials'], strictLineRegexes: [/^3\.\s*Materials Required\b/i], fuzzyContains: ['materials required'] },
      { order: 6, id: 'procedure', label: 'Step-by-step Procedure', universalBlock: 'output', storageKeys: ['step_by_step_procedure', 'steps'], strictLineRegexes: [/^4\.\s*(?:Step-by-step|Teaching)/i], fuzzyContains: ['step-by-step', 'procedure'] },
      { order: 7, id: 'teacher_instructions', label: 'Teacher Instructions', universalBlock: 'output', storageKeys: ['teacher_instructions', 'teacherInstructions'], strictLineRegexes: [/^5\.\s*Teacher Instructions\b/i], fuzzyContains: ['teacher instructions'] },
      { order: 8, id: 'student_instructions', label: 'Student Instructions', universalBlock: 'output', storageKeys: ['student_instructions', 'studentInstructions'], strictLineRegexes: [/^6\.\s*Student Instructions\b/i], fuzzyContains: ['student instructions'] },
      { order: 9, id: 'differentiation', label: 'Differentiation', universalBlock: 'differentiation', storageKeys: ['differentiation', 'differentiation_plan', 'udl_support'], strictLineRegexes: [/differentiation|udl/i], fuzzyContains: ['differentiation', 'udl'] },
      { order: 10, id: 'assessment_rubric', label: 'Assessment Rubric', universalBlock: 'assessment', storageKeys: ['assessment_criteria_rubric', 'assessmentRubric'], strictLineRegexes: [/^8\.\s*Assessment|Rubric/i], fuzzyContains: ['assessment rubric', 'rubric'] },
      { order: 11, id: 'expected_outcomes', label: 'Expected Learning Outcomes', universalBlock: 'assessment', storageKeys: ['expected_learning_outcomes', 'expectedLearningOutcomes'], strictLineRegexes: [/^7\.\s*Expected Learning Outcomes\b/i], fuzzyContains: ['expected learning'] },
      { order: 12, id: 'real_life', label: 'Real-life Application', universalBlock: 'realLife', storageKeys: ['real_life_application', 'realLifeApplication'], strictLineRegexes: [/^9\.\s*Real[-\s]?life Application\b/i], fuzzyContains: ['real-life', 'real life'] },
      { order: 13, id: 'reflection', label: 'Reflection / Exit Ticket', universalBlock: 'reflection', storageKeys: ['reflection_exit_ticket', 'exit_ticket', 'reflection'], strictLineRegexes: [/reflection|exit ticket/i], fuzzyContains: ['reflection', 'exit ticket'] },
    ],
    requiredFieldsForPdfExtract: [
      'title',
      'learning_objectives',
      'materials_required',
      'step_by_step_procedure',
      'teacher_instructions',
      'student_instructions',
      'expected_learning_outcomes',
      'assessment_criteria_rubric',
      'real_life_application',
    ],
    pdfValidationRules: [
      { id: 'has-title', severity: 'error', description: 'Each item must have a non-empty title not equal to a section heading.' },
      { id: 'measurable-objectives', severity: 'warn', description: 'Learning objectives should be measurable (action verbs).' },
      { id: 'assessment-present', severity: 'warn', description: 'Assessment rubric or criteria should be present for formative use.' },
    ],
    parserHints: [
      'Split workbook PDFs on lines matching /^Activity\\s+\\d+/i or /^Variation\\s+\\d+/i before numbered sections.',
      'Keep (4) student procedure separate from (5) teacher instructions — never merge into one array.',
      'Strip page footers like "-- N of M --".',
    ],
    regenerationRules: {
      preservePdfSourcedArrays: true,
      mergePolicy: 'merge',
      allowTemplateRegeneration: true,
    },
    gemini: {
      strictOutputHint:
        'Each object MUST follow the canonical Activity template: (1) title, (2) subtopic_link_prior_knowledge, (3) learning_objectives[], (4) ncf_competency_alignment (string or string[]), (5) materials_required[], (6) step_by_step_procedure[], (7) teacher_instructions[], (8) student_instructions[], (9) differentiation (string or string[]), (10) assessment_criteria_rubric[], (11) expected_learning_outcomes, (12) real_life_application, (13) reflection_exit_ticket. Use Bloom-aligned measurable verbs in objectives. Subtopic linkage is mandatory when context provides subTopic.',
      pdfExtractSchema: {
        sl_no: 'number',
        title: 'string — (1) Title of Activity / Project only',
        subtopic_link_prior_knowledge: 'string — (2) Subtopic link + prior knowledge',
        learning_objectives: ['string — (3) measurable objectives'],
        ncf_competency_alignment: 'string | string[] — (4) NCF competency / LO alignment',
        materials_required: ['string — (5)'],
        step_by_step_procedure: ['string — (6) student-facing steps'],
        teacher_instructions: ['string — (7)'],
        student_instructions: ['string — (8)'],
        differentiation: 'string | string[] — (9) UDL / differentiation',
        assessment_criteria_rubric: ['string — (10) rubric lines'],
        expected_learning_outcomes: 'string — (11)',
        real_life_application: 'string — (12)',
        reflection_exit_ticket: 'string — (13)',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['step_by_step_procedure'], use: ['student_instructions', 'description'], note: 'Use student instructions only as student procedure, not teacher voice.' },
      { ifEmpty: ['learning_objectives'], use: ['expected_learning_outcomes'], synthesize: 'split_into_bullets' },
    ],
  },

  'worksheet-mcq-generator': {
    slug: 'worksheet-mcq-generator',
    title: 'Worksheet & MCQ Generator',
    contentTypeDefault: 'Worksheet',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'worksheet_title', label: 'Worksheet Title', universalBlock: 'input', storageKeys: ['title', 'worksheet_title'] },
      { order: 2, id: 'learning_objectives', label: 'Learning Objectives', universalBlock: 'alignment', storageKeys: ['learning_objectives', 'objectives'] },
      { order: 3, id: 'instructions', label: 'Instructions to Students', universalBlock: 'output', storageKeys: ['instructions', 'student_instructions'] },
      { order: 4, id: 'section_a', label: 'Section A: MCQs', universalBlock: 'output', storageKeys: ['section_a_mcqs', 'questions'] },
      { order: 5, id: 'section_b', label: 'Section B: Fill in the Blanks', universalBlock: 'output', storageKeys: ['section_b_fib', 'fill_in_blanks'] },
      { order: 6, id: 'section_c', label: 'Section C: Very Short Answer Questions', universalBlock: 'output', storageKeys: ['section_c_vsa'] },
      { order: 7, id: 'section_d', label: 'Section D: Short Answer Questions', universalBlock: 'output', storageKeys: ['section_d_sa'] },
      { order: 8, id: 'section_e', label: 'Section E: Competency / Real-life Application Questions', universalBlock: 'realLife', storageKeys: ['section_e_competency', 'section_f_competency'] },
      { order: 9, id: 'answer_key', label: 'Answer Key', universalBlock: 'assessment', storageKeys: ['answer_key', 'answers'] },
      { order: 10, id: 'bloom_tag', label: "Bloom's Level and Difficulty Tag", universalBlock: 'assessment', storageKeys: ['bloom_level', 'difficulty_tag'] },
    ],
    requiredFieldsForPdfExtract: ['question'],
    pdfValidationRules: [
      { id: 'questions-nonempty', severity: 'error', description: 'questions[] must be non-empty after sanitize.' },
      { id: 'answer-key-alignment', severity: 'warn', description: 'MCQs with options should have a declared answer.' },
    ],
    parserHints: ['Detect Q1., Q2., or 1), 2) patterns; preserve section labels A/B/C when present.'],
    regenerationRules: { mergePolicy: 'replace', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Prefer ONE JSON object per full worksheet: title, learning_objectives[], instructions, sections[{sectionName,questions[]}], answer_key, bloom_level, difficulty_tag. Flat rows: question_number, type, section, question, options[], answer, marks.',
      pdfExtractSchema: {
        title: 'string',
        worksheet_title: 'string',
        learning_objectives: ['string'],
        instructions: 'string',
        sections: [
          {
            sectionName: 'string',
            questions: [
              {
                question_number: 'number',
                type: 'string',
                question: 'string',
                options: ['string'],
                answer: 'string',
                explanation: 'string',
                marks: 'number',
              },
            ],
          },
        ],
        answer_key: 'string',
        bloom_level: 'string',
        difficulty_tag: 'string',
        question_number: 'number',
        type: 'string',
        section: 'string',
        question: 'string',
        options: ['string'],
        answer: 'string',
        marks: 'number',
      },
    },
    sectionFallbackRules: [{ ifEmpty: ['questions'], use: ['raw_items', 'items'], synthesize: 'extract_from_plain_text' }],
  },

  'concept-mastery-helper': {
    slug: 'concept-mastery-helper',
    title: 'Concept Mastery Helper',
    contentTypeDefault: 'Concept Notes',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'simple_definition', label: 'Simple Definition', universalBlock: 'output', storageKeys: ['simple_definition', 'definition'] },
      { order: 2, id: 'importance', label: 'Why This Concept Is Important', universalBlock: 'alignment', storageKeys: ['why_important', 'importance'] },
      { order: 3, id: 'prior_knowledge', label: 'Prior Knowledge Needed', universalBlock: 'input', storageKeys: ['prior_knowledge_needed', 'prior_knowledge'] },
      { order: 4, id: 'explanation', label: 'Step-by-step Explanation', universalBlock: 'output', storageKeys: ['lesson', 'explanation', 'step_by_step_explanation'] },
      { order: 5, id: 'visual', label: 'Diagram / Visualisation Suggestion', universalBlock: 'output', storageKeys: ['diagram_suggestion', 'visualisation'] },
      { order: 6, id: 'examples', label: 'Real-life Examples', universalBlock: 'realLife', storageKeys: ['real_example', 'real_life_examples'] },
      { order: 7, id: 'misconceptions', label: 'Common Misconceptions and Corrections', universalBlock: 'differentiation', storageKeys: ['common_mistakes', 'misconceptions'] },
      { order: 8, id: 'concept_check', label: 'Concept Check Questions', universalBlock: 'assessment', storageKeys: ['concept_check_questions'] },
      { order: 9, id: 'key_points', label: 'Key Points to Remember', universalBlock: 'output', storageKeys: ['key_points', 'keyPoints'] },
      { order: 10, id: 'exam_tips', label: 'Exam Tips', universalBlock: 'assessment', storageKeys: ['exam_tips'] },
      { order: 11, id: 'hots', label: 'Higher-order Thinking Question', universalBlock: 'assessment', storageKeys: ['hots_question'] },
      { order: 12, id: 'reflection', label: 'Quick Self-reflection Prompt', universalBlock: 'reflection', storageKeys: ['self_reflection_prompt', 'reflection'] },
    ],
    requiredFieldsForPdfExtract: ['concept_name', 'lesson'],
    pdfValidationRules: [{ id: 'has-concept', severity: 'error', description: 'concept_name and explanatory body required.' }],
    parserHints: ['Map headings to concepts[] entries: { title|concept_name, explanation|lesson, key_points[], common_mistakes[] }.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Return concept objects with all 12 canonical sections mapped; use concept_name + lesson (explanation) at minimum; populate arrays where applicable.',
      pdfExtractSchema: {
        concept_name: 'string',
        simple_definition: 'string',
        why_important: 'string',
        prior_knowledge_needed: 'string',
        lesson: 'string — step-by-step explanation',
        diagram_suggestion: 'string',
        real_example: 'string',
        common_mistakes: ['string'],
        concept_check_questions: ['string'],
        key_points: ['string'],
        exam_tips: 'string',
        hots_question: 'string',
        self_reflection_prompt: 'string',
        difficulty: 'string',
      },
    },
    sectionFallbackRules: [{ ifEmpty: ['lesson'], use: ['summary', 'description'] }],
  },

  'lesson-planner': {
    slug: 'lesson-planner',
    title: 'Lesson Planner',
    contentTypeDefault: 'Lesson Plan',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'lesson_title', label: 'Lesson Title', universalBlock: 'input', storageKeys: ['lesson_name', 'title', 'name'] },
      { order: 2, id: 'learning_objectives', label: 'Learning Objectives', universalBlock: 'alignment', storageKeys: ['learning_objectives', 'objectives'] },
      { order: 3, id: 'ncf_alignment', label: 'NCF Competency / Learning Outcome Alignment', universalBlock: 'alignment', storageKeys: ['ncf_competency_alignment', 'competencies'] },
      { order: 4, id: 'prior_diagnostic', label: 'Prior Knowledge / Diagnostic Question', universalBlock: 'input', storageKeys: ['prior_knowledge_diagnostic', 'diagnostic_question'] },
      { order: 5, id: 'intro_warmup', label: 'Introduction / Warm-up', universalBlock: 'output', storageKeys: ['introduction_warmup', 'warmup'] },
      { order: 6, id: 'teaching_strategy', label: 'Teaching Strategy', universalBlock: 'output', storageKeys: ['teaching_strategy', 'pedagogy'] },
      { order: 7, id: 'classroom_activities', label: 'Classroom Activities', universalBlock: 'output', storageKeys: ['teaching_activities', 'classroom_activities', 'activities'] },
      { order: 8, id: 'teacher_talk', label: 'Teacher Talk Points', universalBlock: 'output', storageKeys: ['teacher_talk_points', 'teacher_instructions'] },
      { order: 9, id: 'student_tasks', label: 'Student Tasks', universalBlock: 'output', storageKeys: ['student_tasks', 'student_instructions'] },
      { order: 10, id: 'formative', label: 'Formative Assessment Questions', universalBlock: 'assessment', storageKeys: ['formative_assessment_questions', 'assessment'] },
      { order: 11, id: 'differentiation', label: 'Differentiation Plan', universalBlock: 'differentiation', storageKeys: ['differentiation_plan', 'differentiation'] },
      { order: 12, id: 'homework', label: 'Homework / Practice', universalBlock: 'output', storageKeys: ['homework_practice', 'homework'] },
      { order: 13, id: 'aids', label: 'Teaching Aids Required', universalBlock: 'output', storageKeys: ['teaching_aids_required', 'materials_required', 'materials'] },
      { order: 14, id: 'closure', label: 'Closure / Exit Ticket', universalBlock: 'reflection', storageKeys: ['closure_exit_ticket', 'reflection_exit_ticket', 'timeline'] },
    ],
    requiredFieldsForPdfExtract: ['lesson_name'],
    pdfValidationRules: [
      { id: 'body-present', severity: 'warn', description: 'At least one of objectives, activities, timeline, assessment should be non-trivial.' },
    ],
    parserHints: [
      'Curiosity lesson PDFs: split on /^Variation\\s+\\d+/i or repeated /^1\\.\\s*Title\\b/i; map sections 2–9 into objectives, materials, teaching steps, teacher/student blocks, assessment, real-life.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Lesson plan JSON: lesson_name + learning_objectives[] + all sections through closure; include materials_required[], teaching_activities[], timeline[] or time_slots[], assessment string, differentiation_plan, homework_practice, teaching_aids_required, closure_exit_ticket.',
      pdfExtractSchema: {
        sl_no: 'number',
        lesson_name: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string | string[]',
        prior_knowledge_diagnostic: 'string',
        introduction_warmup: 'string',
        teaching_strategy: 'string',
        teaching_activities: ['string'],
        teacher_talk_points: ['string'],
        student_tasks: ['string'],
        formative_assessment_questions: ['string'],
        differentiation_plan: 'string | string[]',
        homework_practice: 'string',
        materials_required: ['string'],
        closure_exit_ticket: 'string',
        timeline: ['string'],
        time_slots: [{ time: 'string', activity: 'string' }],
        assessment: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['timeline'], use: ['teaching_activities'], synthesize: 'number_from_activities' },
    ],
  },

  'homework-creator': {
    slug: 'homework-creator',
    title: 'Homework Creator',
    contentTypeDefault: 'Homework',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'hw_title', label: 'Homework Title', universalBlock: 'input', storageKeys: ['title'] },
      { order: 2, id: 'instructions', label: 'Clear Student Instructions', universalBlock: 'output', storageKeys: ['instructions', 'student_instructions'] },
      { order: 3, id: 'practice', label: 'Practice Questions', universalBlock: 'output', storageKeys: ['practice_questions', 'questions'] },
      { order: 4, id: 'application', label: 'Application-based Tasks', universalBlock: 'output', storageKeys: ['application_tasks'] },
      { order: 5, id: 'creative', label: 'One Creative / Thinking Question', universalBlock: 'assessment', storageKeys: ['creative_thinking_question'] },
      { order: 6, id: 'real_life_obs', label: 'One Real-life Observation Task', universalBlock: 'realLife', storageKeys: ['real_life_observation_task'] },
      { order: 7, id: 'challenge', label: 'Challenge Question', universalBlock: 'differentiation', storageKeys: ['challenge_question'] },
      { order: 8, id: 'support_hint', label: 'Support Hint', universalBlock: 'differentiation', storageKeys: ['support_hint', 'hints'] },
      { order: 9, id: 'answer_hints', label: 'Answer Hints / Key Points', universalBlock: 'assessment', storageKeys: ['answer_hints', 'answer_key'] },
      { order: 10, id: 'parent_note', label: 'Parent Note', universalBlock: 'reflection', storageKeys: ['parent_note'] },
    ],
    requiredFieldsForPdfExtract: ['title', 'questions'],
    pdfValidationRules: [{ id: 'questions', severity: 'error', description: 'questions[] required.' }],
    parserHints: ['Group numbered items into questions[] with type hints when section labels exist.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Homework JSON: title, instructions, questions[], application_tasks[], creative_thinking_question, real_life_observation_task, challenge_question, support_hint, answer_hints, parent_note.',
      pdfExtractSchema: { title: 'string', instructions: 'string', questions: ['object|string'] },
    },
    sectionFallbackRules: [],
  },

  'rubrics-evaluation-generator': {
    slug: 'rubrics-evaluation-generator',
    title: 'Rubrics, Evaluation & Report Card',
    contentTypeDefault: 'Rubric',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'purpose', label: 'Assessment Purpose', universalBlock: 'input', storageKeys: ['assessment_purpose', 'purpose'] },
      { order: 2, id: 'competency', label: 'Competency / Learning Outcome Assessed', universalBlock: 'alignment', storageKeys: ['competency_assessed', 'learning_outcome_assessed'] },
      { order: 3, id: 'rubric_grid', label: 'Evaluation Rubric with 4 Performance Levels', universalBlock: 'assessment', storageKeys: ['criteria'] },
      { order: 4, id: 'grading', label: 'Grading Criteria', universalBlock: 'assessment', storageKeys: ['grading_criteria', 'gradingScale'] },
      { order: 5, id: 'strengths', label: 'Strengths Observed', universalBlock: 'assessment', storageKeys: ['strengths_observed'] },
      { order: 6, id: 'improve', label: 'Areas for Improvement', universalBlock: 'assessment', storageKeys: ['areas_for_improvement'] },
      { order: 7, id: 'teacher_remarks', label: 'Teacher Remarks', universalBlock: 'output', storageKeys: ['teacher_remarks', 'remarks'] },
      { order: 8, id: 'actionable', label: 'Actionable Improvement Suggestions', universalBlock: 'output', storageKeys: ['actionable_suggestions'] },
      { order: 9, id: 'parent_feedback', label: 'Parent-friendly Feedback', universalBlock: 'reflection', storageKeys: ['parent_friendly_feedback'] },
      { order: 10, id: 'next_step', label: 'Next-step Remedial / Enrichment Activity', universalBlock: 'reflection', storageKeys: ['next_step_remedial_enrichment'] },
    ],
    requiredFieldsForPdfExtract: ['title', 'criteria'],
    pdfValidationRules: [{ id: 'criteria-four-level', severity: 'warn', description: 'Prefer four performance levels per criterion.' }],
    parserHints: ['criteria[]: { name, excellent, good, satisfactory, needs_improvement }.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint: 'Rubric JSON: title, assessment_purpose, competency_assessed, criteria[], grading_criteria, narrative fields for strengths, improvements, remarks, parent-facing text, next steps.',
      pdfExtractSchema: { title: 'string', criteria: ['object'] },
    },
    sectionFallbackRules: [],
  },

  'story-passage-creator': {
    slug: 'story-passage-creator',
    title: 'Story & Passage Creator',
    contentTypeDefault: 'Story',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'passage_title', label: 'Passage / Story Title', universalBlock: 'input', storageKeys: ['title'] },
      {
        order: 2,
        id: 'alignment',
        label: 'Alignment Block (NEP/NCF, Skill Focus, UDL)',
        universalBlock: 'alignment',
        storageKeys: ['alignment_block', 'nep_ncf_focus', 'skill_focus', 'udl_support', 'udl'],
      },
      {
        order: 3,
        id: 'learning_objectives',
        label: 'Learning Objectives',
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      { order: 4, id: 'passage', label: 'Passage', universalBlock: 'output', storageKeys: ['passage', 'content', 'story_text'] },
      {
        order: 5,
        id: 'vocabulary',
        label: 'Vocabulary Support',
        universalBlock: 'differentiation',
        storageKeys: ['vocabulary_support', 'vocabulary'],
      },
      {
        order: 6,
        id: 'comprehension',
        label: 'Comprehension and Thinking Questions',
        universalBlock: 'assessment',
        storageKeys: ['questions', 'comprehension_questions'],
      },
      {
        order: 7,
        id: 'answer_hints',
        label: 'Answer Hints',
        universalBlock: 'assessment',
        storageKeys: ['answer_hints', 'answer_key'],
      },
      {
        order: 8,
        id: 'differentiation',
        label: 'Differentiation (Support / Extension)',
        universalBlock: 'differentiation',
        storageKeys: ['differentiation_support', 'differentiation_extension', 'differentiation'],
      },
      {
        order: 9,
        id: 'real_life',
        label: 'Real-life Application',
        universalBlock: 'realLife',
        storageKeys: ['real_life_application', 'real_life_link'],
      },
      {
        order: 10,
        id: 'reflection',
        label: 'Reflection / Exit Ticket',
        universalBlock: 'reflection',
        storageKeys: ['reflection_prompt', 'reflection_exit_ticket'],
      },
    ],
    requiredFieldsForPdfExtract: ['title', 'passage'],
    pdfValidationRules: [{ id: 'passage-length', severity: 'warn', description: 'Passage should be substantive for reading practice.' }],
    parserHints: [
      'Metadata row: class, subject, subtopic, bloom_level, difficulty_level when present.',
      'Map Alignment Block (NEP/NCF, Skill Focus, UDL), Learning Objectives, Passage, Vocabulary, Questions, Answer Hints, Differentiation Support/Extension, Real-life Application, Reflection.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'One JSON object per story/passage item: title, alignment_block (or nep_ncf_focus, skill_focus, udl_support), learning_objectives[], passage, vocabulary_support[], questions[], answer_hints[] (or string), differentiation_support, differentiation_extension, real_life_application, reflection_prompt; optional bloom_level, difficulty_level, class_label, subject, subtopic from PDF header.',
      pdfExtractSchema: {
        title: 'string',
        alignment_block: 'string',
        nep_ncf_focus: 'string',
        skill_focus: 'string',
        udl_support: 'string',
        learning_objectives: ['string'],
        passage: 'string',
        vocabulary_support: ['string'],
        questions: ['object'],
        answer_hints: ['string'],
        differentiation_support: 'string',
        differentiation_extension: 'string',
        real_life_application: 'string',
        reflection_prompt: 'string',
        bloom_level: 'string',
        difficulty_level: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['passage'], use: ['content', 'story_text'] },
      { ifEmpty: ['alignment_block'], use: ['genre_purpose', 'subtopic_link'] },
    ],
  },

  'short-notes-summaries-maker': {
    slug: 'short-notes-summaries-maker',
    title: 'Short Notes & Summaries',
    contentTypeDefault: 'Notes',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'note_title', label: 'Note / Summary Title', universalBlock: 'input', storageKeys: ['title', 'concept_name'] },
      {
        order: 2,
        id: 'alignment',
        label: 'Alignment Block (NEP/NCF, UDL)',
        universalBlock: 'alignment',
        storageKeys: ['alignment_block', 'nep_ncf_focus', 'udl_support', 'udl'],
      },
      {
        order: 3,
        id: 'learning_objectives',
        label: 'Learning Objectives',
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      {
        order: 4,
        id: 'short_note',
        label: 'Short Note / Summary',
        universalBlock: 'output',
        storageKeys: ['short_note_summary', 'summary', 'exam_summary'],
      },
      {
        order: 5,
        id: 'key_points',
        label: 'Key Points to Remember',
        universalBlock: 'output',
        storageKeys: ['key_points_to_remember', 'key_points', 'keyPoints'],
      },
      { order: 6, id: 'example', label: 'Example', universalBlock: 'realLife', storageKeys: ['example'] },
      {
        order: 7,
        id: 'misconception',
        label: 'Common Misconception and Correction',
        universalBlock: 'differentiation',
        storageKeys: ['common_misconception_correction', 'misconception', 'correction', 'common_mistakes'],
      },
      {
        order: 8,
        id: 'quick_check',
        label: 'Quick Check Questions',
        universalBlock: 'assessment',
        storageKeys: ['quick_check_questions', 'self_check', 'questions'],
      },
      {
        order: 9,
        id: 'differentiation',
        label: 'Differentiation (Support / Extension)',
        universalBlock: 'differentiation',
        storageKeys: ['differentiation_support', 'differentiation_extension', 'differentiation'],
      },
      {
        order: 10,
        id: 'real_life',
        label: 'Real-life Application',
        universalBlock: 'realLife',
        storageKeys: ['real_life_application', 'real_life_link'],
      },
      {
        order: 11,
        id: 'reflection',
        label: 'Reflection / Exit Ticket',
        universalBlock: 'reflection',
        storageKeys: ['reflection_exit_ticket', 'reflection_prompt'],
      },
    ],
    requiredFieldsForPdfExtract: ['title', 'short_note_summary'],
    pdfValidationRules: [
      {
        id: 'has-body',
        severity: 'error',
        description: 'short_note_summary or summary with key_points required.',
      },
    ],
    parserHints: [
      'One object per Item N in PDF: alignment, objectives, short note, key points, example, misconception/correction, quick checks, differentiation, real-life, reflection.',
      'Metadata: bloom_level, skill_focus, subtopic when in header row.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Short Notes JSON per item: title, alignment_block (or nep_ncf_focus, udl_support), learning_objectives[], short_note_summary, key_points_to_remember[], example, common_misconception_correction, quick_check_questions[], differentiation_support, differentiation_extension, real_life_application, reflection_exit_ticket; optional bloom_level, skill_focus, subtopic.',
      pdfExtractSchema: {
        title: 'string',
        concept_name: 'string',
        alignment_block: 'string',
        learning_objectives: ['string'],
        short_note_summary: 'string',
        key_points_to_remember: ['string'],
        example: 'string',
        common_misconception_correction: 'string',
        quick_check_questions: ['string'],
        differentiation_support: 'string',
        differentiation_extension: 'string',
        real_life_application: 'string',
        reflection_exit_ticket: 'string',
        bloom_level: 'string',
        skill_focus: 'string',
        subtopic: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['short_note_summary'], use: ['summary', 'exam_summary', 'quick_recap'] },
      { ifEmpty: ['key_points_to_remember'], use: ['key_points', 'keyPoints'] },
    ],
  },

  'flashcard-generator': {
    slug: 'flashcard-generator',
    title: 'Flashcard Generator',
    contentTypeDefault: 'Flashcards',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'deck_title', label: 'Deck / Topic Title', universalBlock: 'input', storageKeys: ['deck_title', 'title'] },
      { order: 2, id: 'front', label: 'Front', universalBlock: 'output', storageKeys: ['front'] },
      { order: 3, id: 'back', label: 'Back', universalBlock: 'output', storageKeys: ['back'] },
      { order: 4, id: 'memory_cue', label: 'Memory Cue', universalBlock: 'differentiation', storageKeys: ['memory_cue', 'hint'] },
      { order: 5, id: 'skill_focus', label: 'Skill Focus', universalBlock: 'alignment', storageKeys: ['skill_focus', 'bloom_level'] },
      { order: 6, id: 'example_use', label: 'Example Use', universalBlock: 'realLife', storageKeys: ['example_use', 'real_life_link'] },
      { order: 7, id: 'peer_prompt', label: 'Peer Prompt', universalBlock: 'assessment', storageKeys: ['peer_prompt'] },
      { order: 8, id: 'reflection', label: 'Reflection', universalBlock: 'reflection', storageKeys: ['reflection', 'reflection_prompt', 'self_check'] },
    ],
    requiredFieldsForPdfExtract: ['front', 'back'],
    pdfValidationRules: [{ id: 'front-back', severity: 'error', description: 'Each card needs non-empty front and back.' }],
    parserHints: [
      'One object per flashcard (Item N / Card N): front, back, memory_cue, skill_focus, example_use, peer_prompt, reflection.',
      'Legacy PDFs may use hint → memory_cue, bloom_level → skill_focus, real_life_link → example_use, self_check → reflection.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Flashcard objects: front, back, memory_cue, skill_focus, example_use, peer_prompt, reflection; optional deck_title/title for the set.',
      pdfExtractSchema: {
        deck_title: 'string',
        title: 'string',
        front: 'string',
        back: 'string',
        memory_cue: 'string',
        skill_focus: 'string',
        example_use: 'string',
        peer_prompt: 'string',
        reflection: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['memory_cue'], use: ['hint'] },
      { ifEmpty: ['skill_focus'], use: ['bloom_level', 'topic_tag'] },
      { ifEmpty: ['example_use'], use: ['real_life_link', 'example'] },
      { ifEmpty: ['reflection'], use: ['reflection_prompt', 'self_check'] },
    ],
  },

  'daily-class-plan-maker': {
    slug: 'daily-class-plan-maker',
    title: 'Daily Class Plan',
    contentTypeDefault: 'Daily Plan',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'day_breakup', label: 'Day / Period-wise Topic Break-up', universalBlock: 'input', storageKeys: ['day_period_topic_breakup', 'title'] },
      { order: 2, id: 'objectives_period', label: 'Learning Objective for Each Period', universalBlock: 'alignment', storageKeys: ['objectives', 'period_objectives'] },
      { order: 3, id: 'method', label: 'Teaching Method per Period', universalBlock: 'output', storageKeys: ['teaching_methods'] },
      { order: 4, id: 'activity', label: 'Classroom Activity / Demonstration', universalBlock: 'output', storageKeys: ['classroom_activity'] },
      { order: 5, id: 'exit', label: 'Quick Assessment / Exit Ticket', universalBlock: 'assessment', storageKeys: ['exit_ticket', 'formative_check'] },
      { order: 6, id: 'differentiation', label: 'Differentiated Support', universalBlock: 'differentiation', storageKeys: ['differentiated_support', 'differentiation'] },
      { order: 7, id: 'homework', label: 'Homework / Follow-up Task', universalBlock: 'output', storageKeys: ['homework_followup'] },
      { order: 8, id: 'aids', label: 'Required Teaching Aids', universalBlock: 'output', storageKeys: ['teaching_aids', 'materials'] },
      { order: 9, id: 'reflection', label: 'Teacher Reflection Notes', universalBlock: 'reflection', storageKeys: ['teacher_reflection_notes', 'reflection'] },
    ],
    requiredFieldsForPdfExtract: ['title', 'time_slots'],
    pdfValidationRules: [{ id: 'time-slots', severity: 'warn', description: 'Prefer explicit time_slots[].' }],
    parserHints: ['Reuse lesson Curiosity split when workbook uses same numbering; map to time_slots + objectives.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Daily plan JSON: title, day_period_topic_breakup, objectives[], time_slots[{time,activity,type}], teaching_methods[], classroom_activity[], exit_ticket, differentiated_support, homework_followup, teaching_aids[], teacher_reflection_notes.',
      pdfExtractSchema: {
        title: 'string',
        day_period_topic_breakup: 'string',
        objectives: ['string'],
        time_slots: [{ time: 'string', activity: 'string', type: 'string' }],
        teaching_methods: ['string'],
        classroom_activity: ['string'],
        exit_ticket: 'string',
        differentiated_support: 'string',
        homework_followup: 'string',
        teaching_aids: ['string'],
        teacher_reflection_notes: 'string',
        timeline: ['string'],
      },
    },
    sectionFallbackRules: [{ ifEmpty: ['time_slots'], use: ['timeline', 'schedule_lines'] }],
  },

  'exam-question-paper-generator': {
    slug: 'exam-question-paper-generator',
    title: 'Exam Question Paper',
    contentTypeDefault: 'Exam Paper',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'paper_title', label: 'Paper Title and General Instructions', universalBlock: 'input', storageKeys: ['paper_title', 'instructions'] },
      { order: 2, id: 'blueprint', label: 'Blueprint / Design Grid', universalBlock: 'alignment', storageKeys: ['blueprint', 'design_grid'] },
      { order: 3, id: 'section_a', label: 'Section A: MCQs', universalBlock: 'output', storageKeys: ['section_a'] },
      { order: 4, id: 'section_b', label: 'Section B: Very Short Answer Questions', universalBlock: 'output', storageKeys: ['section_b'] },
      { order: 5, id: 'section_c', label: 'Section C: Short Answer Questions', universalBlock: 'output', storageKeys: ['section_c'] },
      { order: 6, id: 'section_d', label: 'Section D: Long Answer Questions', universalBlock: 'output', storageKeys: ['section_d'] },
      { order: 7, id: 'section_e', label: 'Section E: Case-based / Competency-based Questions', universalBlock: 'output', storageKeys: ['section_e'] },
      { order: 8, id: 'internal_choices', label: 'Internal Choices', universalBlock: 'output', storageKeys: ['internal_choices'] },
      { order: 9, id: 'answer_key', label: 'Complete Answer Key', universalBlock: 'assessment', storageKeys: ['answer_key'] },
      { order: 10, id: 'marking', label: 'Detailed Marking Scheme', universalBlock: 'assessment', storageKeys: ['marking_scheme'] },
      { order: 11, id: 'rubric_open', label: 'Rubric for Open-ended Questions', universalBlock: 'assessment', storageKeys: ['open_ended_rubric'] },
    ],
    requiredFieldsForPdfExtract: ['question', 'answer'],
    pdfValidationRules: [{ id: 'answer-key', severity: 'warn', description: 'Answer key should align with all sections.' }],
    parserHints: ['Questions often rows with section + marks; preserve internal choice markers (OR / Choose one).'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Prefer ONE JSON object per full exam paper: paper_title, instructions, blueprint, sections[{sectionName,questions[{question_number,question,options[],answer,marks,internal_choice_group}]}], internal_choices, answer_key, marking_scheme, open_ended_rubric. If only a question list exists, use flat rows with section + question_number + question + options + answer + marks.',
      pdfExtractSchema: {
        paper_title: 'string',
        title: 'string',
        instructions: 'string',
        blueprint: 'string',
        sections: [
          {
            sectionName: 'string',
            questions: [
              {
                question_number: 'number',
                question: 'string',
                options: ['string'],
                answer: 'string',
                marks: 'number',
                internal_choice_group: 'string',
              },
            ],
          },
        ],
        internal_choices: 'string',
        answer_key: 'string',
        marking_scheme: 'string',
        open_ended_rubric: 'string',
        question_number: 'number',
        section: 'string',
        question: 'string',
        options: ['string'],
        answer: 'string',
        marks: 'number',
      },
    },
    sectionFallbackRules: [],
  },

  'smart-study-guide-generator': {
    slug: 'smart-study-guide-generator',
    title: 'Smart Study Guide Generator',
    contentTypeDefault: 'Study Guide',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Study Guide Title', universalBlock: 'input', storageKeys: ['title'] },
      { order: 2, id: 'objectives', label: 'Learning Objectives', universalBlock: 'alignment', storageKeys: ['learning_objectives', 'objectives'] },
      { order: 3, id: 'key_concepts', label: 'Key Concepts', universalBlock: 'output', storageKeys: ['key_concepts', 'concepts'] },
      { order: 4, id: 'formulas', label: 'Formulas and Rules', universalBlock: 'output', storageKeys: ['formulas', 'rules'] },
      { order: 5, id: 'revision_checklist', label: 'Revision Checklist', universalBlock: 'output', storageKeys: ['revision_checklist', 'checklist'] },
      { order: 6, id: 'study_tips', label: 'Study Tips', universalBlock: 'differentiation', storageKeys: ['study_tips', 'tips'] },
      { order: 7, id: 'quick_review', label: 'Quick Review Points', universalBlock: 'reflection', storageKeys: ['quick_review', 'review_points'] },
    ],
    requiredFieldsForPdfExtract: ['title'],
    pdfValidationRules: [{ id: 'has-body', severity: 'error', description: 'key_concepts or revision_checklist required.' }],
    parserHints: ['Personalized study guide: objectives, concepts, formulas, checklist, tips.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Study guide JSON: title, learning_objectives[], key_concepts[] (name + explanation), formulas[] (name + formula + note), revision_checklist[], study_tips[], quick_review[].',
      pdfExtractSchema: {
        title: 'string',
        learning_objectives: ['string'],
        key_concepts: [{ name: 'string', explanation: 'string' }],
        formulas: [{ name: 'string', formula: 'string', note: 'string' }],
        revision_checklist: ['string'],
        study_tips: ['string'],
        quick_review: ['string'],
      },
    },
    sectionFallbackRules: [{ ifEmpty: ['key_concepts'], use: ['concepts', 'summary'] }],
  },

  'concept-breakdown-explainer': {
    slug: 'concept-breakdown-explainer',
    title: 'Concept Breakdown Explainer',
    contentTypeDefault: 'Concept Notes',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'concept_name', label: 'Concept Name', universalBlock: 'input', storageKeys: ['concept_name', 'title'] },
      { order: 2, id: 'simple_explanation', label: 'Simple Explanation', universalBlock: 'output', storageKeys: ['simple_explanation', 'explanation'] },
      { order: 3, id: 'steps', label: 'Step-by-step Breakdown', universalBlock: 'output', storageKeys: ['steps', 'breakdown_steps'] },
      { order: 4, id: 'examples', label: 'Examples', universalBlock: 'realLife', storageKeys: ['examples'] },
      { order: 5, id: 'misconceptions', label: 'Common Misconceptions', universalBlock: 'differentiation', storageKeys: ['common_misconceptions', 'misconceptions'] },
      { order: 6, id: 'quick_check', label: 'Quick Check', universalBlock: 'assessment', storageKeys: ['quick_check_questions', 'questions'] },
    ],
    requiredFieldsForPdfExtract: ['concept_name'],
    pdfValidationRules: [{ id: 'has-body', severity: 'error', description: 'simple_explanation or steps required.' }],
    parserHints: ['One concept per Item N: name, explanation, steps, examples, misconceptions, quick checks.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Concept breakdown JSON: concepts[] with concept_name, simple_explanation, breakdown_steps[], examples[], common_misconceptions[], quick_check_questions[]. Or single object with same fields.',
      pdfExtractSchema: {
        concepts: [
          {
            concept_name: 'string',
            simple_explanation: 'string',
            breakdown_steps: ['string'],
            examples: ['string'],
            common_misconceptions: ['string'],
            quick_check_questions: ['string'],
          },
        ],
        concept_name: 'string',
        simple_explanation: 'string',
        breakdown_steps: ['string'],
        examples: ['string'],
        common_misconceptions: ['string'],
        quick_check_questions: ['string'],
      },
    },
    sectionFallbackRules: [],
  },

  'smart-qa-practice-generator': {
    slug: 'smart-qa-practice-generator',
    title: 'Smart Q&A Practice Generator',
    contentTypeDefault: 'Practice Q&A',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Practice Set Title', universalBlock: 'input', storageKeys: ['title'] },
      { order: 2, id: 'instructions', label: 'Instructions', universalBlock: 'input', storageKeys: ['instructions'] },
      { order: 3, id: 'questions', label: 'Practice Questions with Answers', universalBlock: 'output', storageKeys: ['questions', 'practice_questions'] },
      { order: 4, id: 'tips', label: 'Quick Tips', universalBlock: 'reflection', storageKeys: ['tips', 'study_tips'] },
    ],
    requiredFieldsForPdfExtract: ['questions'],
    pdfValidationRules: [{ id: 'questions', severity: 'error', description: 'questions[] required.' }],
    parserHints: ['Each question: question text, answer, optional step_by_step_answer and tip.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Practice Q&A JSON: title, instructions, questions[] with question, answer, step_by_step_answer (optional), tip (optional).',
      pdfExtractSchema: {
        title: 'string',
        instructions: 'string',
        questions: [{ question: 'string', answer: 'string', step_by_step_answer: 'string', tip: 'string' }],
      },
    },
    sectionFallbackRules: [],
  },

  'chapter-summary-creator': {
    slug: 'chapter-summary-creator',
    title: 'Chapter Summary Creator',
    contentTypeDefault: 'Chapter Summary',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'chapter_title', label: 'Chapter / Topic Title', universalBlock: 'input', storageKeys: ['chapter_title', 'title'] },
      { order: 2, id: 'summary', label: 'Chapter Summary', universalBlock: 'output', storageKeys: ['summary', 'chapter_summary'] },
      { order: 3, id: 'key_takeaways', label: 'Key Takeaways', universalBlock: 'output', storageKeys: ['key_takeaways', 'takeaways'] },
      { order: 4, id: 'review_points', label: 'Quick Review Points', universalBlock: 'reflection', storageKeys: ['review_points', 'quick_review'] },
    ],
    requiredFieldsForPdfExtract: ['summary'],
    pdfValidationRules: [{ id: 'has-body', severity: 'error', description: 'summary or key_takeaways required.' }],
    parserHints: ['Concise chapter summary with takeaways and review bullets.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Chapter summary JSON: chapter_title, summary, key_takeaways[], review_points[].',
      pdfExtractSchema: {
        chapter_title: 'string',
        title: 'string',
        summary: 'string',
        chapter_summary: 'string',
        key_takeaways: ['string'],
        review_points: ['string'],
      },
    },
    sectionFallbackRules: [{ ifEmpty: ['summary'], use: ['chapter_summary'] }],
  },

  'key-points-formula-extractor': {
    slug: 'key-points-formula-extractor',
    title: 'Key Points Extractor',
    contentTypeDefault: 'Key Points',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Topic Title', universalBlock: 'input', storageKeys: ['title', 'topic_title'] },
      { order: 2, id: 'key_points', label: 'Key Points', universalBlock: 'output', storageKeys: ['key_points', 'key_points_to_remember'] },
      { order: 3, id: 'definitions', label: 'Definitions', universalBlock: 'output', storageKeys: ['definitions'] },
      { order: 4, id: 'formulas', label: 'Formulas', universalBlock: 'output', storageKeys: ['formulas'] },
    ],
    requiredFieldsForPdfExtract: ['key_points'],
    pdfValidationRules: [{ id: 'has-body', severity: 'error', description: 'key_points or formulas required.' }],
    parserHints: ['Bullet key points, term definitions, and formula list.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Key points JSON: title, key_points[] (strings or {point, detail}), definitions[] ({term, definition}), formulas[] ({name, formula, when_to_use}).',
      pdfExtractSchema: {
        title: 'string',
        key_points: ['string'],
        definitions: [{ term: 'string', definition: 'string' }],
        formulas: [{ name: 'string', formula: 'string', when_to_use: 'string' }],
      },
    },
    sectionFallbackRules: [{ ifEmpty: ['key_points'], use: ['key_points_to_remember'] }],
  },

  'quick-assignment-builder': {
    slug: 'quick-assignment-builder',
    title: 'Quick Assignment Builder',
    contentTypeDefault: 'Assignment',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Assignment Title', universalBlock: 'input', storageKeys: ['title', 'assignment_title'] },
      { order: 2, id: 'instructions', label: 'Student Instructions', universalBlock: 'output', storageKeys: ['instructions', 'student_instructions'] },
      { order: 3, id: 'questions', label: 'Assignment Questions', universalBlock: 'output', storageKeys: ['questions', 'tasks'] },
      { order: 4, id: 'marking', label: 'Marking Criteria', universalBlock: 'assessment', storageKeys: ['marking_criteria', 'marking_scheme'] },
    ],
    requiredFieldsForPdfExtract: ['title', 'questions'],
    pdfValidationRules: [{ id: 'questions', severity: 'error', description: 'questions[] required.' }],
    parserHints: ['Structured assignment with instructions, numbered questions, and marking criteria.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Assignment JSON: title, instructions, questions[] (question, marks optional, answer optional), marking_criteria (string or criteria[]).',
      pdfExtractSchema: {
        title: 'string',
        instructions: 'string',
        questions: [{ question: 'string', marks: 'number', answer: 'string' }],
        marking_criteria: 'string',
      },
    },
    sectionFallbackRules: [],
  },
};

Object.freeze(TEMPLATES);
for (const k of Object.keys(TEMPLATES)) Object.freeze(TEMPLATES[k]);

/** @param {string} slug */
export function getAiToolTemplate(slug) {
  const s = String(slug || '').trim();
  return TEMPLATES[s] || null;
}

/** @returns {Record<string, { title: string; contentTypeDefault: string }>} */
export function getToolRegistryMeta() {
  return Object.fromEntries(
    AI_TOOL_ORDERED_SLUGS.map((slug) => {
      const t = TEMPLATES[slug];
      return [slug, { title: t.title, contentTypeDefault: t.contentTypeDefault }];
    }),
  );
}

/** Display title for slug (canonical). */
export function getToolDisplayTitle(slug) {
  return TEMPLATES[String(slug || '').trim()]?.title || String(slug || '').replace(/-/g, ' ');
}

/** Default content type string used in DB / renderers. */
export function getContentTypeDefault(slug) {
  return TEMPLATES[String(slug || '').trim()]?.contentTypeDefault || 'Generated Content';
}

/**
 * Gemini prompt for Super Admin AI Generator (curriculum context only — no PDF).
 * Uses the same strictOutputHint + pdfExtractSchema as AI PDF / Content Engine.
 * @param {string} toolSlug
 * @param {Record<string, unknown>} params
 */
export function buildAiGeneratorStructuredPrompt(toolSlug, params = {}) {
  const slug = String(toolSlug || '').trim();
  const t = getAiToolTemplate(slug);
  if (!t) throw new Error(`Unknown AI tool: ${toolSlug}`);

  const schema = t.gemini?.pdfExtractSchema || {};
  const strictHint = t.gemini?.strictOutputHint || '';
  const headings = (t.canonicalHeadings || [])
    .map((h) => `${h.order}. ${h.label}`)
    .join('\n');
  const extra = params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {};
  const bloomLevel = String(params.bloomLevel || extra.bloomLevel || '').trim();
  const questionCount = Number(extra.questionCount ?? extra.numberOfQuestions);
  const cardCount = Number(extra.cardCount);
  const duration = String(extra.duration || '').trim();

  const contextLines = [
    `TOOL: ${t.title}`,
    `CONTENT TYPE: ${t.contentTypeDefault}`,
    `BOARD: ${String(params.board || '').trim() || '—'}`,
    `CLASS: ${String(params.classLabel || params.gradeLevel || '').trim() || '—'}`,
    `SUBJECT: ${String(params.subject || '').trim() || '—'}`,
    `TOPIC: ${String(params.topic || '').trim() || '—'}`,
    `SUBTOPIC: ${String(params.subTopic || params.subtopic || '').trim() || '—'}`,
  ];
  if (bloomLevel) contextLines.push(`BLOOM / COGNITIVE TARGET: ${bloomLevel}`);
  if (Number.isFinite(questionCount) && questionCount > 0) {
    contextLines.push(`TARGET QUESTION COUNT: ${questionCount}`);
  }
  if (Number.isFinite(cardCount) && cardCount > 0) {
    contextLines.push(`TARGET FLASHCARD COUNT: ${cardCount}`);
  }
  if (duration) contextLines.push(`LESSON DURATION (minutes): ${duration}`);

  return `You are an expert Indian school curriculum content generator aligned to NEP 2020 and NCF-SE 2023.

${contextLines.join('\n')}

CANONICAL OUTPUT SECTIONS (populate structuredContent using these headings and field names):
${headings}

STRICT OUTPUT RULE:
${strictHint}

Generate original, classroom-ready content for the class, subject, topic, and subtopic above. Do not use markdown code fences inside JSON string values.

Return ONLY valid JSON (single root object, no markdown fences):
{
  "contentType": "${t.contentTypeDefault}",
  "structuredContent": { }
}

The structuredContent object MUST match this JSON schema (field names and types exactly):
${JSON.stringify(schema, null, 2)}

For tools that produce multiple worksheet questions, exam items, or flashcards, put them in the arrays defined by the schema (e.g. questions[], sections[].questions[], cards[]).
For Activity & Project Generator, fill ALL 13 canonical fields in one structuredContent object.`;
}

/** @param {string} toolSlug @param {unknown} structured */
export function expandStructuredToFormatItems(toolSlug, structured) {
  if (Array.isArray(structured)) {
    return structured.filter((x) => x && typeof x === 'object');
  }
  const s = structured && typeof structured === 'object' ? structured : {};

  switch (toolSlug) {
    case 'activity-project-generator':
      return [s];
    case 'worksheet-mcq-generator': {
      if (Array.isArray(s.sections) && s.sections.length) return [s];
      const qs = Array.isArray(s.questions) ? s.questions : [];
      if (
        qs.length &&
        (String(s.title || s.worksheet_title || '').trim() ||
          String(s.instructions || '').trim() ||
          s.learning_objectives?.length)
      ) {
        return [{ ...s, questions: qs }];
      }
      if (qs.length) {
        return qs.map((q, i) => {
          if (q && typeof q === 'object') {
            return { ...q, question_number: q.question_number ?? i + 1 };
          }
          return { question: String(q), question_number: i + 1 };
        });
      }
      return [s];
    }
    case 'homework-creator': {
      const qs = Array.isArray(s.questions) ? s.questions : [];
      if (qs.length) {
        return qs.map((q, i) => {
          if (q && typeof q === 'object') {
            return { ...q, question_number: q.question_number ?? i + 1 };
          }
          return { question: String(q), question_number: i + 1 };
        });
      }
      return [s];
    }
    case 'rubrics-evaluation-generator':
      return [s];
    case 'daily-class-plan-maker':
      return [s];
    case 'exam-question-paper-generator': {
      const items = [];
      for (const sec of Array.isArray(s.sections) ? s.sections : []) {
        const sectionName = String(sec?.sectionName || sec?.name || '').trim();
        for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
          items.push({
            ...(q && typeof q === 'object' ? q : { question: String(q) }),
            section: sectionName,
            question_number: items.length + 1,
          });
        }
      }
      return items.length ? items : [s];
    }
    case 'flashcard-generator': {
      const cards = Array.isArray(s.cards) ? s.cards : [];
      return cards.map((c, i) => ({ ...(c && typeof c === 'object' ? c : {}), sl_no: i + 1 }));
    }
    case 'concept-mastery-helper':
    case 'concept-breakdown-explainer': {
      const concepts = Array.isArray(s.concepts) ? s.concepts : [];
      if (concepts.length) {
        return concepts.map((c, i) => {
          const row = c && typeof c === 'object' ? c : {};
          return {
            ...row,
            sl_no: i + 1,
            concept_name: row.concept_name || row.title || row.name || `Concept ${i + 1}`,
            simple_definition: row.simple_definition || row.simple_explanation || row.explanation || '',
            key_points: row.key_points || row.examples,
          };
        });
      }
      return [s];
    }
    case 'smart-qa-practice-generator':
    case 'quick-assignment-builder': {
      const qs = Array.isArray(s.questions) ? s.questions : [];
      if (qs.length) {
        return qs.map((q, i) => {
          if (q && typeof q === 'object') {
            return { ...q, question_number: q.question_number ?? i + 1 };
          }
          return { question: String(q), question_number: i + 1 };
        });
      }
      return [s];
    }
    default:
      return [s];
  }
}

/**
 * Render structured Gemini output to markdown using canonical templates.
 * @param {string} toolSlug
 * @param {unknown} structured
 */
export function formatStructuredToolOutput(toolSlug, structured) {
  const items = expandStructuredToFormatItems(toolSlug, structured);
  if (!items.length) return '';
  return items
    .map((item, idx) => formatItemToContentFromTemplate(toolSlug, item, idx))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/** Map label text → slug (for classify / resolve). */
export function buildToolAliasToSlugMap() {
  const acc = {};
  for (const slug of AI_TOOL_ORDERED_SLUGS) {
    const label = TEMPLATES[slug].title;
    const key = String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    acc[key] = slug;
    acc[slug] = slug;
  }
  return acc;
}

/** @returns {Record<string, string>} slug → strict Gemini / regeneration hint */
export function buildStrictOutputHintsMap() {
  return Object.fromEntries(
    AI_TOOL_ORDERED_SLUGS.map((slug) => [slug, TEMPLATES[slug].gemini.strictOutputHint]),
  );
}

/**
 * Shape expected by `gemini-service.js` PDF_TOOL_CONFIG.
 * @returns {Record<string, { requiredFields: string[]; schema: Record<string, unknown> }>}
 */
export function buildPdfToolConfigMap() {
  return Object.fromEntries(
    AI_TOOL_ORDERED_SLUGS.map((slug) => {
      const t = TEMPLATES[slug];
      return [
        slug,
        {
          requiredFields: [...t.requiredFieldsForPdfExtract],
          schema: { ...t.gemini.pdfExtractSchema },
          pdfValidationRules: [...(t.pdfValidationRules || [])],
          multiItemExpected: [
            'flashcard-generator',
            'short-notes-summaries-maker',
            'story-passage-creator',
            'concept-mastery-helper',
            'concept-breakdown-explainer',
            'smart-qa-practice-generator',
            'quick-assignment-builder',
          ].includes(slug),
        },
      ];
    }),
  );
}

/** Policy hints for PDF extraction pipeline (chunking, retries, validation). */
export function getPdfExtractPolicy(toolSlug) {
  const t = getAiToolTemplate(toolSlug);
  if (!t) return null;
  return {
    slug: toolSlug,
    title: t.title,
    requiredFieldsForPdfExtract: [...t.requiredFieldsForPdfExtract],
    pdfValidationRules: [...(t.pdfValidationRules || [])],
    parserHints: [...(t.parserHints || [])],
    regenerationRules: t.regenerationRules ? { ...t.regenerationRules } : {},
  };
}

/**
 * Match a single line of extracted PDF text against canonical headings (strict regex first, then fuzzy).
 * @param {string} toolSlug
 * @param {string} line
 * @returns {{ headingId: string | null; label: string | null; match: 'strict' | 'fuzzy' | null }}
 */
export function matchCanonicalHeadingLine(toolSlug, line) {
  const t = getAiToolTemplate(toolSlug);
  if (!t) return { headingId: null, label: null, match: null };
  const raw = String(line || '').trim();
  if (!raw) return { headingId: null, label: null, match: null };
  for (const h of t.canonicalHeadings) {
    for (const re of h.strictLineRegexes || []) {
      if (re.test(raw)) return { headingId: h.id, label: h.label, match: 'strict' };
    }
    const lower = raw.toLowerCase();
    for (const sub of h.fuzzyContains || []) {
      if (sub && lower.includes(sub)) return { headingId: h.id, label: h.label, match: 'fuzzy' };
    }
  }
  return { headingId: null, label: null, match: null };
}

/**
 * Ordered list of fallback storage keys for a heading id (for parsers / normalizers).
 * @param {string} toolSlug
 * @param {string} headingId
 */
export function getStorageKeysForHeading(toolSlug, headingId) {
  const t = getAiToolTemplate(toolSlug);
  if (!t) return [];
  const h = t.canonicalHeadings.find((x) => x.id === headingId);
  return h?.storageKeys ? [...h.storageKeys] : [];
}

/** @param {string} toolSlug */
export function getSectionFallbackRules(toolSlug) {
  return getAiToolTemplate(toolSlug)?.sectionFallbackRules || [];
}

const str = (v) => (v == null ? '' : String(v).trim());
const strArr = (v) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

function pushSection(lines, title, bodyLines) {
  lines.push(`### ${title}`, ...bodyLines, '');
}

/**
 * Markdown lines for persistence / preview (`formatItemToContent` delegates here).
 * @param {string} toolSlug
 * @param {Record<string, unknown>} item
 * @param {number} index
 * @returns {string[]}
 */
export function formatItemLinesFromTemplate(toolSlug, item, index = 0) {
  const i = item || {};
  const n = Number(i.sl_no || i.question_number || index + 1) || index + 1;
  const t = getAiToolTemplate(toolSlug);
  if (!t) return [`## Item ${n}`, '', str(i.content) || JSON.stringify(i, null, 2)];

  const lines = [];

  switch (toolSlug) {
    case 'activity-project-generator': {
      lines.push(`## Activity ${n}: ${str(i.title || i.name) || 'Untitled Activity'}`, '');
      const sub = str(i.subtopic_link_prior_knowledge);
      if (sub) pushSection(lines, '2. Subtopic Link and Prior Knowledge Required', [sub]);
      const lo = strArr(i.learning_objectives || i.learningObjectives);
      if (lo.length) pushSection(lines, '3. Learning Objectives', lo.map((x) => `- ${x}`));
      const ncf = str(i.ncf_competency_alignment);
      const ncfArr = strArr(Array.isArray(i.ncf_competency_alignment) ? i.ncf_competency_alignment : []);
      if (ncf) pushSection(lines, '4. NCF Competency / Learning Outcome Alignment', [ncf]);
      else if (ncfArr.length) pushSection(lines, '4. NCF Competency / Learning Outcome Alignment', ncfArr.map((x) => `- ${x}`));
      const mat = strArr(i.materials_required || i.materials);
      if (mat.length) pushSection(lines, '5. Materials Required', mat.map((x) => `- ${x}`));
      const proc = strArr(i.step_by_step_procedure || i.steps);
      if (proc.length) pushSection(lines, '6. Step-by-step Procedure', proc.map((x, idx) => `${idx + 1}. ${x}`));
      const tea = strArr(i.teacher_instructions || i.teacherInstructions);
      if (tea.length) pushSection(lines, '7. Teacher Instructions', tea.map((x) => `- ${x}`));
      const stu = strArr(i.student_instructions || i.studentInstructions);
      if (stu.length) pushSection(lines, '8. Student Instructions', stu.map((x) => `- ${x}`));
      const diffPlan = Array.isArray(i.differentiation_plan)
        ? i.differentiation_plan.map((x) => str(x)).filter(Boolean).join('; ')
        : '';
      const diff = str(i.differentiation) || diffPlan;
      if (diff) pushSection(lines, '9. Differentiation', [diff]);
      const rub = strArr(i.assessment_criteria_rubric || i.assessmentRubric);
      if (rub.length) pushSection(lines, '10. Assessment Rubric', rub.map((x) => `- ${x}`));
      const exp = str(i.expected_learning_outcomes || i.expectedLearningOutcomes || i.learning_outcome);
      if (exp) pushSection(lines, '11. Expected Learning Outcomes', [exp]);
      const rl = str(i.real_life_application || i.realLifeApplication);
      if (rl) pushSection(lines, '12. Real-life Application', [rl]);
      const ref = str(i.reflection_exit_ticket);
      if (ref) pushSection(lines, '13. Reflection / Exit Ticket', [ref]);
      break;
    }
    case 'worksheet-mcq-generator': {
      if (Array.isArray(i.sections) && i.sections.length) {
        lines.push(`## ${str(i.worksheet_title || i.title) || `Worksheet ${n}`}`, '');
        const lo = strArr(i.learning_objectives || i.objectives);
        if (lo.length) pushSection(lines, '2. Learning Objectives', lo.map((x) => `- ${x}`));
        if (str(i.instructions)) pushSection(lines, '3. Instructions to Students', [str(i.instructions)]);
        for (const sec of i.sections) {
          const secName = str(sec?.sectionName || sec?.name || 'Section');
          lines.push(`### ${secName}`, '');
          for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
            lines.push(`**Q${q?.question_number || ''}.** ${str(q?.question)}`, '');
            if (Array.isArray(q?.options) && q.options.length) {
              q.options.forEach((opt) => lines.push(String(opt)));
              lines.push('');
            }
            if (q?.answer) lines.push(`**Answer:** ${str(q.answer)}`);
            if (q?.marks != null) lines.push(`**Marks:** ${str(q.marks)}`);
          }
        }
        if (str(i.answer_key)) pushSection(lines, '9. Answer Key', [str(i.answer_key)]);
        const bloom = [str(i.bloom_level), str(i.difficulty_tag || i.difficulty)].filter(Boolean).join(' — ');
        if (bloom) pushSection(lines, "10. Bloom's Level and Difficulty Tag", [bloom]);
        break;
      }
      if (i.section) lines.push(`**${str(i.section)}**`, '');
      lines.push(`**Q${i.question_number || n}.** ${str(i.question)}`, '');
      if (Array.isArray(i.options) && i.options.length) {
        i.options.forEach((opt) => lines.push(String(opt)));
        lines.push('');
      }
      if (i.answer) lines.push(`**Answer:** ${str(i.answer)}`);
      if (i.explanation) lines.push(`**Explanation:** ${str(i.explanation)}`);
      if (i.marks != null) lines.push(`**Marks:** ${str(i.marks)}`);
      if (str(i.bloom_level)) lines.push(`**Bloom / difficulty:** ${str(i.bloom_level)}`);
      break;
    }
    case 'exam-question-paper-generator': {
      if (Array.isArray(i.sections) && i.sections.length) {
        lines.push(`## ${str(i.paper_title || i.title) || `Exam Paper ${n}`}`, '');
        if (str(i.instructions)) pushSection(lines, '1. Paper Title and General Instructions', [str(i.instructions)]);
        if (str(i.blueprint)) pushSection(lines, '2. Blueprint / Design Grid', [str(i.blueprint)]);
        for (const sec of i.sections) {
          const secName = str(sec?.sectionName || sec?.name || 'Section');
          lines.push(`### ${secName}`, '');
          for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
            lines.push(`**Q${q?.question_number || ''}.** ${str(q?.question)}`, '');
            if (Array.isArray(q?.options) && q.options.length) {
              q.options.forEach((opt) => lines.push(String(opt)));
              lines.push('');
            }
            if (q?.answer) lines.push(`**Answer:** ${str(q.answer)}`);
            if (q?.marks != null) lines.push(`**Marks:** ${str(q.marks)}`);
          }
        }
        if (str(i.internal_choices)) pushSection(lines, '8. Internal Choices', [str(i.internal_choices)]);
        if (str(i.answer_key)) pushSection(lines, '9. Complete Answer Key', [str(i.answer_key)]);
        if (str(i.marking_scheme)) pushSection(lines, '10. Detailed Marking Scheme', [str(i.marking_scheme)]);
        if (str(i.open_ended_rubric)) pushSection(lines, '11. Rubric for Open-ended Questions', [str(i.open_ended_rubric)]);
        break;
      }
      if (i.section) lines.push(`**${str(i.section)}**`, '');
      lines.push(`**Q${i.question_number || n}.** ${str(i.question)}`, '');
      if (Array.isArray(i.options) && i.options.length) {
        i.options.forEach((opt) => lines.push(String(opt)));
        lines.push('');
      }
      if (i.answer) lines.push(`**Answer:** ${str(i.answer)}`);
      if (i.explanation) lines.push(`**Explanation:** ${str(i.explanation)}`);
      if (i.marks != null) lines.push(`**Marks:** ${str(i.marks)}`);
      if (str(i.bloom_level)) lines.push(`**Bloom / difficulty:** ${str(i.bloom_level)}`);
      break;
    }
    case 'concept-mastery-helper': {
      lines.push(`## ${str(i.concept_name) || `Concept ${n}`}`, '');
      if (str(i.simple_definition)) pushSection(lines, '1. Simple Definition', [str(i.simple_definition)]);
      if (str(i.why_important)) pushSection(lines, '2. Why This Concept Is Important', [str(i.why_important)]);
      if (str(i.prior_knowledge_needed)) pushSection(lines, '3. Prior Knowledge Needed', [str(i.prior_knowledge_needed)]);
      if (str(i.lesson)) pushSection(lines, '4. Step-by-step Explanation', [str(i.lesson)]);
      if (str(i.diagram_suggestion)) pushSection(lines, '5. Diagram / Visualisation Suggestion', [str(i.diagram_suggestion)]);
      if (str(i.real_example)) pushSection(lines, '6. Real-life Examples', [str(i.real_example)]);
      const mis = strArr(i.common_mistakes);
      if (mis.length) pushSection(lines, '7. Common Misconceptions and Corrections', mis.map((x) => `- ${x}`));
      const ccq = strArr(i.concept_check_questions);
      if (ccq.length) pushSection(lines, '8. Concept Check Questions', ccq.map((x) => `- ${x}`));
      const kp = strArr(i.key_points);
      if (kp.length) pushSection(lines, '9. Key Points to Remember', kp.map((x) => `- ${x}`));
      if (str(i.exam_tips)) pushSection(lines, '10. Exam Tips', [str(i.exam_tips)]);
      if (str(i.hots_question)) pushSection(lines, '11. Higher-order Thinking Question', [str(i.hots_question)]);
      if (str(i.self_reflection_prompt)) pushSection(lines, '12. Quick Self-reflection Prompt', [str(i.self_reflection_prompt)]);
      break;
    }
    case 'lesson-planner': {
      lines.push(`## ${str(i.lesson_name || i.title || i.name) || `Lesson ${n}`}`, '');
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, '2. Learning Objectives', lo.map((x) => `- ${x}`));
      const ncf = str(i.ncf_competency_alignment);
      if (ncf) pushSection(lines, '3. NCF Competency / Learning Outcome Alignment', [ncf]);
      if (str(i.prior_knowledge_diagnostic)) pushSection(lines, '4. Prior Knowledge / Diagnostic Question', [str(i.prior_knowledge_diagnostic)]);
      if (str(i.introduction_warmup)) pushSection(lines, '5. Introduction / Warm-up', [str(i.introduction_warmup)]);
      if (str(i.teaching_strategy)) pushSection(lines, '6. Teaching Strategy', [str(i.teaching_strategy)]);
      const act = strArr(i.teaching_activities || i.activities || i.step_by_step_procedure);
      if (act.length) pushSection(lines, '7. Classroom Activities', act.map((x, idx) => `${idx + 1}. ${x}`));
      const tt = strArr(i.teacher_talk_points || i.teacher_instructions);
      if (tt.length) pushSection(lines, '8. Teacher Talk Points', tt.map((x) => `- ${x}`));
      const st = strArr(i.student_tasks || i.student_instructions);
      if (st.length) pushSection(lines, '9. Student Tasks', st.map((x) => `- ${x}`));
      const fq = strArr(i.formative_assessment_questions);
      if (fq.length) pushSection(lines, '10. Formative Assessment Questions', fq.map((x) => `- ${x}`));
      const as = str(i.assessment);
      if (as && !fq.length) pushSection(lines, '10. Formative Assessment Questions', [as]);
      const dp = str(i.differentiation_plan || i.differentiation);
      if (dp) pushSection(lines, '11. Differentiation Plan', [dp]);
      if (str(i.homework_practice)) pushSection(lines, '12. Homework / Practice', [str(i.homework_practice)]);
      const aids = strArr(i.teaching_aids_required || i.materials_required);
      if (aids.length) pushSection(lines, '13. Teaching Aids Required', aids.map((x) => `- ${x}`));
      const closure = str(i.closure_exit_ticket);
      const tl = strArr(i.timeline || i.schedule);
      if (closure || tl.length) {
        const body = closure
          ? [closure, ...(tl.length ? ['', '**Period / time cues:**', ...tl.map((x) => `- ${x}`)] : [])]
          : tl.map((x) => `- ${x}`);
        pushSection(lines, '14. Closure / Exit Ticket', body);
      }
      break;
    }
    case 'homework-creator': {
      lines.push(`## ${str(i.title) || `Homework ${n}`}`, '');
      if (str(i.instructions)) pushSection(lines, '2. Clear Student Instructions', [str(i.instructions)]);
      const pq = strArr(i.practice_questions);
      const qs = pq.length ? pq : strArr(i.questions);
      if (qs.length) pushSection(lines, '3. Practice Questions', qs.map((q, idx) => (typeof q === 'string' ? `${idx + 1}. ${q}` : `${idx + 1}. ${str(q.question)}`)));
      const app = strArr(i.application_tasks);
      if (app.length) pushSection(lines, '4. Application-based Tasks', app.map((x) => `- ${x}`));
      if (str(i.creative_thinking_question)) pushSection(lines, '5. One Creative / Thinking Question', [str(i.creative_thinking_question)]);
      if (str(i.real_life_observation_task)) pushSection(lines, '6. One Real-life Observation Task', [str(i.real_life_observation_task)]);
      if (str(i.challenge_question)) pushSection(lines, '7. Challenge Question', [str(i.challenge_question)]);
      if (str(i.support_hint)) pushSection(lines, '8. Support Hint', [str(i.support_hint)]);
      if (str(i.answer_hints)) pushSection(lines, '9. Answer Hints / Key Points', [str(i.answer_hints)]);
      if (str(i.parent_note)) pushSection(lines, '10. Parent Note', [str(i.parent_note)]);
      break;
    }
    case 'rubrics-evaluation-generator': {
      lines.push(`## ${str(i.title) || `Rubric ${n}`}`, '');
      if (str(i.assessment_purpose)) pushSection(lines, '1. Assessment Purpose', [str(i.assessment_purpose)]);
      if (str(i.competency_assessed)) pushSection(lines, '2. Competency / Learning Outcome Assessed', [str(i.competency_assessed)]);
      if (Array.isArray(i.criteria) && i.criteria.length) {
        lines.push('### 3. Evaluation Rubric with 4 Performance Levels', '');
        i.criteria.forEach((c) => {
          const name = str(c?.name) || 'Criterion';
          const parts = [];
          if (str(c?.excellent)) parts.push(`- Excellent: ${str(c.excellent)}`);
          if (str(c?.good)) parts.push(`- Good: ${str(c.good)}`);
          if (str(c?.satisfactory)) parts.push(`- Satisfactory: ${str(c.satisfactory)}`);
          if (str(c?.needs_improvement)) parts.push(`- Needs Improvement: ${str(c.needs_improvement)}`);
          lines.push(`**${name}**`, '');
          if (parts.length) parts.forEach((p) => lines.push(p));
          lines.push('');
        });
      }
      if (str(i.strengths_observed)) pushSection(lines, '5. Strengths Observed', [str(i.strengths_observed)]);
      if (str(i.areas_for_improvement)) pushSection(lines, '6. Areas for Improvement', [str(i.areas_for_improvement)]);
      if (str(i.teacher_remarks)) pushSection(lines, '7. Teacher Remarks', [str(i.teacher_remarks)]);
      if (str(i.actionable_suggestions)) pushSection(lines, '8. Actionable Improvement Suggestions', [str(i.actionable_suggestions)]);
      if (str(i.parent_friendly_feedback)) pushSection(lines, '9. Parent-friendly Feedback', [str(i.parent_friendly_feedback)]);
      if (str(i.next_step_remedial_enrichment)) pushSection(lines, '10. Next-step Remedial / Enrichment Activity', [str(i.next_step_remedial_enrichment)]);
      break;
    }
    case 'story-passage-creator': {
      lines.push(`## ${str(i.title) || `Story ${n}`}`, '');
      const align =
        str(i.alignment_block) ||
        [
          i.nep_ncf_focus ? `NEP/NCF Focus: ${str(i.nep_ncf_focus)}` : '',
          i.skill_focus ? `Skill Focus: ${str(i.skill_focus)}` : '',
          i.udl_support || i.udl ? `UDL: ${str(i.udl_support || i.udl)}` : '',
        ]
          .filter(Boolean)
          .join(' ');
      if (align) pushSection(lines, '1. Alignment Block', [align]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, '2. Learning Objectives', lo.map((x) => `- ${x}`));
      if (str(i.passage || i.content)) pushSection(lines, '3. Passage', [str(i.passage || i.content)]);
      const voc = strArr(i.vocabulary_support || i.vocabulary);
      if (voc.length) pushSection(lines, '4. Vocabulary Support', voc.map((x) => `- ${x}`));
      const qu = Array.isArray(i.questions) ? i.questions : [];
      if (qu.length) {
        lines.push('### 5. Comprehension and Thinking Questions');
        qu.forEach((q, idx) => lines.push(`${idx + 1}. ${str(q.question || q)}`));
        lines.push('');
      }
      const hints = strArr(i.answer_hints);
      if (hints.length) pushSection(lines, '6. Answer Hints', hints.map((x) => `- ${x}`));
      const diffParts = [];
      if (str(i.differentiation_support)) diffParts.push(`Support: ${str(i.differentiation_support)}`);
      if (str(i.differentiation_extension)) diffParts.push(`Extension: ${str(i.differentiation_extension)}`);
      if (!diffParts.length && str(i.differentiation)) diffParts.push(str(i.differentiation));
      if (diffParts.length) pushSection(lines, '7. Differentiation', diffParts);
      if (str(i.real_life_application || i.real_life_link)) {
        pushSection(lines, '8. Real-life Application', [str(i.real_life_application || i.real_life_link)]);
      }
      if (str(i.reflection_prompt || i.reflection_exit_ticket)) {
        pushSection(lines, '9. Reflection / Exit Ticket', [str(i.reflection_prompt || i.reflection_exit_ticket)]);
      }
      break;
    }
    case 'short-notes-summaries-maker': {
      lines.push(`## ${str(i.concept_name || i.title) || `Notes ${n}`}`, '');
      const align =
        str(i.alignment_block) ||
        [
          i.nep_ncf_focus ? `NEP/NCF Focus: ${str(i.nep_ncf_focus)}` : '',
          i.udl_support || i.udl ? `UDL: ${str(i.udl_support || i.udl)}` : '',
        ]
          .filter(Boolean)
          .join(' ');
      if (align) pushSection(lines, '1. Alignment Block', [align]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, '2. Learning Objectives', lo.map((x) => `- ${x}`));
      if (str(i.short_note_summary || i.summary)) {
        pushSection(lines, '3. Short Note / Summary', [str(i.short_note_summary || i.summary)]);
      }
      const kp = strArr(i.key_points_to_remember || i.key_points || i.keyPoints);
      if (kp.length) pushSection(lines, '4. Key Points to Remember', kp.map((x) => `- ${x}`));
      if (str(i.example)) pushSection(lines, '5. Example', [str(i.example)]);
      if (str(i.common_misconception_correction)) {
        pushSection(lines, '6. Common Misconception and Correction', [str(i.common_misconception_correction)]);
      }
      const qc = strArr(i.quick_check_questions);
      if (qc.length) {
        lines.push('### 7. Quick Check Questions');
        qc.forEach((q, idx) => lines.push(`${idx + 1}. ${q}`));
        lines.push('');
      }
      const diffParts = [];
      if (str(i.differentiation_support)) diffParts.push(`Support: ${str(i.differentiation_support)}`);
      if (str(i.differentiation_extension)) diffParts.push(`Extension: ${str(i.differentiation_extension)}`);
      if (diffParts.length) pushSection(lines, '8. Differentiation', diffParts);
      if (str(i.real_life_application || i.real_life_link)) {
        pushSection(lines, '9. Real-life Application', [str(i.real_life_application || i.real_life_link)]);
      }
      if (str(i.reflection_exit_ticket || i.reflection_prompt)) {
        pushSection(lines, '10. Reflection / Exit Ticket', [str(i.reflection_exit_ticket || i.reflection_prompt)]);
      }
      break;
    }
    case 'flashcard-generator':
      return [];
    case 'smart-study-guide-generator': {
      lines.push(`## ${str(i.title) || `Study Guide ${n}`}`, '');
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, '1. Learning Objectives', lo.map((x) => `- ${x}`));
      const kc = Array.isArray(i.key_concepts) ? i.key_concepts : [];
      if (kc.length) {
        lines.push('### 2. Key Concepts');
        kc.forEach((c, idx) => {
          const row = c && typeof c === 'object' ? c : { name: String(c) };
          lines.push(`${idx + 1}. **${str(row.name || row.concept)}** — ${str(row.explanation)}`);
        });
        lines.push('');
      }
      const fm = Array.isArray(i.formulas) ? i.formulas : [];
      if (fm.length) {
        lines.push('### 3. Formulas and Rules');
        fm.forEach((f, idx) => {
          const row = f && typeof f === 'object' ? f : { formula: String(f) };
          lines.push(`${idx + 1}. ${str(row.name)}: ${str(row.formula)}${row.note ? ` (${str(row.note)})` : ''}`);
        });
        lines.push('');
      }
      const chk = strArr(i.revision_checklist || i.checklist);
      if (chk.length) pushSection(lines, '4. Revision Checklist', chk.map((x) => `- ${x}`));
      const tips = strArr(i.study_tips || i.tips);
      if (tips.length) pushSection(lines, '5. Study Tips', tips.map((x) => `- ${x}`));
      const rev = strArr(i.quick_review || i.review_points);
      if (rev.length) pushSection(lines, '6. Quick Review', rev.map((x) => `- ${x}`));
      break;
    }
    case 'concept-breakdown-explainer': {
      lines.push(`## ${str(i.concept_name || i.title) || `Concept ${n}`}`, '');
      if (str(i.simple_explanation || i.explanation)) {
        pushSection(lines, '1. Simple Explanation', [str(i.simple_explanation || i.explanation)]);
      }
      const steps = strArr(i.breakdown_steps || i.steps);
      if (steps.length) pushSection(lines, '2. Step-by-step Breakdown', steps.map((x, idx) => `${idx + 1}. ${x}`));
      const ex = strArr(i.examples);
      if (ex.length) pushSection(lines, '3. Examples', ex.map((x) => `- ${x}`));
      const misc = strArr(i.common_misconceptions || i.misconceptions);
      if (misc.length) pushSection(lines, '4. Common Misconceptions', misc.map((x) => `- ${x}`));
      const qc = strArr(i.quick_check_questions);
      if (qc.length) {
        lines.push('### 5. Quick Check');
        qc.forEach((q, idx) => lines.push(`${idx + 1}. ${q}`));
        lines.push('');
      }
      break;
    }
    case 'smart-qa-practice-generator':
    case 'quick-assignment-builder': {
      const qText = str(i.question);
      if (qText) {
        lines.push(`### Q${n}. ${qText}`, '');
        if (str(i.answer)) pushSection(lines, 'Answer', [str(i.answer)]);
        if (str(i.step_by_step_answer)) pushSection(lines, 'Step-by-step', [str(i.step_by_step_answer)]);
        if (str(i.tip)) pushSection(lines, 'Tip', [str(i.tip)]);
        if (str(i.marks)) pushSection(lines, 'Marks', [String(i.marks)]);
      } else {
        lines.push(`## ${str(i.title || i.assignment_title) || `Item ${n}`}`, '');
        if (str(i.instructions)) pushSection(lines, 'Instructions', [str(i.instructions)]);
        if (str(i.marking_criteria)) pushSection(lines, 'Marking Criteria', [str(i.marking_criteria)]);
      }
      break;
    }
    case 'chapter-summary-creator': {
      lines.push(`## ${str(i.chapter_title || i.title) || `Chapter ${n}`}`, '');
      if (str(i.summary || i.chapter_summary)) pushSection(lines, '1. Summary', [str(i.summary || i.chapter_summary)]);
      const kt = strArr(i.key_takeaways || i.takeaways);
      if (kt.length) pushSection(lines, '2. Key Takeaways', kt.map((x) => `- ${x}`));
      const rp = strArr(i.review_points || i.quick_review);
      if (rp.length) pushSection(lines, '3. Quick Review Points', rp.map((x) => `- ${x}`));
      break;
    }
    case 'key-points-formula-extractor': {
      lines.push(`## ${str(i.title || i.topic_title) || `Key Points ${n}`}`, '');
      const kp = strArr(i.key_points || i.key_points_to_remember);
      if (kp.length) pushSection(lines, '1. Key Points', kp.map((x) => `- ${x}`));
      const defs = Array.isArray(i.definitions) ? i.definitions : [];
      if (defs.length) {
        lines.push('### 2. Definitions');
        defs.forEach((d, idx) => {
          const row = d && typeof d === 'object' ? d : { definition: String(d) };
          lines.push(`${idx + 1}. **${str(row.term)}** — ${str(row.definition)}`);
        });
        lines.push('');
      }
      const fm = Array.isArray(i.formulas) ? i.formulas : [];
      if (fm.length) {
        lines.push('### 3. Formulas');
        fm.forEach((f, idx) => {
          const row = f && typeof f === 'object' ? f : { formula: String(f) };
          lines.push(`${idx + 1}. ${str(row.name)}: ${str(row.formula)}${row.when_to_use ? ` — ${str(row.when_to_use)}` : ''}`);
        });
        lines.push('');
      }
      break;
    }
    case 'daily-class-plan-maker': {
      lines.push(`## ${str(i.title) || `Day Plan ${n}`}`, '');
      if (str(i.day_period_topic_breakup)) pushSection(lines, '1. Day / Period-wise Topic Break-up', [str(i.day_period_topic_breakup)]);
      const ob = strArr(i.objectives);
      if (ob.length) pushSection(lines, '2. Learning Objective for Each Period', ob.map((x) => `- ${x}`));
      const tm = strArr(i.teaching_methods);
      if (tm.length) pushSection(lines, '3. Teaching Method per Period', tm.map((x) => `- ${x}`));
      const ca = strArr(i.classroom_activity);
      if (ca.length) pushSection(lines, '4. Classroom Activity / Demonstration', ca.map((x) => `- ${x}`));
      if (str(i.exit_ticket)) pushSection(lines, '5. Quick Assessment / Exit Ticket', [str(i.exit_ticket)]);
      if (str(i.differentiated_support)) pushSection(lines, '6. Differentiated Support', [str(i.differentiated_support)]);
      if (str(i.homework_followup)) pushSection(lines, '7. Homework / Follow-up Task', [str(i.homework_followup)]);
      const aids = strArr(i.teaching_aids);
      if (aids.length) pushSection(lines, '8. Required Teaching Aids', aids.map((x) => `- ${x}`));
      if (str(i.teacher_reflection_notes)) pushSection(lines, '9. Teacher Reflection Notes', [str(i.teacher_reflection_notes)]);
      if (Array.isArray(i.time_slots) && i.time_slots.length) {
        lines.push('### Period grid', '| Time | Activity | Type |', '|------|----------|------|');
        i.time_slots.forEach((slot) =>
          lines.push(`| ${str(slot?.time)} | ${str(slot?.activity)} | ${str(slot?.type)} |`),
        );
        lines.push('');
      }
      break;
    }
    default:
      lines.push(`## Item ${n}`, '', str(i.content) || JSON.stringify(i, null, 2));
  }

  return Array.isArray(lines) ? lines : [];
}

/**
 * Serialize format lines to string (non-flashcard tools).
 * @param {string} toolSlug
 * @param {Record<string, unknown>} item
 * @param {number} index
 */
export function formatItemToContentFromTemplate(toolSlug, item, index = 0) {
  const i = item || {};
  if (toolSlug === 'flashcard-generator') {
    const card = {
      front: str(i.front),
      back: str(i.back),
      memory_cue: str(i.memory_cue || i.hint),
      skill_focus: str(i.skill_focus || i.bloom_level),
      example_use: str(i.example_use || i.real_life_link),
      peer_prompt: str(i.peer_prompt),
      reflection: str(i.reflection || i.reflection_prompt || i.self_check),
    };
    const extra = [
      card.memory_cue ? `**Memory Cue:** ${card.memory_cue}` : '',
      card.skill_focus ? `**Skill Focus:** ${card.skill_focus}` : '',
      card.example_use ? `**Example Use:** ${card.example_use}` : '',
      card.peer_prompt ? `**Peer Prompt:** ${card.peer_prompt}` : '',
      card.reflection ? `**Reflection:** ${card.reflection}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const payload = {
      formatted: `**Front:** ${card.front}\n\n**Back:** ${card.back}${extra ? `\n\n${extra}` : ''}`,
      raw: { flashcards: [card] },
    };
    return JSON.stringify(payload);
  }
  const lines = formatItemLinesFromTemplate(toolSlug, item, index);
  return (Array.isArray(lines) ? lines : []).join('\n').trim();
}

export const AI_TOOL_TEMPLATES = TEMPLATES;

export default {
  AI_TOOL_ORDERED_SLUGS,
  DEPRECATED_AI_TOOL_LABELS,
  AI_TOOL_TEMPLATES,
  UNIVERSAL_PEDAGOGY_TAGS,
  UNIVERSAL_SECTION_ORDER,
  COMPULSORY_CONTEXT_FIELDS,
  normalizeAiToolIdentifierKey,
  isDeprecatedAiToolIdentifier,
  isValidAiToolSlug,
  getAiToolTemplate,
  getToolDisplayTitle,
  getContentTypeDefault,
  buildAiGeneratorStructuredPrompt,
  expandStructuredToFormatItems,
  formatStructuredToolOutput,
  buildToolAliasToSlugMap,
  buildStrictOutputHintsMap,
  buildPdfToolConfigMap,
  matchCanonicalHeadingLine,
  getStorageKeysForHeading,
  getSectionFallbackRules,
  formatItemLinesFromTemplate,
  formatItemToContentFromTemplate,
  getToolRegistryMeta,
};
