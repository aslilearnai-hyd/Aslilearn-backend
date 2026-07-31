import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

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
    '',
    // Required by the validator's 100% fill rule but never named here, so every
    // record failed at 5/12. Field keys given explicitly.
    'ALSO REQUIRED — emit all of these fields:',
    'common_mistakes_to_avoid: 3 specific errors students make on THIS subtopic, each with the correction.',
    'ncf_competency_alignment: the NCF/NEP competency this deck builds, in plain language.',
    'expected_learning_outcomes: 3 measurable things the student can do after working the deck.',
  ],
  rewriteRules: [
    'Min 10 cards with front/back. No term-only fronts without a question frame.',
  ],
});
