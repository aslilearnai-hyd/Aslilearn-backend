/**
 * Class X — Mathematics (NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 10 + Mathematics.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_10_MATHEMATICS_NCERT_CHAPTERS = [
  {
    title: 'Chapter 1: Real Numbers',
    subtopics: [
      '1.1 Introduction - Revisiting Number Systems',
      '1.2 The Fundamental Theorem of Arithmetic',
      '1.3 Revisiting Irrational Numbers',
      '1.4 Proof of Irrationality (sqrt(2), sqrt(3), sqrt(5))',
      '1.5 Summary - Application-based Questions',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 2: Polynomials',
    subtopics: [
      '2.1 Introduction',
      '2.2 Geometrical Meaning of the Zeroes of a Polynomial',
      '2.3 Relationship between Zeroes and Coefficients of a Polynomial',
      '2.4 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 3: Pair of Linear Equations in Two Variables',
    subtopics: [
      '3.1 Introduction',
      '3.2 Graphical Method of Solution of a Pair of Linear Equations',
      '3.3 Algebraic Methods - Substitution Method',
      '3.4 Algebraic Methods - Elimination Method',
      '3.5 Word Problems Reducible to Pair of Linear Equations',
      '3.6 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 4: Quadratic Equations',
    subtopics: [
      '4.1 Introduction',
      '4.2 Quadratic Equations',
      '4.3 Solution by Factorisation',
      '4.4 Solution by Completing the Square',
      '4.5 Nature of Roots (Discriminant)',
      '4.6 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 5: Arithmetic Progressions',
    subtopics: [
      '5.1 Introduction',
      '5.2 Arithmetic Progressions - Definition',
      '5.3 n-th Term of an A.P.',
      '5.4 Sum of First n Terms of an A.P.',
      '5.5 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 6: Triangles',
    subtopics: [
      '6.1 Introduction',
      '6.2 Similar Figures',
      '6.3 Similarity of Triangles',
      '6.4 Criteria for Similarity of Triangles',
      '6.5 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 7: Coordinate Geometry',
    subtopics: [
      '7.1 Introduction',
      '7.2 Distance Formula',
      '7.3 Section Formula',
      '7.4 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 8: Introduction to Trigonometry',
    subtopics: [
      '8.1 Introduction',
      '8.2 Trigonometric Ratios',
      '8.3 Trigonometric Ratios of Some Specific Angles',
      '8.4 Trigonometric Identities',
      '8.5 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 9: Some Applications of Trigonometry',
    subtopics: [
      '9.1 Introduction',
      '9.2 Heights and Distances',
      '9.3 Angles of Elevation and Depression',
      '9.4 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 10: Circles',
    subtopics: [
      '10.1 Introduction',
      '10.2 Tangent to a Circle',
      '10.3 Number of Tangents from a Point on a Circle',
      '10.4 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 11: Areas Related to Circles',
    subtopics: [
      '11.1 Introduction',
      '11.2 Areas of Sector and Segment of a Circle',
      '11.3 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 12: Surface Areas and Volumes',
    subtopics: [
      '12.1 Introduction',
      '12.2 Surface Area of a Combination of Solids',
      '12.3 Volume of a Combination of Solids',
      '12.4 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 13: Statistics',
    subtopics: [
      '13.1 Introduction',
      '13.2 Mean of Grouped Data (Direct, Assumed Mean, Step-Deviation)',
      '13.3 Mode of Grouped Data',
      '13.4 Median of Grouped Data',
      '13.5 Summary',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 14: Probability',
    subtopics: [
      '14.1 Introduction',
      '14.2 Probability - A Theoretical Approach',
      '14.3 Summary',
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

export function isClass10MathematicsSubject(subjectId) {
  const s = norm(subjectId);
  return s.includes('mathematics') || s.includes('maths') || s.includes('math') || s.includes('गणित');
}

export function matchClass10MathematicsChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_10_MATHEMATICS_NCERT_CHAPTERS);
}
