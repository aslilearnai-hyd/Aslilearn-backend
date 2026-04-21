/**
 * Class VII — Science (NCERT outline).
 * Sole source for Topic / Subtopic dropdowns when Class 7 + Science (same pattern as Class 6).
 */
import { matchNcertChapter, isClass6ScienceSubject } from './class6-science-curiosity-ncert.js';

export const CLASS_7_SCIENCE_NCERT_CHAPTERS = [
  {
    title: 'Chapter 1: The Ever-Evolving World of Science',
    subtopics: [
      '1.1 What Makes Science Different',
      '1.2 Observation, Hypothesis, Experiment',
      '1.3 Scientific Inquiry and Method',
      '1.4 Evolution of Scientific Ideas',
      '1.5 Science in Daily Life',
    ],
  },
  {
    title: 'Chapter 2: Exploring Substances: Acidic, Basic, and Neutral',
    subtopics: [
      '2.1 Acids and Bases Around Us',
      '2.2 Natural Indicators — Litmus, Turmeric, Hibiscus',
      '2.3 Acid-Base Reactions — Neutralisation',
      '2.4 Acids and Bases in Everyday Life',
      '2.5 pH and Testing',
    ],
  },
  {
    title: 'Chapter 3: Electricity: Circuits and Their Components',
    subtopics: [
      '3.1 Electric Current and Its Effects',
      '3.2 Electric Circuit — Components',
      '3.3 Symbols of Electric Components',
      '3.4 Conductors and Insulators',
      '3.5 Safety with Electricity',
      '3.6 Heating Effect of Electric Current',
    ],
  },
  {
    title: 'Chapter 4: The World of Metals and Non-Metals',
    subtopics: [
      '4.1 Physical Properties of Metals',
      '4.2 Physical Properties of Non-Metals',
      '4.3 Chemical Properties — Reactions with Oxygen, Water, Acids',
      '4.4 Uses of Metals and Non-Metals',
      '4.5 Metalloids',
    ],
  },
  {
    title: 'Chapter 5: Changes Around Us: Physical and Chemical',
    subtopics: [
      '5.1 Changes in Our Surroundings',
      '5.2 Physical Changes',
      '5.3 Chemical Changes',
      '5.4 Rusting of Iron',
      '5.5 Crystallisation',
    ],
  },
  {
    title: 'Chapter 6: Adolescence: A Stage of Growth and Change',
    subtopics: [
      '6.1 What is Adolescence?',
      '6.2 Physical Changes at Puberty',
      '6.3 Secondary Sexual Characteristics',
      '6.4 Role of Hormones',
      '6.5 Reproductive Health',
      '6.6 Myths and Facts, Nutrition and Hygiene',
    ],
  },
  {
    title: 'Chapter 7: Heat Transfer in Nature',
    subtopics: [
      '7.1 Heat and Temperature',
      '7.2 Conduction',
      '7.3 Convection',
      '7.4 Radiation',
      '7.5 Heat in Daily Life',
      '7.6 Sea Breeze and Land Breeze',
    ],
  },
  {
    title: 'Chapter 8: Measurement of Time and Motion',
    subtopics: [
      '8.1 Measurement of Time',
      '8.2 Simple Pendulum',
      '8.3 Uniform and Non-Uniform Motion',
      '8.4 Speed',
      '8.5 Distance-Time Graph',
    ],
  },
  {
    title: 'Chapter 9: Life Processes in Animals',
    subtopics: [
      '9.1 Nutrition in Animals',
      '9.2 Digestive System in Humans',
      '9.3 Respiration in Animals',
      '9.4 Circulation',
      '9.5 Excretion',
    ],
  },
  {
    title: 'Chapter 10: Life Processes in Plants',
    subtopics: [
      '10.1 Photosynthesis',
      '10.2 Transport of Water and Minerals',
      '10.3 Transpiration',
      '10.4 Respiration in Plants',
      '10.5 Autotrophic and Heterotrophic Nutrition',
    ],
  },
  {
    title: 'Chapter 11: Light: Shadows and Reflections',
    subtopics: [
      '11.1 Light and Shadows',
      '11.2 Reflection of Light',
      '11.3 Plane Mirrors and Images',
      '11.4 Spherical Mirrors — Concave and Convex',
      '11.5 Real and Virtual Images',
      '11.6 Dispersion of Light',
    ],
  },
  {
    title: 'Chapter 12: Earth, Moon and the Sun',
    subtopics: [
      '12.1 The Earth in the Solar System',
      '12.2 Rotation and Revolution of Earth',
      '12.3 Seasons',
      '12.4 The Moon — Phases, Eclipses',
      '12.5 The Sun — Source of Energy',
    ],
  },
];

export function matchClass7ScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_7_SCIENCE_NCERT_CHAPTERS);
}

/** Same rules as Class 6: “Science” vs Social Science / Computer Science. */
export { isClass6ScienceSubject as isClass7ScienceSubject };
