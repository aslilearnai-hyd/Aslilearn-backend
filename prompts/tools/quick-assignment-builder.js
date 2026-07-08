import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'quick-assignment-builder',
  toolTitle: 'Quick Assignment Builder',
  focus: '11-section assignment with concept Qs, application, rubric, collaborative task — ready to photocopy.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'QUICK ASSIGNMENT — 11 SECTIONS:',
    'assignment_title: specific to subtopic.',
    'learning_objectives[]: 3 measurable outcomes.',
    'instructions: submission format, deadline style, group/individual.',
    'concept_based_questions[]: min 3 with marks.',
    'application_oriented_tasks[]: real-world Indian scenario tasks.',
    'real_life_competency_activity: hands-on or field observation.',
    'creative_thinking_question: design/create prompt.',
    'collaborative_discussion_task: roles + deliverable.',
    'challenge_question_advanced: for early finishers.',
    'assessment_criteria_rubric: 3 criteria × 4 levels.',
    'expected_learning_outcomes[]: align to NCF competencies in plain language.',
    'Total estimated time: 30–45 min class + home if needed.',
  ],
  rewriteRules: [
    'concept_based_questions min 3. rubric and collaborative_discussion_task non-empty.',
  ],
});
