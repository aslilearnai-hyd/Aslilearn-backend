import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'exam-question-paper-generator',
  toolTitle: 'Exam Question Paper Generator',
  focus: 'Formal school exam paper with blueprint, marking scheme, rubric, internal choices — board-pattern quality.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'EXAM PAPER — 11 SECTIONS (teacher formal assessment):',
    'CRITICAL: Use CURRICULUM KNOWLEDGE block — every MCQ must test real chapter facts (litmus, HCl, NaOH, reactions, pH, indicators, neutralization).',
    'FORBIDDEN MCQ OPTIONS: "Belief without evidence", "Systematic observation and evidence", "Superstition only" — these are NOT chemistry options.',
    'FORBIDDEN STEMS: "Identify the correct idea related to [topic title]" — ask specific chemistry instead.',
    'paper_title, instructions, blueprint (section-wise marks table).',
    'section_a..section_e: distinct typologies (MCQ, assertion-reason, VSA, short, long/case).',
    'internal_choices: "Answer any 3 of 5" where appropriate.',
    'answer_key: point-wise for subjective questions.',
    'marking_scheme: step marks for numerical/diagram answers.',
    'open_ended_rubric: 4-level descriptors for long answers.',
    'learning_outcome_mapping: which LO each section tests.',
    'bloom_mapping: section → dominant Bloom level.',
    'competency_mapping: NCF competency codes in plain language.',
    'Minimum question count from TARGET EXAM QUESTIONS param.',
    'Do NOT use mock_test_title or student self-reflection fields.',
  ],
  rewriteRules: [
    'ALL 11 exam sections populated. section_d and section_e must have real questions.',
  ],
});
