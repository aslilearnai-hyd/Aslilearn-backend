/**
 * Class VII — Mathematics (Ganita Prakash / NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 7 + Mathematics.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_7_MATHEMATICS_GANITA_PRAKASH_CHAPTERS = [
  {
    title: 'Book 1 Chapter 1: Large Numbers Around Us',
    subtopics: [
      '1.1 A Lakh Varieties!',
      '1.2 Reading and Writing Numbers',
      '1.3 Land of Tens',
      '1.4 Of Crores and Crores!',
      '1.5 Exact and Approximate Values',
      '1.6 Patterns in Products',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 2: Arithmetic Expressions',
    subtopics: [
      '2.1 Simple Expressions',
      '2.2 Reading and Evaluating Complex Expressions',
      '2.3 Removing Brackets - I',
      '2.4 Terms in Expressions',
      '2.5 Swapping and Grouping',
      '2.6 Removing Brackets - II',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 3: A Peek Beyond the Point',
    subtopics: [
      '3.1 The Need for Smaller Units',
      '3.2 A Tenth Part',
      '3.3 A Hundredth Part',
      '3.4 Decimal Place Value',
      '3.5 Units of Measurement',
      '3.6 Locating and Comparing Decimals',
      '3.7 Addition and Subtraction of Decimals',
      '3.8 More on the Decimal System',
      '3.9 Estimation of Quantities',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 4: Expressions Using Letter-Numbers',
    subtopics: [
      '4.1 The Notion of Letter-Numbers',
      '4.2 Revisiting Arithmetic Expressions',
      '4.3 Expressions with Letter-Numbers',
      '4.4 Algebraic Expressions in Various Contexts',
      '4.5 Formulas',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 5: Parallel and Intersecting Lines',
    subtopics: [
      '5.1 Across the Line',
      '5.2 Perpendicular Lines',
      '5.3 Between Lines - Parallel Lines',
      '5.4 Parallel and Perpendicular Lines in Paper Folding',
      '5.5 Transversals',
      '5.6 Angles Made by a Transversal',
      '5.7 Parallel Lines and a Transversal',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 6: Number Play',
    subtopics: [
      '6.1 Numbers Tell Us Things',
      '6.2 Picking Parity',
      '6.3 Small Number, Large Number',
      '6.4 Playing with Digits',
      '6.5 Digits and Operations',
      '6.6 Pretty Palindromes',
      '6.7 Puzzles Using Digits',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 7: A Tale of Three Intersecting Lines',
    subtopics: [
      '7.1 Triangles in Paper Folding',
      '7.2 Equilateral and Isosceles Triangles',
      '7.3 Types of Triangles by Sides and Angles',
      '7.4 Construction of Triangles',
      '7.5 Exterior Angle of a Triangle',
      '7.6 Sum of the Lengths of Two Sides of a Triangle',
      '7.7 Angle Sum Property',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 1 Chapter 8: Working with Fractions',
    subtopics: [
      '8.1 Multiplication of Fractions',
      '8.2 Division of Fractions',
      '8.3 Word Problems Involving Fractions',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 1: Geometric Twins',
    subtopics: [
      '1.1 Revisiting Basic Geometric Shapes',
      '1.2 Quadrilaterals and Their Types',
      '1.3 Polygons - Regular and Irregular',
      '1.4 Circles - Parts and Properties',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 2: Operations with Integers',
    subtopics: [
      '2.1 Recalling Integers and the Number Line',
      '2.2 Addition and Subtraction of Integers',
      '2.3 Multiplication of Integers',
      '2.4 Division of Integers',
      '2.5 Properties of Operations on Integers',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 3: Finding Common Ground',
    subtopics: [
      '3.1 Factors and Multiples Revisited',
      '3.2 Highest Common Factor (HCF)',
      '3.3 Lowest Common Multiple (LCM)',
      '3.4 Relationship between HCF and LCM',
      '3.5 Word Problems',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 4: Another Peek Beyond the Point',
    subtopics: [
      '4.1 Multiplication of Decimals',
      '4.2 Division of Decimals',
      '4.3 Decimals and Fractions - Interconversion',
      '4.4 Applications in Measurement',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 5: Connecting the Dots',
    subtopics: [
      '5.1 Coordinates and the Grid',
      '5.2 Plotting Points',
      '5.3 Connecting Points to Form Shapes',
      '5.4 Simple Introduction to the Cartesian System',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 6: Constructions and Tilings',
    subtopics: [
      '6.1 Basic Geometrical Constructions',
      '6.2 Constructing Perpendicular Bisector',
      '6.3 Constructing Angle Bisector',
      '6.4 Tilings and Tessellations',
      '6.5 Symmetry in Tilings',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Book 2 Chapter 7: Finding the Unknown',
    subtopics: [
      '7.1 Equations and Their Solutions',
      '7.2 Solving Simple Equations',
      '7.3 Translating Word Problems into Equations',
      '7.4 Verification of Solutions',
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

export function isClass7MathematicsSubject(subjectId) {
  const s = norm(subjectId);
  return (
    s.includes('mathematics') ||
    s.includes('maths') ||
    s.includes('math') ||
    s.includes('ganita') ||
    s.includes('गणित')
  );
}

export function matchClass7MathematicsChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_7_MATHEMATICS_GANITA_PRAKASH_CHAPTERS);
}
