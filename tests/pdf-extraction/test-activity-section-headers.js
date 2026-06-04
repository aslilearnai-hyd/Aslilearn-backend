import { extractActivitiesFromCuriosityWorkbookPdf } from '../../services/curiosity-activity-pdf-parser.js';

const sample = `
Activity 4
1. Title of the Activity / Project
Discovering Mathematics Activity 4
2. Subtopic Link and Prior Knowledge Required
Students should know counting and patterns. They build on prior knowledge from class 3 and daily-life observations.
3. Learning Objectives
- Identify patterns in numbers
- Explain observations clearly
4. NCF Competency / Learning Outcome Alignment
Develops mathematical reasoning, communication, and observation skills.
5. Materials Required
- Chart paper
- Coloured pencils
6. Step-by-step Procedure
1. Ask students to find patterns in the classroom.
2. Record examples in notebooks.
3. Groups present conclusions.
7. Teacher Instructions
- Facilitate discussion
8. Student Instructions
- Work in pairs
9. Differentiation
Offer additional pattern tasks for early finishers.
10. Assessment Rubric
- Participation
11. Expected Learning Outcomes
Students identify mathematics in situations and explain observations.
12. Real-life Application
Mathematics in shopping, cooking, games, travel, and planning.
13. Reflection / Exit Ticket
Where did you notice mathematics today? Write one example.
`;

const rows = extractActivitiesFromCuriosityWorkbookPdf(sample);
if (!rows?.length) {
  console.error('FAIL: no rows');
  process.exit(1);
}
const a = rows[0];
const sub = String(a.subtopic_link_prior_knowledge || '');
const ref = String(a.reflection_exit_ticket || '');
const el = String(a.expected_learning_outcomes || '');
const rl = String(a.real_life_application || '');

let ok = true;
if (sub.startsWith('and ')) {
  console.error('FAIL: subtopic fragment:', sub);
  ok = false;
}
if (!Array.isArray(a.learning_objectives) || a.learning_objectives.length < 2) {
  console.error('FAIL: learning objectives', a.learning_objectives);
  ok = false;
}
if (!Array.isArray(a.materials_required) || a.materials_required.length < 1) {
  console.error('FAIL: materials', a.materials_required);
  ok = false;
}
if (a.step_by_step_procedure?.length < 2) {
  console.error('FAIL: procedure', a.step_by_step_procedure);
  ok = false;
}
if (!el.includes('identify mathematics')) {
  console.error('FAIL: expected outcomes:', el);
  ok = false;
}
if (!rl.includes('shopping')) {
  console.error('FAIL: real life:', rl);
  ok = false;
}
if (ref.includes('Expected Learning Outcomes') || ref.includes('Real-life Application')) {
  console.error('FAIL: reflection merged tail:', ref);
  ok = false;
}
if (!ref.includes('notice mathematics')) {
  console.error('FAIL: reflection:', ref);
  ok = false;
}

console.log(ok ? 'PASS: activity section headers' : 'FAIL');
console.log(JSON.stringify(a, null, 2));
process.exit(ok ? 0 : 1);
