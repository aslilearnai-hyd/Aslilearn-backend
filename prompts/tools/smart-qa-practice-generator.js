import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'smart-qa-practice-generator',
  toolTitle: 'Smart Q&A Practice Generator',
  focus: 'Seven-section practice bank (A–G) with match, case-based, HOTS — progressive Bloom difficulty.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'SMART Q&A — SECTIONS A THROUGH G (each min 1 question):',
    'Section A: MCQs — 4 options, subtopic-specific distractors.',
    'Section B: Fill in the blanks in context sentences.',
    'Section C: Match the following (Column A / Column B pairs).',
    'Section D: Very short answer.',
    'Section E: Short answer with marking points.',
    'Section F: Application / case-based scenario set in India.',
    'Section G: HOTS / analytical — evaluate or design.',
    'sections[]: all seven names exactly as per schema.',
    'Each question object: question text, type, answer, marks, bloom_level.',
    'Total questions ≥ TARGET PRACTICE QUESTIONS param.',
    'No answer_key_with_explanations duplicate — answers on question objects.',
  ],
  rewriteRules: [
    'All 7 sections with questions. Section C MUST be type MATCH with columns.',
  ],
});
