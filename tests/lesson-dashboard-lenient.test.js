import {
  shouldDeliverStoredContentDespiteSectionGate,
  validateDashboardAiToolDoc,
} from '../services/ai-tool-dashboard-validation.js';

const markdown = `1. Lesson Title
Patterns in Mathematics

2. Learning Objectives
- Identify patterns in numbers

3. NCF Competency / Learning Outcome Alignment
Reasoning skills
`;

const gate = validateDashboardAiToolDoc('lesson-planner', {
  toolName: 'lesson-planner',
  generatedContent: markdown,
  metadata: {
    structuredContent: {
      lesson_name: 'Patterns in Mathematics',
      learning_objectives: ['Identify patterns in numbers'],
    },
  },
});

if (!shouldDeliverStoredContentDespiteSectionGate(gate, markdown)) {
  console.error('FAIL: should deliver lesson with partial sections', gate);
  process.exit(1);
}

console.log('PASS: lesson planner delivers without blocking on missing sections');
