import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'concept-mastery-helper',
  toolTitle: 'Concept Mastery Helper',
  focus: 'Deep concept breakdown a teacher uses to teach a difficult idea — with analogies, diagrams, checks for understanding, and remediation.',
  includeTeacherScript: true,
  includeMisconceptions: true,
  includeBloom: true,
  includeDifferentiation: true,
  includeVisualLearning: true,
  includePedagogyChecklist: true,
  generationRules: [
    'OUTPUT SHAPE: structuredContent = { "concepts": [ { ...one rich concept object... } ] }',
    'concept_name: subtopic + optional teaching angle (e.g. "Photosynthesis — starch test lab angle").',
    'simple_explanation: 2–3 paragraphs in teacher voice — story or analogy first, definition second.',
    'key_points: 5–7 bullets with exam-relevant precision.',
    'step_by_step_explanation: numbered teaching sequence with "Say:" / "Show:" / "Ask:" lines.',
    'examples: 3 Indian-context examples (daily life, NCERT diagram reference, local phenomenon).',
    'common_mistakes: each with wrong idea + correction + quick check question.',
    'concept_check_questions: 5 items spanning Bloom levels with expected answers.',
    'diagram_description: what to draw on board with labels.',
    'memory_tricks: mnemonic or rhyme where apt (not forced).',
    'Each batch variant MUST use different angle, examples, and check questions.',
  ],
  rewriteRules: [
    'concepts[] must have at least one fully filled object. No empty concept_check_questions.',
  ],
});
