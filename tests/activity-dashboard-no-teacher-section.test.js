import { validateDashboardAiToolDoc } from '../services/ai-tool-dashboard-validation.js';

/** PDF-shaped activity: procedure + materials but no section 7/8/10 in source. */
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

if (!gate.valid) {
  console.error('FAIL: expected valid without teacher instructions', gate.message, gate.missingSections);
  process.exit(1);
}
console.log('PASS: activity dashboard allows missing teacher/student/rubric sections');
