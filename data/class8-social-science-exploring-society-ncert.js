/**
 * Class VIII — Social Science (Exploring Society: India and Beyond, NCERT 2026-27).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 8 + Social Science.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_8_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS = [
  {
    title: 'Part 1 Chapter 1: Natural Resources and Their Use',
    subtopics: [
      '1.1 What is a Resource?',
      '1.2 Classification of Resources - Renewable and Non-Renewable',
      '1.3 Biotic and Abiotic Resources',
      '1.4 Potential, Developed, and Stock Resources',
      '1.5 Availability vs Accessibility of Resources',
      '1.6 Human Activity and Resource Depletion',
      '1.7 Sustainable Development and Conservation',
      EXERCISE_LINE,
    ],
  },
  {
    title: "Part 1 Chapter 2: Reshaping India's Political Map",
    subtopics: [
      '2.1 Political Landscape of Medieval India',
      '2.2 The Delhi Sultanate - Key Rulers and Administration',
      '2.3 The Vijayanagara Empire',
      "2.4 Timur's Invasion and Its Consequences",
      '2.5 Portuguese Arrival and Early European Contact',
      '2.6 Regional Kingdoms',
      '2.7 Cultural and Economic Impact',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 3: The Rise of the Marathas',
    subtopics: [
      '3.1 Origins of the Marathas',
      '3.2 Shivaji - Birth, Early Life, and Coronation (1674)',
      "3.3 Shivaji's Military and Administrative Genius",
      "3.4 Ashtapradhan - Shivaji's Council",
      "3.5 Expansion under Shivaji's Successors",
      '3.6 The Peshwas and Maratha Confederacy',
      '3.7 Decline of the Maratha Empire',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 4: The Colonial Era in India',
    subtopics: [
      '4.1 Arrival of European Trading Companies',
      '4.2 Rise of the British East India Company',
      '4.3 Battles of Plassey (1757) and Buxar (1764)',
      '4.4 Expansion of British Rule - Subsidiary Alliance, Doctrine of Lapse',
      '4.5 Economic Impact - Deindustrialisation, Drain of Wealth',
      '4.6 Social and Cultural Impact',
      '4.7 Early Resistance and the Revolt of 1857',
      EXERCISE_LINE,
    ],
  },
  {
    title: "Part 1 Chapter 5: Universal Franchise and India's Electoral System",
    subtopics: [
      '5.1 What is Universal Adult Franchise?',
      '5.2 Why Universal Franchise was Radical',
      '5.3 Voting in India - One Person, One Vote',
      '5.4 The Election Commission of India',
      '5.5 Conducting Free and Fair Elections',
      '5.6 Types of Elections - General, State, Local',
      '5.7 Electoral Reforms',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 6: The Parliamentary System: Legislature and Executive',
    subtopics: [
      '6.1 Why a Parliamentary System?',
      '6.2 Parliament of India - Lok Sabha and Rajya Sabha',
      '6.3 Role of the President',
      '6.4 Prime Minister and Council of Ministers',
      '6.5 Separation of Powers',
      '6.6 Making of Laws - How a Bill Becomes a Law',
      '6.7 State Legislature',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 7: Factors of Production',
    subtopics: [
      '7.1 What is Production?',
      '7.2 Land as a Factor of Production',
      '7.3 Labour',
      '7.4 Capital',
      '7.5 Entrepreneurship',
      '7.6 Interdependence among Factors',
      '7.7 Production in Modern Economy',
      EXERCISE_LINE,
    ],
  },
  {
    title: "Part 2 Chapter 8: India's Cultural and Intellectual Heritage (Indicative)",
    subtopics: [
      '8.1 Indian Knowledge Systems',
      '8.2 Contributions to Mathematics, Astronomy, Medicine',
      '8.3 Art, Architecture and Music Traditions',
      '8.4 Literature in Indian Languages',
      EXERCISE_LINE,
    ],
  },
  {
    title: "Part 2 Chapter 9: India's Freedom Movement (Indicative)",
    subtopics: [
      '9.1 Early Nationalist Phase (1885-1905)',
      '9.2 Moderates and Extremists',
      '9.3 Mahatma Gandhi and Mass Movements',
      '9.4 Non-Cooperation, Civil Disobedience, Quit India',
      '9.5 Revolutionary Movements',
      '9.6 Partition and Independence',
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

export function isClass8SocialScienceSubject(subjectId) {
  const s = norm(subjectId);
  return (
    s.includes('social science') ||
    s.includes('social studies') ||
    s.includes('sst') ||
    s.includes('exploring society') ||
    s.includes('history') ||
    s.includes('geography') ||
    s.includes('civics')
  );
}

export function matchClass8SocialScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_8_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS);
}
