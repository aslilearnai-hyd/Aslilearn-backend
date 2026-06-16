/**
 * Single source of truth for all 17 AI curriculum tools (NEP / NCF / Bloom / CBE / UDL).
 * Consumed by: Gemini PDF extract, validation, regeneration, formatItemToContent, parsers, UI contracts.
 *
 * @module config/aiToolTemplates
 */

import { sanitizeStudyGuideTitle } from '../services/study-guide-title-utils.js';
import { stripMarkdownSyntax } from '../utils/strip-markdown-syntax.js';

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
  'project-idea-lab',
  'worksheet-mcq-generator',
  'concept-mastery-helper',
  'lesson-planner',
  'study-schedule-maker',
  'homework-creator',
  'rubrics-evaluation-generator',
  'reading-practice-room',
  'story-passage-creator',
  'short-notes-summaries-maker',
  'my-study-decks',
  'flashcard-generator',
  'daily-class-plan-maker',
  'mock-test-builder',
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
    title: 'Activity / Project Generator',
    contentTypeDefault: 'Activity Plan',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Title of Activity / Project', universalBlock: 'output', storageKeys: ['title', 'name'], strictLineRegexes: [/^1\.\s*Title\b/i], fuzzyContains: ['title of activity', 'activity title'] },
      { order: 2, id: 'subtopic_prior', label: 'Subtopic Link and Prior Knowledge Required', universalBlock: 'input', storageKeys: ['subtopic_link_prior_knowledge', 'prior_knowledge', 'subtopic_context'], strictLineRegexes: [/^2\.\s*Subtopic Link/i, /^Subtopic Link and Prior Knowledge/i], fuzzyContains: ['subtopic link', 'prior knowledge required'] },
      { order: 3, id: 'learning_objectives', label: 'Learning Objectives', universalBlock: 'alignment', storageKeys: ['learning_objectives', 'learningObjectives'], strictLineRegexes: [/^3\.\s*Learning Objectives?\b/i, /^2\.\s*Learning Objectives?\b/i], fuzzyContains: ['learning objectives'] },
      { order: 4, id: 'ncf_alignment', label: 'NCF Competency / Learning Outcome Alignment', universalBlock: 'alignment', storageKeys: ['ncf_competency_alignment', 'competencies', 'learning_outcomes'], strictLineRegexes: [/^4\.\s*NCF Competenc/i, /^NCF Competency/i], fuzzyContains: ['ncf competency', 'learning outcome alignment'] },
      { order: 5, id: 'materials', label: 'Materials Required', universalBlock: 'output', storageKeys: ['materials_required', 'materials'], strictLineRegexes: [/^5\.\s*Materials Required\b/i, /^3\.\s*Materials Required\b/i], fuzzyContains: ['materials required'] },
      { order: 6, id: 'procedure', label: 'Step-by-step Procedure', universalBlock: 'output', storageKeys: ['step_by_step_procedure', 'steps', 'procedure'], strictLineRegexes: [/^6\.\s*Step-by-step/i, /^4\.\s*Step-by-step/i], fuzzyContains: ['step-by-step procedure', 'step-by-step'] },
      { order: 7, id: 'teacher_instructions', label: 'Teacher Instructions', universalBlock: 'output', storageKeys: ['teacher_instructions', 'teacherInstructions'], strictLineRegexes: [/teacher instructions/i], fuzzyContains: ['teacher instruction'] },
      { order: 8, id: 'student_instructions', label: 'Student Instructions', universalBlock: 'output', storageKeys: ['student_instructions', 'studentInstructions'], strictLineRegexes: [/student instructions/i], fuzzyContains: ['student instruction'] },
      { order: 9, id: 'differentiation', label: 'Differentiation', universalBlock: 'differentiation', storageKeys: ['differentiation', 'differentiation_plan', 'udl_support'], strictLineRegexes: [/differentiation/i], fuzzyContains: ['differentiation', 'udl'] },
      { order: 10, id: 'assessment_rubric', label: 'Assessment Rubric', universalBlock: 'assessment', storageKeys: ['assessment_criteria_rubric', 'assessmentRubric'], strictLineRegexes: [/assessment.*rubric/i], fuzzyContains: ['assessment rubric', 'rubric', 'criteria'] },
      { order: 11, id: 'expected_outcomes', label: 'Expected Learning Outcomes', universalBlock: 'assessment', storageKeys: ['expected_learning_outcomes', 'expectedLearningOutcomes'], strictLineRegexes: [/expected learning outcomes/i], fuzzyContains: ['expected learning'] },
      { order: 12, id: 'real_life', label: 'Real-life Application', universalBlock: 'realLife', storageKeys: ['real_life_application', 'realLifeApplication'], strictLineRegexes: [/real[-\s]?life application/i], fuzzyContains: ['real-life', 'real life'] },
      { order: 13, id: 'reflection', label: 'Reflection / Exit Ticket', universalBlock: 'reflection', storageKeys: ['reflection_exit_ticket', 'exit_ticket', 'reflection'], strictLineRegexes: [/reflection|exit ticket/i], fuzzyContains: ['reflection', 'exit ticket'] },
    ],
    requiredFieldsForPdfExtract: [
      'title',
      'learning_objectives',
      'materials_required',
      'step_by_step_procedure',
      'teacher_instructions',
      'expected_learning_outcomes',
      'assessment_criteria_rubric',
    ],
    pdfValidationRules: [
      { id: 'has-title', severity: 'error', description: 'Each item must have a non-empty title not equal to a section heading.' },
      { id: 'measurable-objectives', severity: 'warn', description: 'Learning objectives should be measurable (action verbs).' },
      { id: 'assessment-present', severity: 'warn', description: 'Assessment rubric or criteria should be present for formative use.' },
    ],
    parserHints: [
      'Split workbook PDFs on lines matching /^Activity\\s+\\d+/i or /^Variation\\s+\\d+/i before numbered sections.',
      'Keep teacher instructions, student instructions, and step-by-step procedure as separate sections.',
      'Strip page footers like "-- N of M --".',
    ],
    regenerationRules: {
      preservePdfSourcedArrays: true,
      mergePolicy: 'merge',
      allowTemplateRegeneration: true,
    },
    gemini: {
      strictOutputHint:
        'Each object MUST follow the teacher Activity / Project Generator 13-point template: (1) title, (2) subtopic_link_prior_knowledge, (3) learning_objectives[], (4) ncf_competency_alignment, (5) materials_required[], (6) step_by_step_procedure[] (facilitation/teaching steps), (7) teacher_instructions[], (8) student_instructions[], (9) differentiation, (10) assessment_criteria_rubric[], (11) expected_learning_outcomes, (12) real_life_application, (13) reflection_exit_ticket.',
      pdfExtractSchema: {
        sl_no: 'number',
        title: 'string — (1) Title of Activity / Project only',
        subtopic_link_prior_knowledge: 'string — (2)',
        learning_objectives: ['string — (3)'],
        ncf_competency_alignment: 'string | string[] — (4)',
        materials_required: ['string — (5)'],
        step_by_step_procedure: ['string — (6) teaching/facilitation steps'],
        teacher_instructions: ['string — (7)'],
        student_instructions: ['string — (8)'],
        differentiation: 'string | string[] — (9)',
        assessment_criteria_rubric: ['string — (10)'],
        expected_learning_outcomes: 'string — (11)',
        real_life_application: 'string — (12)',
        reflection_exit_ticket: 'string — (13)',
      },
    },
    sectionFallbackRules: [
      {
        ifEmpty: ['teacher_instructions'],
        use: ['differentiation', 'step_by_step_procedure'],
        note: 'Use differentiation or facilitation steps when PDF lacks section 7.',
      },
      { ifEmpty: ['student_instructions'], use: ['step_by_step_procedure'], note: 'Student-facing lines may live in procedure when PDF lacks section 8.' },
      { ifEmpty: ['assessment_criteria_rubric'], use: ['marking_criteria', 'evaluation', 'self_assessment_rubric'] },
      { ifEmpty: ['learning_objectives'], use: ['expected_learning_outcomes'], synthesize: 'split_into_bullets' },
    ],
  },

  'project-idea-lab': {
    slug: 'project-idea-lab',
    title: 'Project Idea Lab',
    contentTypeDefault: 'Activity Plan',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Project / Activity Title', universalBlock: 'output', storageKeys: ['title', 'name'], strictLineRegexes: [/^1\.\s*Title\b/i], fuzzyContains: ['title of activity', 'activity title', 'project title'] },
      { order: 2, id: 'subtopic_prior', label: 'Subtopic Link and Prior Knowledge Required', universalBlock: 'input', storageKeys: ['subtopic_link_prior_knowledge', 'prior_knowledge', 'subtopic_context'], strictLineRegexes: [/subtopic|prior knowledge/i], fuzzyContains: ['prior knowledge', 'subtopic'] },
      { order: 3, id: 'learning_objectives', label: "Learning Objectives - Bloom's Taxonomy Aligned", universalBlock: 'alignment', storageKeys: ['learning_objectives', 'learningObjectives'], strictLineRegexes: [/^2\.\s*Learning Objectives?\b/i], fuzzyContains: ['learning objective'] },
      { order: 4, id: 'ncf_alignment', label: 'NCF Competency / Learning Outcome Alignment', universalBlock: 'alignment', storageKeys: ['ncf_competency_alignment', 'competencies', 'learning_outcomes'], strictLineRegexes: [/ncf|competenc/i], fuzzyContains: ['ncf', 'competency', 'learning outcome'] },
      { order: 5, id: 'materials', label: 'Materials Required', universalBlock: 'output', storageKeys: ['materials_required', 'materials'], strictLineRegexes: [/^3\.\s*Materials Required\b/i], fuzzyContains: ['materials required'] },
      { order: 6, id: 'procedure', label: 'Step-by-step Student Procedure', universalBlock: 'output', storageKeys: ['step_by_step_procedure', 'student_procedure', 'steps'], strictLineRegexes: [/^4\.\s*(?:Step-by-step|Student)/i], fuzzyContains: ['step-by-step', 'student procedure'] },
      { order: 7, id: 'safety_instructions', label: 'Safety and Care Instructions', universalBlock: 'output', storageKeys: ['safety_care_instructions', 'safety_instructions', 'care_instructions'], strictLineRegexes: [/safety|care instructions/i], fuzzyContains: ['safety', 'care instruction'] },
      { order: 8, id: 'observation_table', label: 'Observation / Data Recording Table', universalBlock: 'assessment', storageKeys: ['observation_data_recording_table', 'observation_table', 'data_recording_table'], strictLineRegexes: [/observation|data recording/i], fuzzyContains: ['observation', 'data recording'] },
      { order: 9, id: 'creative_output', label: 'Creative Output / Final Product', universalBlock: 'output', storageKeys: ['creative_output_final_product', 'creative_output', 'final_product'], strictLineRegexes: [/creative output|final product/i], fuzzyContains: ['creative output', 'final product'] },
      { order: 10, id: 'differentiation', label: 'Differentiation: Support and Extension', universalBlock: 'differentiation', storageKeys: ['differentiation_support_extension', 'differentiation', 'differentiation_plan', 'udl_support'], strictLineRegexes: [/differentiation|udl|support|extension/i], fuzzyContains: ['differentiation', 'support', 'extension', 'udl'] },
      { order: 11, id: 'assessment_rubric', label: 'Self-Assessment Rubric', universalBlock: 'assessment', storageKeys: ['self_assessment_rubric', 'assessment_criteria_rubric', 'assessmentRubric'], strictLineRegexes: [/self[-\s]?assessment|rubric/i], fuzzyContains: ['self-assessment rubric', 'assessment rubric', 'rubric'] },
      { order: 12, id: 'expected_outcomes', label: 'Expected Learning Outcomes', universalBlock: 'assessment', storageKeys: ['expected_learning_outcomes', 'expectedLearningOutcomes'], strictLineRegexes: [/expected learning outcomes/i], fuzzyContains: ['expected learning'] },
      { order: 13, id: 'real_life', label: 'Real-life Application', universalBlock: 'realLife', storageKeys: ['real_life_application', 'realLifeApplication'], strictLineRegexes: [/real[-\s]?life application/i], fuzzyContains: ['real-life', 'real life'] },
      { order: 14, id: 'reflection', label: 'Reflection / Exit Ticket', universalBlock: 'reflection', storageKeys: ['reflection_exit_ticket', 'exit_ticket', 'reflection'], strictLineRegexes: [/reflection|exit ticket/i], fuzzyContains: ['reflection', 'exit ticket'] },
    ],
    requiredFieldsForPdfExtract: [
      'title',
      'learning_objectives',
      'materials_required',
      'step_by_step_procedure',
      'safety_care_instructions',
      'expected_learning_outcomes',
      'self_assessment_rubric',
      'real_life_application',
    ],
    pdfValidationRules: [
      { id: 'has-title', severity: 'error', description: 'Each item must have a non-empty title not equal to a section heading.' },
      { id: 'measurable-objectives', severity: 'warn', description: 'Learning objectives should be measurable (action verbs).' },
      { id: 'assessment-present', severity: 'warn', description: 'Self-assessment rubric should be present for student use.' },
    ],
    parserHints: [
      'Split workbook PDFs on lines matching /^Activity\\s+\\d+/i or /^Variation\\s+\\d+/i before numbered sections.',
      'Keep student procedure, safety instructions, and observation table separate.',
      'Strip page footers like "-- N of M --".',
    ],
    regenerationRules: {
      preservePdfSourcedArrays: true,
      mergePolicy: 'merge',
      allowTemplateRegeneration: true,
    },
    gemini: {
      strictOutputHint:
        "Each object MUST follow the Project Idea Lab 14-point template: (1) title, (2) subtopic_link_prior_knowledge, (3) learning_objectives[] (Bloom aligned), (4) ncf_competency_alignment (string or string[]), (5) materials_required[], (6) step_by_step_procedure[] (student procedure), (7) safety_care_instructions[], (8) observation_data_recording_table, (9) creative_output_final_product, (10) differentiation_support_extension (string or string[]), (11) self_assessment_rubric[], (12) expected_learning_outcomes, (13) real_life_application, (14) reflection_exit_ticket.",
      pdfExtractSchema: {
        sl_no: 'number',
        title: 'string — (1) Project / Activity Title only',
        subtopic_link_prior_knowledge: 'string — (2) Subtopic link + prior knowledge',
        learning_objectives: ['string — (3) measurable objectives (Bloom aligned)'],
        ncf_competency_alignment: 'string | string[] — (4) NCF competency / LO alignment',
        materials_required: ['string — (5)'],
        step_by_step_procedure: ['string — (6) student-facing steps'],
        safety_care_instructions: ['string — (7)'],
        observation_data_recording_table: 'string — (8)',
        creative_output_final_product: 'string — (9)',
        differentiation_support_extension: 'string | string[] — (10)',
        self_assessment_rubric: ['string — (11) rubric lines'],
        expected_learning_outcomes: 'string — (12)',
        real_life_application: 'string — (13)',
        reflection_exit_ticket: 'string — (14)',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['step_by_step_procedure'], use: ['student_instructions', 'description'], note: 'Use student instructions only as student procedure.' },
      { ifEmpty: ['safety_care_instructions'], use: ['safety_instructions', 'care_instructions'] },
      { ifEmpty: ['self_assessment_rubric'], use: ['assessment_criteria_rubric', 'marking_criteria'] },
      { ifEmpty: ['differentiation_support_extension'], use: ['differentiation', 'differentiation_plan', 'udl_support'] },
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
    parserHints: [
      'PDF upload uses zero-LLM regex path only (pdf-worksheet-extract.js → pdf-canonical-extract.js). No Gemini classify/extract on upload.',
      'Detect Q1., Q2., 1., 1), 1 Which (no dot), section headers Section A–E; dense single-line PDFs auto-split.',
      'Strip page footers (-- N of M --), NEP-NCF chrome, merged section tails; dedupe by section+text+answer+options.',
      'Answer Key section 9: auto-built A–E grouped from per-question answers; see ai-tools/AI-PDF-UPLOAD.md.',
    ],
    regenerationRules: { mergePolicy: 'replace', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Return ONE JSON object per worksheet using strict section-wise format only: title, learning_objectives[], instructions, sections[{sectionName,questions[]}], answer_key, bloom_level, difficulty_tag. Sections MUST be exactly Section A (MCQs), B (Fill in the Blanks), C (Very Short Answer), D (Short Answer), E (Competency/Real-life). Do not merge sections, do not skip headings, and keep each question under its correct section. Section D and Section E must each contain at least one complete question. Section E questions must be real-life/application/case/scenario style prompts (not answer-key fragments, keywords, or one-line term lists). Flat rows (fallback): question_number, type, section, question, options[], answer, marks.',
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
        'Return structuredContent as { "concepts": [ { ...one or more concept objects with all 12 canonical sections } ] }. Use concept_name + lesson (step-by-step explanation) at minimum for each concept; populate list fields where applicable.',
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
      /** AI Generator prompt schema (topic + sub-topic only — no separate concept field). */
      generatorStructuredSchema: {
        concepts: [
          {
            concept_name: 'string — use the selected sub-topic (or topic if no sub-topic)',
            simple_definition: 'string',
            why_important: 'string',
            prior_knowledge_needed: 'string',
            lesson: 'string — step-by-step explanation for that sub-topic',
            diagram_suggestion: 'string',
            real_example: 'string',
            common_mistakes: ['string'],
            concept_check_questions: ['string'],
            key_points: ['string'],
            exam_tips: 'string',
            hots_question: 'string',
            self_reflection_prompt: 'string',
          },
        ],
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
      {
        order: 4,
        id: 'prior_knowledge',
        label: 'Prior Knowledge / Diagnostic Question',
        universalBlock: 'input',
        storageKeys: ['prior_knowledge_diagnostic', 'prior_knowledge', 'diagnostic_question'],
      },
      { order: 5, id: 'introduction', label: 'Introduction / Warm-up', universalBlock: 'output', storageKeys: ['introduction_warmup', 'warmup', 'warm_up'] },
      { order: 6, id: 'teaching_strategy', label: 'Teaching Strategy', universalBlock: 'output', storageKeys: ['teaching_strategy', 'pedagogy', 'methodology_summary'] },
      {
        order: 7,
        id: 'classroom_activities',
        label: 'Classroom Activities',
        universalBlock: 'output',
        storageKeys: ['teaching_activities', 'activities', 'classroom_activities', 'lesson_activities'],
      },
      {
        order: 8,
        id: 'teacher_talk',
        label: 'Teacher Talk Points',
        universalBlock: 'output',
        storageKeys: ['teacher_talk_points', 'teacher_instructions'],
      },
      { order: 9, id: 'student_tasks', label: 'Student Tasks', universalBlock: 'output', storageKeys: ['student_tasks', 'student_instructions'] },
      {
        order: 10,
        id: 'formative_assessment',
        label: 'Formative Assessment Questions',
        universalBlock: 'assessment',
        storageKeys: ['formative_assessment_questions', 'formative_questions'],
      },
      {
        order: 11,
        id: 'differentiation',
        label: 'Differentiation Plan',
        universalBlock: 'differentiation',
        storageKeys: ['differentiation_plan', 'differentiation', 'udl_support'],
      },
      { order: 12, id: 'homework', label: 'Homework / Practice', universalBlock: 'output', storageKeys: ['homework_practice', 'homework', 'practice'] },
      {
        order: 13,
        id: 'teaching_aids',
        label: 'Teaching Aids Required',
        universalBlock: 'output',
        storageKeys: ['teaching_aids_required', 'materials_required', 'materials', 'teaching_aids'],
      },
      {
        order: 14,
        id: 'closure',
        label: 'Closure / Exit Ticket',
        universalBlock: 'reflection',
        storageKeys: ['closure_exit_ticket', 'exit_ticket', 'reflection_exit_ticket'],
      },
    ],
    requiredFieldsForPdfExtract: ['lesson_name', 'learning_objectives', 'teaching_activities'],
    pdfValidationRules: [
      { id: 'body-present', severity: 'warn', description: 'At least one of objectives, activities, timeline, or assessment should be non-trivial.' },
    ],
    parserHints: [
      '14-section teacher lesson plan; split on Variation N or Item N; keep teacher talk points separate from student tasks.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Teacher lesson plan JSON: lesson_name, learning_objectives[], ncf_competency_alignment, prior_knowledge_diagnostic, introduction_warmup, teaching_strategy, teaching_activities[], teacher_talk_points[], student_tasks[], formative_assessment_questions[], differentiation_plan, homework_practice, teaching_aids_required[], closure_exit_ticket.',
      pdfExtractSchema: {
        sl_no: 'number',
        lesson_name: 'string — (1) Lesson Title',
        learning_objectives: ['string — (2)'],
        ncf_competency_alignment: 'string | string[] — (3)',
        prior_knowledge_diagnostic: 'string — (4)',
        introduction_warmup: 'string — (5)',
        teaching_strategy: 'string — (6)',
        teaching_activities: ['string — (7) classroom activities'],
        teacher_talk_points: ['string — (8)'],
        student_tasks: ['string — (9)'],
        formative_assessment_questions: ['string — (10)'],
        differentiation_plan: 'string — (11)',
        homework_practice: 'string — (12)',
        teaching_aids_required: ['string — (13)'],
        closure_exit_ticket: 'string — (14)',
        timeline: ['string — optional period breakdown'],
        time_slots: [{ time: 'string', activity: 'string' }],
        assessment: 'string — optional summary assessment',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['teaching_activities'], use: ['activities', 'procedure', 'lesson_procedure', 'classroom_activities'] },
      { ifEmpty: ['introduction_warmup'], use: ['warmup', 'warm_up', 'teaching_strategy', 'teaching_activities'] },
      { ifEmpty: ['teaching_strategy'], use: ['pedagogy', 'methodology_summary', 'introduction_warmup', 'teaching_activities'] },
      { ifEmpty: ['teacher_talk_points'], use: ['teacher_instructions', 'teaching_activities'] },
      { ifEmpty: ['student_tasks'], use: ['student_instructions', 'teaching_activities', 'homework_practice'] },
      { ifEmpty: ['formative_assessment_questions'], use: ['assessment', 'formative_questions'], synthesize: 'split_into_bullets' },
      { ifEmpty: ['homework_practice'], use: ['homework', 'practice'] },
      { ifEmpty: ['teaching_aids_required'], use: ['materials_required', 'materials', 'teaching_aids'] },
      { ifEmpty: ['timeline'], use: ['time_slots'], synthesize: 'from_time_slots' },
    ],
  },

  'study-schedule-maker': {
    slug: 'study-schedule-maker',
    title: 'Study Schedule Maker',
    contentTypeDefault: 'Study Schedule',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      {
        order: 1,
        id: 'schedule_title',
        label: 'Study Schedule Title',
        universalBlock: 'input',
        storageKeys: ['study_schedule_title', 'lesson_name', 'title', 'name'],
      },
      {
        order: 2,
        id: 'study_goal',
        label: 'Study Goal and Subtopic Link',
        universalBlock: 'input',
        storageKeys: ['study_goal_subtopic_link', 'subtopic_link', 'topic'],
      },
      {
        order: 3,
        id: 'prior_readiness',
        label: 'Prior Knowledge and Readiness Check',
        universalBlock: 'input',
        storageKeys: ['prior_knowledge_readiness_check', 'prior_knowledge_diagnostic', 'diagnostic_question'],
      },
      {
        order: 4,
        id: 'learning_objectives',
        label: "Learning Objectives - Bloom's Taxonomy Aligned",
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      {
        order: 5,
        id: 'ncf_alignment',
        label: 'NCF Competency / Learning Outcome Alignment',
        universalBlock: 'alignment',
        storageKeys: ['ncf_competency_alignment', 'competencies'],
      },
      {
        order: 6,
        id: 'study_plan_table',
        label: 'Study Plan Table',
        universalBlock: 'output',
        storageKeys: ['study_plan_table', 'timeline', 'time_slots', 'schedule'],
      },
      {
        order: 7,
        id: 'concept_slot',
        label: 'Concept Learning Slot',
        universalBlock: 'output',
        storageKeys: ['concept_learning_slot', 'introduction_warmup', 'teaching_strategy', 'teaching_activities'],
      },
      {
        order: 8,
        id: 'practice_slot',
        label: 'Practice Slot',
        universalBlock: 'output',
        storageKeys: ['practice_slot', 'homework_practice', 'student_tasks'],
      },
      {
        order: 9,
        id: 'breaks_tips',
        label: 'Breaks and Focus Tips',
        universalBlock: 'differentiation',
        storageKeys: ['breaks_focus_tips', 'warmup'],
      },
      {
        order: 10,
        id: 'self_assessment',
        label: 'Self-Assessment Checkpoint',
        universalBlock: 'assessment',
        storageKeys: ['self_assessment_checkpoint', 'formative_assessment_questions', 'assessment'],
      },
      {
        order: 11,
        id: 'support_extension',
        label: 'Support and Extension Plan',
        universalBlock: 'differentiation',
        storageKeys: ['support_extension_plan', 'differentiation_plan', 'differentiation'],
      },
      {
        order: 12,
        id: 'expected_outcomes',
        label: 'Expected Learning Outcomes',
        universalBlock: 'output',
        storageKeys: ['expected_learning_outcomes', 'learning_outcomes'],
      },
      {
        order: 13,
        id: 'reflection',
        label: 'Reflection / Exit Ticket',
        universalBlock: 'reflection',
        storageKeys: ['reflection_exit_ticket', 'closure_exit_ticket'],
      },
    ],
    requiredFieldsForPdfExtract: ['study_schedule_title', 'lesson_name'],
    pdfValidationRules: [
      { id: 'body-present', severity: 'warn', description: 'At least one of objectives, study plan table, concept slot, or practice slot should be non-trivial.' },
    ],
    parserHints: [
      '13-section Study Schedule Maker; split on Variation N or Item N; map study_plan_table from timeline/time_slots rows.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Study schedule JSON: study_schedule_title, study_goal_subtopic_link, prior_knowledge_readiness_check, learning_objectives[], ncf_competency_alignment, study_plan_table[], concept_learning_slot, practice_slot, breaks_focus_tips, self_assessment_checkpoint, support_extension_plan, expected_learning_outcomes[], reflection_exit_ticket.',
      pdfExtractSchema: {
        sl_no: 'number',
        study_schedule_title: 'string',
        lesson_name: 'string',
        study_goal_subtopic_link: 'string',
        prior_knowledge_readiness_check: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string | string[]',
        study_plan_table: ['string'],
        concept_learning_slot: 'string',
        practice_slot: 'string',
        breaks_focus_tips: 'string',
        self_assessment_checkpoint: 'string',
        support_extension_plan: 'string',
        expected_learning_outcomes: ['string'],
        reflection_exit_ticket: 'string',
        timeline: ['string'],
        time_slots: [{ time: 'string', activity: 'string' }],
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['study_plan_table'], use: ['timeline', 'teaching_activities'], synthesize: 'number_from_activities' },
      { ifEmpty: ['study_schedule_title'], use: ['lesson_name', 'title'] },
      { ifEmpty: ['prior_knowledge_readiness_check'], use: ['prior_knowledge_diagnostic'] },
      { ifEmpty: ['reflection_exit_ticket'], use: ['closure_exit_ticket'] },
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
      strictOutputHint:
        'Rubric JSON MUST populate ALL 10 canonical sections as non-empty strings. criteria[] MUST have at least 3 criteria; EACH criterion MUST include name, excellent, good, satisfactory, and needs_improvement (four performance levels). Also require grading_criteria, strengths_observed, areas_for_improvement, teacher_remarks, actionable_suggestions, parent_friendly_feedback, and next_step_remedial_enrichment. Do not omit Section 3 rubric grid, Section 4 grading, Section 8 actionable suggestions, or Section 10 next-step activity.',
      pdfExtractSchema: {
        title: 'string',
        assessment_purpose: 'string',
        competency_assessed: 'string',
        criteria: [
          {
            name: 'string',
            excellent: 'string',
            good: 'string',
            satisfactory: 'string',
            needs_improvement: 'string',
          },
        ],
        grading_criteria: 'string',
        strengths_observed: 'string',
        areas_for_improvement: 'string',
        teacher_remarks: 'string',
        actionable_suggestions: 'string',
        parent_friendly_feedback: 'string',
        next_step_remedial_enrichment: 'string',
      },
      generatorStructuredSchema: {
        title: 'string',
        assessment_purpose: 'string',
        competency_assessed: 'string',
        criteria: [
          {
            name: 'string',
            excellent: 'string',
            good: 'string',
            satisfactory: 'string',
            needs_improvement: 'string',
          },
        ],
        grading_criteria: 'string',
        strengths_observed: 'string',
        areas_for_improvement: 'string',
        teacher_remarks: 'string',
        actionable_suggestions: 'string',
        parent_friendly_feedback: 'string',
        next_step_remedial_enrichment: 'string',
      },
    },
    sectionFallbackRules: [],
  },

  'reading-practice-room': {
    slug: 'reading-practice-room',
    title: 'Reading Practice Room',
    contentTypeDefault: 'Reading Practice',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'reading_practice_title', label: 'Reading Practice Title', universalBlock: 'input', storageKeys: ['reading_practice_title', 'title'] },
      {
        order: 2,
        id: 'subtopic_prior',
        label: 'Subtopic Link and Prior Knowledge Required',
        universalBlock: 'input',
        storageKeys: ['subtopic_link_prior_knowledge', 'prior_knowledge', 'subtopic_link'],
      },
      {
        order: 3,
        id: 'learning_objectives',
        label: "Learning Objectives - Bloom's Taxonomy Aligned",
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      {
        order: 4,
        id: 'ncf_alignment',
        label: 'NCF Competency / Learning Outcome Alignment',
        universalBlock: 'alignment',
        storageKeys: ['ncf_competency_alignment', 'competencies', 'learning_outcomes'],
      },
      {
        order: 5,
        id: 'vocabulary_warmup',
        label: 'Vocabulary Warm-up',
        universalBlock: 'differentiation',
        storageKeys: ['vocabulary_warmup', 'vocabulary_support', 'vocabulary'],
      },
      { order: 6, id: 'passage', label: 'Passage / Story', universalBlock: 'output', storageKeys: ['passage', 'content', 'story_text'] },
      {
        order: 7,
        id: 'read_recall',
        label: 'Read and Recall Questions',
        universalBlock: 'assessment',
        storageKeys: ['read_and_recall_questions', 'recall_questions'],
      },
      {
        order: 8,
        id: 'think_infer',
        label: 'Think and Infer Questions',
        universalBlock: 'assessment',
        storageKeys: ['think_and_infer_questions', 'infer_questions'],
      },
      {
        order: 9,
        id: 'apply_connect',
        label: 'Apply and Connect Questions',
        universalBlock: 'assessment',
        storageKeys: ['apply_and_connect_questions', 'connect_questions'],
      },
      {
        order: 10,
        id: 'vocabulary_practice',
        label: 'Vocabulary Practice',
        universalBlock: 'assessment',
        storageKeys: ['vocabulary_practice'],
      },
      {
        order: 11,
        id: 'answer_key',
        label: 'Answer Key / Suggested Responses',
        universalBlock: 'assessment',
        storageKeys: ['answer_key_suggested_responses', 'answer_hints', 'answer_key'],
      },
      {
        order: 12,
        id: 'expected_outcomes',
        label: 'Expected Learning Outcomes',
        universalBlock: 'output',
        storageKeys: ['expected_learning_outcomes'],
      },
      {
        order: 13,
        id: 'reflection',
        label: 'Reflection / Exit Ticket',
        universalBlock: 'reflection',
        storageKeys: ['reflection_exit_ticket', 'reflection_prompt'],
      },
    ],
    requiredFieldsForPdfExtract: ['title', 'passage'],
    pdfValidationRules: [{ id: 'passage-length', severity: 'warn', description: 'Passage should be substantive for reading practice.' }],
    parserHints: [
      '13-section Reading Practice Room format; English and Hindi subjects only.',
      'Split questions into read_and_recall, think_and_infer, apply_and_connect when PDF section headings indicate type.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'One JSON object per reading practice item: reading_practice_title (or title), subtopic_link_prior_knowledge, learning_objectives[], ncf_competency_alignment, vocabulary_warmup[], passage, read_and_recall_questions[], think_and_infer_questions[], apply_and_connect_questions[], vocabulary_practice[], answer_key_suggested_responses[], expected_learning_outcomes, reflection_exit_ticket.',
      pdfExtractSchema: {
        reading_practice_title: 'string',
        title: 'string',
        subtopic_link_prior_knowledge: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string',
        vocabulary_warmup: ['string'],
        passage: 'string',
        read_and_recall_questions: ['string'],
        think_and_infer_questions: ['string'],
        apply_and_connect_questions: ['string'],
        vocabulary_practice: ['string'],
        answer_key_suggested_responses: ['string'],
        expected_learning_outcomes: ['string'],
        reflection_exit_ticket: 'string',
        questions: ['string'],
        bloom_level: 'string',
        difficulty_level: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['passage'], use: ['content', 'story_text'] },
      { ifEmpty: ['reading_practice_title'], use: ['title'] },
      { ifEmpty: ['vocabulary_warmup'], use: ['vocabulary_support', 'vocabulary'] },
      { ifEmpty: ['read_and_recall_questions'], use: ['questions'] },
      { ifEmpty: ['think_and_infer_questions'], use: ['questions'] },
      { ifEmpty: ['apply_and_connect_questions'], use: ['questions'] },
      { ifEmpty: ['answer_key_suggested_responses'], use: ['answer_hints'] },
      { ifEmpty: ['ncf_competency_alignment'], use: ['alignment_block', 'nep_ncf_focus'] },
      { ifEmpty: ['reflection_exit_ticket'], use: ['reflection_prompt'] },
    ],
  },

  'story-passage-creator': {
    slug: 'story-passage-creator',
    title: 'Story and Passage Creator',
    contentTypeDefault: 'Story',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'story_title', label: 'Story / Passage Title', universalBlock: 'input', storageKeys: ['title', 'story_title', 'passage_title'] },
      {
        order: 2,
        id: 'topic_subtopic',
        label: 'Topic and Subtopic Connection',
        universalBlock: 'input',
        storageKeys: ['topic_subtopic_connection', 'topic_and_subtopic_connection', 'subtopic_link'],
      },
      {
        order: 3,
        id: 'prior_knowledge',
        label: 'Prior Knowledge Required',
        universalBlock: 'input',
        storageKeys: ['prior_knowledge_required', 'prior_knowledge'],
      },
      {
        order: 4,
        id: 'learning_objectives',
        label: "Learning Objectives – Bloom's Taxonomy Aligned",
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      {
        order: 5,
        id: 'ncf_alignment',
        label: 'NCF Competency / Learning Outcome Alignment',
        universalBlock: 'alignment',
        storageKeys: ['ncf_competency_alignment', 'competencies', 'learning_outcomes'],
      },
      {
        order: 6,
        id: 'vocabulary_warmup',
        label: 'Vocabulary Warm-up',
        universalBlock: 'differentiation',
        storageKeys: ['vocabulary_warmup', 'vocabulary_support', 'vocabulary'],
      },
      {
        order: 7,
        id: 'pre_reading',
        label: 'Pre-reading Thinking Prompt',
        universalBlock: 'input',
        storageKeys: ['pre_reading_thinking_prompt', 'pre_reading_prompt'],
      },
      {
        order: 8,
        id: 'passage_content',
        label: 'Story / Passage Content',
        universalBlock: 'output',
        storageKeys: ['passage', 'content', 'story_text', 'story_passage_content'],
      },
      {
        order: 9,
        id: 'read_recall',
        label: 'Read and Recall Questions',
        universalBlock: 'assessment',
        storageKeys: ['read_and_recall_questions', 'recall_questions'],
      },
      {
        order: 10,
        id: 'think_infer',
        label: 'Think and Infer Questions',
        universalBlock: 'assessment',
        storageKeys: ['think_and_infer_questions', 'infer_questions'],
      },
      {
        order: 11,
        id: 'apply_connect',
        label: 'Apply and Connect Questions',
        universalBlock: 'assessment',
        storageKeys: ['apply_and_connect_questions', 'connect_questions'],
      },
      {
        order: 12,
        id: 'vocab_grammar',
        label: 'Vocabulary and Grammar Practice',
        universalBlock: 'assessment',
        storageKeys: ['vocabulary_grammar_practice', 'vocabulary_practice'],
      },
      {
        order: 13,
        id: 'creative_response',
        label: 'Creative Response Activity',
        universalBlock: 'output',
        storageKeys: ['creative_response_activity'],
      },
      {
        order: 14,
        id: 'answer_key',
        label: 'Answer Key / Suggested Responses',
        universalBlock: 'assessment',
        storageKeys: ['answer_key_suggested_responses', 'answer_hints', 'answer_key'],
      },
      {
        order: 15,
        id: 'common_mistakes',
        label: 'Common Mistakes to Avoid',
        universalBlock: 'assessment',
        storageKeys: ['common_mistakes_to_avoid'],
      },
      {
        order: 16,
        id: 'differentiation_support',
        label: 'Differentiation Support',
        universalBlock: 'differentiation',
        storageKeys: ['differentiation_support'],
      },
      {
        order: 17,
        id: 'expected_outcomes',
        label: 'Expected Learning Outcomes',
        universalBlock: 'output',
        storageKeys: ['expected_learning_outcomes'],
      },
      {
        order: 18,
        id: 'real_life',
        label: 'Real-life Application',
        universalBlock: 'realLife',
        storageKeys: ['real_life_application', 'real_life_link'],
      },
      {
        order: 19,
        id: 'reflection',
        label: 'Reflection / Exit Ticket',
        universalBlock: 'reflection',
        storageKeys: ['reflection_exit_ticket', 'reflection_prompt', 'reflection'],
      },
    ],
    requiredFieldsForPdfExtract: ['title', 'passage'],
    pdfValidationRules: [{ id: 'passage-length', severity: 'warn', description: 'Passage should be substantive for classroom use.' }],
    parserHints: [
      '19-section Story and Passage Creator format; English and Hindi subjects only.',
      'Split questions into read_and_recall, think_and_infer, apply_and_connect when PDF section headings indicate type.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Story and Passage Creator JSON MUST populate ALL 19 sections as non-empty strings or arrays. passage/story_passage_content MUST be a full classroom-ready story (min ~120 words). Include topic_subtopic_connection, prior_knowledge_required, learning_objectives[] (min 3), ncf_competency_alignment, vocabulary_warmup[] (min 4 words), pre_reading_thinking_prompt, read_and_recall_questions[] (min 2), think_and_infer_questions[] (min 2), apply_and_connect_questions[] (min 2), vocabulary_grammar_practice, creative_response_activity, answer_key_suggested_responses[] (min 2), common_mistakes_to_avoid, differentiation_support, expected_learning_outcomes[] (min 2), real_life_application, reflection_exit_ticket. Do not return title-only or placeholder passage text.',
      pdfExtractSchema: {
        title: 'string',
        topic_subtopic_connection: 'string',
        prior_knowledge_required: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string',
        vocabulary_warmup: ['string'],
        pre_reading_thinking_prompt: 'string',
        passage: 'string',
        story_passage_content: 'string',
        read_and_recall_questions: ['string'],
        think_and_infer_questions: ['string'],
        apply_and_connect_questions: ['string'],
        vocabulary_grammar_practice: 'string',
        creative_response_activity: 'string',
        answer_key_suggested_responses: ['string'],
        common_mistakes_to_avoid: 'string',
        differentiation_support: 'string',
        expected_learning_outcomes: ['string'],
        real_life_application: 'string',
        reflection_exit_ticket: 'string',
        questions: ['string'],
        bloom_level: 'string',
        difficulty_level: 'string',
      },
      generatorStructuredSchema: {
        title: 'string',
        topic_subtopic_connection: 'string',
        prior_knowledge_required: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string',
        vocabulary_warmup: ['string'],
        pre_reading_thinking_prompt: 'string',
        passage: 'string',
        story_passage_content: 'string',
        read_and_recall_questions: ['string'],
        think_and_infer_questions: ['string'],
        apply_and_connect_questions: ['string'],
        vocabulary_grammar_practice: 'string',
        creative_response_activity: 'string',
        answer_key_suggested_responses: ['string'],
        common_mistakes_to_avoid: 'string',
        differentiation_support: 'string',
        expected_learning_outcomes: ['string'],
        real_life_application: 'string',
        reflection_exit_ticket: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['passage'], use: ['content', 'story_text', 'story_passage_content'] },
      { ifEmpty: ['vocabulary_warmup'], use: ['vocabulary_support', 'vocabulary'] },
      { ifEmpty: ['read_and_recall_questions'], use: ['questions', 'comprehension_questions'] },
      { ifEmpty: ['think_and_infer_questions'], use: ['questions'] },
      { ifEmpty: ['apply_and_connect_questions'], use: ['questions'] },
      { ifEmpty: ['vocabulary_grammar_practice'], use: ['vocabulary_practice'] },
      { ifEmpty: ['answer_key_suggested_responses'], use: ['answer_hints', 'answer_key'] },
      { ifEmpty: ['ncf_competency_alignment'], use: ['alignment_block', 'nep_ncf_focus'] },
      { ifEmpty: ['reflection_exit_ticket'], use: ['reflection_prompt', 'reflection'] },
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

  'my-study-decks': {
    slug: 'my-study-decks',
    title: 'My Study Decks',
    contentTypeDefault: 'Flashcards',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'deck_title', label: 'Deck Title', universalBlock: 'input', storageKeys: ['deck_title', 'title'] },
      { order: 2, id: 'subtopic_link_prior_knowledge_required', label: 'Subtopic Link and Prior Knowledge Required', universalBlock: 'input', storageKeys: ['subtopic_link_prior_knowledge_required', 'prior_knowledge_required', 'subtopic_link'] },
      { order: 3, id: 'learning_objectives', label: "Learning Objectives - Bloom's Taxonomy Aligned", universalBlock: 'alignment', storageKeys: ['learning_objectives', 'objectives', 'bloom_objectives'] },
      { order: 4, id: 'ncf_competency_alignment', label: 'NCF Competency / Learning Outcome Alignment', universalBlock: 'alignment', storageKeys: ['ncf_competency_alignment', 'learning_outcome_alignment'] },
      { order: 5, id: 'flashcard_set', label: 'Flashcard Set', universalBlock: 'output', storageKeys: ['cards', 'flashcard_set', 'flashcards'] },
      { order: 6, id: 'difficulty_tag_for_each_card', label: 'Difficulty Tag for Each Card', universalBlock: 'assessment', storageKeys: ['difficulty_tag_for_each_card', 'difficulty_tag', 'difficulty_level'] },
      { order: 7, id: 'memory_hook_quick_tip', label: 'Memory Hook / Quick Tip', universalBlock: 'differentiation', storageKeys: ['memory_hook_quick_tip', 'memory_cue', 'hint'] },
      { order: 8, id: 'self_check_round', label: 'Self-Check Round', universalBlock: 'assessment', storageKeys: ['self_check_round', 'peer_prompt', 'self_check'] },
      { order: 9, id: 'common_mistakes_to_avoid', label: 'Common Mistakes to Avoid', universalBlock: 'differentiation', storageKeys: ['common_mistakes_to_avoid', 'common_mistakes'] },
      { order: 10, id: 'expected_learning_outcomes', label: 'Expected Learning Outcomes', universalBlock: 'output', storageKeys: ['expected_learning_outcomes'] },
      { order: 11, id: 'real_life_application', label: 'Real-life Application', universalBlock: 'realLife', storageKeys: ['real_life_application', 'example_use', 'real_life_link'] },
      { order: 12, id: 'reflection_exit_ticket', label: 'Reflection / Exit Ticket', universalBlock: 'reflection', storageKeys: ['reflection_exit_ticket', 'reflection', 'reflection_prompt'] },
    ],
    requiredFieldsForPdfExtract: ['front', 'back'],
    pdfValidationRules: [{ id: 'front-back', severity: 'error', description: 'Each card needs non-empty front and back.' }],
    parserHints: [
      'Prefer one object per deck: deck_title, subtopic_link_prior_knowledge_required, learning_objectives[], ncf_competency_alignment, flashcard_set/cards[], common_mistakes_to_avoid, expected_learning_outcomes, real_life_application, reflection_exit_ticket.',
      'Each card should include front, back, difficulty_tag_for_each_card (or difficulty_tag), and memory_hook_quick_tip (legacy: memory_cue/hint).',
      'Legacy mappings: peer_prompt/self_check -> self_check_round, example_use/real_life_link -> real_life_application, reflection/reflection_prompt -> reflection_exit_ticket.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'structuredContent MUST follow the 12-point My Study Decks format. Include deck_title, subtopic_link_prior_knowledge_required, learning_objectives[], ncf_competency_alignment, cards (flashcard_set) with non-empty front/back AND on EVERY card: difficulty_tag_for_each_card (Bloom level), memory_hook_quick_tip, self_check_round, plus deck-level common_mistakes_to_avoid, expected_learning_outcomes, real_life_application, reflection_exit_ticket.',
      pdfExtractSchema: {
        deck_title: 'string',
        subtopic_link_prior_knowledge_required: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string',
        common_mistakes_to_avoid: ['string'],
        expected_learning_outcomes: ['string'],
        real_life_application: 'string',
        reflection_exit_ticket: 'string',
        cards: [
          {
            front: 'string',
            back: 'string',
            difficulty_tag_for_each_card: 'string',
            memory_hook_quick_tip: 'string',
            self_check_round: 'string',
          },
        ],
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['memory_hook_quick_tip'], use: ['memory_cue', 'hint'] },
      { ifEmpty: ['difficulty_tag_for_each_card'], use: ['difficulty_tag', 'difficulty_level', 'skill_focus', 'bloom_level'] },
      { ifEmpty: ['self_check_round'], use: ['peer_prompt', 'self_check'] },
      { ifEmpty: ['real_life_application'], use: ['example_use', 'real_life_link', 'example'] },
      { ifEmpty: ['reflection_exit_ticket'], use: ['reflection', 'reflection_prompt', 'self_check'] },
    ],
  },

  'flashcard-generator': {
    slug: 'flashcard-generator',
    title: 'Flash Card Generator',
    contentTypeDefault: 'Flashcards',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      {
        order: 1,
        id: 'context_alignment',
        label: 'Context & Alignment',
        universalBlock: 'input',
        storageKeys: [
          'flashcard_deck_title',
          'deck_title',
          'title',
          'topic',
          'subtopic',
          'topic_and_subtopic_link',
          'class_level',
          'difficulty_level',
          'bloom_level',
        ],
      },
      {
        order: 2,
        id: 'foundations',
        label: 'Foundations',
        universalBlock: 'alignment',
        storageKeys: ['prior_knowledge_required', 'prior_knowledge', 'learning_objectives', 'objectives', 'ncf_competency_alignment', 'learning_outcome_alignment'],
      },
      {
        order: 3,
        id: 'application_hots_card_set',
        label: 'The Card Set: Application & HOTS',
        universalBlock: 'output',
        storageKeys: ['application_hots_cards', 'application_cards', 'cards', 'flashcard_set', 'flashcards'],
      },
      {
        order: 4,
        id: 'study_aids',
        label: 'Study Aids',
        universalBlock: 'differentiation',
        storageKeys: [
          'deck_memory_hook',
          'memory_hook_quick_tip',
          'memory_cue',
          'common_mistakes_to_avoid',
          'common_mistakes',
          'self_check_rapid_recall_round',
          'self_check_round',
        ],
      },
      {
        order: 5,
        id: 'wrap_up',
        label: 'Wrap-Up',
        universalBlock: 'reflection',
        storageKeys: [
          'real_life_connection',
          'real_life_application',
          'differentiation_support',
          'differentiation',
          'reflection_exit_ticket',
          'reflection',
        ],
      },
    ],
    requiredFieldsForPdfExtract: ['front', 'back'],
    pdfValidationRules: [{ id: 'front-back', severity: 'error', description: 'Each card needs non-empty front and back.' }],
    parserHints: [
      'Teacher Flash Card Generator — 5-block deck: (1) Context & Alignment — deck title, topic, subtopic, class, difficulty, Bloom level; (2) Foundations — prior knowledge, learning objectives, NCF competency; (3) The Card Set: Application & HOTS — cards[] with front=Task prompt and back=Solution (min 5); (4) Study Aids — deck_memory_hook, common_mistakes_to_avoid[], self_check_rapid_recall_round; (5) Wrap-Up — real_life_connection, differentiation_support, reflection_exit_ticket.',
      'Put HOTS/application cards in application_hots_cards[] and mirror them in cards[]. Each card may include difficulty_tag_for_each_card and memory_hook_quick_tip.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Return ONE deck object for the 5-block Flash Card Generator format. (1) Context & Alignment: flashcard_deck_title, topic, subtopic, class_level, difficulty_level, bloom_level. (2) Foundations: prior_knowledge_required, learning_objectives[] (min 2), ncf_competency_alignment. (3) The Card Set: application_hots_cards[] AND cards[] — at least 5 items; front = Task (question/prompt), back = Solution (answer with explanation). (4) Study Aids: deck_memory_hook (one mnemonic for the deck), common_mistakes_to_avoid[] (min 2), self_check_rapid_recall_round. (5) Wrap-Up: real_life_connection, differentiation_support, reflection_exit_ticket. Do NOT use term/definition only — use front/back.',
      pdfExtractSchema: {
        flashcard_deck_title: 'string',
        deck_title: 'string',
        topic_and_subtopic_link: 'string',
        prior_knowledge_required: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string',
        concept_and_definition_cards: [{ front: 'string', back: 'string', difficulty_tag_for_each_card: 'string', memory_hook_quick_tip: 'string' }],
        formula_rule_cards: [{ front: 'string', back: 'string', difficulty_tag_for_each_card: 'string', memory_hook_quick_tip: 'string' }],
        application_hots_cards: [{ front: 'string', back: 'string', difficulty_tag_for_each_card: 'string', memory_hook_quick_tip: 'string' }],
        visual_diagram_suggestion_cards: [{ front: 'string', back: 'string', difficulty_tag_for_each_card: 'string', memory_hook_quick_tip: 'string' }],
        cards: [{ front: 'string', back: 'string', difficulty_tag_for_each_card: 'string', memory_hook_quick_tip: 'string', card_category: 'string' }],
        self_check_rapid_recall_round: 'string',
        common_mistakes_to_avoid: ['string'],
        differentiation_support: 'string',
        expected_learning_outcomes: ['string'],
        real_life_connection: 'string',
        reflection_exit_ticket: 'string',
      },
      generatorStructuredSchema: {
        flashcard_deck_title: 'string',
        topic: 'string',
        subtopic: 'string',
        class_level: 'string',
        difficulty_level: 'string',
        bloom_level: 'string',
        prior_knowledge_required: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string',
        application_hots_cards: [
          {
            front: 'string — Task (question or prompt)',
            back: 'string — Solution (answer with explanation)',
            difficulty_tag_for_each_card: 'string',
            memory_hook_quick_tip: 'string',
          },
        ],
        cards: [
          {
            front: 'string — Task',
            back: 'string — Solution',
            difficulty_tag_for_each_card: 'string',
            memory_hook_quick_tip: 'string',
          },
        ],
        deck_memory_hook: 'string',
        common_mistakes_to_avoid: ['string'],
        self_check_rapid_recall_round: 'string',
        real_life_connection: 'string',
        differentiation_support: 'string',
        reflection_exit_ticket: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['flashcard_deck_title'], use: ['deck_title', 'title'] },
      { ifEmpty: ['topic'], use: ['topic_and_subtopic_link', 'subtopic_link'] },
      { ifEmpty: ['subtopic'], use: ['sub_topic', 'subTopic'] },
      { ifEmpty: ['topic_and_subtopic_link'], use: ['subtopic_link', 'topic'] },
      { ifEmpty: ['deck_memory_hook'], use: ['memory_hook_quick_tip', 'memory_cue', 'hint'] },
      { ifEmpty: ['application_hots_cards'], use: ['cards', 'flashcard_set', 'flashcards'] },
      { ifEmpty: ['cards'], use: ['application_hots_cards', 'flashcard_set', 'flashcards'] },
      { ifEmpty: ['memory_hook_quick_tip'], use: ['memory_cue', 'hint'] },
      { ifEmpty: ['difficulty_tag_for_each_card'], use: ['difficulty_tag', 'difficulty_level', 'skill_focus', 'bloom_level'] },
      { ifEmpty: ['self_check_rapid_recall_round'], use: ['self_check_round', 'peer_prompt', 'self_check'] },
      { ifEmpty: ['real_life_connection'], use: ['real_life_application', 'example_use', 'real_life_link'] },
      { ifEmpty: ['reflection_exit_ticket'], use: ['reflection', 'reflection_prompt'] },
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
        'Return ONE Daily Class Plan object with ALL 9 sections populated. Use day_period_topic_breakup, objectives[] (min 2), teaching_methods[] (min 2), classroom_activity[] (min 1), exit_ticket, differentiated_support, homework_followup, teaching_aids[] (min 2), teacher_reflection_notes. Optional time_slots[{time,activity,type}]. This is NOT a 13-section Lesson Planner — do NOT use lesson_name, introduction_warmup, teaching_strategy, ncf_competency_alignment, or formative_questions as primary fields.',
      generatorStructuredSchema: {
        title: 'string',
        day_period_topic_breakup: 'string',
        objectives: ['string'],
        teaching_methods: ['string'],
        classroom_activity: ['string'],
        exit_ticket: 'string',
        differentiated_support: 'string',
        homework_followup: 'string',
        teaching_aids: ['string'],
        teacher_reflection_notes: 'string',
        time_slots: [{ time: 'string', activity: 'string', type: 'string' }],
      },
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

  'mock-test-builder': {
    slug: 'mock-test-builder',
    title: 'Mock Test Builder',
    contentTypeDefault: 'Mock Test',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'mock_test_title', label: 'Mock Test Title', universalBlock: 'input', storageKeys: ['mock_test_title', 'paper_title', 'title'] },
      { order: 2, id: 'test_purpose_subtopic_link', label: 'Test Purpose and Subtopic Link', universalBlock: 'input', storageKeys: ['test_purpose_subtopic_link', 'test_purpose', 'subtopic_link'] },
      { order: 3, id: 'learning_objectives', label: "Learning Objectives - Bloom's Taxonomy Aligned", universalBlock: 'alignment', storageKeys: ['learning_objectives', 'objectives'] },
      { order: 4, id: 'ncf_competency_alignment', label: 'NCF Competency / Learning Outcome Alignment', universalBlock: 'alignment', storageKeys: ['ncf_competency_alignment', 'learning_outcome_alignment'] },
      { order: 5, id: 'instructions', label: 'Instructions for Students', universalBlock: 'input', storageKeys: ['instructions', 'general_instructions'] },
      { order: 6, id: 'question_paper', label: 'Question Paper', universalBlock: 'output', storageKeys: ['question_paper', 'sections', 'section_a', 'section_b', 'section_c', 'section_d', 'section_e'] },
      { order: 7, id: 'answer_key', label: 'Answer Key', universalBlock: 'assessment', storageKeys: ['answer_key'] },
      { order: 8, id: 'step_by_step_solutions_explanations', label: 'Step-by-step Solutions / Explanations', universalBlock: 'assessment', storageKeys: ['step_by_step_solutions_explanations', 'solutions', 'explanations'] },
      { order: 9, id: 'remedial_revision_suggestions', label: 'Remedial Revision Suggestions', universalBlock: 'differentiation', storageKeys: ['remedial_revision_suggestions', 'revision_suggestions', 'remedial_suggestions'] },
      { order: 10, id: 'expected_learning_outcomes', label: 'Expected Learning Outcomes', universalBlock: 'output', storageKeys: ['expected_learning_outcomes'] },
      { order: 11, id: 'real_life_application', label: 'Real-life Application', universalBlock: 'realLife', storageKeys: ['real_life_application', 'real_life_connections'] },
      { order: 12, id: 'reflection_exit_ticket', label: 'Reflection / Exit Ticket', universalBlock: 'reflection', storageKeys: ['reflection_exit_ticket', 'reflection', 'exit_ticket'] },
    ],
    requiredFieldsForPdfExtract: ['question', 'answer'],
    pdfValidationRules: [{ id: 'answer-key', severity: 'warn', description: 'Answer key should align with all sections.' }],
    parserHints: ['12-section mock test format with question paper, answer key, solutions, remedial suggestions, outcomes, real-life application, and reflection.'],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        "Return ONE JSON object for Mock Test Builder in this fixed 12-heading format: mock_test_title, test_purpose_subtopic_link, learning_objectives[], ncf_competency_alignment, instructions, question_paper (or sections[] / section_a..section_e), answer_key, step_by_step_solutions_explanations, remedial_revision_suggestions[], expected_learning_outcomes[], real_life_application, reflection_exit_ticket. REQUIRED: include at least 8 numbered questions across section_a..section_e (preferred) or sections[] with sectionName + questions[] — each question object MUST have question (string), and options[]/answer/marks when applicable. For MCQs (especially Section A), options[] MUST be exactly four strings labeled A) …, B) …, C) …, D) … and answer must be the correct letter or full labeled option. Do NOT return question_paper as prose-only without structured question arrays. Do NOT include performance_self_analysis_table.",
      pdfExtractSchema: {
        mock_test_title: 'string',
        test_purpose_subtopic_link: 'string',
        learning_objectives: ['string'],
        ncf_competency_alignment: 'string',
        paper_title: 'string',
        title: 'string',
        instructions: 'string',
        question_paper: 'string',
        section_a: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_b: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_c: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_d: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_e: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
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
        step_by_step_solutions_explanations: 'string',
        remedial_revision_suggestions: ['string'],
        expected_learning_outcomes: ['string'],
        real_life_application: 'string',
        reflection_exit_ticket: 'string',
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

  'exam-question-paper-generator': {
    slug: 'exam-question-paper-generator',
    title: 'Exam Question Paper Generator',
    contentTypeDefault: 'Exam Paper',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'paper_title', label: 'Paper Title and General Instructions', universalBlock: 'input', storageKeys: ['paper_title', 'title', 'instructions'] },
      { order: 2, id: 'blueprint', label: 'Blueprint / Design Grid', universalBlock: 'alignment', storageKeys: ['blueprint', 'design_grid', 'blueprint_grid'] },
      { order: 3, id: 'section_a', label: 'Section A: MCQs', universalBlock: 'output', storageKeys: ['section_a'] },
      { order: 4, id: 'section_b', label: 'Section B: Very Short Answer Questions', universalBlock: 'output', storageKeys: ['section_b'] },
      { order: 5, id: 'section_c', label: 'Section C: Short Answer Questions', universalBlock: 'output', storageKeys: ['section_c'] },
      { order: 6, id: 'section_d', label: 'Section D: Long Answer Questions', universalBlock: 'output', storageKeys: ['section_d'] },
      { order: 7, id: 'section_e', label: 'Section E: Case-based / Competency Questions', universalBlock: 'output', storageKeys: ['section_e'] },
      { order: 8, id: 'internal_choices', label: 'Internal Choices', universalBlock: 'assessment', storageKeys: ['internal_choices', 'internal_choice'] },
      { order: 9, id: 'answer_key', label: 'Complete Answer Key', universalBlock: 'assessment', storageKeys: ['answer_key', 'complete_answer_key'] },
      { order: 10, id: 'marking_scheme', label: 'Detailed Marking Scheme', universalBlock: 'assessment', storageKeys: ['marking_scheme', 'detailed_marking_scheme'] },
      { order: 11, id: 'open_ended_rubric', label: 'Rubric for Open-ended Questions', universalBlock: 'assessment', storageKeys: ['open_ended_rubric', 'rubric_open'] },
    ],
    requiredFieldsForPdfExtract: ['question', 'answer'],
    pdfValidationRules: [{ id: 'answer-key', severity: 'warn', description: 'Answer key should align with all sections.' }],
    parserHints: [
      'Teacher Exam Question Paper Generator — 11 sections: paper_title/instructions, blueprint, sections A–E, internal_choices, answer_key, marking_scheme, open_ended_rubric.',
      'Preserve section labels, OR/internal-choice markers, and marks per question.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Return ONE JSON object for Exam Question Paper Generator with ALL 11 sections: paper_title, instructions, blueprint, section_a..section_e (arrays of questions), internal_choices, answer_key, marking_scheme, open_ended_rubric. Each question needs question_number, question, options[] when MCQ (four labeled A–D), answer, marks. This is NOT Mock Test Builder — do NOT use mock_test_title, test_purpose_subtopic_link, ncf_competency_alignment, remedial_revision_suggestions, or reflection_exit_ticket.',
      generatorStructuredSchema: {
        paper_title: 'string',
        instructions: 'string',
        blueprint: 'string',
        section_a: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
          },
        ],
        section_b: [{ question_number: 'number', question: 'string', answer: 'string', marks: 'number' }],
        section_c: [{ question_number: 'number', question: 'string', answer: 'string', marks: 'number' }],
        section_d: [{ question_number: 'number', question: 'string', answer: 'string', marks: 'number' }],
        section_e: [{ question_number: 'number', question: 'string', answer: 'string', marks: 'number' }],
        internal_choices: 'string',
        answer_key: 'string',
        marking_scheme: 'string',
        open_ended_rubric: 'string',
      },
      pdfExtractSchema: {
        paper_title: 'string',
        title: 'string',
        instructions: 'string',
        blueprint: 'string',
        section_a: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_b: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_c: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_d: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
        section_e: [
          {
            question_number: 'number',
            question: 'string',
            options: ['string'],
            answer: 'string',
            marks: 'number',
            internal_choice_group: 'string',
          },
        ],
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
      {
        order: 2,
        id: 'chapter_subtopic_overview',
        label: 'Chapter and Subtopic Overview',
        universalBlock: 'alignment',
        storageKeys: ['chapter_subtopic_overview', 'chapter_overview', 'overview'],
      },
      {
        order: 3,
        id: 'objectives',
        label: 'Learning Objectives',
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      {
        order: 4,
        id: 'prior_knowledge',
        label: 'Prior Knowledge Required',
        universalBlock: 'alignment',
        storageKeys: ['prior_knowledge_required', 'prior_knowledge'],
      },
      {
        order: 5,
        id: 'key_concepts',
        label: 'Key Concepts Explained in Simple Language',
        universalBlock: 'output',
        storageKeys: ['key_concepts', 'concepts'],
      },
      {
        order: 6,
        id: 'definitions_formulae',
        label: 'Important Definitions and Formulae',
        universalBlock: 'output',
        storageKeys: ['definitions', 'formulae', 'formulas', 'definitions_and_formulae'],
      },
      {
        order: 7,
        id: 'concept_flow',
        label: 'Concept Flow / Mind Map Suggestion',
        universalBlock: 'output',
        storageKeys: ['concept_flow_mind_map', 'concept_flow', 'mind_map'],
      },
      {
        order: 8,
        id: 'real_life',
        label: 'Real-life Examples and Applications',
        universalBlock: 'realLife',
        storageKeys: ['real_life_examples', 'real_life_applications', 'examples'],
      },
      {
        order: 9,
        id: 'quick_revision',
        label: 'Quick Revision Notes',
        universalBlock: 'output',
        storageKeys: ['quick_revision_notes', 'revision_checklist', 'quick_review'],
      },
      {
        order: 10,
        id: 'practice_questions',
        label: 'Practice Questions (Objective + Subjective)',
        universalBlock: 'assessment',
        storageKeys: ['practice_questions', 'questions'],
      },
      {
        order: 11,
        id: 'improvement_tips',
        label: 'Tips for Further Improvement',
        universalBlock: 'differentiation',
        storageKeys: ['improvement_tips', 'study_tips', 'tips'],
      },
    ],
    requiredFieldsForPdfExtract: ['title'],
    pdfValidationRules: [
      {
        id: 'has-body',
        severity: 'error',
        description: 'key_concepts, quick_revision_notes, or chapter_subtopic_overview required.',
      },
    ],
    parserHints: [
      '11-section study guide: title, chapter overview, objectives, prior knowledge, key concepts, definitions/formulae, mind map, real-life examples, revision notes, practice Qs, improvement tips.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Study guide JSON: title MUST be a short study guide name only (e.g. "Nature of Science — Study Guide") using TOPIC/SUBTOPIC from context — NEVER paste MCQ options, A) B) C) D) lines, or **Answer:** keys into title. Put all practice MCQs only in practice_questions[]. Other fields: chapter_subtopic_overview, learning_objectives[], prior_knowledge_required[], key_concepts[] ({name, explanation}), definitions[] ({term, definition}), formulae[] ({name, formula, note}), concept_flow_mind_map, real_life_examples[], quick_revision_notes[], practice_questions[] ({question, type: objective|subjective, options[] as A) B) C) D) for MCQs, answer}), improvement_tips[].',
      pdfExtractSchema: {
        title: 'string',
        chapter_subtopic_overview: 'string',
        learning_objectives: ['string'],
        prior_knowledge_required: ['string'],
        key_concepts: [{ name: 'string', explanation: 'string' }],
        definitions: [{ term: 'string', definition: 'string' }],
        formulae: [{ name: 'string', formula: 'string', note: 'string' }],
        concept_flow_mind_map: 'string',
        real_life_examples: ['string'],
        quick_revision_notes: ['string'],
        practice_questions: [
          { question: 'string', type: 'objective|subjective', options: ['string'], answer: 'string' },
        ],
        improvement_tips: ['string'],
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['key_concepts'], use: ['concepts', 'summary'] },
      { ifEmpty: ['quick_revision_notes'], use: ['revision_checklist', 'quick_review'] },
      { ifEmpty: ['improvement_tips'], use: ['study_tips', 'tips'] },
      { ifEmpty: ['formulae'], use: ['formulas', 'rules'] },
    ],
  },

  'concept-breakdown-explainer': {
    slug: 'concept-breakdown-explainer',
    title: 'Concept Breakdown Explainer',
    contentTypeDefault: 'Concept Notes',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      {
        order: 1,
        id: 'concept_title',
        label: 'Concept Title',
        universalBlock: 'input',
        storageKeys: ['concept_title', 'concept_name', 'title'],
      },
      {
        order: 2,
        id: 'simple_definition',
        label: 'Simple Definition',
        universalBlock: 'output',
        storageKeys: ['simple_definition', 'simple_explanation', 'explanation'],
      },
      {
        order: 3,
        id: 'breakdown_steps',
        label: 'Step-by-step Concept Breakdown',
        universalBlock: 'output',
        storageKeys: ['breakdown_steps', 'steps'],
      },
      {
        order: 4,
        id: 'real_life_examples',
        label: 'Real-life and Indian Context Examples',
        universalBlock: 'realLife',
        storageKeys: ['real_life_examples', 'examples', 'indian_context_examples'],
      },
      {
        order: 5,
        id: 'important_terms',
        label: 'Important Terms and Keywords',
        universalBlock: 'output',
        storageKeys: ['important_terms', 'keywords', 'terms'],
      },
      {
        order: 6,
        id: 'concept_check',
        label: 'Concept Check Questions',
        universalBlock: 'assessment',
        storageKeys: ['concept_check_questions', 'quick_check_questions'],
      },
      {
        order: 7,
        id: 'application_question',
        label: 'Application-based Thinking Question',
        universalBlock: 'assessment',
        storageKeys: ['application_thinking_question', 'application_question'],
      },
      {
        order: 8,
        id: 'hots_prompt',
        label: 'Higher-order Thinking Prompt',
        universalBlock: 'reflection',
        storageKeys: ['higher_order_thinking_prompt', 'hots_prompt', 'hots_question'],
      },
      {
        order: 9,
        id: 'quick_revision',
        label: 'Quick Revision Summary',
        universalBlock: 'reflection',
        storageKeys: ['quick_revision_summary', 'revision_summary', 'summary'],
      },
    ],
    requiredFieldsForPdfExtract: ['concept_title'],
    pdfValidationRules: [
      {
        id: 'has-body',
        severity: 'error',
        description: 'simple_definition, breakdown_steps, or quick_revision_summary required.',
      },
    ],
    parserHints: [
      '9-section concept breakdown: title, definition, steps, Indian-context examples, terms, check questions, application & HOTS prompts, revision summary.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Concept breakdown JSON: concept_title, simple_definition, breakdown_steps[], real_life_examples[], important_terms[] ({term, definition}), concept_check_questions[], application_thinking_question, higher_order_thinking_prompt, quick_revision_summary. Or concepts[] array of objects with the same fields.',
      pdfExtractSchema: {
        concepts: [
          {
            concept_title: 'string',
            simple_definition: 'string',
            breakdown_steps: ['string'],
            real_life_examples: ['string'],
            important_terms: [{ term: 'string', definition: 'string' }],
            concept_check_questions: ['string'],
            application_thinking_question: 'string',
            higher_order_thinking_prompt: 'string',
            quick_revision_summary: 'string',
          },
        ],
        concept_title: 'string',
        simple_definition: 'string',
        breakdown_steps: ['string'],
        real_life_examples: ['string'],
        important_terms: [{ term: 'string', definition: 'string' }],
        concept_check_questions: ['string'],
        application_thinking_question: 'string',
        higher_order_thinking_prompt: 'string',
        quick_revision_summary: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['concept_title'], use: ['concept_name', 'title'] },
      { ifEmpty: ['simple_definition'], use: ['simple_explanation', 'explanation'] },
      { ifEmpty: ['real_life_examples'], use: ['examples'] },
      { ifEmpty: ['concept_check_questions'], use: ['quick_check_questions'] },
      { ifEmpty: ['higher_order_thinking_prompt'], use: ['hots_question', 'hots_prompt'] },
    ],
  },

  'smart-qa-practice-generator': {
    slug: 'smart-qa-practice-generator',
    title: 'Smart Q&A Practice Generator',
    contentTypeDefault: 'Practice Q&A',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'title', label: 'Practice Set Title', universalBlock: 'input', storageKeys: ['title', 'practice_set_title'] },
      {
        order: 2,
        id: 'learning_objectives',
        label: 'Learning Objectives',
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      {
        order: 3,
        id: 'instructions',
        label: 'Instructions to Students',
        universalBlock: 'input',
        storageKeys: ['instructions', 'student_instructions'],
      },
      { order: 4, id: 'section_a', label: 'Section A: MCQs', universalBlock: 'output', storageKeys: ['section_a_mcqs', 'section_a'] },
      {
        order: 5,
        id: 'section_b',
        label: 'Section B: Fill in the Blanks',
        universalBlock: 'output',
        storageKeys: ['section_b_fill_in_blanks', 'section_b_fib', 'fill_in_blanks'],
      },
      {
        order: 6,
        id: 'section_c',
        label: 'Section C: Match the Following',
        universalBlock: 'output',
        storageKeys: ['section_c_match_following', 'section_c_match', 'match_following'],
      },
      {
        order: 7,
        id: 'section_d',
        label: 'Section D: Very Short Answer Questions',
        universalBlock: 'output',
        storageKeys: ['section_d_vsa', 'section_d'],
      },
      {
        order: 8,
        id: 'section_e',
        label: 'Section E: Short Answer Questions',
        universalBlock: 'output',
        storageKeys: ['section_e_short_answer', 'section_e_sa', 'section_d_sa'],
      },
      {
        order: 9,
        id: 'section_f',
        label: 'Section F: Application / Case-based Questions',
        universalBlock: 'realLife',
        storageKeys: ['section_f_application', 'section_f_case_based'],
      },
      {
        order: 10,
        id: 'section_g',
        label: 'Section G: HOTS / Analytical Questions',
        universalBlock: 'assessment',
        storageKeys: ['section_g_hots', 'section_g_analytical'],
      },
      {
        order: 11,
        id: 'answer_key',
        label: 'Answer Key with Explanations',
        universalBlock: 'assessment',
        storageKeys: ['answer_key_with_explanations', 'answer_key', 'answerKey'],
      },
    ],
    requiredFieldsForPdfExtract: ['question'],
    pdfValidationRules: [
      { id: 'questions-nonempty', severity: 'error', description: 'At least one question required across sections.' },
      { id: 'answer-key-alignment', severity: 'warn', description: 'MCQs with options should have a declared answer.' },
    ],
    parserHints: [
      '11-section practice set: title, objectives, instructions, sections A–G, answer key with explanations; each question includes bloom_level and difficulty_tag.',
      'Section C example: sectionName "Section C: Match the Following", questions[{ type:"MATCH", question:"Match Column A with Column B.", options:["1. Observation — A. First step","2. Hypothesis — B. Testable explanation"], answer:"1-A, 2-B", marks:2 }].',
    ],
    regenerationRules: { mergePolicy: 'replace', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Practice Q&A JSON: title, learning_objectives[], instructions, sections[{sectionName,questions[]}] with question_number, type, question, options[], answer, explanation, bloom_level, difficulty_tag, marks; answer_key_with_explanations. Section names MUST be exactly: "Section A: MCQs", "Section B: Fill in the Blanks", "Section C: Match the Following", "Section D: Very Short Answer Questions", "Section E: Short Answer Questions", "Section F: Application / Case-based Questions", "Section G: HOTS / Analytical Questions". REQUIRED: include ALL seven sections A–G in sections[] — each section MUST have at least one question (distribute the target question count across sections; include Match in C, short answers in E, application/case in F). Do NOT duplicate the same question in sections[] and a top-level questions[] array. Every question object MUST have a non-empty "question" field.',
      pdfExtractSchema: {
        title: 'string',
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
                bloom_level: 'string',
                difficulty_tag: 'string',
                marks: 'number',
              },
            ],
          },
        ],
        answer_key_with_explanations: 'string',
        questions: [
          {
            question_number: 'number',
            type: 'string',
            section: 'string',
            question: 'string',
            options: ['string'],
            answer: 'string',
            explanation: 'string',
            bloom_level: 'string',
            difficulty_tag: 'string',
            marks: 'number',
          },
        ],
      },
    },
    sectionFallbackRules: [{ ifEmpty: ['questions'], use: ['sections', 'practice_questions'], synthesize: 'extract_from_plain_text' }],
  },

  'chapter-summary-creator': {
    slug: 'chapter-summary-creator',
    title: 'Chapter Summary Creator',
    contentTypeDefault: 'Chapter Summary',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      {
        order: 1,
        id: 'chapter_summary_title',
        label: 'Chapter Summary Title',
        universalBlock: 'input',
        storageKeys: ['chapter_summary_title', 'chapter_title', 'title'],
      },
      {
        order: 2,
        id: 'chapter_overview',
        label: 'Overview of the Chapter',
        universalBlock: 'alignment',
        storageKeys: ['chapter_overview', 'overview', 'summary', 'chapter_summary'],
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
        id: 'important_concepts',
        label: 'Important Concepts and Explanations',
        universalBlock: 'output',
        storageKeys: ['important_concepts', 'key_concepts', 'concepts'],
      },
      {
        order: 5,
        id: 'definitions',
        label: 'Key Definitions and Terms',
        universalBlock: 'output',
        storageKeys: ['definitions', 'key_definitions', 'terms'],
      },
      {
        order: 6,
        id: 'formulae',
        label: 'Formulae / Rules / Important Facts',
        universalBlock: 'output',
        storageKeys: ['formulae', 'formulas', 'rules', 'important_facts'],
      },
      {
        order: 7,
        id: 'concept_connections',
        label: 'Concept Connections',
        universalBlock: 'output',
        storageKeys: ['concept_connections', 'connections'],
      },
      {
        order: 8,
        id: 'real_life',
        label: 'Real-life Applications',
        universalBlock: 'realLife',
        storageKeys: ['real_life_applications', 'applications', 'examples'],
      },
      {
        order: 9,
        id: 'quick_revision',
        label: 'Quick Revision Notes',
        universalBlock: 'reflection',
        storageKeys: ['quick_revision_notes', 'review_points', 'quick_review'],
      },
      {
        order: 10,
        id: 'recall_questions',
        label: 'Practice Recall Questions',
        universalBlock: 'assessment',
        storageKeys: ['practice_recall_questions', 'recall_questions'],
      },
    ],
    requiredFieldsForPdfExtract: ['chapter_summary_title'],
    pdfValidationRules: [
      {
        id: 'has-body',
        severity: 'error',
        description: 'chapter_overview, important_concepts, or quick_revision_notes required.',
      },
    ],
    parserHints: [
      '10-section chapter summary: title, overview, objectives, concepts, definitions, formulae, connections, applications, revision notes, recall questions.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Chapter Summary Creator ONLY (NOT Smart Study Guide): chapter_summary_title, chapter_overview, learning_objectives[], important_concepts[] ({name, explanation}), definitions[] ({term, definition}), formulae[] ({name, formula, note}) — REQUIRED min 3 entries: use equations for STEM or must-know rules/facts for all subjects (put the rule text in formula field), concept_connections, real_life_applications[], quick_revision_notes[], practice_recall_questions[]. Do NOT use study_guide_title, prior_knowledge, key_concepts block, or practice_questions MCQ arrays. Fill ALL sections 4–10; never leave formulae[] empty.',
      pdfExtractSchema: {
        chapter_summary_title: 'string',
        chapter_title: 'string',
        chapter_overview: 'string',
        learning_objectives: ['string'],
        important_concepts: [{ name: 'string', explanation: 'string' }],
        definitions: [{ term: 'string', definition: 'string' }],
        formulae: [{ name: 'string', formula: 'string', note: 'string' }],
        concept_connections: 'string',
        real_life_applications: ['string'],
        quick_revision_notes: ['string'],
        practice_recall_questions: ['string'],
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['chapter_overview'], use: ['summary', 'chapter_summary'] },
      { ifEmpty: ['important_concepts'], use: ['key_concepts', 'concepts'] },
      { ifEmpty: ['quick_revision_notes'], use: ['review_points', 'key_takeaways', 'important_exam_points', 'exam_points'] },
      { ifEmpty: ['practice_recall_questions'], use: ['quick_check_questions'] },
      {
        ifEmpty: ['formulae'],
        use: ['formulas', 'rules', 'important_facts', 'must_remember_facts', 'important_exam_points', 'exam_points'],
      },
    ],
  },

  'key-points-formula-extractor': {
    slug: 'key-points-formula-extractor',
    title: 'Key Points Extractor',
    contentTypeDefault: 'Key Points',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      { order: 1, id: 'topic_title', label: 'Topic Title', universalBlock: 'input', storageKeys: ['topic_title', 'title'] },
      {
        order: 2,
        id: 'important_concepts',
        label: 'Most Important Concepts',
        universalBlock: 'output',
        storageKeys: ['important_concepts', 'key_concepts', 'concepts'],
      },
      {
        order: 3,
        id: 'essential_definitions',
        label: 'Essential Definitions',
        universalBlock: 'output',
        storageKeys: ['essential_definitions', 'definitions'],
      },
      {
        order: 4,
        id: 'formulae',
        label: 'Important Formulae / Rules',
        universalBlock: 'output',
        storageKeys: ['formulae', 'formulas', 'rules'],
      },
      {
        order: 5,
        id: 'keywords',
        label: 'Keywords and Terminologies',
        universalBlock: 'output',
        storageKeys: ['keywords_terminologies', 'keywords', 'terminologies'],
      },
      {
        order: 6,
        id: 'must_remember',
        label: 'Must-remember Facts',
        universalBlock: 'output',
        storageKeys: ['must_remember_facts', 'key_points', 'key_points_to_remember'],
      },
      {
        order: 7,
        id: 'real_life',
        label: 'Real-life Connections',
        universalBlock: 'realLife',
        storageKeys: ['real_life_connections', 'real_life_applications'],
      },
      {
        order: 8,
        id: 'exam_points',
        label: 'Frequently Asked Exam Points',
        universalBlock: 'assessment',
        storageKeys: ['frequently_asked_exam_points', 'exam_points'],
      },
      {
        order: 9,
        id: 'mnemonics',
        label: 'Mnemonics / Memory Tricks',
        universalBlock: 'differentiation',
        storageKeys: ['mnemonics_memory_tricks', 'mnemonics', 'memory_tricks'],
      },
      {
        order: 10,
        id: 'revision_summary',
        label: 'One-minute Revision Summary',
        universalBlock: 'reflection',
        storageKeys: ['one_minute_revision_summary', 'revision_summary', 'summary'],
      },
    ],
    requiredFieldsForPdfExtract: ['topic_title'],
    pdfValidationRules: [
      {
        id: 'has-body',
        severity: 'error',
        description: 'important_concepts, must_remember_facts, or formulae required.',
      },
    ],
    parserHints: [
      '10-section key points: concepts, definitions, formulae, keywords, facts, real-life links, exam FAQs, mnemonics, one-minute summary.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Key points JSON: topic_title, important_concepts[] ({name, explanation}), essential_definitions[] ({term, definition}), formulae[] ({name, formula, note}) REQUIRED min 3 — use equations for STEM or must-know rules in formula field for all subjects, keywords_terminologies[] ({term, meaning}), must_remember_facts[], real_life_connections[], frequently_asked_exam_points[], mnemonics_memory_tricks[], one_minute_revision_summary. Never leave formulae[] empty.',
      pdfExtractSchema: {
        topic_title: 'string',
        title: 'string',
        important_concepts: [{ name: 'string', explanation: 'string' }],
        essential_definitions: [{ term: 'string', definition: 'string' }],
        formulae: [{ name: 'string', formula: 'string', note: 'string' }],
        keywords_terminologies: [{ term: 'string', meaning: 'string' }],
        must_remember_facts: ['string'],
        real_life_connections: ['string'],
        frequently_asked_exam_points: ['string'],
        mnemonics_memory_tricks: ['string'],
        one_minute_revision_summary: 'string',
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['important_concepts'], use: ['key_concepts', 'concepts'] },
      { ifEmpty: ['essential_definitions'], use: ['definitions'] },
      { ifEmpty: ['formulae'], use: ['formulas', 'rules', 'important_facts', 'facts'] },
      { ifEmpty: ['must_remember_facts'], use: ['key_points', 'key_points_to_remember'] },
      { ifEmpty: ['one_minute_revision_summary'], use: ['summary', 'short_note_summary'] },
    ],
  },

  'quick-assignment-builder': {
    slug: 'quick-assignment-builder',
    title: 'Quick Assignment Builder',
    contentTypeDefault: 'Assignment',
    pedagogyFrameworkTags: [...UNIVERSAL_PEDAGOGY_TAGS],
    compulsoryContextFields: COMPULSORY_CONTEXT_FIELDS,
    canonicalHeadings: [
      {
        order: 1,
        id: 'assignment_title',
        label: 'Assignment Title',
        universalBlock: 'input',
        storageKeys: ['assignment_title', 'title', 'assignmentTitle'],
      },
      {
        order: 2,
        id: 'learning_objectives',
        label: 'Learning Objectives',
        universalBlock: 'alignment',
        storageKeys: ['learning_objectives', 'objectives'],
      },
      {
        order: 3,
        id: 'instructions',
        label: 'Instructions to Students',
        universalBlock: 'output',
        storageKeys: ['instructions', 'instructions_to_students', 'student_instructions'],
      },
      {
        order: 4,
        id: 'concept_questions',
        label: 'Concept-based Questions',
        universalBlock: 'output',
        storageKeys: ['concept_based_questions', 'questions', 'practice_questions'],
      },
      {
        order: 5,
        id: 'application_tasks',
        label: 'Application-oriented Tasks',
        universalBlock: 'output',
        storageKeys: ['application_oriented_tasks', 'application_tasks'],
      },
      {
        order: 6,
        id: 'real_life_activity',
        label: 'Real-life / Competency-based Activity',
        universalBlock: 'realLife',
        storageKeys: ['real_life_competency_activity', 'real_life_activity', 'real_life_observation_task'],
      },
      {
        order: 7,
        id: 'creative_question',
        label: 'Creative Thinking Question',
        universalBlock: 'assessment',
        storageKeys: ['creative_thinking_question', 'creative_question'],
      },
      {
        order: 8,
        id: 'collaborative_task',
        label: 'Collaborative / Discussion Task (if suitable)',
        universalBlock: 'differentiation',
        storageKeys: ['collaborative_discussion_task', 'discussion_task', 'collaborative_task'],
      },
      {
        order: 9,
        id: 'challenge_question',
        label: 'Challenge Question for Advanced Learners',
        universalBlock: 'differentiation',
        storageKeys: ['challenge_question_advanced', 'challenge_question'],
      },
      {
        order: 11,
        id: 'assessment_rubric',
        label: 'Assessment Criteria / Rubric',
        universalBlock: 'assessment',
        storageKeys: ['assessment_criteria_rubric', 'marking_criteria', 'marking_scheme', 'rubric'],
      },
      {
        order: 13,
        id: 'expected_outcomes',
        label: 'Expected Learning Outcomes',
        universalBlock: 'reflection',
        storageKeys: ['expected_learning_outcomes', 'learning_outcomes'],
      },
    ],
    requiredFieldsForPdfExtract: ['assignment_title', 'concept_based_questions'],
    pdfValidationRules: [
      {
        id: 'has-body',
        severity: 'error',
        description: 'concept_based_questions, instructions, or learning objectives required.',
      },
    ],
    parserHints: [
      '11-section assignment: objectives, concept questions, application tasks, competency activity, creative/collaborative/challenge questions, rubric, outcomes.',
    ],
    regenerationRules: { mergePolicy: 'merge', allowTemplateRegeneration: true },
    gemini: {
      strictOutputHint:
        'Quick assignment JSON: assignment_title, learning_objectives[], instructions, concept_based_questions[] ({question, marks, answer optional}), application_oriented_tasks[], real_life_competency_activity, creative_thinking_question, collaborative_discussion_task, challenge_question_advanced, assessment_criteria_rubric, expected_learning_outcomes[].',
      pdfExtractSchema: {
        assignment_title: 'string',
        title: 'string',
        learning_objectives: ['string'],
        instructions: 'string',
        concept_based_questions: [{ question: 'string', marks: 'number', answer: 'string' }],
        application_oriented_tasks: ['string'],
        real_life_competency_activity: 'string',
        creative_thinking_question: 'string',
        collaborative_discussion_task: 'string',
        challenge_question_advanced: 'string',
        assessment_criteria_rubric: 'string',
        expected_learning_outcomes: ['string'],
      },
    },
    sectionFallbackRules: [
      { ifEmpty: ['assignment_title'], use: ['title'] },
      { ifEmpty: ['concept_based_questions'], use: ['questions', 'practice_questions'] },
      { ifEmpty: ['application_oriented_tasks'], use: ['application_tasks'] },
      { ifEmpty: ['assessment_criteria_rubric'], use: ['marking_criteria', 'marking_scheme'] },
      { ifEmpty: ['expected_learning_outcomes'], use: ['learning_objectives'] },
    ],
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

/** Opening persona for Super Admin AI Generator Gemini prompts. */
export const AI_GENERATOR_PERSONA_PREAMBLE = `You are an expert Indian school curriculum content generator — a subject matter expert across ALL subjects taught in Indian schools (CBSE, ICSE, IB, IGCSE, State Boards), deeply aligned with:
- NEP 2020 (competency-based learning, multidisciplinary thinking, mother tongue preference, 5+3+3+4 structure)
- NCF-SE 2023 (learning standards, curricular goals, pedagogical approaches, competency progression across stages: Foundational → Preparatory → Middle → Secondary)
- NCERT Learning Outcomes 2017 (subject-specific observable behaviours)
- Bloom's Taxonomy (Revised Anderson & Krathwohl, 2001) — mandatory HOTS weighting at Analyse / Evaluate / Create levels`;

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

  const schema = t.gemini?.generatorStructuredSchema || t.gemini?.pdfExtractSchema || {};
  const strictHint = t.gemini?.strictOutputHint || '';
  const canonicalHeadings = t.canonicalHeadings || [];
  const headings = canonicalHeadings.map((h) => `${h.order}. ${h.label}`).join('\n');
  const sectionCount = canonicalHeadings.length;
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
  if (slug === 'mock-test-builder' || slug === 'exam-question-paper-generator') {
    const examQuestionTarget =
      Number.isFinite(questionCount) && questionCount > 0 ? questionCount : 12;
    contextLines.push(
      `TARGET EXAM QUESTIONS: at least ${examQuestionTarget} across sections A–E (section_a..section_e or sections[])`,
    );
  }
  if (slug === 'smart-qa-practice-generator') {
    const practiceTarget =
      Number.isFinite(questionCount) && questionCount > 0 ? questionCount : 12;
    contextLines.push(
      `TARGET PRACTICE QUESTIONS: ${practiceTarget} total, distributed across ALL sections A–G (each section must have at least 1 question; Section C = match, Section E = short answer, Section F = application/case-based)`,
    );
  }
  if (slug === 'chapter-summary-creator') {
    contextLines.push(
      'OUTPUT TOOL: Chapter Summary Creator (10 sections) — NOT Smart Study Guide. Use chapter_summary_title and chapter_overview field names.',
    );
  }
  if (slug === 'key-points-formula-extractor') {
    contextLines.push(
      'OUTPUT TOOL: Key Points Extractor — formulae[] REQUIRED (min 3): each {name, formula, note}; formula may be an equation OR a must-know rule/fact sentence.',
    );
  }
  if (slug === 'smart-study-guide-generator') {
    contextLines.push(
      'TITLE RULE: structuredContent.title = short guide name from SUBTOPIC/TOPIC only (max ~12 words). Never put MCQ option lines or answers in title — use practice_questions[] for all objective items.',
    );
  }
  if (slug === 'rubrics-evaluation-generator') {
    contextLines.push(
      'RUBRIC RULE: structuredContent MUST include ALL 10 sections. criteria[] needs min 3 rows; each row needs excellent, good, satisfactory, needs_improvement text. grading_criteria, actionable_suggestions, and next_step_remedial_enrichment must be non-empty paragraphs.',
    );
  }
  if (slug === 'story-passage-creator') {
    contextLines.push(
      'STORY RULE: structuredContent MUST include ALL 19 Story and Passage Creator sections. passage must be a complete story (not just the title word). Each question array (read_and_recall, think_and_infer, apply_and_connect) needs at least 2 questions.',
    );
  }
  if (slug === 'flashcard-generator') {
    const targetCards = Math.max(
      5,
      Number.isFinite(cardCount) && cardCount > 0 ? cardCount : 5,
    );
    contextLines.push(
      `FLASHCARD RULE (5-block teacher deck): Populate Context & Alignment (flashcard_deck_title, topic, subtopic, class_level, difficulty_level, bloom_level), Foundations (prior_knowledge_required, learning_objectives[], ncf_competency_alignment), The Card Set (application_hots_cards[] AND cards[] with at least ${targetCards} items — front=Task prompt, back=Solution), Study Aids (deck_memory_hook, common_mistakes_to_avoid[], self_check_rapid_recall_round), Wrap-Up (real_life_connection, differentiation_support, reflection_exit_ticket).`,
    );
  } else if (slug === 'my-study-decks') {
    const targetCards = Number.isFinite(cardCount) && cardCount > 0 ? cardCount : 10;
    contextLines.push(
      `FLASHCARD RULE: structuredContent.cards MUST be an array of at least ${targetCards} objects. Each card MUST use front and back string fields (do not use term/definition only). Include difficulty_tag_for_each_card and memory_hook_quick_tip on every card.`,
    );
  }
  if (slug === 'daily-class-plan-maker') {
    contextLines.push(
      'DAILY CLASS PLAN RULE: structuredContent MUST use the 9-section Daily Class Plan format (day_period_topic_breakup, objectives, teaching_methods, classroom_activity, exit_ticket, differentiated_support, homework_followup, teaching_aids, teacher_reflection_notes). Do NOT return a 13-section lesson planner object.',
    );
  }
  if (slug === 'lesson-planner') {
    contextLines.push(
      'LESSON PLANNER RULE: structuredContent MUST include ALL 14 teacher lesson-plan fields: lesson_name, learning_objectives[], ncf_competency_alignment, prior_knowledge_diagnostic, introduction_warmup, teaching_strategy, teaching_activities[], teacher_talk_points[], student_tasks[], formative_assessment_questions[], differentiation_plan, homework_practice, teaching_aids_required[], closure_exit_ticket. Sections 5–14 (warm-up through closure) must each have real content — not empty.',
    );
  }
  if (slug === 'exam-question-paper-generator') {
    const examTarget =
      Number.isFinite(questionCount) && questionCount > 0 ? questionCount : 12;
    contextLines.push(
      `EXAM PAPER RULE: structuredContent MUST use the 11-section Exam Question Paper format (paper_title, instructions, blueprint, section_a..section_e, internal_choices, answer_key, marking_scheme, open_ended_rubric). Minimum ${examTarget} questions across sections. Do NOT return Mock Test Builder fields.`,
    );
  }
  const generationVariant = Number(extra.generationVariant ?? extra.variantIndex);
  const batchSize = Number(extra.batchSize);
  const variantAngle = String(extra.variantAngle || '').trim();
  const variantScenario = String(extra.variantScenario || '').trim();
  const uniqueSeed = String(extra.uniqueSeed || '').trim();
  if (Number.isFinite(generationVariant) && generationVariant > 0) {
    const batchLabel =
      Number.isFinite(batchSize) && batchSize > 0 ? ` of ${Math.floor(batchSize)}` : '';
    contextLines.push(
      `GENERATION VARIANT: ${Math.floor(generationVariant)}${batchLabel}. This output MUST be noticeably different from all other variants for the same subtopic.`,
    );
    if (variantAngle) {
      contextLines.push(`MANDATORY CREATIVE ANGLE (build the entire activity/content around this): ${variantAngle}`);
    }
    if (variantScenario) {
      contextLines.push(`MANDATORY SCENARIO SETTING (use in examples, story, and activities): ${variantScenario}`);
    }
    contextLines.push(
      'UNIQUENESS RULES: Change the title/heading, opening hook, examples, question stems, numbers, names, and activity steps. Do NOT reuse the same story, same MCQ options, or same step wording as another variant. The title/heading MUST visibly reflect the creative angle (not a generic title).',
    );
    contextLines.push(
      'COMPLETENESS RULE (critical): Fill EVERY canonical section/field listed below with real, non-empty content. The system validates ALL fields before saving — any empty section causes rejection and retry.',
    );
    if (uniqueSeed) {
      contextLines.push(`UNIQUENESS SEED (for randomization only — do not print in output): ${uniqueSeed}`);
    }
    const dedupAttempt = Number(extra.dedupAttempt);
    if (Number.isFinite(dedupAttempt) && dedupAttempt > 1) {
      contextLines.push(
        `ANTI-DUPLICATION RETRY ${dedupAttempt}: A prior attempt for this variant was too similar to another record. Produce completely different wording, examples, question stems, names, numbers, and activity steps.`,
      );
    }
    const forbiddenOpenings = Array.isArray(extra.forbiddenOpenings)
      ? extra.forbiddenOpenings.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (forbiddenOpenings.length) {
      contextLines.push(
        `FORBIDDEN OPENINGS (do NOT reuse or paraphrase closely):\n${forbiddenOpenings
          .slice(0, 6)
          .map((s, i) => `${i + 1}. "${s}"`)
          .join('\n')}`,
      );
    }
  }

  const completenessRule =
    sectionCount > 0
      ? `COMPLETENESS RULE (mandatory): Fill ALL ${sectionCount} canonical sections listed below with real, non-empty content. The system validates every section before saving — any empty or missing field causes rejection and automatic retry. Do not omit sections or leave placeholder text.`
      : '';

  return `${AI_GENERATOR_PERSONA_PREAMBLE}

${contextLines.join('\n')}

${completenessRule ? `${completenessRule}\n\n` : ''}CANONICAL OUTPUT SECTIONS (populate structuredContent using these headings and field names):
${headings}

STRICT OUTPUT RULE:
${strictHint}

Generate original, classroom-ready content for the class, subject, topic, and subtopic above. Use plain text only in every JSON string value — no markdown bold (**), italics (*), backticks, or # headings. Do not use markdown code fences inside JSON string values.

Return ONLY valid JSON (single root object, no markdown fences):
{
  "contentType": "${t.contentTypeDefault}",
  "structuredContent": { }
}

The structuredContent object MUST match this JSON schema (field names and types exactly):
${JSON.stringify(schema, null, 2)}

For tools that produce multiple worksheet questions, exam items, or flashcards, put them in the arrays defined by the schema (e.g. questions[], sections[].questions[], cards[]).
For Smart Q&A Practice Generator, structuredContent.sections MUST list all seven entries (Section A through Section G) and each MUST contain at least one question object. Section C must be a Match-the-Following item (type "MATCH").
For Chapter Summary Creator use chapter_summary_title and chapter_overview — never study_guide_title or chapter_subtopic_overview field names.
For Concept Mastery Helper there is NO separate "concept" form field — use the SUBTOPIC (and TOPIC) from context as concept_name. structuredContent MUST be { "concepts": [ { ... } ] } with at least one filled concept object for that sub-topic.
For Activity & Project Generator, fill ALL 13 canonical fields in one structuredContent object.
For Rubrics, Evaluation & Report Card, fill ALL 10 canonical fields; criteria[] must have at least 3 complete rubric rows with four performance levels each.
For Story and Passage Creator, fill ALL 19 canonical fields with a full passage and at least two questions in sections 9, 10, and 11.
For Flash Card Generator, use the 5-block format; every item in cards[] and application_hots_cards[] MUST include front (Task) and back (Solution) as non-empty strings.
For My Study Decks, every item in cards[] MUST include front and back (non-empty strings).
For Daily Class Plan Maker, fill ALL 9 canonical daily-plan fields — not lesson planner fields (no introduction_warmup, teaching_strategy, or 13-section lesson layout).
For Exam Question Paper Generator, fill ALL 11 canonical exam-paper fields — not Mock Test Builder fields (no mock_test_title, test_purpose_subtopic_link, or 12-section mock layout).`;
}

