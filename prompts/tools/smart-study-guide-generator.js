import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'smart-study-guide-generator',
  toolTitle: 'Smart Study Guide Generator',
  focus: 'Premium 11-section study guide — concepts, formulae, MCQs, revision — like BYJU\'s premium notes meets NCERT.',
  includeBloom: true,
  includeVisualLearning: true,
  includeMisconceptions: true,
  generationRules: [
    'SMART STUDY GUIDE — 11 SECTIONS:',
    'title: short guide name from subtopic only (max ~12 words) — never MCQ text in title.',
    'prior_knowledge: what to recall before starting.',
    'key_concepts_explained[]: each with explanation + Indian example + "Watch out:" trap.',
    'formulae_and_rules[]: name, formula, when to use, worked mini-example.',
    'diagrams_to_remember: label list for sketch-from-memory.',
    'step_by_step_solved_example: full worked problem with reasoning lines.',
    'practice_questions[]: MCQ + short answer mix with answers.',
    'hots_questions[]: analyse/evaluate level.',
    'revision_notes: bullet cram sheet.',
    'self_assessment_checklist: "I can…" statements.',
    'exam_connection: how this subtopic appears in board papers.',
    'Use study_guide fields — NOT chapter_summary field names.',
  ],
  rewriteRules: [
    'practice_questions in array — not in title. key_concepts min 3 with substance.',
  ],
});
