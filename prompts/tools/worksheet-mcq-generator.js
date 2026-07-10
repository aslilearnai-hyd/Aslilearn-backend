import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'worksheet-mcq-generator',
  toolTitle: 'Worksheet & MCQ Generator',
  focus: 'NCERT/CBSE-style worksheet — MCQ, FIB, VSA, SA, numerical — aligned to textbook exercises for the subtopic.',
  includeBloom: true,
  includeDifferentiation: true,
  includeMisconceptions: true,
  generationRules: [
    'WORKSHEET QUESTION TYPES (distribute across sections A–E):',
    'Section A: MCQs (4 options, distractors from real misconceptions on THIS subtopic).',
    'Section B: Fill in the blanks (definition/formula/unit sentences).',
    'Section C: Very short answer (1–2 marks) — define, state, name.',
    'Section D: Short answer (3 marks) with marking points — explain with example.',
    'Section E: Extended application — multi-step numerical, formula use, or analytical explanation (no case-study story).',
    'Also weave in: Match the following, True/False with justification, HOTS where appropriate.',
    'learning_objectives: align each section to a Bloom level.',
    'instructions: timing per section, units for numerical answers.',
    'answer_key: letter + 1-line explanation referencing why wrong options fail.',
    'bloom_tag: tag each question or section.',
    'Every question stem must name subtopic-specific terms — no generic "Which statement about Science is correct?"',
    'Numerical values must be realistic (SI units, class-appropriate magnitude).',
    'When textbook passages are provided, mirror in-chapter Examples and end-of-section Exercise question patterns.',
  ],
  rewriteRules: [
    'Minimum unique questions across A–E. No duplicate stems. MCQs need 4 labelled options. No scenario wrappers.',
  ],
});
