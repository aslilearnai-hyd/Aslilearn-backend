import { validateDashboardAiToolDoc } from '../services/ai-tool-dashboard-validation.js';

const markdown = `1. Title of Activity / Project
Observing Plant Growth

2. Learning Objectives
- Observe changes in a seedling over a week
- Record measurements in a table

3. Subtopic Link and Prior Knowledge Required
Students know that plants need water and light.

4. NCF Competency / Learning Outcome Alignment
Scientific inquiry and observation

5. Materials Required
- Pots and soil
- Seeds
- Ruler

6. Step-by-step Procedure
- Day 1: Plant seeds and label pots
- Day 3: Measure height and note leaf colour

7. Teacher Instructions
- Demonstrate how to measure height consistently
- Circulate and ask guiding questions during recording

8. Student Instructions
- Water plants daily at the same time
- Complete the observation table

9. Differentiation
- Provide a pre-filled table template for learners who need support

10. Assessment Rubric
- Accuracy of observations
- Quality of data table

11. Expected Learning Outcomes
Learners describe how a seedling changes over time using evidence.

12. Real-life Application
Gardening and farming rely on similar observation skills.

13. Reflection / Exit Ticket
What surprised you most about how your plant changed?
`;

/** Structured JSON missing teacher_instructions — sections exist only in markdown. */
const structured = {
  title: 'Observing Plant Growth',
  learning_objectives: ['Observe changes in a seedling over a week'],
  materials_required: ['Pots and soil', 'Seeds'],
  step_by_step_procedure: ['Day 1: Plant seeds', 'Day 3: Measure height'],
  expected_learning_outcomes: 'Learners describe seedling changes using evidence.',
};

const doc = {
  toolName: 'activity-project-generator',
  generatedContent: markdown,
  metadata: { structuredContent: structured },
};

const gate = validateDashboardAiToolDoc('activity-project-generator', doc);
console.log('activity gate valid:', gate.valid, gate.message || '');

if (!gate.valid) {
  console.error('missing:', gate.missingSections);
  process.exit(1);
}

console.log('activity dashboard validation OK');
