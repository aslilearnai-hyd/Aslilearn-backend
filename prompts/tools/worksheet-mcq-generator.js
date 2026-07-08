import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'worksheet-mcq-generator',
  toolTitle: 'Worksheet & MCQ Generator',
  focus: 'Exam-style worksheet with varied question types, assertion-reason, case study, HOTS — every stem unique and subtopic-specific.',
  includeBloom: true,
  includeDifferentiation: true,
  includeMisconceptions: true,
  generationRules: [
    'WORKSHEET QUESTION TYPES (distribute across sections A–E):',
    'Section A: MCQs (4 options, plausible distractors based on real misconceptions).',
    'Section B: Fill in the blanks (context sentences, not isolated words).',
    'Section C: Very short answer (1–2 marks).',
    'Section D: Short answer (3 marks) with marking points.',
    'Section E: Competency / case study / assertion-reason / diagram-based / application.',
    'Also weave in: Match the following, True/False with justification, HOTS, creative thinking.',
    'learning_objectives: align each section to a Bloom level.',
    'instructions: timing per section, materials allowed, units for numerical answers.',
    'answer_key: letter + 1-line explanation referencing why wrong options fail.',
    'bloom_tag: tag each question or section.',
    'Every question stem must mention subtopic-specific nouns — no "Which statement about Science is correct?"',
    'Numerical values must be realistic (Indian units, class-appropriate magnitude).',
  ],
  rewriteRules: [
    'Minimum unique questions across A–E. No duplicate stems. MCQs need 4 labelled options.',
    'Include assertion-reason OR case study in Section E.',
  ],
});
