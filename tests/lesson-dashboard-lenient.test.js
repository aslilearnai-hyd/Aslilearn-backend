import {
  shouldDeliverStoredContentDespiteSectionGate,
  validateDashboardAiToolDoc,
} from '../services/ai-tool-dashboard-validation.js';

const gate = validateDashboardAiToolDoc('mock-test-builder', {
  toolName: 'mock-test-builder',
  generatedContent: '# Science Exam\n\n## Section A\n1. What is science?',
  metadata: {
    structuredContent: {
      mock_test_title: 'Science Exam',
      section_a: [
        {
          question: 'What is science?',
          options: ['A) x', 'B) y', 'C) z', 'D) w'],
          answer: 'A',
        },
      ],
    },
  },
});

if (gate.valid) {
  console.error('FAIL: partial mock test should not pass full section validation');
  process.exit(1);
}

if (shouldDeliverStoredContentDespiteSectionGate(gate)) {
  console.error('FAIL: incomplete content must not be delivered for any tool', gate);
  process.exit(1);
}

console.log('PASS: incomplete mock test is blocked from delivery');