/** @param {string} toolSlug @param {unknown} structured */
export function expandStructuredToFormatItems(toolSlug, structured) {
  if (Array.isArray(structured)) {
    return structured.filter((x) => x && typeof x === 'object');
  }
  const s = structured && typeof structured === 'object' ? structured : {};

  switch (toolSlug) {
    case 'activity-project-generator':
    case 'project-idea-lab':
      return [s];
    case 'worksheet-mcq-generator':
      return [s];
    case 'homework-creator':
      return [s];
    case 'rubrics-evaluation-generator':
      return [s];
    case 'daily-class-plan-maker':
    case 'lesson-planner':
    case 'study-schedule-maker':
      return [s];
    case 'mock-test-builder':
    case 'exam-question-paper-generator':
      return [s];
    case 'my-study-decks':
    case 'flashcard-generator':
      return [s];
    case 'concept-breakdown-explainer': {
      const concepts = Array.isArray(s.concepts) ? s.concepts : [];
      if (concepts.length) {
        return concepts.map((c, i) => {
          const row = c && typeof c === 'object' ? c : {};
          const title =
            row.concept_title || row.concept_name || row.title || row.name || `Concept ${i + 1}`;
          return {
            ...row,
            sl_no: i + 1,
            concept_title: title,
            concept_name: title,
          };
        });
      }
      return [s];
    }
    case 'concept-mastery-helper': {
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
      return [s];
    case 'quick-assignment-builder':
      return [s];
    default:
      return [s];
  }
}

/**
 * Render structured Gemini output to markdown using canonical templates.
 * @param {string} toolSlug
 * @param {unknown} structured
 */
function formatTeacherFlashcardCardBlock(card, idx) {
  const extra = [
    card.difficulty_tag_for_each_card
      ? `**Difficulty:** ${card.difficulty_tag_for_each_card}`
      : '',
    card.memory_hook_quick_tip ? `**Memory Hook:** ${card.memory_hook_quick_tip}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const header = `**Card ${idx + 1}**\n\n`;
  return `${header}**Task:** ${card.front}\n\n**Solution:** ${card.back}${extra ? `\n\n${extra}` : ''}`;
}

function formatTeacherFlashcardCardList(cards) {
  return (Array.isArray(cards) ? cards : [])
    .map((item, idx) => {
      const i = item && typeof item === 'object' ? item : {};
      const card = {
        front: str(i.front),
        back: str(i.back),
        difficulty_tag_for_each_card: str(
          i.difficulty_tag_for_each_card || i.difficulty_tag || i.difficulty_level || i.skill_focus,
        ),
        memory_hook_quick_tip: str(i.memory_hook_quick_tip || i.memory_cue || i.hint),
      };
      return card.front && card.back ? formatTeacherFlashcardCardBlock(card, idx) : '';
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function formatTeacherFlashcardEnvelope(items) {
  const records = Array.isArray(items) ? items : [];
  const root = records[0] && typeof records[0] === 'object' ? records[0] : {};
  const pickCards = (...keys) => {
    for (const key of keys) {
      const list = root[key];
      if (Array.isArray(list) && list.length) return list;
    }
    return [];
  };
  const applicationCards = pickCards('application_hots_cards', 'application_cards');
  let cards = pickCards('cards', 'flashcard_set', 'flashcards');
  if (!cards.length) cards = applicationCards;
  if (!cards.length) {
    cards = [
      ...pickCards('concept_and_definition_cards'),
      ...pickCards('formula_rule_cards', 'formula_cards'),
      ...pickCards('visual_diagram_suggestion_cards', 'visual_cards'),
    ];
  }
  const normalizedCards = cards
    .map((item) => {
      const i = item && typeof item === 'object' ? item : {};
      return {
        front: str(i.front || i.task || i.question),
        back: str(i.back || i.solution || i.answer),
        difficulty_tag_for_each_card: str(
          i.difficulty_tag_for_each_card || i.difficulty_tag || i.difficulty_level,
        ),
        memory_hook_quick_tip: str(i.memory_hook_quick_tip || i.memory_cue || i.hint),
        card_category: str(i.card_category) || 'application',
      };
    })
    .filter((c) => c.front && c.back);

  if (!normalizedCards.length) return '';

  const deckTitle = str(
    root.flashcard_deck_title || root.deck_title || root.title || 'Flash Card Set',
  );
  const topic =
    str(root.topic) ||
    (() => {
      const link = str(root.topic_and_subtopic_link || root.subtopic_link);
      const m = link.match(/^([^—–\-:]+)/);
      return m ? m[1].trim() : link;
    })();
  const subtopic = str(root.subtopic) || str(root.sub_topic || root.subTopic);
  const classLevel = str(root.class_level || root.classLabel || root.class);
  const difficultyLevel = str(root.difficulty_level || root.difficulty) || 'Medium';
  const bloomLevel = str(root.bloom_level || root.bloom) || 'Apply / Analyze';
  const learningObjectives = strArr(root.learning_objectives || root.objectives);
  const commonMistakes = strArr(root.common_mistakes_to_avoid || root.common_mistakes);
  const deckMemoryHook = str(
    root.deck_memory_hook || root.memory_hook_quick_tip || root.memory_cue,
  );

  const blocks = [
    `## ${deckTitle}`,
    '',
    '### 1. Context & Alignment',
    `**Deck Title:** ${deckTitle}`,
    topic ? `**Topic:** ${topic}` : '',
    subtopic ? `**Subtopic:** ${subtopic}` : '',
    str(root.topic_and_subtopic_link || root.subtopic_link)
      ? `**Topic Link:** ${str(root.topic_and_subtopic_link || root.subtopic_link)}`
      : '',
    classLevel ? `**Class:** ${classLevel}` : '',
    `**Difficulty:** ${difficultyLevel}`,
    `**Bloom's Level:** ${bloomLevel}`,
    '',
    '### 2. Foundations',
    str(root.prior_knowledge_required)
      ? `**Prior Knowledge Required:** ${str(root.prior_knowledge_required)}`
      : '',
    learningObjectives.length
      ? `**Learning Objectives:**\n${learningObjectives.map((x) => `- ${x}`).join('\n')}`
      : '',
    str(root.ncf_competency_alignment || root.learning_outcome_alignment)
      ? `**NCF Competency / Learning Outcome Alignment:** ${str(root.ncf_competency_alignment || root.learning_outcome_alignment)}`
      : '',
    '',
    '### 3. The Card Set: Application & HOTS',
    formatTeacherFlashcardCardList(normalizedCards),
    '',
    '### 4. Study Aids',
    deckMemoryHook ? `**Memory Hook:** ${deckMemoryHook}` : '',
    commonMistakes.length
      ? `**Common Mistakes to Avoid:**\n${commonMistakes.map((x) => `- ${x}`).join('\n')}`
      : '',
    str(root.self_check_rapid_recall_round || root.self_check_round)
      ? `**Rapid Recall:** ${str(root.self_check_rapid_recall_round || root.self_check_round)}`
      : '',
    '',
    '### 5. Wrap-Up',
    str(root.real_life_connection || root.real_life_application)
      ? `**Real-life Connection:** ${str(root.real_life_connection || root.real_life_application)}`
      : '',
    str(root.differentiation_support || root.differentiation)
      ? `**Differentiation:** ${str(root.differentiation_support || root.differentiation)}`
      : '',
    str(root.reflection_exit_ticket || root.reflection)
      ? `**Exit Ticket:** ${str(root.reflection_exit_ticket || root.reflection)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const topicLink = str(root.topic_and_subtopic_link || root.subtopic_link);
  const topicAndSubtopicLink =
    topicLink ||
    (topic && subtopic ? `${topic} — ${subtopic}` : topic || subtopic || '');

  return JSON.stringify({
    formatted: blocks,
    raw: {
      ...root,
      flashcard_deck_title: deckTitle,
      deck_title: deckTitle,
      title: deckTitle,
      topic: topic || undefined,
      subtopic: subtopic || undefined,
      topic_and_subtopic_link: topicAndSubtopicLink || undefined,
      class_level: classLevel || undefined,
      difficulty_level: difficultyLevel,
      bloom_level: bloomLevel,
      deck_memory_hook: deckMemoryHook || undefined,
      cards: normalizedCards,
      application_hots_cards: normalizedCards,
      flashcards: normalizedCards,
    },
  });
}

function formatFlashcardDeckEnvelope(items) {
  const records = Array.isArray(items) ? items : [];
  const root = records[0] && typeof records[0] === 'object' ? records[0] : {};
  const rootCards = Array.isArray(root.cards)
    ? root.cards
    : Array.isArray(root.flashcard_set)
      ? root.flashcard_set
      : Array.isArray(root.flashcards)
        ? root.flashcards
        : null;
  const cards = (rootCards || records)
    .map((item) => {
      const i = item && typeof item === 'object' ? item : {};
      return {
        front: str(i.front),
        back: str(i.back),
        difficulty_tag_for_each_card: str(
          i.difficulty_tag_for_each_card || i.difficulty_tag || i.difficulty_level || i.skill_focus || i.bloom_level,
        ),
        memory_hook_quick_tip: str(i.memory_hook_quick_tip || i.memory_cue || i.hint),
        self_check_round: str(i.self_check_round || i.peer_prompt || i.self_check),
      };
    })
    .filter((c) => c.front && c.back);

  if (!cards.length) return '';

  const learningObjectives = strArr(root.learning_objectives || root.objectives);
  const commonMistakes = strArr(root.common_mistakes_to_avoid || root.common_mistakes);
  const expectedOutcomes = strArr(root.expected_learning_outcomes);
  const formattedBlocks = cards.map((card, idx) => {
    const extra = [
      card.difficulty_tag_for_each_card ? `**Difficulty Tag for Each Card:** ${card.difficulty_tag_for_each_card}` : '',
      card.memory_hook_quick_tip ? `**Memory Hook / Quick Tip:** ${card.memory_hook_quick_tip}` : '',
      card.self_check_round ? `**Self-Check Round:** ${card.self_check_round}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const header = cards.length > 1 ? `## Card ${idx + 1}\n\n` : '';
    return `${header}**Front:** ${card.front}\n\n**Back:** ${card.back}${extra ? `\n\n${extra}` : ''}`;
  });

  const metaSections = [
    `**Deck Title:** ${str(root.deck_title || root.title || 'My Study Decks')}`,
    str(root.subtopic_link_prior_knowledge_required || root.prior_knowledge_required)
      ? `**Subtopic Link and Prior Knowledge Required:** ${str(root.subtopic_link_prior_knowledge_required || root.prior_knowledge_required)}`
      : '',
    learningObjectives.length
      ? `**Learning Objectives - Bloom's Taxonomy Aligned:**\n${learningObjectives.map((x) => `- ${x}`).join('\n')}`
      : '',
    str(root.ncf_competency_alignment || root.learning_outcome_alignment)
      ? `**NCF Competency / Learning Outcome Alignment:** ${str(root.ncf_competency_alignment || root.learning_outcome_alignment)}`
      : '',
    commonMistakes.length
      ? `**Common Mistakes to Avoid:**\n${commonMistakes.map((x) => `- ${x}`).join('\n')}`
      : '',
    expectedOutcomes.length
      ? `**Expected Learning Outcomes:**\n${expectedOutcomes.map((x) => `- ${x}`).join('\n')}`
      : '',
    str(root.real_life_application || root.example_use || root.real_life_link)
      ? `**Real-life Application:** ${str(root.real_life_application || root.example_use || root.real_life_link)}`
      : '',
    str(root.reflection_exit_ticket || root.reflection || root.reflection_prompt)
      ? `**Reflection / Exit Ticket:** ${str(root.reflection_exit_ticket || root.reflection || root.reflection_prompt)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return JSON.stringify({
    formatted: `${metaSections}\n\n**Flashcard Set:**\n\n${formattedBlocks.join('\n\n---\n\n')}`,
    raw: { ...root, cards, flashcards: cards },
  });
}

export function formatStructuredToolOutput(toolSlug, structured) {
  const items = expandStructuredToFormatItems(toolSlug, structured);
  if (!items.length) return '';
  if (toolSlug === 'my-study-decks') {
    return formatFlashcardDeckEnvelope(items);
  }
  if (toolSlug === 'flashcard-generator') {
    return formatTeacherFlashcardEnvelope(items);
  }
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
            'my-study-decks',
            'flashcard-generator',
            'mock-test-builder',
            'exam-question-paper-generator',
            'short-notes-summaries-maker',
            'reading-practice-room',
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

const str = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v;
    return stripMarkdownSyntax(
      String(
        o.question || o.text || o.prompt || o.statement || o.content || o.label || o.value || '',
      ).trim(),
    );
  }
  return stripMarkdownSyntax(String(v).trim());
};
const strArr = (v) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const WORKSHEET_SECTION_SEQUENCE = [
  'Section A: MCQs',
  'Section B: Fill in the Blanks',
  'Section C: Very Short Answer Questions',
  'Section D: Short Answer Questions',
  'Section E: Competency / Real-life Application Questions',
];

function canonicalWorksheetSectionName(name) {
  const n = String(name || '').trim();
  if (/^section\s*a|mcq|multiple\s*choice/i.test(n)) return WORKSHEET_SECTION_SEQUENCE[0];
  if (/^section\s*b|fill|blank|fib/i.test(n)) return WORKSHEET_SECTION_SEQUENCE[1];
  if (/^section\s*c|very\s*short|vsa/i.test(n)) return WORKSHEET_SECTION_SEQUENCE[2];
  if (/^section\s*d|short\s*answer/i.test(n) && !/very/i.test(n)) return WORKSHEET_SECTION_SEQUENCE[3];
  if (/^section\s*[ef]|competency|real[\s-]*life|application/i.test(n)) {
    return WORKSHEET_SECTION_SEQUENCE[4];
  }
  return n || 'Section';
}

function normalizeWorksheetAnswerKeyLines(answerKey) {
  const raw = str(answerKey);
  if (!raw) return [];
  if (raw.includes('\n')) {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const parts = raw
    .replace(/\s+/g, ' ')
    .split(/(?=\s*\d+\.\s+)/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts;
  return [raw];
}

function pushSection(lines, title, bodyLines) {
  lines.push(`### ${title}`, ...bodyLines, '');
}

/** Mock Test Builder — main template sections use ## for clearer parsing and display. */
function pushMockTestSection(lines, sectionNum, title, bodyLines) {
  const label = String(title || '')
    .replace(/^\d{1,2}\.\s*/, '')
    .trim();
  lines.push(`## ${sectionNum}. ${label}`, ...bodyLines, '');
}

const MCQ_OPTION_LABEL_RE = /^([A-Da-d])[\).:\-\s]+/;

