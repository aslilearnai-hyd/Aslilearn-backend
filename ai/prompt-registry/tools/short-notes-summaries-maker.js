import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'short-notes-summaries-maker',
  toolTitle: 'Short Notes & Summaries Maker',
  focus: 'Revision sheet a student pins on wall — formulae, tricks, exam points, one-minute summary.',
  includeBloom: true,
  includeVisualLearning: true,
  generationRules: [
    'SHORT NOTES FORMAT:',
    'summary_title: punchy revision name.',
    'key_concepts[]: 5–8 bullets — precise, exam-ready.',
    'important_definitions[]: term + one-line definition from NCERT wording.',
    'formulae_and_rules[]: equation or rule + when to use + common trap.',
    'diagram_notes: what to sketch from memory with labels.',
    'exam_tips[]: "Board often asks…" style pointers for THIS subtopic.',
    'memory_hooks[]: mnemonics, rhymes, story links.',
    'quick_quiz[]: 5 rapid-fire questions with answers.',
    'one_minute_revision: single paragraph rapid recap.',
    'Tone: crisp, confident — like a top student\'s curated notes, not a textbook copy.',
  ],
  rewriteRules: [
    'formulae_and_rules and quick_quiz must be non-empty. No generic "important points".',
  ],
});
