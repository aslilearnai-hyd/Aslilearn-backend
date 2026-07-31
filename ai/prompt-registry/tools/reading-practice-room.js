import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'reading-practice-room',
  toolTitle: 'Reading Practice Room',
  focus: 'Engaging reading passage with characters, emotion, inference questions — output language matches subject (English/Hindi/Telugu).',
  includeBloom: true,
  includeDifferentiation: true,
  includeEngagement: true,
  generationRules: [
    'READING PASSAGE — 13 SECTIONS:',
    'passage: 150–250 words, complete story or informational text with narrative arc (hook, tension, resolution).',
    'Characters with names, dialogue, sensory detail tied to subtopic theme.',
    'vocabulary_words[]: 5–8 words with child-friendly definitions IN OUTPUT LANGUAGE.',
    'read_and_recall_questions: 2+ literal comprehension questions.',
    'think_and_infer_questions: 2+ inference questions ("Why did…?", "What suggests…?").',
    'apply_and_connect_questions: 2+ connect to student life or other subjects.',
    'discussion_prompts: for pair share.',
    'creative_writing_extension: continue the story / alternate ending prompt.',
    'role_play_ideas: characters and 3-line script sketch.',
    'illustration_suggestions: scene descriptions for artist.',
    'moral_or_theme: stated clearly without preaching.',
    'Never use section headings as field values. Title = creative story name.',
    'ALL content in output language — not English for Hindi/Telugu subjects.',
    '',
    // Required by the validator's 100% fill rule but never named here, so every
    // record failed at 8/13. Field keys given explicitly.
    'ALSO REQUIRED — emit both of these fields (in the output language):',
    'ncf_competency_alignment: the NCF/NEP literacy competency this passage builds, in plain language.',
    'expected_learning_outcomes: 3 measurable things the student can do after the passage and questions.',
  ],
  rewriteRules: [
    'passage minimum 120 words real story. Min 2 questions per question array. No placeholder titles.',
  ],
});
