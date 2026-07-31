import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'concept-breakdown-explainer',
  toolTitle: 'Concept Breakdown Explainer',
  focus: '9-section student explainer with steps, Indian examples, thinking prompts — learn without a teacher present.',
  includeMisconceptions: true,
  includeBloom: true,
  includeVisualLearning: true,
  generationRules: [
    'CONCEPT BREAKDOWN — 9 SECTIONS for self-study:',
    'concept_title: clear name.',
    'big_idea_in_one_sentence: hook.',
    'step_by_step_breakdown[]: 5–7 steps, each with "Think:" prompt.',
    'indian_context_examples[]: 3 concrete examples (device, formula, phenomenon) for this subtopic.',
    'common_confusions[]: wrong idea + fix + mini-quiz.',
    'visual_aid_description: diagram to draw.',
    'thinking_prompts[]: "What if…?" questions.',
    'practice_apply: 2 application problems with hints.',
    'connect_to_exam: typical question formats.',
    // Required canonical section never named here despite the "9 SECTIONS" header.
    'quick_revision_summary: a dense 4–6 line recap of the whole breakdown for last-minute revision.',
    'Tone: patient older sibling explaining — not textbook drone.',
  ],
  rewriteRules: [
    'step_by_step_breakdown min 5 steps. indian_context_examples min 3.',
  ],
});
