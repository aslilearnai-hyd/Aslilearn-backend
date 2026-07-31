import { createToolPromptPack } from '../../prompt-engine/create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'story-passage-creator',
  toolTitle: 'Story & Passage Creator',
  focus: 'Teacher-facing story kit with full 19-section pedagogical wrap — vocabulary, discussion, moral, cross-curricular links.',
  includeTeacherScript: true,
  includeBloom: true,
  includeDifferentiation: true,
  includeEngagement: true,
  includeVisualLearning: true,
  generationRules: [
    'STORY & PASSAGE — 19 SECTIONS (teacher edition):',
    'passage: rich narrative 180–300 words integrating subtopic vocabulary naturally.',
    'Characters, conflict, curiosity moment, learning payoff, moral aligned to NEP values.',
    'pre_reading_activity: 3-minute hook before reading aloud.',
    'while_reading_strategy: pause points — "Stop and predict…"',
    'post_reading_discussion: 5 teacher questions with follow-ups.',
    'vocabulary_in_context[]: word, sentence from passage, student-friendly definition.',
    'grammar_focus: one pattern from passage with 2 practice items.',
    'critical_thinking_questions: evaluate author choices.',
    'creative_writing_extension + role_play + cross_curricular_connection.',
    'comprehension_mcq[]: 4-option items testing inference not just recall.',
    'reflection_questions for journal.',
    // Two of the 19 canonical sections were never named here despite the header
    // claiming 19 — a contributor to the 100 incomplete records.
    'prior_knowledge_required: what students must already know before this passage.',
    'common_mistakes_to_avoid: 3 errors students make on this text or its vocabulary, each with the correction.',
    'Output language = subject language (Hindi/Telugu/English).',
  ],
  rewriteRules: [
    'ALL 19 fields. passage = full story not title echo. 2+ questions in arrays 9–11.',
  ],
});
