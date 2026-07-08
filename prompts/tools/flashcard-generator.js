import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'flashcard-generator',
  toolTitle: 'Flash Card Generator',
  focus: 'Teacher deck with HOTS cards, memory tricks, self-check — front=task prompt, back=solution (not term-definition only).',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'FLASHCARD 5-BLOCK TEACHER DECK:',
    'application_hots_cards[] AND cards[]: each item front = question/task/scenario; back = worked solution or explanation.',
    'Include: image_suggestion, hint, memory_trick, real_example, quick_quiz variant per few cards.',
    'deck_memory_hook: one story linking all cards.',
    'common_mistakes_to_avoid[]: 3 specific errors for this subtopic.',
    'self_check_rapid_recall_round: 5 oral prompts for end of lesson.',
    'differentiation_support: which cards to remove/add for Below/Above.',
    'reflection_exit_ticket: one metacognitive question.',
    'Minimum 5 cards; vary card types (MCQ, fill, explain, apply, diagram describe).',
  ],
  rewriteRules: [
    'Every card needs front AND back strings. Include HOTS and recall mix.',
  ],
});
