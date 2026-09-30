import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDashboardAiToolDoc } from '../services/ai-tool-dashboard-validation.js';

test('activity normalization supplies required delivery sections', () => {
/** PDF-shaped activity: procedure + materials but no teacher/student/rubric sections. */
const markdown = `1. Title of Activity / Project
Discovering Mathematics Activity 4

2. Subtopic Link and Prior Knowledge Required
Understanding numbers and daily-life observations.

3. Learning Objectives
- Recognize mathematics in everyday life

4. NCF Competency / Learning Outcome Alignment
Develops reasoning and observation skills.

5. Materials Required
- Notebook and pencil

6. Step-by-step Procedure
1. Ask students to find patterns.
2. Groups present conclusions.

9. Differentiation
Offer additional pattern tasks.

11. Expected Learning Outcomes
Students identify mathematics in situations.

12. Real-life Application
Mathematics in shopping and travel.

13. Reflection / Exit Ticket
Where did you notice mathematics today?
`;

const structured = {
  title: 'Discovering Mathematics Activity 4',
  subtopic_link_prior_knowledge: 'Understanding numbers and daily-life observations.',
  learning_objectives: ['Recognize mathematics in everyday life'],
  ncf_competency_alignment: 'Develops reasoning and observation skills.',
  materials_required: ['Notebook and pencil'],
  step_by_step_procedure: ['Ask students to find patterns.', 'Groups present conclusions.'],
  differentiation: 'Offer additional pattern tasks.',
  expected_learning_outcomes: 'Students identify mathematics in situations.',
  real_life_application: 'Mathematics in shopping and travel.',
  reflection_exit_ticket: 'Where did you notice mathematics today?',
};

const gate = validateDashboardAiToolDoc('activity-project-generator', {
  toolName: 'activity-project-generator',
  generatedContent: markdown,
  metadata: { structuredContent: structured },
});

assert.equal(gate.valid, true, gate.message);
assert.ok(gate.normalizedStructuredContent?.teacher_instructions?.length > 0);
assert.ok(gate.normalizedStructuredContent?.student_instructions?.length > 0);
assert.ok(gate.normalizedStructuredContent?.assessment_criteria_rubric?.length > 0);
});
