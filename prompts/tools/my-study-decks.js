import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'my-study-decks',
  toolTitle: 'My Study Decks',
  focus: 'Student self-study flashcards — active recall, hints, difficulty tags, memory hooks.',
  includeBloom: true,
  generationRules: [
    'STUDENT STUDY DECK:',
    'cards[]: min 10 items — front = question/prompt; back = answer/explanation.',
    'Each card: difficulty_tag_for_each_card (easy/medium/hard) + memory_hook_quick_tip.',
    'Mix: definition, application, diagram describe, solve, compare, error-spot.',
    'study_strategy_note: how to use deck (Leitner, shuffle, teach-back).',
    'self_test_routine: 10-minute daily plan.',
    'Student tone: friendly coach, not teacher manual.',
  ],
  rewriteRules: [
    'Min 10 cards with front/back. No term-only fronts without a question frame.',
  ],
});
