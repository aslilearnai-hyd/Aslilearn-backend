/**
 * Class VI — Social Science (Exploring Society: India and Beyond / NCERT).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 6 + Social Science.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_6_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS = [
  {
    title: 'Theme A Chapter 1: Locating Places on the Earth',
    subtopics: [
      '1.1 Finding Places on the Earth',
      '1.2 Latitude',
      '1.3 Longitude',
      '1.4 Longitudes and Time (Time Zones)',
      '1.5 The Globe and the Map',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme A Chapter 2: Oceans and Continents',
    subtopics: [
      '2.1 Drawing the Planet',
      '2.2 Globes and Maps',
      '2.3 The Oceans of the World',
      '2.4 The Continents of the World',
      '2.5 Major Features of Each Continent',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme A Chapter 3: Landforms and Life',
    subtopics: [
      '3.1 Mountains and Life in the Mountains',
      '3.2 Plateaus',
      '3.3 Plains',
      '3.4 Coastal Areas and Islands',
      '3.5 Lakes and Rivers - Their Importance',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme B Chapter 4: Timeline and Sources of History',
    subtopics: [
      '4.1 The Concept of Time in History',
      '4.2 Dating of Historical Events - BCE, CE, Decade, Century, Millennium',
      '4.3 Sources of History - Literary, Archaeological, Oral',
      '4.4 Historians at Work',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme B Chapter 5: India, That Is Bharat',
    subtopics: [
      '5.1 The Name Bharat / India',
      '5.2 Geographical Features of India',
      '5.3 Natural Diversity of India',
      '5.4 Cultural Unity across Regions',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme B Chapter 6: The Beginnings of Indian Civilisation',
    subtopics: [
      '6.1 From Stone Age to Civilisation',
      '6.2 The Harappan / Indus-Sarasvati Civilisation',
      '6.3 Important Sites and Town Planning',
      '6.4 Agriculture, Crafts and Trade',
      '6.5 Script and Seals',
      '6.6 Decline of the Civilisation',
      EXERCISE_LINE,
    ],
  },
  {
    title: "Theme C Chapter 7: India's Cultural Roots",
    subtopics: [
      '7.1 The Vedic Culture',
      '7.2 The Vedas and Vedic Society',
      '7.3 Shramanic Traditions - Buddhism',
      '7.4 Shramanic Traditions - Jainism',
      '7.5 Shared Values and Ideas',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme C Chapter 8: Unity in Diversity, or "Many in the One"',
    subtopics: [
      '8.1 Linguistic Diversity',
      '8.2 Diversity of Festivals',
      '8.3 Culinary Practices',
      '8.4 Diversity of Art Forms - Dance, Music, Crafts',
      '8.5 "Many in One" - The Idea of Bharat',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme D Chapter 9: Family and Community',
    subtopics: [
      '9.1 Family - Types and Structures',
      '9.2 Community',
      '9.3 Village and Neighbourhood',
      '9.4 The State and its Role',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme D Chapter 10: Grassroots Democracy - Part 1: Governance',
    subtopics: [
      '10.1 What is Democracy?',
      '10.2 Governance',
      '10.3 Grassroots Democracy',
      '10.4 Features of a Democratic Government',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme D Chapter 11: Grassroots Democracy - Part 2: Local Government in Rural Areas',
    subtopics: [
      '11.1 The Panchayati Raj System',
      '11.2 Gram Panchayat - Composition and Roles',
      '11.3 Gram Sabha',
      '11.4 Block-Level and District-Level Panchayat',
      '11.5 Functions and Revenue Sources',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme D Chapter 12: Grassroots Democracy - Part 3: Local Government in Urban Areas',
    subtopics: [
      '12.1 Municipality',
      '12.2 Municipal Corporation',
      '12.3 Composition and Ward System',
      '12.4 Functions of Urban Local Bodies',
      '12.5 Revenue Sources for Urban Local Bodies',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme E Chapter 13: The Value of Work',
    subtopics: [
      '13.1 What is Work?',
      '13.2 Dignity of Work',
      '13.3 Types of Work - Manual, Mental, Mixed',
      '13.4 Work, Occupation, Profession',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Theme E Chapter 14: Economic Activities Around Us',
    subtopics: [
      '14.1 Economic and Non-Economic Activities',
      '14.2 Primary Sector',
      '14.3 Secondary Sector',
      '14.4 Tertiary Sector',
      '14.5 Organised and Unorganised Sectors',
      '14.6 Interdependence in the Economy',
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

export function isClass6SocialScienceSubject(subjectId) {
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

export function matchClass6SocialScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_6_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS);
}
