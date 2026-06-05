import { extractActivityProjectItemsFromPdfText } from '../../services/pdf-activity-extract.js';

const sample = `
Activity / Project 1
1. Title of the Activity / Project
Thread Trail Measurement
Class: 6 | Subject: Science | Subtopic: 5.4 Measurement of Curved Lines
2. Subtopic Link and Prior Knowledge Required
Some lengths cannot be measured with a straight ruler. Students should know basic units of length.
3. Learning Objectives
- Identify curved lines in daily life
- Use a flexible measuring aid such as thread
4. NCF Competency / Learning Outcome Alignment
Supports competency-based learning through observation and hands-on measurement.
5. Materials Required
- Ruler
- Cotton thread
- Notebook
6. Step-by-step Procedure
1. Display the curved line for the task.
2. Ask students to estimate the length first.
3. Place the thread along the curve without stretching.

Activity / Project 2
1. Title of the Activity / Project
Cloud Outline Challenge
2. Subtopic Link and Prior Knowledge Required
Students should know how to observe cloud shapes.
3. Learning Objectives
- Observe cloud outlines carefully
4. NCF Competency / Learning Outcome Alignment
Builds observation skills.
5. Materials Required
- Chart paper
6. Step-by-step Procedure
1. Go outside and observe clouds.
2. Draw the outline on chart paper.
`;

const items = extractActivityProjectItemsFromPdfText(sample, 10, 'activity-project-generator');
console.log('extracted activities:', items.length);
if (items.length < 2) {
  console.error('Expected 2 activities, got', items.length);
  process.exit(1);
}

const first = items[0];
if (!String(first.title).includes('Thread Trail')) {
  console.error('Activity 1 title wrong:', first.title);
  process.exit(1);
}
if (!Array.isArray(first.learning_objectives) || first.learning_objectives.length < 1) {
  console.error('Activity 1 missing learning objectives');
  process.exit(1);
}
if (!Array.isArray(first.step_by_step_procedure) || first.step_by_step_procedure.length < 1) {
  console.error('Activity 1 missing procedure');
  process.exit(1);
}

console.log('Activity / Project heading tests OK');
