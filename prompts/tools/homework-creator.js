import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'homework-creator',
  toolTitle: 'Homework Creator',
  focus: 'Tiered homework like textbook exercises — basic recall, standard apply, challenge numerical/analytical on the subtopic.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'HOMEWORK TIERS (all required):',
    'Basic: 2 questions — recall and define (15 min).',
    'Standard: 3 questions — apply formula/principle or explain with example (20 min).',
    'Challenge: 1 extended numerical or analytical question (15 min).',
    'practice_questions[]: full text with marks and Bloom tag — direct stems only.',
    'application_tasks[]: solve numericals or explain using subtopic content.',
    'creative_thinking_question: compare, analyse, or justify within the subtopic.',
    'real_life_observation_task: one numerical or fact-based application (not "notice at home…").',
    'family_activity: optional short practice task with parent — still subtopic-specific.',
    'support_hint: scaffold for struggling learners without giving the answer.',
    'answer_hints: teacher-only brief guidance.',
    'parent_note: what was learned and how to help — plain language.',
    'Total time must match LESSON DURATION parameter.',
  ],
  rewriteRules: [
    'Include practice_questions (min 2), application_tasks, creative_thinking — all non-empty and subtopic-direct.',
  ],
});
