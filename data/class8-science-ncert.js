/**
 * Class VIII — Science (Curiosity / NCERT outline).
 * Topic / Subtopic dropdowns for Class 8 + Science.
 */
import { matchNcertChapter, isClass6ScienceSubject } from './class6-science-curiosity-ncert.js';

export const CLASS_8_SCIENCE_NCERT_CHAPTERS = [
  {
    title: 'Chapter 1: Exploring the Investigative World of Science',
    subtopics: [
      '1.1 How Scientists Investigate',
      '1.2 Asking Questions and Making Observations',
      '1.3 Forming Hypotheses',
      '1.4 Designing Experiments',
      '1.5 Drawing Conclusions',
      '1.6 Science as a Human Enterprise',
    ],
  },
  {
    title: 'Chapter 2: The Invisible Living World: Beyond Our Naked Eye',
    subtopics: [
      '2.1 Microorganisms Around Us',
      '2.2 Major Groups — Bacteria, Virus, Fungi, Protozoa, Algae',
      '2.3 Useful Microorganisms',
      '2.4 Harmful Microorganisms — Diseases',
      '2.5 Food Preservation',
      '2.6 Nitrogen Fixation and Cycle',
    ],
  },
  {
    title: 'Chapter 3: Health: The Ultimate Treasure',
    subtopics: [
      '3.1 What is Health?',
      '3.2 Physical, Mental, Social Health',
      '3.3 Balanced Nutrition',
      '3.4 Communicable and Non-Communicable Diseases',
      '3.5 Lifestyle Diseases',
      '3.6 Prevention and Immunity',
      '3.7 Yoga, Exercise and Well-being',
    ],
  },
  {
    title: 'Chapter 4: Electricity: Magnetic and Heating Effects',
    subtopics: [
      '4.1 Heating Effect of Electric Current',
      '4.2 Electric Heating Appliances',
      '4.3 Electric Fuse',
      '4.4 Magnetic Effect of Electric Current',
      '4.5 Electromagnet',
      '4.6 Electric Bell',
      '4.7 Chemical Effect of Electric Current',
    ],
  },
  {
    title: 'Chapter 5: Exploring Forces',
    subtopics: [
      '5.1 Force — Push or Pull',
      '5.2 Types of Forces — Contact and Non-Contact',
      '5.3 Gravitational Force',
      '5.4 Magnetic Force',
      '5.5 Electrostatic Force',
      '5.6 Friction and Its Effects',
      '5.7 Pressure',
    ],
  },
  {
    title: 'Chapter 6: Pressure, Winds, and Cyclones',
    subtopics: [
      '6.1 Air Exerts Pressure',
      '6.2 High and Low Pressure Regions',
      '6.3 Air Currents and Winds',
      '6.4 Uneven Heating of the Earth',
      '6.5 Thunderstorms',
      '6.6 Cyclones',
      '6.7 Effective Safety Measures',
    ],
  },
  {
    title: 'Chapter 7: Particulate Nature of Matter',
    subtopics: [
      '7.1 Particles of Matter',
      '7.2 Characteristics of Particles',
      '7.3 States of Matter — Solid, Liquid, Gas',
      '7.4 Change of State',
      '7.5 Evaporation and Factors Affecting It',
    ],
  },
  {
    title: 'Chapter 8: Nature of Matter: Elements, Compounds, and Mixtures',
    subtopics: [
      '8.1 Pure and Impure Substances',
      '8.2 Elements',
      '8.3 Compounds',
      '8.4 Mixtures — Homogeneous and Heterogeneous',
      '8.5 Separation of Mixtures',
    ],
  },
  {
    title: 'Chapter 9: The Amazing World of Solutes, Solvents, and Solutions',
    subtopics: [
      '9.1 What are Solutions?',
      '9.2 Solute, Solvent, and Solutions',
      '9.3 Concentration of a Solution',
      '9.4 Saturated and Unsaturated Solutions',
      '9.5 Effect of Temperature on Solubility',
      '9.6 Water as a Universal Solvent',
      '9.7 Colloids and Suspensions',
    ],
  },
  {
    title: 'Chapter 10: Light: Mirrors and Lenses',
    subtopics: [
      '10.1 Reflection of Light — Recap',
      '10.2 Laws of Reflection',
      '10.3 Images Formed by Plane Mirror',
      '10.4 Spherical Mirrors — Concave, Convex',
      '10.5 Lenses — Convex, Concave',
      '10.6 Dispersion of Light',
      '10.7 Human Eye — Structure and Function',
    ],
  },
  {
    title: 'Chapter 11: Keeping Time with the Skies',
    subtopics: [
      '11.1 Early Timekeeping',
      '11.2 Calendars — Lunar, Solar, Lunisolar',
      '11.3 Indian Calendars',
      '11.4 Day, Month, Year',
      '11.5 Seasons and Solstices',
      '11.6 Modern Clocks and Time Standards',
    ],
  },
  {
    title: 'Chapter 12: How Nature Works in Harmony',
    subtopics: [
      '12.1 Ecosystem',
      '12.2 Food Chain and Food Web',
      '12.3 Biogeochemical Cycles — Water, Carbon, Nitrogen',
      '12.4 Biodiversity and Conservation',
      '12.5 Human Impact on Environment',
    ],
  },
  {
    title: 'Chapter 13: Our Home: Earth, a Unique Life Sustaining Planet',
    subtopics: [
      '13.1 The Earth in the Solar System',
      '13.2 Why Earth is Special',
      '13.3 The Atmosphere',
      '13.4 The Hydrosphere',
      '13.5 The Lithosphere and Biosphere',
      '13.6 Sustaining the Planet',
    ],
  },
];

export function matchClass8ScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_8_SCIENCE_NCERT_CHAPTERS);
}

export { isClass6ScienceSubject as isClass8ScienceSubject };
