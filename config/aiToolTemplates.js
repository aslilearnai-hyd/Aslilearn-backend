/**
 * Single source of truth for all 11 AI curriculum tools (NEP / NCF / Bloom / CBE / UDL).
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
]);

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
      { order: 8, id: 'section_e', label: 'Section E: Long Answer / Case-based Questions', universalBlock: 'output', storageKeys: ['section_e_la'] },
      { order: 9, id: 'section_f', label: 'Section F: Competency / Real-life Application Questions', universalBlock: 'realLife', storageKeys: ['section_f_competency'] },
      { order: 10, id: 'answer_key', label: 'Answer Key', universalBlock: 'assessment', storageKeys: ['answer_key', 'answers'] },
      { order: 11, id: 'bloom_tag', label: "Bloom's Level and Difficulty Tag", universalBlock: 'assessment', storageKeys: ['bloom_level', 'difficulty_tag'] },
    ],
    requiredFieldsForPdfExtract: ['question', 'answer'],
    pdfValidationRules: [
      { id: 'questions-nonempty', severity: 'error', description: 'questions[] must be non-empty after sanitize.' },
      { id: 'answer-key-alignment', severity: 'warn', description: 'MCQs with options should have a declared answer.' },
    ],
    parserHints: ['Detect Q1., Q2., or 1), 2) patterns; preserve section labels A/B/C when present.'],
    regenerationRules: { mergePolicy: 'replace', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Worksheet JSON: include worksheet_title, learning_objectives[], instructions, questions[] (typed MCQ/VSA/SA/LA/FIB/competency), answer_key, bloom_level, difficulty_tag. Each question: question_number, type, section, question, options[], answer, explanation, marks.',
      pdfExtractSchema: {
        question_number: 'number',
        type: 'string — MCQ|FIB|VSA|SA|LA|CASE|COMPETENCY',
        section: 'string — A|B|C|D|E|F',
        question: 'string',
        options: ['string'],
        answer: 'string',
        explanation: 'string',
        marks: 'number',
        bloom_level: 'string',
        difficulty: 'string',
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
      { order: 2, id: 'subtopic_link', label: 'Subtopic & Curriculum Link', universalBlock: 'input', storageKeys: ['subtopic_link', 'subtopic'] },
      { order: 3, id: 'genre_purpose', label: 'Genre, Purpose & Reading Level', universalBlock: 'alignment', storageKeys: ['genre_purpose', 'reading_level'] },
      { order: 4, id: 'passage', label: 'Passage / Story Text', universalBlock: 'output', storageKeys: ['passage', 'content'] },
      { order: 5, id: 'vocabulary', label: 'Vocabulary Support', universalBlock: 'differentiation', storageKeys: ['vocabulary', 'vocabulary_support'] },
      { order: 6, id: 'comprehension', label: 'Comprehension Questions', universalBlock: 'assessment', storageKeys: ['questions', 'comprehension_questions'] },
      { order: 7, id: 'moral_values', label: 'Moral / Value-based Discussion', universalBlock: 'alignment', storageKeys: ['moral', 'values_discussion'] },
      { order: 8, id: 'formative', label: 'Formative Check', universalBlock: 'assessment', storageKeys: ['formative_check'] },
      { order: 9, id: 'differentiation', label: 'Differentiation & Scaffolding', universalBlock: 'differentiation', storageKeys: ['differentiation'] },
      { order: 10, id: 'real_life', label: 'Real-life Link', universalBlock: 'realLife', storageKeys: ['real_life_link'] },
      { order: 11, id: 'reflection', label: 'Reflection / Exit Prompt', universalBlock: 'reflection', storageKeys: ['reflection_prompt'] },
    ],
    requiredFieldsForPdfExtract: ['title', 'passage'],
    pdfValidationRules: [{ id: 'passage-length', severity: 'warn', description: 'Passage should be substantive for reading practice.' }],
    parserHints: ['Detect title then prose block; questions as numbered lines or array.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Story JSON: title, passage, vocabulary_support[], questions[], moral/values, formative_check, differentiation, real_life_link, reflection_prompt; align comprehension + value-based learning.',
      pdfExtractSchema: { title: 'string', passage: 'string', questions: ['object'], moral: 'string' },
    },
    sectionFallbackRules: [{ ifEmpty: ['passage'], use: ['content', 'story_text'] }],
  },

  'short-notes-summaries-maker': {
    slug: 'short-notes-summaries-maker',
    title: 'Short Notes & Summaries',
    contentTypeDefault: 'Notes',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'note_title', label: 'Note / Summary Title', universalBlock: 'input', storageKeys: ['title', 'concept_name'] },
      { order: 2, id: 'subtopic', label: 'Subtopic Focus', universalBlock: 'input', storageKeys: ['subtopic'] },
      { order: 3, id: 'revision_scope', label: 'Revision Scope & Exam Weightage Hint', universalBlock: 'alignment', storageKeys: ['revision_scope'] },
      { order: 4, id: 'key_ideas', label: 'Key Ideas (Compressed)', universalBlock: 'output', storageKeys: ['key_points', 'keyPoints', 'headings'] },
      { order: 5, id: 'definitions', label: 'Definitions & Formulas', universalBlock: 'output', storageKeys: ['definitions', 'formulas'] },
      { order: 6, id: 'exam_summary', label: 'Exam Summary / One-page view', universalBlock: 'output', storageKeys: ['exam_summary', 'summary'] },
      { order: 7, id: 'concept_map', label: 'Concept Compression / Map', universalBlock: 'output', storageKeys: ['concept_compression', 'concepts'] },
      { order: 8, id: 'quick_recap', label: 'Quick Recap', universalBlock: 'reflection', storageKeys: ['quick_recap'] },
      { order: 9, id: 'misconceptions', label: 'Common Errors to Avoid', universalBlock: 'differentiation', storageKeys: ['common_errors'] },
      { order: 10, id: 'hots', label: 'HOTS / Application Prompt', universalBlock: 'assessment', storageKeys: ['hots_prompt'] },
      { order: 11, id: 'reflection', label: 'Self-check / Reflection', universalBlock: 'reflection', storageKeys: ['self_check'] },
    ],
    requiredFieldsForPdfExtract: ['concept_name', 'summary'],
    pdfValidationRules: [{ id: 'has-body', severity: 'error', description: 'summary or keyPoints/headings required.' }],
    parserHints: ['Map to concepts[] or { concept_name, summary, key_points[], headings[] }.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Notes JSON: concept_name, summary, key_points[], headings[] with exam-aligned compression, recap, HOTS, self-check.',
      pdfExtractSchema: { concept_name: 'string', summary: 'string', key_points: ['string'], headings: ['object'] },
    },
    sectionFallbackRules: [],
  },

  'flashcard-generator': {
    slug: 'flashcard-generator',
    title: 'Flashcard Generator',
    contentTypeDefault: 'Flashcards',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'deck_title', label: 'Deck / Topic Title', universalBlock: 'input', storageKeys: ['deck_title', 'title'] },
      { order: 2, id: 'subtopic', label: 'Subtopic Tag', universalBlock: 'input', storageKeys: ['topic_tag', 'subtopic'] },
      { order: 3, id: 'front', label: 'Front (Prompt / Cue)', universalBlock: 'output', storageKeys: ['front'] },
      { order: 4, id: 'back', label: 'Back (Response / Definition)', universalBlock: 'output', storageKeys: ['back'] },
      { order: 5, id: 'bloom', label: "Bloom's / Cognitive Level", universalBlock: 'alignment', storageKeys: ['bloom_level'] },
      { order: 6, id: 'hint', label: 'Hint / Scaffolding', universalBlock: 'differentiation', storageKeys: ['hint'] },
      { order: 7, id: 'real_life', label: 'Real-life Link (optional)', universalBlock: 'realLife', storageKeys: ['real_life_link'] },
      { order: 8, id: 'self_check', label: 'Self-check Question', universalBlock: 'reflection', storageKeys: ['self_check'] },
    ],
    requiredFieldsForPdfExtract: ['front', 'back'],
    pdfValidationRules: [{ id: 'front-back', severity: 'error', description: 'Each card needs non-empty front and back.' }],
    parserHints: ['Lines "Front:" / "Back:" or JSON flashcards[].'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Flashcard objects: front, back, type, hint, topic_tag, bloom_level, real_life_link, self_check — for recall, revision, exam prep.',
      pdfExtractSchema: { front: 'string', back: 'string', type: 'string', hint: 'string', topic_tag: 'string', bloom_level: 'string' },
    },
    sectionFallbackRules: [],
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
        'Daily plan JSON: title, objectives[], time_slots[{time,activity,type}], teaching_methods[], classroom_activity[], exit_ticket, differentiated_support, homework_followup, teaching_aids[], teacher_reflection_notes.',
      pdfExtractSchema: { title: 'string', time_slots: [{ time: 'string', activity: 'string', type: 'string' }], objectives: ['string'] },
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
        'Exam items as JSON rows: question_number, section, question, options[], answer, marks, internal_choice_group, blueprint_tag, marking_notes, rubric_hint.',
      pdfExtractSchema: {
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
        },
      ];
    }),
  );
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
    case 'worksheet-mcq-generator':
    case 'exam-question-paper-generator': {
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
        lines.push('### 3. Evaluation Rubric with 4 Performance Levels');
        lines.push('| Criteria | Excellent | Good | Satisfactory | Needs Improvement |');
        lines.push('|----------|-----------|------|--------------|-------------------|');
        i.criteria.forEach((c) =>
          lines.push(
            `| ${str(c?.name)} | ${str(c?.excellent)} | ${str(c?.good)} | ${str(c?.satisfactory)} | ${str(c?.needs_improvement)} |`,
          ),
        );
        lines.push('');
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
      if (str(i.subtopic_link)) pushSection(lines, '2. Subtopic & Curriculum Link', [str(i.subtopic_link)]);
      if (str(i.genre_purpose)) pushSection(lines, '3. Genre, Purpose & Reading Level', [str(i.genre_purpose)]);
      if (str(i.passage || i.content)) pushSection(lines, '4. Passage / Story Text', [str(i.passage || i.content)]);
      const voc = strArr(i.vocabulary_support || i.vocabulary);
      if (voc.length) pushSection(lines, '5. Vocabulary Support', voc.map((x) => `- ${x}`));
      const qu = Array.isArray(i.questions) ? i.questions : [];
      if (qu.length) {
        lines.push('### 6. Comprehension Questions');
        qu.forEach((q, idx) => lines.push(`${idx + 1}. ${str(q.question || q)}`));
        lines.push('');
      }
      if (str(i.moral)) pushSection(lines, '7. Moral / Value-based Discussion', [str(i.moral)]);
      if (str(i.formative_check)) pushSection(lines, '8. Formative Check', [str(i.formative_check)]);
      if (str(i.differentiation)) pushSection(lines, '9. Differentiation & Scaffolding', [str(i.differentiation)]);
      if (str(i.real_life_link)) pushSection(lines, '10. Real-life Link', [str(i.real_life_link)]);
      if (str(i.reflection_prompt)) pushSection(lines, '11. Reflection / Exit Prompt', [str(i.reflection_prompt)]);
      break;
    }
    case 'short-notes-summaries-maker': {
      lines.push(`## ${str(i.concept_name || i.title) || `Notes ${n}`}`, '');
      if (str(i.subtopic)) pushSection(lines, '2. Subtopic Focus', [str(i.subtopic)]);
      if (str(i.revision_scope)) pushSection(lines, '3. Revision Scope & Exam Weightage Hint', [str(i.revision_scope)]);
      const kp = strArr(i.key_points || i.keyPoints);
      if (kp.length) pushSection(lines, '4. Key Ideas (Compressed)', kp.map((x) => `- ${x}`));
      const def = strArr(i.definitions);
      if (def.length) pushSection(lines, '5. Definitions & Formulas', def.map((x) => `- ${x}`));
      if (str(i.exam_summary || i.summary)) pushSection(lines, '6. Exam Summary / One-page view', [str(i.exam_summary || i.summary)]);
      if (str(i.concept_compression)) pushSection(lines, '7. Concept Compression / Map', [str(i.concept_compression)]);
      if (str(i.quick_recap)) pushSection(lines, '8. Quick Recap', [str(i.quick_recap)]);
      const err = strArr(i.common_errors);
      if (err.length) pushSection(lines, '9. Common Errors to Avoid', err.map((x) => `- ${x}`));
      if (str(i.hots_prompt)) pushSection(lines, '10. HOTS / Application Prompt', [str(i.hots_prompt)]);
      if (str(i.self_check)) pushSection(lines, '11. Self-check / Reflection', [str(i.self_check)]);
      break;
    }
    case 'flashcard-generator':
      return [];
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
    const payload = {
      formatted: `**Front:** ${str(i.front)}\n\n**Back:** ${str(i.back)}${i.hint ? `\n\n*Hint: ${str(i.hint)}*` : ''}`,
      raw: {
        flashcards: [
          {
            front: str(i.front),
            back: str(i.back),
            type: str(i.type) || 'fact',
            hint: str(i.hint),
            topic_tag: str(i.topic_tag),
            bloom_level: str(i.bloom_level),
            real_life_link: str(i.real_life_link),
            self_check: str(i.self_check),
          },
        ],
      },
    };
    return JSON.stringify(payload);
  }
  const lines = formatItemLinesFromTemplate(toolSlug, item, index);
  return (Array.isArray(lines) ? lines : []).join('\n').trim();
}

export const AI_TOOL_TEMPLATES = TEMPLATES;

export default {
  AI_TOOL_ORDERED_SLUGS,
  AI_TOOL_TEMPLATES,
  UNIVERSAL_PEDAGOGY_TAGS,
  UNIVERSAL_SECTION_ORDER,
  COMPULSORY_CONTEXT_FIELDS,
  isValidAiToolSlug,
  getAiToolTemplate,
  getToolDisplayTitle,
  getContentTypeDefault,
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