function labelMcqOptions(options = [], maxOptions = 4) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const texts = (Array.isArray(options) ? options : [])
    .map((opt) => str(opt).trim())
    .filter(Boolean)
    .map((opt) => opt.replace(MCQ_OPTION_LABEL_RE, '').trim())
    .filter(Boolean);
  return texts.slice(0, maxOptions).map((text, i) => `${letters[i]}) ${text}`);
}

function formatMockTestQuestionLines(q, idx) {
  const out = [];
  const num = q?.question_number ?? idx + 1;
  const question = str(q?.question);
  if (!question) return out;
  out.push(`**Q${num}.** ${question}`);
  const opts = Array.isArray(q?.options) ? q.options : [];
  const labeled = opts.length >= 2 ? labelMcqOptions(opts) : opts.map((o) => str(o).trim()).filter(Boolean);
  for (const o of labeled) {
    if (o) out.push(`- ${o}`);
  }
  if (q?.marks != null && q?.marks !== '') out.push(`> *Marks: ${str(q.marks)}*`);
  const choice = str(q?.internal_choice_group);
  if (choice) out.push(`> *Internal choice:* ${choice}`);
  out.push('');
  return out;
}

/** Student self-check table — one row per question (markdown GFM). */
export function buildMockTestSelfAnalysisTableMarkdown(questionCount = 8) {
  const n = Math.max(Number(questionCount) || 0, 8);
  const lines = [
    '_Fill in after you complete the mock test. Compare with Section 7 (Answer Key)._',
    '',
    '| Q. No. | Section | Max marks | Marks scored | Correct? ✓/✗ | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (let i = 1; i <= n; i += 1) {
    lines.push(`| ${i} | — | — | | | |`);
  }
  lines.push('| **Total** | | **—** | | | |');
  return lines.join('\n');
}

