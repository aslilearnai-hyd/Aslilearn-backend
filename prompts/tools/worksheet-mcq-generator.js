import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'worksheet-mcq-generator',
  toolTitle: 'Worksheet & MCQ Generator',
  focus: 'NCERT/CBSE-style worksheet — MCQ, FIB, VSAQ, SAQ, LAQ — aligned to textbook exercises for the chapter or selected subtopic.',
  includeBloom: true,
  includeDifferentiation: true,
  includeMisconceptions: true,
  generationRules: [
    'Honor QUESTION COMPOSITION exact counts for MCQ, VSAQ, SAQ, LAQ, and FIB. If a count is 0, omit that type.',
    'When SCOPE is whole chapter, distribute questions across major ideas in the chapter/topic.',
    'When a subtopic is provided, keep every stem tightly focused on that subtopic.',
    'DIRECT WORKSHEET STYLE: title = "{Chapter/Subtopic} — {Subject} Worksheet". BAN adventure, market-day, journey, or story titles.',
    'instructions = timing, units, attempt-all — never "Welcome young scientists" or market/journey framing.',
    'Every stem is direct: Define / State / Calculate / Explain / Fill in / Choose the correct option — no story setup.',
    'MCQs: 4 options, distractors from real misconceptions.',
    'FIB: definition/formula/unit sentences.',
    'VSAQ: 1–2 marks — define, state, name.',
    'SAQ: 3 marks with marking points — explain with example.',
    'LAQ: extended application — multi-step numerical, formula use, or analytical explanation (no case-study story).',
    'learning_objectives: align sections to Bloom levels.',
    'instructions: timing per section, units for numerical answers.',
    'answer_key: letter + 1-line explanation referencing why wrong options fail.',
    'bloom_tag: tag each question or section.',
    'Every question stem must use curriculum-specific terms — no generic Science trivia.',
    'Numerical values must be realistic (SI units, class-appropriate magnitude).',
    'When textbook passages are provided, mirror in-chapter Examples and end-of-section Exercise patterns.',
  ],
  rewriteRules: [
    'Exact composition counts. No duplicate stems. MCQs need 4 labelled options. No scenario wrappers.',
    'If title or instructions use a scenario/adventure frame, rewrite to direct worksheet wording.',
  ],
});
