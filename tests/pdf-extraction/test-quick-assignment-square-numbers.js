/**
 * Quick Assignment — Square Numbers sample (metadata + section boundary fixes).
 */
import { extractQuickAssignmentItemsFromPdfText } from '../../services/pdf-quick-assignment-extract.js';
import { cleanPdfEducationalContent } from '../../services/pdf-content-cleaner.js';

const SAMPLE = `
My Assignment: Final Mastery Assignment in Square Numbers.

Section 1
Assignment Title
My Assignment: Final Mastery Assignment in Square Numbers.

Section 2
Learning Objectives
• I can identify square numbers as numbers of the form n x n or n^2.
• I can solve age-appropriate competency-based problems involving square arrangements.

Section 3
Instructions to Students
• Read every task carefully and underline the key mathematical words.
• Use square notation correctly, such as 8^2 = 64.

Section 4
Concept-based Questions
Q1. Explain in your own words how final mastery assignment helps me understand square numbers.
Q2. Write any six square numbers between 1 and 200 and mention their bases.
Q3. Decide whether 144 is a perfect square. Give two reasons.
Q4. A number ends in 7. Can it be a perfect square? Explain using the unit digit rule.
Q5. Complete the pattern: 1, 4, 9, 16, __, __, __ and write the bases.

Section 5
Application-oriented Tasks
• Task: Make a small table that connects showing complete understanding of square numbers with n, n^2 and square arrangement.
• Task: Draw a 6 by 6 square array and write the square number it represents.

Section 6
Real-life / Competency-based Activity
• I will observe a real-life situation involving showing complete understanding of square numbers.

Section 7
Creative Thinking Question
• Create a mini poster titled "Square Numbers through Final Mastery Assignment".

-- 100 of 102 --
Class 8 Maths | Chapter 1: A Square and A Cube | Subtopic 1.1 Square Numbers Page 101

Section 8
Collaborative / Discussion Task (if suitable)
• Work with a partner and compare two methods for identifying a perfect square.

Section 9
Challenge Question for Advanced Learners
• Challenge 1. A perfect square lies between 400 and 500. List all possibilities.
• Challenge 2. Find the smallest number by which 180 must be divided to get a perfect square.

Assessment Criteria / Rubric
• Concept accuracy: I correctly identify square numbers and use n^2 notation properly. 4 marks.
• Reasoning: I explain why an answer is a perfect square or not. 4 marks.

Expected Learning Outcomes
• I will be able to define a square number and give correct examples and non-examples.
• I will be able to recognise square numbers using patterns, arrays, factors or prime factorisation.

-- 101 of 102 --
Class 8 Maths | Chapter 1: A Square and A Cube | Subtopic 1.1 Square Numbers Page 102

Student Completion Checklist

How I should use these 50 assignments

• Complete one generation at a time and check whether I have answered all 11 sections.
• Revise squares from 1^2 to 20^2 regularly for speed and accuracy.
`;

const params = { topic: 'A Square and A Cube', subtopic: 'Square Numbers' };

const cleaned = cleanPdfEducationalContent(SAMPLE);
if (cleaned.includes('-- 100 of 102 --')) {
  console.error('FAIL: page footer still in cleaned text');
  process.exit(1);
}
if (/student\s+completion\s+checklist/i.test(cleaned)) {
  console.error('FAIL: checklist trailer still in cleaned text');
  process.exit(1);
}
console.log('PASS: content cleaner removes footers and trailer');

const items = extractQuickAssignmentItemsFromPdfText(SAMPLE, 5, params);
if (items.length !== 1) {
  console.error('FAIL: expected 1 assignment item, got', items.length);
  process.exit(1);
}

const a = items[0];
if (a.concept_based_questions.length < 5) {
  console.error('FAIL: expected 5 concept questions, got', a.concept_based_questions.length);
  process.exit(1);
}

const q1 = String(a.concept_based_questions[0]?.question || '');
if (/final\s+mastery\s+assignment\s+helps\s+me\s+understand\s+square\s+numbers/i.test(q1)) {
  console.error('FAIL: Q1 still has unfilled template placeholder:', q1);
  process.exit(1);
}
if (!/square\s+numbers/i.test(q1)) {
  console.error('FAIL: Q1 should reference square numbers after contextualize:', q1);
  process.exit(1);
}

if (String(a.challenge_question_advanced).includes('Concept accuracy')) {
  console.error('FAIL: rubric leaked into challenge section');
  process.exit(1);
}
if (!String(a.assessment_criteria_rubric).includes('Concept accuracy')) {
  console.error('FAIL: rubric missing from assessment section');
  process.exit(1);
}

if (a.expected_learning_outcomes.some((line) => /complete one generation/i.test(line))) {
  console.error('FAIL: checklist bullets in expected learning outcomes');
  process.exit(1);
}

if (String(a.creative_thinking_question).includes('-- 100 of 102')) {
  console.error('FAIL: page footer in creative section');
  process.exit(1);
}

console.log('PASS: quick assignment square numbers extract');
console.log('  questions:', a.concept_based_questions.length);
console.log('  title:', a.assignment_title);
