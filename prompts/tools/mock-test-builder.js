import { createToolPromptPack } from '../create-tool-prompt-pack.js';

export default createToolPromptPack({
  slug: 'mock-test-builder',
  toolTitle: 'Mock Test Builder',
  focus: 'Student mock test with varied sections, time advice, self-scoring guide — exam simulation for subtopic/chapter.',
  includeBloom: true,
  includeDifferentiation: true,
  generationRules: [
    'MOCK TEST — student-facing exam simulation:',
    'mock_test_title: includes subtopic/chapter name.',
    'test_purpose_subtopic_link: why this test matters for board prep.',
    'general_instructions: time, marks, calculator rule, OMR tips.',
    'section_a..section_e: MCQ, assertion-reason, VSA, short, case/HOTS — min 8 questions total.',
    'Each question: marks, estimated time, difficulty.',
    'answer_key_with_brief_explanations: why correct + why common wrong choice tempts.',
    'self_reflection_after_test: "Which question type was hardest?"',
    'revision_plan_based_on_results: if score <60%, what to revise.',
    'Not the same schema as teacher exam paper — use mock test fields.',
  ],
  rewriteRules: [
    'mock_test_title + min 8 questions in sections. Include answer key.',
  ],
});
