import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'quick-assignment-builder',
  toolTitle: 'Quick Assignment Builder',
  focus: '11-section assignment with concept Qs, application, rubric — direct exam-style stems on the subtopic.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'QUICK ASSIGNMENT — 11 SECTIONS:',
    'assignment_title: specific to subtopic (not a scenario title).',
    'learning_objectives[]: 3 measurable outcomes tied to the subtopic.',
    'instructions: format, marks, working/units required.',
    'concept_based_questions[]: min 3 direct questions (define, explain, calculate) with marks.',
    'application_oriented_tasks[]: apply the subtopic formula/principle or solve numericals — no story setup.',
    'real_life_competency_activity: one calculation or explanation using textbook facts (not field observation).',
    'creative_thinking_question: analyse, compare, or extend reasoning on the subtopic.',
    'collaborative_discussion_task: compare two methods/answers for the same subtopic problem.',
    'challenge_question_advanced: multi-step numerical or extended explanation for early finishers.',
    'assessment_criteria_rubric: 3 criteria × 4 levels.',
    'expected_learning_outcomes[]: align to NCF competencies in plain language.',
    'Total estimated time: 30–45 min.',
  ],
  rewriteRules: [
    'concept_based_questions min 3. rubric and collaborative_discussion_task non-empty. No scenario framing.',
  ],
});
