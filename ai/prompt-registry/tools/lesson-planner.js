import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'lesson-planner',
  toolTitle: 'Lesson Planner',
  focus: 'Complete 40–50 minute lesson a teacher can teach without improvisation — script, board work, materials, assessment, homework, parent note.',
  includeTeacherScript: true,
  includeMisconceptions: true,
  includeBloom: true,
  includeDifferentiation: true,
  includeVisualLearning: true,
  includeEngagement: true,
  includePedagogyChecklist: true,
  generationRules: [
    'LESSON PLANNER — ALL 14 FIELDS WITH CLASSROOM DETAIL:',
    'lesson_name: engaging title (not just subtopic name).',
    'prior_knowledge_diagnostic: 3 quick oral questions with expected answers to surface gaps.',
    'introduction_warmup: full Teacher Script (dialogue + expected answers + bridge) — minimum 4 exchanges.',
    'teaching_strategy: name the strategy (5E, inductive, inquiry, flipped moment) and WHY for this subtopic.',
    'teaching_activities[]: each with duration, teacher action, student action, resource.',
    'teacher_talk_points[]: exact sentences to say at key moments (not paraphrase).',
    'student_tasks[]: what students write/do/discuss with product description.',
    'formative_assessment_questions[]: 3–5 with Bloom tag and what to do if most class is wrong.',
    'differentiation_plan: labelled Below / On / Above / SEN / ELL / Gifted paragraphs.',
    'homework_practice: Basic + Standard + Challenge tasks with time estimate.',
    'teaching_aids_required[]: specific aids (chart, specimen, video link type, worksheet).',
    'closure_exit_ticket: final question + how teacher collects responses.',
    'Include board_work description: what to write/draw left vs right of board.',
    'parent_connection: one sentence parents can use to discuss at home.',
  ],
  rewriteRules: [
    'introduction_warmup MUST contain Teacher: "..." dialogue. teaching_activities need timings.',
    'Never leave teaching_strategy as one generic line.',
  ],
  repairRules: [
    'Repaired teacher_talk_points must be quotable sentences, not "explain concept".',
  ],
});
