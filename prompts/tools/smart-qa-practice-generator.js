import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'smart-qa-practice-generator',
  toolTitle: 'Smart Q&A Practice Generator',
  focus: 'Seven-section practice bank (A–G) with true/false, applied problems, HOTS — progressive Bloom difficulty on the subtopic. Match-the-Following allowed when matchPairs are provided; figure questions allowed with needsDiagram + imagePrompt.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'SMART Q&A — SECTIONS A THROUGH G (each min 1 question):',
    'Section A: MCQs — 4 options, subtopic-specific distractors.',
    'Section B: Fill in the blanks (definitions, formulas, units).',
    'Section C: True or False — clear textbook statements (type TF).',
    'Section D: Very short answer.',
    'Section E: Short answer with marking points.',
    'Section F: Applied problem — numerical, formula use, or explanation using subtopic facts (no fictional scenario).',
    'Section G: HOTS — analyse, evaluate, or justify within the subtopic.',
    'sections[]: all seven names exactly as per schema.',
    'Each question object: question text, type, answer, marks, bloom_level.',
    'Total questions ≥ TARGET PRACTICE QUESTIONS param.',
    'No answer_key_with_explanations duplicate — answers on question objects.',
    // Required canonical section never named here — this tool sits at 63% incomplete.
    'learning_objectives: 3 measurable objectives this practice set assesses (emit as a deck-level field, not inside sections[]).',
  ],
  rewriteRules: [
    'All 7 sections with questions. Section C MUST be type TF (True/False). Never Match-the-Following or image/figure-based stems. Direct stems only.',
  ],
});
