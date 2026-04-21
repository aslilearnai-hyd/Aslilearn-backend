/**
 * Class VI — Mathematics (Ganita Prakash / NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 6 + Mathematics.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_6_MATHEMATICS_GANITA_PRAKASH_CHAPTERS = [
  {
    title: 'Chapter 1: Patterns in Mathematics',
    subtopics: [
      '1.1 What is Mathematics?',
      '1.2 Patterns in Numbers',
      '1.3 Visualising Number Sequences',
      '1.4 Relations among Number Sequences',
      '1.5 Patterns in Shapes',
      '1.6 Relation to Number Sequences',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 2: Lines and Angles',
    subtopics: [
      '2.1 Point',
      '2.2 Line Segment',
      '2.3 Line',
      '2.4 Ray',
      '2.5 Angle',
      '2.6 Comparing Angles',
      '2.7 Making Rotating Arms',
      '2.8 Special Types of Angles',
      '2.9 Measuring Angles',
      '2.10 Drawing Angles of a Specified Measure',
      '2.11 Types of Angles and their Measures',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 3: Number Play',
    subtopics: [
      '3.1 Numbers Can Tell Us Things',
      '3.2 Supercells',
      '3.3 Patterns of Numbers on the Number Line',
      '3.4 Playing with Digits',
      '3.5 Pretty Palindromic Patterns',
      '3.6 The Magic Number of Kaprekar',
      '3.7 Clock and Calendar Numbers',
      '3.8 Mental Math',
      '3.9 Playing with Number Patterns',
      '3.10 An Unsolved Mystery - the Collatz Conjecture',
      '3.11 Simple Estimation',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 4: Data Handling and Presentation',
    subtopics: [
      '4.1 Collecting and Organising Data',
      '4.2 Pictographs',
      '4.3 Bar Graphs',
      '4.4 Drawing a Bar Graph',
      '4.5 Artistic and Infographic Representation of Data',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 5: Prime Time',
    subtopics: [
      '5.1 Common Multiples and Common Factors',
      '5.2 Prime Numbers',
      '5.3 Co-prime Numbers for Safekeeping Treasures',
      '5.4 Prime Factorisation',
      '5.5 Divisibility Tests',
      '5.6 Fun with Numbers - Special Numbers',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 6: Perimeter and Area',
    subtopics: ['6.1 Perimeter', '6.2 Area', '6.3 Area of a Triangle', EXERCISE_LINE],
  },
  {
    title: 'Chapter 7: Fractions',
    subtopics: [
      '7.1 Fractional Units and Equal Shares',
      '7.2 Fractional Units as Parts of a Whole',
      '7.3 Measuring Using Fractional Units',
      '7.4 Marking Fraction Lengths on a Number Line',
      '7.5 Mixed Fractions',
      '7.6 Equivalent Fractions',
      '7.7 Comparing Fractions',
      '7.8 Addition and Subtraction of Fractions',
      '7.9 A Pinch of History',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 8: Playing with Constructions',
    subtopics: [
      '8.1 Artwork',
      '8.2 Squares and Rectangles',
      '8.3 Constructing Squares and Rectangles',
      '8.4 An Exploration in Rectangles',
      '8.5 Exploring Diagonals of Rectangles and Squares',
      '8.6 Points Equidistant from Two Given Points',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 9: Symmetry',
    subtopics: ['9.1 Line of Symmetry', '9.2 Rotational Symmetry', EXERCISE_LINE],
  },
  {
    title: 'Chapter 10: The Other Side of Zero',
    subtopics: [
      "10.1 Bela's Building of Fun",
      '10.2 The Token Model',
      '10.3 Integers in Other Places',
      '10.4 Explorations with Integers',
      '10.5 A Pinch of History',
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

export function isClass6MathematicsSubject(subjectId) {
  const s = norm(subjectId);
  return (
    s.includes('mathematics') ||
    s.includes('maths') ||
    s.includes('math') ||
    s.includes('ganita') ||
    s.includes('गणित')
  );
}

export function matchClass6MathematicsChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_6_MATHEMATICS_GANITA_PRAKASH_CHAPTERS);
}
