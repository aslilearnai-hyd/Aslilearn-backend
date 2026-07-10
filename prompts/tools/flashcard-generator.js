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
    'CARDS ARE THE PRODUCT: write chapter-specific questions and complete answers — not meta-instructions like "Students should define the concept" or "give one example".',
    'Each back must teach: definition + mechanism/step + one concrete example from the subtopic.',
    'Include: image_suggestion, hint, memory_trick, real_example, quick_quiz variant per few cards.',
    'deck_memory_hook: one story linking all cards.',
    'common_mistakes_to_avoid[]: 3 specific errors for this subtopic.',
    'self_check_rapid_recall_round: 5 oral prompts for end of lesson.',
    'differentiation_support: which cards to remove/add for Below/Above.',
    'reflection_exit_ticket: one metacognitive question.',
    'Minimum 5 cards; vary card types (MCQ, fill, explain, apply, diagram describe).',
    'Never copy learning-objective wording into card fronts (e.g. avoid "Apply X to short real-life examples" as a question).',
  ],
  rewriteRules: [
    'Every card needs front AND back strings. Include HOTS and recall mix.',
    'Replace any generic scaffold card with a real question and a complete factual answer about the subtopic.',
  ],
  repairRules: [
    'Regenerate cards[] with substantive front/back pairs; backs must contain facts, not answer rubrics.',
  ],
});