/** One row per real question (not AI summary bands like "1–3"). */
export function buildMockTestSelfAnalysisTableFromSections(sections = []) {
  const lines = [
    '_Fill in after you complete the mock test. Compare with Section 7 (Answer Key)._',
    '',
    '| Q. No. | Section | Max marks | Marks scored | Correct? ✓/✗ | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  let n = 0;
  let totalMarks = 0;
  for (const sec of Array.isArray(sections) ? sections : []) {
    const secLabel = String(sec?.sectionName || sec?.name || sec?.title || 'Section')
      .replace(/\|/g, '/')
      .trim();
    const shortSec = secLabel.length > 30 ? `${secLabel.slice(0, 27)}…` : secLabel;
    for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
      n += 1;
      const marksRaw = q?.marks;
      const marksNum =
        marksRaw != null && marksRaw !== '' && Number.isFinite(Number(marksRaw)) ? Number(marksRaw) : null;
      const marksCell = marksNum != null ? String(marksNum) : '—';
      if (marksNum != null) totalMarks += marksNum;
      lines.push(`| ${n} | ${shortSec} | ${marksCell} | | | |`);
    }
  }
  if (n === 0) return buildMockTestSelfAnalysisTableMarkdown(8);
  lines.push(`| **Total** | | **${totalMarks > 0 ? totalMarks : '—'}** | | | |`);
  return lines.join('\n');
}

