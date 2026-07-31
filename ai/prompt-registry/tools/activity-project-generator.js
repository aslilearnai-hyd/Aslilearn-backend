import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'activity-project-generator',
  toolTitle: 'Activity & Project Generator',
  focus: 'Classroom activity aligned to textbook Activities/Projects — materials, timed steps, observation — easy to teach.',
  includeTeacherScript: true,
  includeMisconceptions: true,
  includeBloom: true,
  includeDifferentiation: true,
  includeVisualLearning: true,
  includeEngagement: true,
  includePedagogyChecklist: true,
  generationRules: [
    'ACTIVITY STRUCTURE:',
    '- title: clear name for the subtopic activity (not a fictional scenario title).',
    '- subtopic_link_prior_knowledge: 2–3 specific prior concepts from earlier NCERT chapters with chapter references.',
    '- learning_objectives: 3–5 measurable objectives using verbs (observe, classify, justify, design) tied to THIS subtopic.',
    '- materials_required: exact quantities (e.g. "6 spinach leaves, 3 test tubes, dilute iodine — ₹20 total").',
    '- step_by_step_procedure: numbered steps like a textbook Activity (duration per step, what students record).',
    '- teacher_instructions: what teacher does during each phase — circulate, ask, demonstrate.',
    '- student_instructions: what students do, in student-friendly language.',
    '- assessment_criteria_rubric: 3–4 criteria × 4 performance levels with observable descriptors.',
    '- real_life_application: one concrete device, phenomenon, or formula application for this subtopic.',
    '- reflection_exit_ticket: one question students answer before leaving.',
    'PROJECT VARIANT: include creative_output and observation_table where schema allows.',
  ],
  rewriteRules: [
    'Fill ALL 13 canonical fields. Each step must say WHO does WHAT for HOW LONG.',
    'Never write "conduct activity" — write the actual activity.',
  ],
  repairRules: [
    'Repaired steps must include timing and materials. Rubric must have 4 levels per criterion.',
  ],
});
