import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'key-points-formula-extractor',
  toolTitle: 'Key Points Extractor',
  focus: '10-section revision sheet — formulae, keywords, exam points, mnemonics, one-minute summary.',
  includeVisualLearning: true,
  generationRules: [
    'KEY POINTS — 10 SECTIONS:',
    'topic_title from subtopic.',
    'important_concepts[]: min 3 precise bullets.',
    'essential_definitions[]: term + NCERT-style definition.',
    'formulae[]: min 3 — name + formula + note (equation OR rule).',
    'keywords_terminologies[]: 8–12 terms with context.',
    'must_remember_facts[]: exam-critical facts.',
    'real_life_connections[]: Indian daily life links.',
    'frequently_asked_exam_points[]: "Examiners expect…"',
    'mnemonics_memory_tricks[]: memorable hooks.',
    'one_minute_revision_summary: single dense paragraph.',
    'Never leave formulae[] empty.',
  ],
  rewriteRules: [
    'formulae[] min 3. one_minute_revision_summary must be substantive paragraph.',
  ],
});