/** Replace AI tables that group questions (1–3) or use the wrong row count. */
export function shouldRebuildMockTestSelfAnalysisTable(tableMd, questionCount) {
  const count = Number(questionCount) || 0;
  if (count <= 0) return false;
  const raw = String(tableMd || '').trim();
  if (!raw || !raw.includes('|')) return true;
  if (/\d+\s*[-–—]\s*\d+/.test(raw)) return true;
  const rows = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && !/^\|[-\s|]+\|$/.test(l.replace(/[^|]/g, '')));
  const dataRows = rows.filter(
    (l) =>
      !l.includes('---') &&
      !/^\|\s*Q\.\s*No/i.test(l) &&
      !/Question\s*Number/i.test(l) &&
      !/^\|\s*Section\s*\|/i.test(l),
  );
  const withoutTotal = dataRows.filter((l) => !/\|\s*\*?\*?Total\*?\*?\s*\|/i.test(l));
  return withoutTotal.length !== count;
}

export function buildMockTestSolutionsFromSections(sections = []) {
  const lines = [];
  let n = 0;
  for (const sec of Array.isArray(sections) ? sections : []) {
    for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
      n += 1;
      const ans = str(q?.answer);
      const expl = str(q?.explanation);
      if (ans) {
        lines.push(
          `${n}. **${ans}**${expl ? ` — ${expl}` : ''} _(${String(sec?.sectionName || sec?.name || 'Section').replace(/\|/g, '/')})_`,
        );
      }
    }
  }
  return lines.join('\n');
}

