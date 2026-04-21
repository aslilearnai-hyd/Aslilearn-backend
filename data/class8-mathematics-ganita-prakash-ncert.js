/**
 * Class VIII — Mathematics (Ganita Prakash / NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 8 + Mathematics.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_8_MATHEMATICS_GANITA_PRAKASH_CHAPTERS = [
  {
    title: 'Book 1 Chapter 1: A Square and A Cube',
    subtopics: [
      '1.1 Squares and Square Numbers',
      '1.2 Properties of Square Numbers',
      '1.3 Some More Interesting Patterns',
      '1.4 Finding the Square of a Number',
      '1.5 Square Roots',
      '1.6 Square Roots of Decimals',
      '1.7 Cubes and Cube Numbers',
      '1.8 Cube Roots',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 2: Power Play',
    subtopics: [
      '2.1 Exponents and Powers',
      '2.2 Laws of Exponents',
      '2.3 Powers of 10 - Standard Form',
      '2.4 Expressing Numbers in Standard Form',
      '2.5 Comparing Very Large and Very Small Numbers',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 3: A Story of Numbers',
    subtopics: [
      '3.1 Rational Numbers',
      '3.2 Properties of Rational Numbers',
      '3.3 Representing Rational Numbers on the Number Line',
      '3.4 Rational Numbers between Two Rational Numbers',
      '3.5 Operations on Rational Numbers',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 4: Quadrilaterals',
    subtopics: [
      '4.1 Revisiting Polygons',
      '4.2 Sum of Angles of a Quadrilateral',
      '4.3 Types of Quadrilaterals - Parallelogram, Rhombus, Rectangle, Square, Trapezium, Kite',
      '4.4 Properties of a Parallelogram',
      '4.5 Constructing Special Quadrilaterals',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 5: Number Play',
    subtopics: [
      '5.1 Playing with Numbers',
      '5.2 Tests of Divisibility',
      '5.3 Puzzles Using Numbers',
      '5.4 Number Games and Tricks',
      '5.5 Patterns with Digits',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 6: We Distribute, Yet Things Multiply',
    subtopics: [
      '6.1 Revisiting Distributive Law',
      '6.2 Multiplication of Algebraic Expressions',
      '6.3 Identities - (a+b)^2, (a-b)^2, (a+b)(a-b)',
      '6.4 Applying Identities to Simplify Expressions',
      '6.5 Factorisation',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 7: Proportional Reasoning',
    subtopics: [
      '7.1 Ratio and Proportion - Recap',
      '7.2 Direct Variation',
      '7.3 Inverse Variation',
      '7.4 Applications - Time, Speed, Work',
      '7.5 Compound Ratio',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 1: Fractions in Disguise',
    subtopics: [
      '1.1 Revisiting Rational Numbers',
      '1.2 Decimals - Terminating and Non-Terminating',
      '1.3 Converting Decimals to Fractions',
      '1.4 Operations on Rational Numbers in Decimal Form',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 2: The Baudhayan-Pythagoras Theorem',
    subtopics: [
      '2.1 Historical Background - Sulba Sutras',
      '2.2 Statement of the Theorem',
      '2.3 Proof of the Theorem',
      '2.4 Pythagorean Triples',
      '2.5 Applications to Problems',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 3: Proportional Reasoning - 2',
    subtopics: [
      '3.1 Percentage Change - Increase and Decrease',
      '3.2 Profit and Loss',
      '3.3 Discount',
      '3.4 Simple Interest and Compound Interest',
      '3.5 Growth and Depreciation',
      '3.6 Applications in Daily Life',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 4: Exploring Space: Congruent Triangles',
    subtopics: [
      '4.1 Congruence of Figures',
      '4.2 Congruence of Triangles',
      '4.3 Criteria for Congruence - SSS, SAS, ASA, RHS',
      '4.4 Applications to Problems',
      '4.5 Activity-Based Proofs',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 5: Tales by Dots and Lines',
    subtopics: [
      '5.1 Introduction to Graphs',
      '5.2 Linear Graphs',
      '5.3 Reading and Interpreting Graphs',
      '5.4 Drawing Graphs from a Table',
      '5.5 Applications - Distance-Time, Quantity-Price',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 6: Algebra Play',
    subtopics: [
      '6.1 Recap - Algebraic Expressions',
      '6.2 Solving Linear Equations in One Variable',
      '6.3 Equations Involving Brackets and Fractions',
      '6.4 Word Problems - Age, Money, Numbers',
      '6.5 Checking Solutions',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 7: Area',
    subtopics: [
      '7.1 Area of Polygons',
      '7.2 Area of Trapezium and Other Quadrilaterals',
      '7.3 Area of Circle',
      '7.4 Surface Area of Cuboid and Cube',
      '7.5 Surface Area of Cylinder',
      '7.6 Volume of Cuboid, Cube, Cylinder',
      EXERCISE_LINE,
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass8MathematicsSubject(subjectId) {
  const s = norm(subjectId);
  return (
    s.includes('mathematics') ||
    s.includes('maths') ||
    s.includes('math') ||
    s.includes('ganita') ||
    s.includes('गणित')
  );
}

export function matchClass8MathematicsChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_8_MATHEMATICS_GANITA_PRAKASH_CHAPTERS);
}
