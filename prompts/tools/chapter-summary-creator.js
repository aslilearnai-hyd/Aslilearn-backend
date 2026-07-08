import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'chapter-summary-creator',
  toolTitle: 'Chapter Summary Creator',
  focus: '10-section chapter revision — overview, concepts, formulae, recall questions — NOT study guide field names.',
  includeBloom: true,
  includeVisualLearning: true,
  generationRules: [
    'CHAPTER SUMMARY — 10 SECTIONS:',
    'chapter_summary_title, chapter_overview (2 paragraphs max).',
    'important_concepts[]: min 3 with one-line depth each.',
    'formulae[]: min 3 — name + formula (equation OR must-know rule sentence).',
    'key_events_or_processes[]: timeline or sequence for this chapter chunk.',
    'quick_revision_notes[]: min 3 exam-cram bullets.',
    'practice_recall_questions[]: min 3 with short answers.',
    'diagram_to_remember: labels list.',
    'connection_to_next_topic: bridge sentence.',
    'Use chapter_summary_* fields — NEVER study_guide_title or prior_knowledge.',
  ],
  rewriteRules: [
    'chapter_summary_title not study_guide_title. formulae[] min 3 non-empty.',
  ],
});
