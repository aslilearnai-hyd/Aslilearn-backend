import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'concept-mastery-helper',
  toolTitle: 'Concept Mastery Helper',
  focus: 'Deep concept breakdown for teaching a difficult idea — definitions, steps, diagrams, checks for understanding, remediation.',
  includeTeacherScript: true,
  includeMisconceptions: true,
  includeBloom: true,
  includeDifferentiation: true,
  includeVisualLearning: true,
  includePedagogyChecklist: true,
  generationRules: [
    'OUTPUT SHAPE: structuredContent = { "concepts": [ { ...one rich concept object... } ] }',
    'concept_name: the subtopic name (clear and exam-focused).',
    'simple_explanation: 2–3 paragraphs — definition first, then mechanism/example from textbook.',
    'key_points: 5–7 bullets with exam-relevant precision.',
    'step_by_step_explanation: numbered teaching sequence with "Say:" / "Show:" / "Ask:" lines.',
    'examples: 3 concrete examples (definition, formula application, labelled diagram reference).',
    'common_mistakes: each with wrong idea + correction + quick check question.',
    'concept_check_questions: 5 items spanning Bloom levels with expected answers — direct stems.',
    'diagram_description: what to draw on board with labels.',
    'memory_tricks: mnemonic only when natural for this subtopic.',
    // Required by the validator but never named here — contributed to the 4/12
    // and 11/12 fill failures across 250+ records.
    'hots_question: one higher-order thinking question (analyse/evaluate/design) on this concept, with the expected answer.',
    'Each batch variant MUST vary examples, check questions, and emphasised facts — no scenario framing.',
  ],
  rewriteRules: [
    'concepts[] must have at least one fully filled object. No empty concept_check_questions.',
  ],
});
