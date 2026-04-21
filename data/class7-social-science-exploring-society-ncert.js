/**
 * Class VII — Social Science (Exploring Society: India and Beyond, NCERT 2026-27).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 7 + Social Science.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_7_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS = [
  {
    title: 'Part 1 Chapter 1: Geographical Diversity of India',
    subtopics: [
      "1.1 India's Location and Extent",
      '1.2 Major Physical Divisions - Himalayas, Northern Plains, Peninsular Plateau, Coastal Plains, Islands, Desert',
      '1.3 Influence of Landforms on Life and Culture',
      '1.4 Rivers and their Role',
      '1.5 Diverse Landscapes: A Mosaic',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 2: Understanding the Weather',
    subtopics: [
      '2.1 What is Weather?',
      '2.2 Elements of Weather - Temperature, Humidity, Rainfall, Wind, Pressure',
      '2.3 The Atmosphere and its Layers',
      '2.4 Weather Instruments',
      '2.5 Weather Forecasting and its Importance',
      '2.6 Extreme Weather Events',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 3: Climates of India',
    subtopics: [
      '3.1 Difference between Weather and Climate',
      "3.2 Factors Influencing India's Climate",
      '3.3 The Monsoon System',
      '3.4 Seasons of India - Winter, Summer, Rainy, Retreating Monsoon',
      '3.5 Climatic Regions of India',
      '3.6 Climate Change and India',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 4: New Beginnings: Cities and States',
    subtopics: [
      '4.1 From Villages to Cities - The Second Urbanisation',
      '4.2 Janapadas and Mahajanapadas',
      '4.3 Republics and Monarchies',
      '4.4 Coinage, Trade and Crafts',
      '4.5 Early Indian Philosophy and Religious Movements',
      '4.6 The Rise of Magadha',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 5: The Rise of Empires',
    subtopics: [
      '5.1 The Mauryan Empire - Chandragupta and Bindusara',
      '5.2 Ashoka the Great',
      "5.3 Ashoka's Dhamma and Edicts",
      '5.4 Mauryan Administration',
      '5.5 Decline of the Mauryan Empire',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 6: The Age of Reorganisation',
    subtopics: [
      '6.1 Post-Mauryan India',
      '6.2 The Shungas and Kanvas',
      '6.3 The Satavahanas of the Deccan',
      '6.4 The Indo-Greeks, Shakas, Kushanas',
      '6.5 The Sangam Age - Cheras, Cholas and Pandyas',
      '6.6 Trade, Culture and Cross-Regional Contacts',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 7: The Gupta Era: An Age of Tireless Creativity',
    subtopics: [
      '7.1 Rise of the Gupta Dynasty',
      '7.2 Chandragupta I, Samudragupta, Chandragupta II',
      '7.3 Administration and Society under the Guptas',
      '7.4 Achievements in Science and Mathematics - Aryabhata, Varahamihira',
      '7.5 Literature and Arts - Kalidasa, Sculpture, Temples',
      '7.6 Decline of the Gupta Empire',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 8: How the Land Becomes Sacred',
    subtopics: [
      '8.1 The Idea of Sacred Geography',
      '8.2 Sacred Rivers, Mountains and Forests',
      '8.3 Pilgrimage Sites across India',
      '8.4 Temples as Cultural Centres',
      '8.5 Integrating Diverse Traditions - Hinduism, Buddhism, Jainism, Sikhism, Islam, Christianity',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 9: From the Rulers to the Ruled: Types of Governments',
    subtopics: [
      '9.1 What is a Government?',
      '9.2 Monarchy',
      '9.3 Oligarchy',
      '9.4 Democracy - Direct and Representative',
      '9.5 Dictatorship and Theocracy',
      '9.6 Why India Chose Democracy',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 10: The Constitution of India - An Introduction',
    subtopics: [
      '10.1 What is a Constitution?',
      '10.2 Framing of the Indian Constitution',
      '10.3 The Preamble',
      '10.4 Key Features of the Constitution',
      '10.5 Fundamental Rights and Duties',
      '10.6 Directive Principles of State Policy',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 11: From Barter to Money',
    subtopics: [
      '11.1 Barter System and its Limitations',
      '11.2 Evolution of Money',
      '11.3 Forms of Money - Coins, Paper Currency, Digital Money',
      '11.4 Functions of Money',
      '11.5 Role of Banks in Modern Money Systems',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 1 Chapter 12: Understanding Markets',
    subtopics: [
      '12.1 What is a Market?',
      '12.2 Types of Markets - Local, Wholesale, Retail, Online',
      '12.3 Buyers, Sellers and Middlemen',
      '12.4 Demand and Supply - A Simple Introduction',
      '12.5 Role of Competition and Prices',
      '12.6 Ethical Consumption',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 2 Chapter 13: The Story of Indian Farming',
    subtopics: [
      '13.1 Evolution of Indian Agriculture',
      '13.2 Types of Farming - Subsistence, Commercial, Plantation',
      '13.3 Cropping Seasons - Rabi, Kharif, Zaid',
      '13.4 Major Crops of India',
      '13.5 Green Revolution and its Impact',
      '13.6 Modern Challenges - Soil Health, Water, Climate',
      '13.7 Organic and Sustainable Farming',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Part 2 Chapter 14: India and Her Neighbours',
    subtopics: [
      "14.1 India's Neighbouring Countries",
      '14.2 Geography and People of Neighbours',
      '14.3 Historical and Cultural Links',
      '14.4 SAARC and Regional Cooperation',
      "14.5 India's Foreign Policy Principles",
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

export function isClass7SocialScienceSubject(subjectId) {
  const s = norm(subjectId);
  return (
    s.includes('social science') ||
    s.includes('social studies') ||
    s.includes('sst') ||
    s.includes('civics') ||
    s.includes('history') ||
    s.includes('geography') ||
    s.includes('exploring society')
  );
}

export function matchClass7SocialScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_7_SOCIAL_SCIENCE_EXPLORING_SOCIETY_CHAPTERS);
}
