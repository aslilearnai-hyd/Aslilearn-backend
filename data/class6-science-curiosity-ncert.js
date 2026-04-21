/**
 * Class VI CBSE — Science (Curiosity / NCERT-aligned outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 6 + Science.
 */
export const CLASS_6_SCIENCE_CURIOSITY_CHAPTERS = [
  {
    title: 'Chapter 1: The Wonderful World of Science',
    subtopics: [
      '1.1 What is Science?',
      '1.2 The Domain of Science',
      '1.3 How Do Scientists Study Science?',
      '1.4 Branches of Science',
      '1.5 Science in Everyday Life',
      '1.6 Scientists of India and Their Contributions',
    ],
  },
  {
    title: 'Chapter 2: Diversity in the Living World',
    subtopics: [
      '2.1 What is Diversity?',
      '2.2 Diversity in Plants Around Us',
      '2.3 Diversity in Animals Around Us',
      '2.4 Local Biodiversity',
      '2.5 Biodiversity in Different Habitats',
      '2.6 Importance of Biodiversity',
      '2.7 Conservation of Biodiversity',
    ],
  },
  {
    title: 'Chapter 3: Mindful Eating: A Path to a Healthy Body',
    subtopics: [
      '3.1 Food and Its Sources',
      '3.2 Plant and Animal Sources of Food',
      '3.3 Components of Food (Carbohydrates, Proteins, Fats, Vitamins, Minerals, Water, Roughage)',
      '3.4 Tests for Starch, Protein and Fat',
      '3.5 Balanced Diet',
      '3.6 Food Miles and Seasonal Food',
      '3.7 Food Choices and Healthy Eating Habits',
    ],
  },
  {
    title: 'Chapter 4: Exploring Magnets',
    subtopics: [
      '4.1 Magnetic and Non-Magnetic Materials',
      '4.2 Poles of a Magnet',
      '4.3 Finding Directions Using a Magnet',
      '4.4 Attraction and Repulsion between Magnets',
      '4.5 Making Your Own Magnet',
      '4.6 Uses of Magnets',
    ],
  },
  {
    title: 'Chapter 5: Measurement of Length and Motion',
    subtopics: [
      '5.1 How Do We Measure?',
      '5.2 Standard Units of Measurement — SI Units',
      '5.3 Measuring Length with a Ruler',
      '5.4 Measurement of Curved Lines',
      '5.5 Motion and Rest',
      '5.6 Types of Motion — Linear, Circular, Oscillatory',
    ],
  },
  {
    title: 'Chapter 6: Materials Around Us',
    subtopics: [
      '6.1 Objects Around Us',
      '6.2 Grouping Materials',
      '6.3 Properties of Materials — Appearance, Hardness, Solubility in Water, Objects Float/Sink, Transparency',
    ],
  },
  {
    title: 'Chapter 7: Temperature and its Measurement',
    subtopics: [
      '7.1 Hot and Cold',
      '7.2 Measurement of Temperature',
      '7.3 Laboratory Thermometer',
      '7.4 Units of Temperature — Celsius, Fahrenheit',
      '7.5 Body Temperature and the Clinical Thermometer',
      '7.6 Measuring Temperature of Surroundings',
    ],
  },
  {
    title: 'Chapter 8: A Journey through States of Water',
    subtopics: [
      '8.1 Three States of Water',
      '8.2 The Water Cycle',
      '8.3 Evaporation and Condensation',
      '8.4 Melting and Freezing',
      '8.5 Boiling',
      '8.6 Conservation of Water',
    ],
  },
  {
    title: 'Chapter 9: Methods of Separation in Everyday Life',
    subtopics: [
      '9.1 Separating Components of a Mixture',
      '9.2 Handpicking',
      '9.3 Winnowing',
      '9.4 Sieving',
      '9.5 Sedimentation and Decantation',
      '9.6 Filtration',
      '9.7 Evaporation',
      '9.8 Use of More than One Method',
    ],
  },
  {
    title: 'Chapter 10: Living Creatures: Exploring their Characteristics',
    subtopics: [
      '10.1 What Constitutes a Living Being?',
      '10.2 Features/Characteristics of Living Beings',
      '10.3 Growth, Reproduction, Respiration, Response to Stimuli, Excretion',
      '10.4 Plants and Animals — A Comparison',
      '10.5 Living vs Non-Living',
    ],
  },
  {
    title: "Chapter 11: Nature's Treasures",
    subtopics: [
      '11.1 Air and Its Composition',
      '11.2 Water as a Natural Resource',
      '11.3 Soil',
      '11.4 Minerals and Ores',
      '11.5 Fossil Fuels — Coal, Petroleum, Natural Gas',
      '11.6 Forests and Wildlife',
      '11.7 Renewable and Non-Renewable Resources',
      '11.8 Conservation of Natural Resources',
    ],
  },
  {
    title: 'Chapter 12: Beyond Earth',
    subtopics: [
      '12.1 The Moon and its Phases',
      '12.2 The Stars',
      '12.3 Constellations',
      '12.4 The Solar System — Sun and Planets',
      '12.5 Asteroids, Comets, Meteors',
      "12.6 Artificial Satellites and India's Space Programme",
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** True if subject string refers to Class 6 Science in the app. */
export function isClass6ScienceSubject(subjectId) {
  const s = norm(subjectId);
  if (!s.includes('science')) return false;
  if (s.includes('computer')) return false;
  // Social Science / Social Studies
  if (s.includes('social')) return false;
  return true;
}

/** Match dropdown topic string to a chapter object (NCERT-style titles). */
export function matchNcertChapter(topicId, chapters) {
  const t = norm(topicId);
  if (!t || !Array.isArray(chapters)) return null;
  for (const ch of chapters) {
    const c = norm(ch.title);
    if (t === c || t.includes(c) || c.includes(t)) return ch;
    const m = t.match(/chapter\s*(\d+)/i);
    const m2 = ch.title.match(/Chapter\s+(\d+)/i);
    if (m && m2 && m[1] === m2[1]) return ch;
  }
  return null;
}

/** Find chapter object for a topic id from the dropdown (may differ slightly in wording). */
export function matchClass6ScienceChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_6_SCIENCE_CURIOSITY_CHAPTERS);
}