export function formatMockTestAnswerKeyLinesFromSections(sections = []) {
  const lines = [];
  let n = 0;
  for (const sec of Array.isArray(sections) ? sections : []) {
    for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
      n += 1;
      const ans = str(q?.answer);
      if (ans) {
        lines.push(
          `${n}. **${ans}** _(${String(sec?.sectionName || sec?.name || 'Section').replace(/\|/g, '/')})_`,
        );
      }
    }
  }
  return lines;
}

function formatMockTestAnswerKeyLines(answerKey, sections) {
  if (str(answerKey)) {
    return String(answerKey)
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
  const lines = [];
  for (const sec of sections) {
    for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
      if (str(q?.answer)) {
        lines.push(`${q?.question_number ?? ''}. **${str(q.answer)}** (${str(sec?.sectionName || sec?.name || 'Section')})`);
      }
    }
  }
  return lines;
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
      const teacher = strArr(i.teacher_instructions || i.teacherInstructions);
      if (teacher.length) pushSection(lines, '7. Teacher Instructions', teacher.map((x) => `- ${x}`));
      const student = strArr(i.student_instructions || i.studentInstructions);
      if (student.length) pushSection(lines, '8. Student Instructions', student.map((x) => `- ${x}`));
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
    case 'project-idea-lab': {
      lines.push(`## Activity ${n}: ${str(i.title || i.name) || 'Untitled Activity'}`, '');
      const sub = str(i.subtopic_link_prior_knowledge);
      if (sub) pushSection(lines, '2. Subtopic Link and Prior Knowledge Required', [sub]);
      const lo = strArr(i.learning_objectives || i.learningObjectives);
      if (lo.length) pushSection(lines, "3. Learning Objectives - Bloom's Taxonomy Aligned", lo.map((x) => `- ${x}`));
      const ncf = str(i.ncf_competency_alignment);
      const ncfArr = strArr(Array.isArray(i.ncf_competency_alignment) ? i.ncf_competency_alignment : []);
      if (ncf) pushSection(lines, '4. NCF Competency / Learning Outcome Alignment', [ncf]);
      else if (ncfArr.length) pushSection(lines, '4. NCF Competency / Learning Outcome Alignment', ncfArr.map((x) => `- ${x}`));
      const mat = strArr(i.materials_required || i.materials);
      if (mat.length) pushSection(lines, '5. Materials Required', mat.map((x) => `- ${x}`));
      const proc = strArr(i.step_by_step_procedure || i.steps);
      if (proc.length) pushSection(lines, '6. Step-by-step Student Procedure', proc.map((x, idx) => `${idx + 1}. ${x}`));
      const safety = strArr(i.safety_care_instructions || i.safety_instructions || i.care_instructions);
      if (safety.length) pushSection(lines, '7. Safety and Care Instructions', safety.map((x) => `- ${x}`));
      const observation = str(i.observation_data_recording_table || i.observation_table || i.data_recording_table);
      if (observation) pushSection(lines, '8. Observation / Data Recording Table', [observation]);
      const creative = str(i.creative_output_final_product || i.creative_output || i.final_product);
      if (creative) pushSection(lines, '9. Creative Output / Final Product', [creative]);
      const diffPlan = Array.isArray(i.differentiation_plan)
        ? i.differentiation_plan.map((x) => str(x)).filter(Boolean).join('; ')
        : '';
      const diff = str(i.differentiation_support_extension || i.differentiation) || diffPlan;
      if (diff) pushSection(lines, '10. Differentiation: Support and Extension', [diff]);
      const rub = strArr(i.self_assessment_rubric || i.assessment_criteria_rubric || i.assessmentRubric);
      if (rub.length) pushSection(lines, '11. Self-Assessment Rubric', rub.map((x) => `- ${x}`));
      const exp = str(i.expected_learning_outcomes || i.expectedLearningOutcomes || i.learning_outcome);
      if (exp) pushSection(lines, '12. Expected Learning Outcomes', [exp]);
      const rl = str(i.real_life_application || i.realLifeApplication);
      if (rl) pushSection(lines, '13. Real-life Application', [rl]);
      const ref = str(i.reflection_exit_ticket);
      if (ref) pushSection(lines, '14. Reflection / Exit Ticket', [ref]);
      break;
    }
    case 'worksheet-mcq-generator': {
      const sheet = { ...i };
      if (!Array.isArray(sheet.sections) || !sheet.sections.length) {
        const legacySections = WORKSHEET_SECTION_SEQUENCE.map((secName, idx) => {
          const keys = [
            ['section_a_mcqs', 'section_a', 'questions'],
            ['section_b_fib', 'section_b', 'fill_in_blanks'],
            ['section_c_vsa', 'section_c'],
            ['section_d_sa', 'section_d'],
            ['section_e_competency', 'section_e', 'section_f_competency'],
          ][idx];
          const questions = keys
            .flatMap((k) => (Array.isArray(sheet[k]) ? sheet[k] : []))
            .filter((q) => q && typeof q === 'object');
          return { sectionName: secName, questions };
        });
        sheet.sections = legacySections;
      }
      lines.push(`## ${str(sheet.worksheet_title || sheet.title) || `Worksheet ${n}`}`, '');
      const lo = strArr(sheet.learning_objectives || sheet.objectives);
      pushSection(
        lines,
        '2. Learning Objectives',
        lo.length ? lo.map((x) => `- ${x}`) : [`- Understand key ideas in this worksheet.`],
      );
      pushSection(lines, '3. Instructions to Students', [
        str(sheet.instructions) || 'Answer all questions in each section.',
      ]);
      const byName = new Map();
      for (const sec of sheet.sections) {
        const secName = canonicalWorksheetSectionName(sec?.sectionName || sec?.name || 'Section');
        if (!byName.has(secName)) byName.set(secName, []);
        const prev = byName.get(secName);
        prev.push(...(Array.isArray(sec?.questions) ? sec.questions : []));
        byName.set(secName, prev);
      }
      let runningQNumber = 1;
      WORKSHEET_SECTION_SEQUENCE.forEach((secName, idx) => {
        const sectionQuestions = byName.get(secName) || [];
        lines.push(`### ${idx + 4}. ${secName}`, '');
        const qs =
          sectionQuestions.length > 0
            ? sectionQuestions
            : [
                {
                  question: `Apply ideas from ${secName} to a worked example.`,
                  answer: 'Show steps and label your reasoning.',
                },
              ];
        for (const q of qs) {
          const qNum = Number(q?.question_number || 0) > 0 ? Number(q.question_number) : runningQNumber;
          lines.push(`**Q${qNum}.** ${str(q?.question)}`, '');
          if (Array.isArray(q?.options) && q.options.length) {
            q.options.forEach((opt) => lines.push(String(opt)));
            lines.push('');
          }
          if (q?.answer) lines.push(`**Answer:** ${str(q.answer)}`);
          if (q?.marks != null) lines.push(`**Marks:** ${str(q.marks)}`);
          runningQNumber += 1;
        }
      });
      const answerKeyLines = normalizeWorksheetAnswerKeyLines(sheet.answer_key);
      pushSection(
        lines,
        '9. Answer Key',
        answerKeyLines.length ? answerKeyLines : ['See answers under each question.'],
      );
      const bloom = [str(sheet.bloom_level), str(sheet.difficulty_tag || sheet.difficulty)].filter(Boolean).join(' — ');
      pushSection(lines, "10. Bloom's Level and Difficulty Tag", [bloom || 'Apply — Medium']);
      break;
    }
    case 'mock-test-builder': {
      const fixedSections = [
        ['Section A: MCQs', i.section_a],
        ['Section B: Very Short Answer Questions', i.section_b],
        ['Section C: Short Answer Questions', i.section_c],
        ['Section D: Long Answer Questions', i.section_d],
        ['Section E: Case-based / Competency Questions', i.section_e],
      ]
        .filter(([, qs]) => Array.isArray(qs) && qs.length)
        .map(([sectionName, questions]) => ({ sectionName, questions }));
      const effectiveSections =
        Array.isArray(i.sections) && i.sections.length ? i.sections : fixedSections;

      const title = str(i.mock_test_title || i.paper_title || i.title || `Mock Test ${n}`);
      const isFullMockTest =
        effectiveSections.length > 0 ||
        Boolean(title) ||
        Boolean(str(i.test_purpose_subtopic_link || i.test_purpose || i.subtopic_link)) ||
        Boolean(str(i.question_paper)) ||
        Boolean(str(i.answer_key));

      if (isFullMockTest) {
        lines.push(`# ${title}`, '', `> **Mock Test Builder** · 12-section template for practice, review, and self-check.`, '---', '');
        pushMockTestSection(lines, 1, 'Mock Test Title', [title || `Mock Test ${n}`]);
        if (str(i.test_purpose_subtopic_link || i.test_purpose || i.subtopic_link)) {
          pushMockTestSection(lines, 2, 'Test Purpose and Subtopic Link', [
            str(i.test_purpose_subtopic_link || i.test_purpose || i.subtopic_link),
          ]);
        }
        const lo = strArr(i.learning_objectives || i.objectives);
        if (lo.length) {
          pushMockTestSection(lines, 3, "Learning Objectives - Bloom's Taxonomy Aligned", lo.map((x) => `- ${x}`));
        }
        if (str(i.ncf_competency_alignment || i.learning_outcome_alignment)) {
          pushMockTestSection(lines, 4, 'NCF Competency / Learning Outcome Alignment', [
            str(i.ncf_competency_alignment || i.learning_outcome_alignment),
          ]);
        }
        if (str(i.instructions)) {
          pushMockTestSection(lines, 5, 'Instructions for Students', [str(i.instructions)]);
        }
        lines.push(`## 6. Question Paper`, '', `*Answer in Section 7 after attempting all questions.*`, '');
        if (effectiveSections.length) {
          for (const sec of effectiveSections) {
            const secName = str(sec?.sectionName || sec?.name || 'Section');
            lines.push(`### ${secName}`, '');
            const qs = Array.isArray(sec?.questions) ? sec.questions : [];
            qs.forEach((q, qi) => {
              lines.push(...formatMockTestQuestionLines(q, qi));
            });
          }
        } else if (str(i.question_paper)) {
          lines.push(str(i.question_paper), '');
        } else {
          lines.push('_Questions were not structured for this deck — regenerate or edit Section 6._', '');
        }
        const answerKeyLines = formatMockTestAnswerKeyLines(i.answer_key, effectiveSections);
        if (answerKeyLines.length) {
          pushMockTestSection(lines, 7, 'Answer Key', answerKeyLines);
        }
        const solFromField = str(i.step_by_step_solutions_explanations || i.solutions || i.explanations);
        const solLines = solFromField
          ? solFromField.split(/\n/).filter(Boolean)
          : buildMockTestSolutionsFromSections(effectiveSections).split(/\n/).filter(Boolean);
        if (solLines.length) {
          pushMockTestSection(lines, 8, 'Step-by-step Solutions / Explanations', solLines);
        }
        const remedial = strArr(i.remedial_revision_suggestions || i.revision_suggestions || i.remedial_suggestions);
        if (remedial.length) {
          pushMockTestSection(lines, 9, 'Remedial Revision Suggestions', remedial.map((x) => `- ${x}`));
        }
        const outcomes = strArr(i.expected_learning_outcomes);
        if (outcomes.length) {
          pushMockTestSection(lines, 10, 'Expected Learning Outcomes', outcomes.map((x) => `- ${x}`));
        }
        if (str(i.real_life_application || i.real_life_connections)) {
          pushMockTestSection(lines, 11, 'Real-life Application', [
            str(i.real_life_application || i.real_life_connections),
          ]);
        }
        if (str(i.reflection_exit_ticket || i.reflection || i.exit_ticket)) {
          pushMockTestSection(lines, 12, 'Reflection / Exit Ticket', [
            str(i.reflection_exit_ticket || i.reflection || i.exit_ticket),
          ]);
        }
        break;
      }
      if (i.section) lines.push(`**${str(i.section)}**`, '');
      lines.push(`**Q${i.question_number || n}.** ${str(i.question)}`, '');
      if (Array.isArray(i.options) && i.options.length) {
        i.options.forEach((opt) => lines.push(`- ${String(opt)}`));
        lines.push('');
      }
      if (i.marks != null) lines.push(`> *Marks: ${str(i.marks)}*`);
      if (i.answer) lines.push(`> *Answer (for key):* ${str(i.answer)}`);
      if (i.explanation) lines.push(`> *Explanation:* ${str(i.explanation)}`);
      if (str(i.bloom_level)) lines.push(`> *Bloom / difficulty:* ${str(i.bloom_level)}`);
      break;
    }
    case 'exam-question-paper-generator': {
      const parseExamBlueprintCounts = (blueprintText) => {
        const text = str(blueprintText);
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
      };
      const examBoundaryRe =
        /(section\s*[a-e]\s*:|internal\s+choices\b|complete\s+answer\s+key\b|detailed\s+marking\s+scheme\b|rubric\s+for\s+open[-\s]?ended\b|total\s+marks\b)/i;
      const sanitizeExamQuestionText = (value) => {
        const raw = str(value).replace(/\r\n/g, '\n');
        if (!raw) return '';
        const idx = raw.search(examBoundaryRe);
        if (idx > 12) return raw.slice(0, idx).trim();
        return raw.trim();
      };
      const normalizeExamQKey = (q) => {
        const qText = sanitizeExamQuestionText(q?.question || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const opts = (Array.isArray(q?.options) ? q.options : [])
          .map((o) =>
            str(o)
              .toLowerCase()
              .replace(/[^a-z0-9\s]+/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .filter(Boolean)
          .join('|');
        return `${qText}|${opts}`;
      };
      const examSectionOrder = [
        ['Section A: MCQs', i.section_a],
        ['Section B: Very Short Answer Questions', i.section_b],
        ['Section C: Short Answer Questions', i.section_c],
        ['Section D: Long Answer Questions', i.section_d],
        ['Section E: Case-based / Competency Questions', i.section_e],
      ];
      const fixedSections = examSectionOrder
        .filter(([, qs]) => Array.isArray(qs) && qs.length)
        .map(([sectionName, questions]) => ({ sectionName, questions }));
      const namedFromSections = (Array.isArray(i.sections) ? i.sections : []).filter((sec) => {
        const name = str(sec?.sectionName || sec?.name || '');
        return /section\s*[a-e]/i.test(name) && Array.isArray(sec?.questions) && sec.questions.length;
      });
      const seeded = fixedSections.length ? fixedSections : namedFromSections;
      const counts = parseExamBlueprintCounts(i.blueprint || i.design_grid);
      const limits = [counts.a, counts.b, counts.c, counts.d, counts.e];
      const effectiveSections = seeded.map((sec, secIdx) => {
        const deduped = [];
        const seen = new Set();
        for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
          const cleanedQuestion = sanitizeExamQuestionText(q?.question);
          if (!cleanedQuestion) continue;
          const row = { ...q, question: cleanedQuestion };
          const key = normalizeExamQKey(row);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          deduped.push(row);
        }
        const limit = Math.max(0, Number(limits[secIdx] || 0));
        return {
          sectionName: str(sec?.sectionName || sec?.name || 'Section'),
          questions: limit > 0 ? deduped.slice(0, limit) : deduped,
        };
      });

      if (effectiveSections.length) {
        lines.push(`## ${str(i.paper_title || i.title) || `Exam Paper ${n}`}`, '');
        pushSection(lines, '1. Paper Title and General Instructions', [
          str(i.paper_title || i.title || `Exam Paper ${n}`),
          str(i.instructions),
        ].filter(Boolean));
        if (str(i.blueprint || i.design_grid)) {
          pushSection(lines, '2. Blueprint / Design Grid', [str(i.blueprint || i.design_grid)]);
        }
        let qNum = 0;
        for (const sec of effectiveSections) {
          const secName = str(sec?.sectionName || sec?.name || 'Section');
          lines.push(`### ${secName}`, '');
          for (const q of Array.isArray(sec?.questions) ? sec.questions : []) {
            qNum += 1;
            const num = q?.question_number != null ? q.question_number : qNum;
            lines.push(`**Q${num}.** ${str(q?.question)}`, '');
            if (Array.isArray(q?.options) && q.options.length) {
              q.options.forEach((opt) => lines.push(String(opt)));
              lines.push('');
            }
            if (q?.marks != null) lines.push(`**Marks:** ${str(q.marks)}`);
          }
        }
        if (str(i.internal_choices)) pushSection(lines, '8. Internal Choices', [str(i.internal_choices)]);
        if (str(i.answer_key)) pushSection(lines, '9. Complete Answer Key', [str(i.answer_key)]);
        if (str(i.marking_scheme)) pushSection(lines, '10. Detailed Marking Scheme', [str(i.marking_scheme)]);
        if (str(i.open_ended_rubric)) {
          pushSection(lines, '11. Rubric for Open-ended Questions', [str(i.open_ended_rubric)]);
        }
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
      const lessonTitle = str(i.lesson_name || i.title || i.name) || `Lesson ${n}`;
      lines.push(`## ${lessonTitle}`, '');
      pushSection(lines, '1. Lesson Title', [lessonTitle]);
      const lo = strArr(i.learning_objectives || i.objectives);
      pushSection(lines, '2. Learning Objectives', lo.length ? lo.map((x) => `- ${x}`) : ['- Students understand the lesson focus.']);
      const ncf = str(i.ncf_competency_alignment);
      const ncfArr = strArr(Array.isArray(i.ncf_competency_alignment) ? i.ncf_competency_alignment : []);
      if (ncf) pushSection(lines, '3. NCF Competency / Learning Outcome Alignment', [ncf]);
      else pushSection(lines, '3. NCF Competency / Learning Outcome Alignment', ncfArr.length ? ncfArr.map((x) => `- ${x}`) : ['Aligned to curriculum competencies.']);
      pushSection(lines, '4. Prior Knowledge / Diagnostic Question', [str(i.prior_knowledge_diagnostic || i.prior_knowledge)]);
      pushSection(lines, '5. Introduction / Warm-up', [str(i.introduction_warmup || i.warmup)]);
      pushSection(lines, '6. Teaching Strategy', [str(i.teaching_strategy)]);
      const acts = strArr(i.teaching_activities || i.activities);
      pushSection(lines, '7. Classroom Activities', acts.length ? acts.map((x, idx) => `${idx + 1}. ${x}`) : ['1. Guided class discussion.']);
      const talk = strArr(i.teacher_talk_points || i.teacher_instructions);
      pushSection(lines, '8. Teacher Talk Points', talk.length ? talk.map((x) => `- ${x}`) : ['- Key teaching points for this lesson.']);
      const tasks = strArr(i.student_tasks || i.student_instructions);
      pushSection(lines, '9. Student Tasks', tasks.length ? tasks.map((x) => `- ${x}`) : ['- Complete the notebook task.']);
      const formative = strArr(i.formative_assessment_questions);
      pushSection(lines, '10. Formative Assessment Questions', formative.length ? formative.map((x) => `- ${x}`) : ['- Quick check: explain the main idea.']);
      pushSection(lines, '11. Differentiation Plan', [str(i.differentiation_plan || i.differentiation)]);
      pushSection(lines, '12. Homework / Practice', [str(i.homework_practice || i.homework)]);
      const aids = strArr(i.teaching_aids_required || i.materials_required || i.materials);
      pushSection(lines, '13. Teaching Aids Required', aids.length ? aids.map((x) => `- ${x}`) : ['- Whiteboard, textbook']);
      pushSection(lines, '14. Closure / Exit Ticket', [str(i.closure_exit_ticket || i.reflection_exit_ticket)]);
      break;
    }
    case 'study-schedule-maker': {
      const schedTitle = str(i.study_schedule_title || i.lesson_name || i.title || i.name) || `Study Schedule ${n}`;
      lines.push(`## ${schedTitle}`, '');
      pushSection(lines, '1. Study Schedule Title', [schedTitle]);
      const goal = str(i.study_goal_subtopic_link || i.subtopic_link);
      if (goal) pushSection(lines, '2. Study Goal and Subtopic Link', [goal]);
      const prior = str(i.prior_knowledge_readiness_check || i.prior_knowledge_diagnostic);
      if (prior) pushSection(lines, '3. Prior Knowledge and Readiness Check', [prior]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, "4. Learning Objectives - Bloom's Taxonomy Aligned", lo.map((x) => `- ${x}`));
      const ncf = str(i.ncf_competency_alignment);
      const ncfArr = strArr(Array.isArray(i.ncf_competency_alignment) ? i.ncf_competency_alignment : []);
      if (ncf) pushSection(lines, '5. NCF Competency / Learning Outcome Alignment', [ncf]);
      else if (ncfArr.length) pushSection(lines, '5. NCF Competency / Learning Outcome Alignment', ncfArr.map((x) => `- ${x}`));
      const concept =
        str(i.concept_learning_slot || i.conceptLearningSlot) ||
        [str(i.introduction_warmup), str(i.teaching_strategy), strArr(i.teaching_activities || i.activities).join('\n')]
          .filter(Boolean)
          .join('\n\n');
      const practiceEarly =
        str(i.practice_slot || i.practiceSlot) ||
        [str(i.homework_practice), strArr(i.student_tasks || i.student_instructions).join('\n')]
          .filter(Boolean)
          .join('\n\n');
      const breaksEarly = str(i.breaks_focus_tips || i.breaksFocusTips);
      const checkpointEarly =
        str(i.self_assessment_checkpoint || i.selfAssessmentCheckpoint) ||
        strArr(i.formative_assessment_questions).join('\n') ||
        str(i.assessment);
      let planTable = strArr(
        i.study_plan_table || i.studyPlanTable || i.timeline || i.schedule,
      );
      if (!planTable.length && Array.isArray(i.time_slots)) {
        planTable = i.time_slots
          .map((ts) => {
            const t = str(ts?.time || ts?.duration || ts?.slot);
            const a = str(ts?.activity || ts?.task || ts?.topic || ts?.description);
            if (t && a) return `${t}: ${a}`;
            return a || t;
          })
          .filter(Boolean);
      }
      if (!planTable.length) {
        const goalEarly = str(i.study_goal_subtopic_link || i.studyGoalSubtopicLink);
        const synthesized = [];
        if (goalEarly) synthesized.push(`Focus: ${goalEarly}`);
        if (concept) synthesized.push(`Concept learning: ${concept}`);
        if (practiceEarly) synthesized.push(`Practice: ${practiceEarly}`);
        if (breaksEarly) synthesized.push(`Breaks & focus: ${breaksEarly}`);
        if (checkpointEarly) synthesized.push(`Self-assessment: ${checkpointEarly}`);
        if (synthesized.length) planTable = synthesized;
      }
      if (planTable.length) pushSection(lines, '6. Study Plan Table', planTable.map((x, idx) => `${idx + 1}. ${x}`));
      if (concept) pushSection(lines, '7. Concept Learning Slot', [concept]);
      if (practiceEarly) pushSection(lines, '8. Practice Slot', [practiceEarly]);
      if (breaksEarly) pushSection(lines, '9. Breaks and Focus Tips', [breaksEarly]);
      if (checkpointEarly) pushSection(lines, '10. Self-Assessment Checkpoint', [checkpointEarly]);
      const support = str(i.support_extension_plan || i.differentiation_plan || i.differentiation);
      if (support) pushSection(lines, '11. Support and Extension Plan', [support]);
      const outcomes = strArr(i.expected_learning_outcomes);
      if (outcomes.length) pushSection(lines, '12. Expected Learning Outcomes', outcomes.map((x) => `- ${x}`));
      const reflection = str(i.reflection_exit_ticket || i.closure_exit_ticket);
      if (reflection) pushSection(lines, '13. Reflection / Exit Ticket', [reflection]);
      break;
    }
    case 'homework-creator': {
      lines.push(`## ${str(i.title) || `Homework ${n}`}`, '');
      pushSection(lines, '1. Homework Title', [str(i.title) || `Homework ${n}`]);
      pushSection(lines, '2. Clear Student Instructions', [str(i.instructions)]);
      const pq = strArr(i.practice_questions);
      const qs = pq.length ? pq : strArr(i.questions);
      pushSection(
        lines,
        '3. Practice Questions',
        qs.length
          ? qs.map((q, idx) => (typeof q === 'string' ? `${idx + 1}. ${q}` : `${idx + 1}. ${str(q.question)}`))
          : ['1. Review your class notes and answer two short questions.'],
      );
      const app = strArr(i.application_tasks);
      pushSection(
        lines,
        '4. Application-based Tasks',
        app.length ? app.map((x) => `- ${x}`) : ['- Apply the topic to one real-life example.'],
      );
      pushSection(lines, '5. One Creative / Thinking Question', [str(i.creative_thinking_question)]);
      pushSection(lines, '6. One Real-life Observation Task', [str(i.real_life_observation_task)]);
      pushSection(lines, '7. Challenge Question', [str(i.challenge_question)]);
      pushSection(lines, '8. Support Hint', [str(i.support_hint)]);
      pushSection(lines, '9. Answer Hints / Key Points', [str(i.answer_hints)]);
      pushSection(lines, '10. Parent Note', [str(i.parent_note)]);
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
      if (str(i.grading_criteria)) pushSection(lines, '4. Grading Criteria', [str(i.grading_criteria)]);
      if (str(i.strengths_observed)) pushSection(lines, '5. Strengths Observed', [str(i.strengths_observed)]);
      if (str(i.areas_for_improvement)) pushSection(lines, '6. Areas for Improvement', [str(i.areas_for_improvement)]);
      if (str(i.teacher_remarks)) pushSection(lines, '7. Teacher Remarks', [str(i.teacher_remarks)]);
      if (str(i.actionable_suggestions)) pushSection(lines, '8. Actionable Improvement Suggestions', [str(i.actionable_suggestions)]);
      if (str(i.parent_friendly_feedback)) pushSection(lines, '9. Parent-friendly Feedback', [str(i.parent_friendly_feedback)]);
      if (str(i.next_step_remedial_enrichment)) pushSection(lines, '10. Next-step Remedial / Enrichment Activity', [str(i.next_step_remedial_enrichment)]);
      break;
    }
    case 'reading-practice-room': {
      const title = str(i.reading_practice_title || i.title) || `Reading Practice ${n}`;
      lines.push(`## ${title}`, '');
      pushSection(lines, '1. Reading Practice Title', [title]);
      const sub = str(i.subtopic_link_prior_knowledge || i.subtopic_link || i.prior_knowledge);
      if (sub) pushSection(lines, '2. Subtopic Link and Prior Knowledge Required', [sub]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, "3. Learning Objectives - Bloom's Taxonomy Aligned", lo.map((x) => `- ${x}`));
      const ncf = str(i.ncf_competency_alignment);
      const ncfArr = strArr(Array.isArray(i.ncf_competency_alignment) ? i.ncf_competency_alignment : []);
      if (ncf) pushSection(lines, '4. NCF Competency / Learning Outcome Alignment', [ncf]);
      else if (ncfArr.length) pushSection(lines, '4. NCF Competency / Learning Outcome Alignment', ncfArr.map((x) => `- ${x}`));
      const warm = strArr(i.vocabulary_warmup || i.vocabulary_support || i.vocabulary);
      if (warm.length) pushSection(lines, '5. Vocabulary Warm-up', warm.map((x) => `- ${x}`));
      if (str(i.passage || i.content)) pushSection(lines, '6. Passage / Story', [str(i.passage || i.content)]);
      const recall = strArr(i.read_and_recall_questions || i.recall_questions);
      if (recall.length) {
        pushSection(lines, '7. Read and Recall Questions', recall.map((x, idx) => `${idx + 1}. ${x}`));
      } else {
        const legacyQ = Array.isArray(i.questions) ? i.questions : [];
        const legacyRecall = legacyQ.map((q) => (typeof q === 'object' && q ? str(q.question || q) : str(q))).filter(Boolean);
        if (legacyRecall.length) pushSection(lines, '7. Read and Recall Questions', legacyRecall.map((x, idx) => `${idx + 1}. ${x}`));
      }
      const infer = strArr(i.think_and_infer_questions || i.infer_questions);
      if (infer.length) pushSection(lines, '8. Think and Infer Questions', infer.map((x, idx) => `${idx + 1}. ${x}`));
      const connect = strArr(i.apply_and_connect_questions || i.connect_questions);
      if (connect.length) pushSection(lines, '9. Apply and Connect Questions', connect.map((x, idx) => `${idx + 1}. ${x}`));
      const vocabPractice = strArr(i.vocabulary_practice);
      if (vocabPractice.length) pushSection(lines, '10. Vocabulary Practice', vocabPractice.map((x, idx) => `${idx + 1}. ${x}`));
      const answers = strArr(i.answer_key_suggested_responses || i.answer_hints);
      if (answers.length) pushSection(lines, '11. Answer Key / Suggested Responses', answers.map((x, idx) => `${idx + 1}. ${x}`));
      const outcomes = strArr(i.expected_learning_outcomes);
      if (outcomes.length) pushSection(lines, '12. Expected Learning Outcomes', outcomes.map((x) => `- ${x}`));
      const ref = str(i.reflection_exit_ticket || i.reflection_prompt);
      if (ref) pushSection(lines, '13. Reflection / Exit Ticket', [ref]);
      break;
    }
    case 'story-passage-creator': {
      const title = str(i.title || i.passage_title || i.story_title) || `Story ${n}`;
      lines.push(`## ${title}`, '');
      pushSection(lines, '1. Story / Passage Title', [title]);
      const topicSub = str(i.topic_subtopic_connection || i.topic_and_subtopic_connection || i.subtopic_link);
      if (topicSub) pushSection(lines, '2. Topic and Subtopic Connection', [topicSub]);
      const prior = str(i.prior_knowledge_required || i.prior_knowledge);
      if (prior) pushSection(lines, '3. Prior Knowledge Required', [prior]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) {
        pushSection(lines, "4. Learning Objectives – Bloom's Taxonomy Aligned", lo.map((x) => `- ${x}`));
      }
      const ncf = str(i.ncf_competency_alignment);
      const ncfArr = strArr(Array.isArray(i.ncf_competency_alignment) ? i.ncf_competency_alignment : []);
      if (ncf) pushSection(lines, '5. NCF Competency / Learning Outcome Alignment', [ncf]);
      else if (ncfArr.length) pushSection(lines, '5. NCF Competency / Learning Outcome Alignment', ncfArr.map((x) => `- ${x}`));
      const warm = strArr(i.vocabulary_warmup || i.vocabulary_support || i.vocabulary);
      if (warm.length) pushSection(lines, '6. Vocabulary Warm-up', warm.map((x) => `- ${x}`));
      const preRead = str(i.pre_reading_thinking_prompt || i.pre_reading_prompt);
      if (preRead) pushSection(lines, '7. Pre-reading Thinking Prompt', [preRead]);
      if (str(i.passage || i.content || i.story_passage_content)) {
        pushSection(lines, '8. Story / Passage Content', [str(i.passage || i.content || i.story_passage_content)]);
      }
      const recall = strArr(i.read_and_recall_questions || i.recall_questions);
      if (recall.length) {
        pushSection(lines, '9. Read and Recall Questions', recall.map((x, idx) => `${idx + 1}. ${x}`));
      }
      const infer = strArr(i.think_and_infer_questions || i.infer_questions);
      if (infer.length) pushSection(lines, '10. Think and Infer Questions', infer.map((x, idx) => `${idx + 1}. ${x}`));
      const connect = strArr(i.apply_and_connect_questions || i.connect_questions);
      if (connect.length) pushSection(lines, '11. Apply and Connect Questions', connect.map((x, idx) => `${idx + 1}. ${x}`));
      const vocabGram = str(i.vocabulary_grammar_practice) || strArr(i.vocabulary_practice).join('\n');
      if (vocabGram) pushSection(lines, '12. Vocabulary and Grammar Practice', [vocabGram]);
      const creative = str(i.creative_response_activity);
      if (creative) pushSection(lines, '13. Creative Response Activity', [creative]);
      const answers = strArr(i.answer_key_suggested_responses || i.answer_hints);
      if (answers.length) pushSection(lines, '14. Answer Key / Suggested Responses', answers.map((x, idx) => `${idx + 1}. ${x}`));
      const mistakes = str(i.common_mistakes_to_avoid);
      if (mistakes) pushSection(lines, '15. Common Mistakes to Avoid', [mistakes]);
      if (str(i.differentiation_support)) pushSection(lines, '16. Differentiation Support', [str(i.differentiation_support)]);
      const outcomes = strArr(i.expected_learning_outcomes);
      if (outcomes.length) pushSection(lines, '17. Expected Learning Outcomes', outcomes.map((x) => `- ${x}`));
      if (str(i.real_life_application || i.real_life_link)) {
        pushSection(lines, '18. Real-life Application', [str(i.real_life_application || i.real_life_link)]);
      }
      const ref = str(i.reflection_exit_ticket || i.reflection_prompt || i.reflection);
      if (ref) pushSection(lines, '19. Reflection / Exit Ticket', [ref]);
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
    case 'my-study-decks': {
      const title = str(i.deck_title || i.title) || `Deck ${n}`;
      lines.push(`## ${title}`, '');
      pushSection(lines, '1. Deck Title', [title]);
      const sub = str(i.subtopic_link_prior_knowledge_required || i.prior_knowledge_required);
      if (sub) pushSection(lines, '2. Subtopic Link and Prior Knowledge Required', [sub]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) {
        pushSection(lines, "3. Learning Objectives - Bloom's Taxonomy Aligned", lo.map((x) => `- ${x}`));
      }
      const ncf = str(i.ncf_competency_alignment || i.learning_outcome_alignment);
      if (ncf) pushSection(lines, '4. NCF Competency / Learning Outcome Alignment', [ncf]);
      const cards = Array.isArray(i.cards) ? i.cards : [];
      if (cards.length) {
        lines.push('### 5. Flashcard Set');
        cards.forEach((card, idx) => {
          const c = card && typeof card === 'object' ? card : {};
          const front = str(c.front);
          const back = str(c.back);
          if (front || back) {
            lines.push(`**Card ${idx + 1}**`, `Front: ${front}`, `Back: ${back}`, '');
          }
        });
        lines.push('');
      }
      const appendPerCardDeckSection = (sectionNum, label, pickValue) => {
        const block = [];
        cards.forEach((card, idx) => {
          const c = card && typeof card === 'object' ? card : {};
          const value = str(pickValue(c));
          if (value) block.push(`Card ${idx + 1}`, value, '');
        });
        if (block.length) pushSection(lines, `${sectionNum}. ${label}`, block);
      };
      if (cards.length) {
        appendPerCardDeckSection(6, 'Difficulty Tag for Each Card', (c) =>
          c.difficulty_tag_for_each_card || c.difficulty_tag || c.difficulty_level || c.skill_focus,
        );
        appendPerCardDeckSection(7, 'Memory Hook / Quick Tip', (c) =>
          c.memory_hook_quick_tip || c.memory_cue || c.hint,
        );
        appendPerCardDeckSection(8, 'Self-Check Round', (c) =>
          c.self_check_round || c.peer_prompt || c.self_check,
        );
      }
      const mistakes = strArr(i.common_mistakes_to_avoid);
      if (mistakes.length) pushSection(lines, '9. Common Mistakes to Avoid', mistakes.map((x) => `- ${x}`));
      const outcomes = strArr(i.expected_learning_outcomes);
      if (outcomes.length) pushSection(lines, '10. Expected Learning Outcomes', outcomes.map((x) => `- ${x}`));
      if (str(i.real_life_application)) pushSection(lines, '11. Real-life Application', [str(i.real_life_application)]);
      if (str(i.reflection_exit_ticket || i.reflection_prompt)) {
        pushSection(lines, '12. Reflection / Exit Ticket', [str(i.reflection_exit_ticket || i.reflection_prompt)]);
      }
      break;
    }
    case 'flashcard-generator': {
      const title = str(i.flashcard_deck_title || i.deck_title || i.title) || `Deck ${n}`;
      lines.push(`## ${title}`, '');
      pushSection(lines, '1. Context & Alignment', [
        `Deck Title: ${title}`,
        str(i.topic) ? `Topic: ${str(i.topic)}` : '',
        str(i.subtopic) ? `Subtopic: ${str(i.subtopic)}` : '',
        str(i.topic_and_subtopic_link || i.subtopic_link)
          ? `Topic Link: ${str(i.topic_and_subtopic_link || i.subtopic_link)}`
          : '',
        str(i.class_level) ? `Class: ${str(i.class_level)}` : '',
        str(i.difficulty_level || i.difficulty) ? `Difficulty: ${str(i.difficulty_level || i.difficulty)}` : '',
        str(i.bloom_level || i.bloom) ? `Bloom's Level: ${str(i.bloom_level || i.bloom)}` : '',
      ].filter(Boolean));
      const pk = str(i.prior_knowledge_required);
      const lo = strArr(i.learning_objectives || i.objectives);
      const ncf = str(i.ncf_competency_alignment || i.learning_outcome_alignment);
      pushSection(lines, '2. Foundations', [
        pk ? `Prior Knowledge Required: ${pk}` : '',
        lo.length ? `Learning Objectives:\n${lo.map((x) => `- ${x}`).join('\n')}` : '',
        ncf ? `NCF Competency / Learning Outcome Alignment: ${ncf}` : '',
      ].filter(Boolean));
      const cardList =
        (Array.isArray(i.application_hots_cards) && i.application_hots_cards.length
          ? i.application_hots_cards
          : null) ||
        (Array.isArray(i.cards) ? i.cards : []);
      if (cardList.length) {
        lines.push('### 3. The Card Set: Application & HOTS');
        cardList.forEach((card, idx) => {
          const c = card && typeof card === 'object' ? card : {};
          const task = str(c.front || c.task || c.question);
          const solution = str(c.back || c.solution || c.answer);
          if (!task && !solution) return;
          lines.push(`**Card ${idx + 1}**`, `Task: ${task}`, `Solution: ${solution}`);
          const diff = str(c.difficulty_tag_for_each_card || c.difficulty_tag);
          if (diff) lines.push(`Difficulty: ${diff}`);
          const hook = str(c.memory_hook_quick_tip || c.memory_cue);
          if (hook) lines.push(`Memory Hook: ${hook}`);
          lines.push('');
        });
      }
      const deckHook = str(i.deck_memory_hook || i.memory_hook_quick_tip);
      const mistakes = strArr(i.common_mistakes_to_avoid);
      const recall = str(i.self_check_rapid_recall_round || i.self_check_round);
      pushSection(lines, '4. Study Aids', [
        deckHook ? `Memory Hook: ${deckHook}` : '',
        mistakes.length ? `Common Mistakes to Avoid:\n${mistakes.map((x) => `- ${x}`).join('\n')}` : '',
        recall ? `Rapid Recall: ${recall}` : '',
      ].filter(Boolean));
      const rl = str(i.real_life_connection || i.real_life_application);
      const diffSupport = str(i.differentiation_support || i.differentiation);
      const exit = str(i.reflection_exit_ticket || i.reflection);
      pushSection(lines, '5. Wrap-Up', [
        rl ? `Real-life Connection: ${rl}` : '',
        diffSupport ? `Differentiation: ${diffSupport}` : '',
        exit ? `Exit Ticket: ${exit}` : '',
      ].filter(Boolean));
      break;
    }
    case 'smart-study-guide-generator': {
      const guideTitle =
        sanitizeStudyGuideTitle(str(i.title), '') || `Study Guide ${n}`;
      lines.push(
        `# ${guideTitle}`,
        '',
        `> **Smart Study Guide** · 11-section template.`,
        '---',
        '',
      );
      pushMockTestSection(lines, 1, 'Study Guide Title', [guideTitle]);
      const overview = str(i.chapter_subtopic_overview || i.chapter_overview || i.overview);
      if (overview) pushSection(lines, '2. Chapter and Subtopic Overview', [overview]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, '3. Learning Objectives', lo.map((x) => `- ${x}`));
      const pk = strArr(i.prior_knowledge_required || i.prior_knowledge);
      if (pk.length) pushSection(lines, '4. Prior Knowledge Required', pk.map((x) => `- ${x}`));
      const kc = Array.isArray(i.key_concepts) ? i.key_concepts : Array.isArray(i.concepts) ? i.concepts : [];
      if (kc.length) {
        lines.push('### 5. Key Concepts Explained in Simple Language');
        kc.forEach((c, idx) => {
          const row = c && typeof c === 'object' ? c : { name: String(c) };
          lines.push(`${idx + 1}. **${str(row.name || row.concept)}** — ${str(row.explanation)}`);
        });
        lines.push('');
      }
      const defs = Array.isArray(i.definitions) ? i.definitions : [];
      const fm = Array.isArray(i.formulae)
        ? i.formulae
        : Array.isArray(i.formulas)
          ? i.formulas
          : [];
      if (defs.length || fm.length) {
        lines.push('### 6. Important Definitions and Formulae');
        defs.forEach((d, idx) => {
          const row = d && typeof d === 'object' ? d : { term: String(d) };
          lines.push(`${idx + 1}. **${str(row.term || row.name)}** — ${str(row.definition)}`);
        });
        fm.forEach((f, idx) => {
          const row = f && typeof f === 'object' ? f : { formula: String(f) };
          lines.push(
            `${defs.length + idx + 1}. ${str(row.name)}: ${str(row.formula)}${row.note ? ` (${str(row.note)})` : ''}`,
          );
        });
        lines.push('');
      }
      const flow = str(i.concept_flow_mind_map || i.concept_flow || i.mind_map);
      if (flow) pushSection(lines, '7. Concept Flow / Mind Map Suggestion', [flow]);
      const rl = strArr(i.real_life_examples || i.real_life_applications || i.examples);
      if (rl.length) pushSection(lines, '8. Real-life Examples and Applications', rl.map((x) => `- ${x}`));
      const rev = strArr(i.quick_revision_notes || i.revision_checklist || i.quick_review);
      if (rev.length) pushSection(lines, '9. Quick Revision Notes', rev.map((x) => `- ${x}`));
      const pqs = Array.isArray(i.practice_questions) ? i.practice_questions : [];
      if (pqs.length) {
        lines.push('### 10. Practice Questions (Objective + Subjective)');
        pqs.forEach((q, idx) => {
          const row = q && typeof q === 'object' ? q : { question: String(q) };
          const qType = str(row.type) || 'subjective';
          lines.push(`${idx + 1}. [${qType}] ${str(row.question)}`);
          const opts = Array.isArray(row.options) ? row.options : [];
          const labeled = opts.length >= 2 ? labelMcqOptions(opts) : opts.map((o) => str(o).trim()).filter(Boolean);
          labeled.forEach((opt) => lines.push(`   ${opt}`));
          if (str(row.answer)) lines.push(`   **Answer:** ${str(row.answer)}`);
        });
        lines.push('');
      }
      const tips = strArr(i.improvement_tips || i.study_tips || i.tips);
      if (tips.length) pushSection(lines, '11. Tips for Further Improvement', tips.map((x) => `- ${x}`));
      break;
    }
    case 'concept-breakdown-explainer': {
      const title = str(i.concept_title || i.concept_name || i.title) || `Concept ${n}`;
      lines.push(
        `# ${title}`,
        '',
        `> **Concept Breakdown Explainer** · 9-section template for clear, stepwise understanding.`,
        '---',
        '',
      );
      pushMockTestSection(lines, 1, 'Concept Title', [title]);
      if (str(i.simple_definition || i.simple_explanation || i.explanation)) {
        pushMockTestSection(lines, 2, 'Simple Definition', [
          str(i.simple_definition || i.simple_explanation || i.explanation),
        ]);
      }
      const steps = strArr(i.breakdown_steps || i.steps);
      if (steps.length) {
        pushMockTestSection(
          lines,
          3,
          'Step-by-step Concept Breakdown',
          steps.map((x, idx) => `${idx + 1}. ${x}`),
        );
      }
      const ex = strArr(i.real_life_examples || i.examples || i.indian_context_examples);
      if (ex.length) {
        pushMockTestSection(
          lines,
          4,
          'Real-life and Indian Context Examples',
          ex.map((x) => `- ${x}`),
        );
      }
      const terms = Array.isArray(i.important_terms) ? i.important_terms : [];
      if (terms.length) {
        const termLines = terms.map((t, idx) => {
          const row = t && typeof t === 'object' ? t : { term: String(t) };
          return `${idx + 1}. **${str(row.term || row.keyword)}**${row.definition ? ` — ${str(row.definition)}` : ''}`;
        });
        pushMockTestSection(lines, 5, 'Important Terms and Keywords', termLines);
      }
      const qc = strArr(i.concept_check_questions || i.quick_check_questions);
      if (qc.length) {
        pushMockTestSection(
          lines,
          6,
          'Concept Check Questions',
          qc.map((q, idx) => `${idx + 1}. ${q}`),
        );
      }
      if (str(i.application_thinking_question || i.application_question)) {
        pushMockTestSection(lines, 7, 'Application-based Thinking Question', [
          str(i.application_thinking_question || i.application_question),
        ]);
      }
      if (str(i.higher_order_thinking_prompt || i.hots_prompt || i.hots_question)) {
        pushMockTestSection(lines, 8, 'Higher-order Thinking Prompt', [
          str(i.higher_order_thinking_prompt || i.hots_prompt || i.hots_question),
        ]);
      }
      if (str(i.quick_revision_summary || i.revision_summary || i.summary)) {
        pushMockTestSection(lines, 9, 'Quick Revision Summary', [
          str(i.quick_revision_summary || i.revision_summary || i.summary),
        ]);
      }
      break;
    }
    case 'smart-qa-practice-generator': {
      if (Array.isArray(i.sections) && i.sections.length) {
        lines.push(`## ${str(i.title || i.practice_set_title) || `Practice Set ${n}`}`, '');
        const lo = strArr(i.learning_objectives || i.objectives);
        if (lo.length) pushSection(lines, '2. Learning Objectives', lo.map((x) => `- ${x}`));
        if (str(i.instructions)) pushSection(lines, '3. Instructions to Students', [str(i.instructions)]);
        const sectionOrder = [
          'Section A: MCQs',
          'Section B: Fill in the Blanks',
          'Section C: Match the Following',
          'Section D: Very Short Answer Questions',
          'Section E: Short Answer Questions',
          'Section F: Application / Case-based Questions',
          'Section G: HOTS / Analytical Questions',
        ];
        let secNum = 4;
        for (const label of sectionOrder) {
          const sec = i.sections.find(
            (s) => str(s?.sectionName || s?.name).toLowerCase() === label.toLowerCase(),
          );
          const qs = sec ? (Array.isArray(sec.questions) ? sec.questions : []) : [];
          if (!qs.length) continue;
          lines.push(`### ${secNum}. ${label}`, '');
          secNum += 1;
          for (const q of qs) {
            const bloom = str(q?.bloom_level);
            const diff = str(q?.difficulty_tag || q?.difficulty);
            lines.push(
              `**Q${q?.question_number || ''}.** ${str(q?.question)}${bloom || diff ? ` _(Bloom: ${bloom || '—'}, Difficulty: ${diff || '—'})_` : ''}`,
              '',
            );
            if (Array.isArray(q?.options) && q.options.length) {
              q.options.forEach((opt) => lines.push(String(opt)));
              lines.push('');
            }
            if (q?.answer) lines.push(`**Answer:** ${str(q.answer)}`);
            if (q?.explanation) lines.push(`**Explanation:** ${str(q.explanation)}`);
            if (q?.marks != null) lines.push(`**Marks:** ${str(q.marks)}`);
          }
        }
        const ak = str(i.answer_key_with_explanations || i.answer_key);
        if (ak) pushSection(lines, '11. Answer Key with Explanations', [ak]);
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
      if (str(i.bloom_level)) lines.push(`**Bloom:** ${str(i.bloom_level)}`);
      if (str(i.difficulty_tag || i.difficulty)) {
        lines.push(`**Difficulty:** ${str(i.difficulty_tag || i.difficulty)}`);
      }
      break;
    }
    case 'quick-assignment-builder': {
      const qaTitle = str(i.assignment_title || i.title) || `Assignment ${n}`;
      lines.push(`## ${qaTitle}`, '');
      if (qaTitle) pushSection(lines, '1. Assignment Title', [qaTitle]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, '2. Learning Objectives', lo.map((x) => `- ${x}`));
      if (str(i.instructions || i.instructions_to_students)) {
        pushSection(lines, '3. Instructions to Students', [str(i.instructions || i.instructions_to_students)]);
      }
      const conceptQs = Array.isArray(i.concept_based_questions)
        ? i.concept_based_questions
        : Array.isArray(i.questions)
          ? i.questions
          : Array.isArray(i.practice_questions)
            ? i.practice_questions
            : [];
      if (conceptQs.length) {
        lines.push('### 4. Concept-based Questions');
        conceptQs.forEach((q, idx) => {
          const row = q && typeof q === 'object' ? q : { question: String(q) };
          const marks =
            row.marks != null && row.marks !== '' ? ` (${String(row.marks)} marks)` : '';
          lines.push(`${idx + 1}. ${str(row.question)}${marks}`);
          if (str(row.answer)) lines.push(`   - Answer: ${str(row.answer)}`);
        });
        lines.push('');
      }
      const app = strArr(i.application_oriented_tasks || i.application_tasks);
      if (app.length) pushSection(lines, '5. Application-oriented Tasks', app.map((x) => `- ${x}`));
      const rl = str(i.real_life_competency_activity || i.real_life_activity || i.real_life_observation_task);
      if (rl) pushSection(lines, '6. Real-life / Competency-based Activity', [rl]);
      if (str(i.creative_thinking_question)) {
        pushSection(lines, '7. Creative Thinking Question', [str(i.creative_thinking_question)]);
      }
      if (str(i.collaborative_discussion_task || i.discussion_task)) {
        pushSection(lines, '8. Collaborative / Discussion Task (if suitable)', [
          str(i.collaborative_discussion_task || i.discussion_task),
        ]);
      }
      if (str(i.challenge_question_advanced || i.challenge_question)) {
        pushSection(lines, '9. Challenge Question for Advanced Learners', [
          str(i.challenge_question_advanced || i.challenge_question),
        ]);
      }
      const rubric = str(i.assessment_criteria_rubric || i.marking_criteria || i.marking_scheme);
      if (rubric) pushSection(lines, '11. Assessment Criteria / Rubric', [rubric]);
      const outcomes = strArr(i.expected_learning_outcomes || i.learning_outcomes);
      if (outcomes.length) {
        pushSection(lines, '13. Expected Learning Outcomes', outcomes.map((x) => `- ${x}`));
      }
      break;
    }
    case 'chapter-summary-creator': {
      const csTitle = str(i.chapter_summary_title || i.chapter_title || i.title) || `Chapter ${n}`;
      lines.push(`## ${csTitle}`, '');
      const overview = str(i.chapter_overview || i.overview || i.summary || i.chapter_summary);
      if (overview) pushSection(lines, '2. Overview of the Chapter', [overview]);
      const lo = strArr(i.learning_objectives || i.objectives);
      if (lo.length) pushSection(lines, '3. Learning Objectives', lo.map((x) => `- ${x}`));
      const concepts = Array.isArray(i.important_concepts)
        ? i.important_concepts
        : Array.isArray(i.key_concepts)
          ? i.key_concepts
          : [];
      if (concepts.length) {
        lines.push('### 4. Important Concepts and Explanations');
        concepts.forEach((c, idx) => {
          const row = c && typeof c === 'object' ? c : { name: String(c) };
          lines.push(`${idx + 1}. **${str(row.name || row.concept)}** — ${str(row.explanation)}`);
        });
        lines.push('');
      }
      const defs = Array.isArray(i.definitions) ? i.definitions : [];
      if (defs.length) {
        lines.push('### 5. Key Definitions and Terms');
        defs.forEach((d, idx) => {
          const row = d && typeof d === 'object' ? d : { term: String(d) };
          lines.push(`${idx + 1}. **${str(row.term)}** — ${str(row.definition)}`);
        });
        lines.push('');
      }
      const fm = Array.isArray(i.formulae)
        ? i.formulae
        : Array.isArray(i.formulas)
          ? i.formulas
          : [];
      if (fm.length) {
        lines.push('### 6. Formulae / Rules / Important Facts');
        fm.forEach((f, idx) => {
          const row = f && typeof f === 'object' ? f : { formula: String(f) };
          lines.push(
            `${idx + 1}. ${str(row.name)}: ${str(row.formula)}${row.note ? ` (${str(row.note)})` : ''}`,
          );
        });
        lines.push('');
      }
      if (str(i.concept_connections || i.connections)) {
        pushSection(lines, '7. Concept Connections', [str(i.concept_connections || i.connections)]);
      }
      const rl = strArr(i.real_life_applications || i.applications || i.examples);
      if (rl.length) pushSection(lines, '8. Real-life Applications', rl.map((x) => `- ${x}`));
      const rev = strArr(i.quick_revision_notes || i.review_points || i.quick_review);
      if (rev.length) pushSection(lines, '9. Quick Revision Notes', rev.map((x) => `- ${x}`));
      const recall = strArr(i.practice_recall_questions || i.recall_questions);
      if (recall.length) {
        lines.push('### 10. Practice Recall Questions');
        recall.forEach((q, idx) => lines.push(`${idx + 1}. ${q}`));
        lines.push('');
      }
      break;
    }
    case 'key-points-formula-extractor': {
      const kpTitle = str(i.topic_title || i.title) || `Key Points ${n}`;
      lines.push(`## ${kpTitle}`, '');
      if (kpTitle) pushSection(lines, '1. Topic Title', [kpTitle]);
      const concepts = Array.isArray(i.important_concepts)
        ? i.important_concepts
        : Array.isArray(i.key_concepts)
          ? i.key_concepts
          : [];
      if (concepts.length) {
        lines.push('### 2. Most Important Concepts');
        concepts.forEach((c, idx) => {
          const row = c && typeof c === 'object' ? c : { name: String(c) };
          lines.push(`${idx + 1}. **${str(row.name || row.concept)}** — ${str(row.explanation)}`);
        });
        lines.push('');
      }
      const defs = Array.isArray(i.essential_definitions)
        ? i.essential_definitions
        : Array.isArray(i.definitions)
          ? i.definitions
          : [];
      if (defs.length) {
        lines.push('### 3. Essential Definitions');
        defs.forEach((d, idx) => {
          const row = d && typeof d === 'object' ? d : { term: String(d) };
          lines.push(`${idx + 1}. **${str(row.term)}** — ${str(row.definition)}`);
        });
        lines.push('');
      }
      const fm = Array.isArray(i.formulae) ? i.formulae : Array.isArray(i.formulas) ? i.formulas : [];
      if (fm.length) {
        lines.push('### 4. Important Formulae / Rules');
        fm.forEach((f, idx) => {
          const row = f && typeof f === 'object' ? f : { formula: String(f) };
          lines.push(
            `${idx + 1}. ${str(row.name)}: ${str(row.formula)}${row.note || row.when_to_use ? ` (${str(row.note || row.when_to_use)})` : ''}`,
          );
        });
        lines.push('');
      }
      const kw = Array.isArray(i.keywords_terminologies) ? i.keywords_terminologies : [];
      if (kw.length) {
        lines.push('### 5. Keywords and Terminologies');
        kw.forEach((k, idx) => {
          const row = k && typeof k === 'object' ? k : { term: String(k) };
          lines.push(`${idx + 1}. **${str(row.term)}** — ${str(row.meaning || row.definition)}`);
        });
        lines.push('');
      }
      const facts = strArr(i.must_remember_facts || i.key_points || i.key_points_to_remember);
      if (facts.length) pushSection(lines, '6. Must-remember Facts', facts.map((x) => `- ${x}`));
      const rl = strArr(i.real_life_connections || i.real_life_applications);
      if (rl.length) pushSection(lines, '7. Real-life Connections', rl.map((x) => `- ${x}`));
      const exam = strArr(i.frequently_asked_exam_points || i.exam_points);
      if (exam.length) pushSection(lines, '8. Frequently Asked Exam Points', exam.map((x) => `- ${x}`));
      const mn = strArr(i.mnemonics_memory_tricks || i.mnemonics || i.memory_tricks);
      if (mn.length) pushSection(lines, '9. Mnemonics / Memory Tricks', mn.map((x) => `- ${x}`));
      const rev = str(i.one_minute_revision_summary || i.revision_summary || i.summary);
      if (rev) pushSection(lines, '10. One-minute Revision Summary', [rev]);
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
  if (toolSlug === 'my-study-decks') {
    const card = {
      front: str(i.front),
      back: str(i.back),
      difficulty_tag_for_each_card: str(
        i.difficulty_tag_for_each_card || i.difficulty_tag || i.difficulty_level || i.skill_focus || i.bloom_level,
      ),
      memory_hook_quick_tip: str(i.memory_hook_quick_tip || i.memory_cue || i.hint),
      self_check_round: str(i.self_check_round || i.peer_prompt || i.self_check),
    };
    const extra = [
      card.difficulty_tag_for_each_card ? `**Difficulty Tag for Each Card:** ${card.difficulty_tag_for_each_card}` : '',
      card.memory_hook_quick_tip ? `**Memory Hook / Quick Tip:** ${card.memory_hook_quick_tip}` : '',
      card.self_check_round ? `**Self-Check Round:** ${card.self_check_round}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const payload = {
      formatted: `**Front:** ${card.front}\n\n**Back:** ${card.back}${extra ? `\n\n${extra}` : ''}`,
      raw: { flashcards: [card] },
    };
    return JSON.stringify(payload);
  }
  if (toolSlug === 'flashcard-generator') {
    const card = {
      front: str(i.front),
      back: str(i.back),
      memory_cue: str(i.memory_cue || i.hint),
      skill_focus: str(i.skill_focus || i.bloom_level),
      example_use: str(i.example_use || i.real_life_link),
      peer_prompt: str(i.peer_prompt || i.self_check),
      reflection: str(i.reflection || i.reflection_prompt),
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
