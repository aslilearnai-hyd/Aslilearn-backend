import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'smart-qa-practice-generator',
  toolTitle: 'Smart Q&A Practice Generator',
  focus: 'Seven-section practice bank (A–G) with match, applied problems, HOTS — progressive Bloom difficulty on the subtopic.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'SMART Q&A — SECTIONS A THROUGH G (each min 1 question):',
    'Section A: MCQs — 4 options, subtopic-specific distractors.',
    'Section B: Fill in the blanks (definitions, formulas, units).',
    'Section C: Match the following (Column A / Column B pairs).',
    'Section D: Very short answer.',
    'Section E: Short answer with marking points.',
    'Section F: Applied problem — numerical, formula use, or explanation using subtopic facts (no fictional scenario).',
    'Section G: HOTS — analyse, evaluate, or justify within the subtopic.',
    'sections[]: all seven names exactly as per schema.',
    'Each question object: question text, type, answer, marks, bloom_level.',
    'Total questions ≥ TARGET PRACTICE QUESTIONS param.',
    'No answer_key_with_explanations duplicate — answers on question objects.',
  ],
  rewriteRules: [
    'All 7 sections with questions. Section C MUST be type MATCH with columns. Direct stems only.',
  ],
});
