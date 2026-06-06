/**
 * Generation boundary — must not leak Generation 2–50 into one assignment.
 */
import { extractQuickAssignmentItemsFromPdfText } from '../../services/pdf-quick-assignment-extract.js';
import { splitByGenerationMarkers, isolateGenerationBlock } from '../../services/pdf-assignment-boundaries.js';

const BULK_BANK = `
Generation 1: Square Numbers as Equal Groups

Section 1
Assignment Title
Square Numbers as Equal Groups

Section 2
Learning Objectives
• I can identify square numbers.

Section 4
Concept-based Questions
Q1. What is a square number?
Q2. List four square numbers.

Section 5
Application-oriented Tasks
• Task 1: Draw a 4 by 4 array.
• Task 2: Write 5 squared equals 25.
• Task 3: Find square of 9.
• Task 4: Show 16 as a square.
• Task 5: Make a table of n and n squared.

Section 6
Real-life / Competency-based Activity
• Count tiles on a chessboard row.

Section 7
Creative Thinking Question
• Design a poster about square numbers.

Generation 2: Perfect Square Identification

Section 1
Assignment Title
Perfect Square Identification

Section 5
Application-oriented Tasks
• Task 1: Use factor tree for 36.
• Task 2: Check if 50 is a perfect square.

Generation 3: First Twenty Squares

Section 1
Assignment Title
First Twenty Squares

Section 5
Application-oriented Tasks
• Task 1: Memorize 1 to 20 squares.

Generation 4: Odd Number Pattern

Section 5
Application-oriented Tasks
• Task 1: Show difference between 5 squared and 4 squared.

Generation 50: Squares and Square Numbers Assignment

Section 5
Application-oriented Tasks
• Task 1: Final review task.
`;

const gens = splitByGenerationMarkers(BULK_BANK);
if (gens.length < 4) {
  console.error('FAIL: expected >= 4 generation blocks, got', gens.length);
  process.exit(1);
}
console.log('PASS: split into', gens.length, 'generation blocks');

const gen1Only = isolateGenerationBlock(BULK_BANK, 1);
if (/generation\s+2/i.test(gen1Only) || /perfect\s+square\s+identification/i.test(gen1Only)) {
  console.error('FAIL: Generation 1 block contains Generation 2 content');
  process.exit(1);
}
if (!/square\s+numbers\s+as\s+equal\s+groups/i.test(gen1Only)) {
  console.error('FAIL: Generation 1 title missing');
  process.exit(1);
}
console.log('PASS: isolateGenerationBlock stops at Generation 2');

const items = extractQuickAssignmentItemsFromPdfText(BULK_BANK, 5, {
  subtopic: 'Square Numbers',
  assignmentTitle: 'Square Numbers as Equal Groups',
});
if (items.length !== 1) {
  console.error('FAIL: expected 1 item');
  process.exit(1);
}

const a = items[0];
const section5 = (a.application_oriented_tasks || []).join('\n').toLowerCase();

if (/generation\s+[3-9]/i.test(section5) || /generation\s+\d{2}/i.test(section5)) {
  console.error('FAIL: Section 5 contains later generation markers:', section5.slice(0, 400));
  process.exit(1);
}
if (/perfect\s+square\s+identification/i.test(section5)) {
  console.error('FAIL: Section 5 leaked Generation 2 content');
  process.exit(1);
}
if (/first\s+twenty\s+squares/i.test(section5)) {
  console.error('FAIL: Section 5 leaked Generation 3 content');
  process.exit(1);
}
if (a.application_oriented_tasks.length > 8) {
  console.error('FAIL: too many application tasks (bank merge):', a.application_oriented_tasks.length);
  process.exit(1);
}
if (a.concept_based_questions.length < 2) {
  console.error('FAIL: expected concept questions from Generation 1');
  process.exit(1);
}

console.log('PASS: generation boundary isolation');
console.log('  title:', a.assignment_title);
console.log('  application tasks:', a.application_oriented_tasks.length);
console.log('  concept questions:', a.concept_based_questions.length);
