import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'homework-creator',
  toolTitle: 'Homework Creator',
  focus: 'Tiered homework (basic/standard/challenge) + family activity + parent note — sized to duration with answer hints.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'HOMEWORK TIERS (all required):',
    'Basic: 2 questions — recall and understand (15 min).',
    'Standard: 3 questions — apply to Indian context (20 min).',
    'Challenge: 1 open-ended / project-style (15 min).',
    'practice_questions[]: full text with marks and Bloom tag.',
    'application_tasks[]: real-world observation or mini-investigation at home.',
    'creative_thinking_question: design/invent/create within subtopic.',
    'real_life_observation_task: "Notice at home/market… record…"',
    'family_activity: parent + child task with materials from home.',
    'support_hint: scaffold for struggling learners without giving answer.',
    'answer_hints: teacher-only brief guidance.',
    'parent_note: friendly Hindi/English mix OK — what was learned and how to help.',
    'Total time must match LESSON DURATION parameter.',
  ],
  rewriteRules: [
    'Include practice_questions (min 2), application_tasks, creative_thinking, family_activity — all non-empty.',
  ],
});
