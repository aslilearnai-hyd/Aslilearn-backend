/**
 * Class X — Science (NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 10 + Science.
 */
import { matchNcertChapter, isClass6ScienceSubject } from './class6-science-curiosity-ncert.js';

const EXERCISE_LINE =
  "Exercises: In-text activities ('Figure it Out'), end-of-chapter exercises, Think-Respond-React questions, and MCQ/reasoning problems.";

export const CLASS_10_SCIENCE_NCERT_CHAPTERS = [
  {
    title: 'Chapter 1: Chemical Reactions and Equations',
    subtopics: [
      '1.1 Chemical Equations',
      '1.2 Balanced Chemical Equations',
      '1.3 Types of Chemical Reactions - Combination',
      '1.4 Decomposition Reactions',
      '1.5 Displacement Reactions',
      '1.6 Double Displacement Reactions',
      '1.7 Oxidation and Reduction (Redox)',
      '1.8 Effects of Oxidation in Everyday Life - Corrosion, Rancidity',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 2: Acids, Bases and Salts',
    subtopics: [
      '2.1 Chemical Properties of Acids and Bases',
      '2.2 Reactions with Metals, Metal Carbonates, Metal Oxides',
      '2.3 Similarities between Acids/Bases - H+ and OH- ions',
      '2.4 Strength of Acid/Base Solutions - pH Scale',
      '2.5 Importance of pH in Everyday Life',
      '2.6 More About Salts - Family of Salts, pH of Salts',
      '2.7 Common Salt, Washing Soda, Baking Soda, Plaster of Paris',
      '2.8 Crystals of Salts - Water of Crystallisation',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 3: Metals and Non-metals',
    subtopics: [
      '3.1 Physical Properties of Metals and Non-metals',
      '3.2 Chemical Properties of Metals - Reactions with Air, Water, Acids',
      '3.3 Reactivity Series',
      '3.4 How do Metals and Non-metals React? - Ionic Compounds',
      '3.5 Occurrence of Metals - Extraction',
      '3.6 Corrosion - Prevention',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 4: Carbon and its Compounds',
    subtopics: [
      '4.1 Bonding in Carbon - Covalent Bond',
      '4.2 Versatile Nature of Carbon - Catenation, Tetravalency',
      '4.3 Saturated and Unsaturated Carbon Compounds',
      '4.4 Chains, Branches and Rings',
      '4.5 Functional Groups',
      '4.6 Homologous Series',
      '4.7 Nomenclature of Carbon Compounds',
      '4.8 Chemical Properties - Combustion, Oxidation, Addition, Substitution',
      '4.9 Some Important Carbon Compounds - Ethanol, Ethanoic Acid',
      '4.10 Soaps and Detergents',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 5: Life Processes',
    subtopics: [
      '5.1 What are Life Processes?',
      '5.2 Nutrition - Autotrophic, Heterotrophic',
      '5.3 Nutrition in Human Beings',
      '5.4 Respiration',
      '5.5 Transportation - Human Circulatory System, Plants',
      '5.6 Excretion - Humans and Plants',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 6: Control and Coordination',
    subtopics: [
      '6.1 Animals - Nervous System',
      '6.2 Reflex Actions',
      '6.3 Human Brain',
      '6.4 Coordination in Plants - Immediate and Growth Responses',
      '6.5 Hormones in Animals',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 7: How do Organisms Reproduce?',
    subtopics: [
      '7.1 Do Organisms Create Exact Copies of Themselves?',
      '7.2 Modes of Reproduction Used by Single Organisms - Fission, Fragmentation, Budding, Spore Formation',
      '7.3 Vegetative Propagation, Tissue Culture',
      '7.4 Sexual Reproduction',
      '7.5 Sexual Reproduction in Flowering Plants',
      '7.6 Reproduction in Human Beings - Male and Female Reproductive System',
      '7.7 Reproductive Health',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 8: Heredity and Evolution',
    subtopics: [
      '8.1 Accumulation of Variation during Reproduction',
      "8.2 Heredity - Mendel's Laws",
      '8.3 Rules for Inheritance of Traits',
      '8.4 How do these Traits get Expressed?',
      '8.5 Sex Determination',
      '8.6 Evolution - Speciation, Fossils',
      '8.7 Evolution and Classification',
      '8.8 Human Evolution',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 9: Light - Reflection and Refraction',
    subtopics: [
      '9.1 Reflection of Light',
      '9.2 Spherical Mirrors - Terminology',
      '9.3 Image Formation by Spherical Mirrors',
      '9.4 Uses of Concave and Convex Mirrors',
      '9.5 Mirror Formula and Magnification',
      '9.6 Refraction of Light - Laws',
      '9.7 Refraction through a Rectangular Glass Slab',
      '9.8 Refraction by Spherical Lenses',
      '9.9 Image Formation by Lenses',
      '9.10 Lens Formula and Magnification',
      '9.11 Power of a Lens',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 10: Human Eye and Colourful World',
    subtopics: [
      '10.1 Human Eye - Structure and Function',
      '10.2 Power of Accommodation',
      '10.3 Defects of Vision and their Correction - Myopia, Hypermetropia, Presbyopia',
      '10.4 Refraction of Light through a Prism',
      '10.5 Dispersion of White Light by Prism',
      '10.6 Atmospheric Refraction',
      '10.7 Scattering of Light - Tyndall Effect, Blue Sky, Red Sunrise/Sunset',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 11: Electricity',
    subtopics: [
      '11.1 Electric Current and Circuit',
      '11.2 Electric Potential and Potential Difference',
      '11.3 Circuit Diagram',
      "11.4 Ohm's Law",
      '11.5 Factors on Which Resistance Depends',
      '11.6 Resistance of a System of Resistors - Series and Parallel',
      '11.7 Heating Effect of Electric Current',
      '11.8 Electric Power',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 12: Magnetic Effects of Electric Current',
    subtopics: [
      '12.1 Magnetic Field and Field Lines',
      '12.2 Magnetic Field due to Current-Carrying Conductor',
      '12.3 Magnetic Field Pattern of a Solenoid',
      '12.4 Force on a Current-Carrying Conductor in a Magnetic Field',
      '12.5 Electric Motor',
      '12.6 Electromagnetic Induction',
      '12.7 Electric Generator',
      '12.8 Domestic Electric Circuits',
      EXERCISE_LINE,
    ],
  },
  {
    title: 'Chapter 13: Our Environment',
    subtopics: [
      '13.1 Eco-system - Producers, Consumers, Decomposers',
      '13.2 Food Chains and Food Webs',
      '13.3 Flow of Energy - Trophic Levels',
      '13.4 How do Our Activities Affect the Environment?',
      '13.5 Ozone Layer and its Depletion',
      '13.6 Managing the Garbage We Produce',
      EXERCISE_LINE,
    ],
  },
];

export function matchClass10ScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_10_SCIENCE_NCERT_CHAPTERS);
}

export { isClass6ScienceSubject as isClass10ScienceSubject };
