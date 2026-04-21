/**
 * Class VI — English (Poorvi / NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 6 + English.
 */
import { matchNcertChapter } from './class6-science-curiosity-ncert.js';

const COMMON_LITERATURE_SUBTOPICS = [
  "Pre-reading: Let's Begin / Paath se Pehle",
  'Reading the text: silent reading, reading aloud, pronunciation practice',
  "Comprehension: Let's Understand / Samajh",
  "Vocabulary & Grammar: Let's Learn / Bhasha ki Baat",
  "Listening & Speaking: Let's Listen and Speak / Sunna-Bolna",
  "Writing: Let's Write / Likhna",
  "Project/Extension: Let's Explore More / Paath se Aage",
];

export const CLASS_6_ENGLISH_POORVI_CHAPTERS = [
  { title: 'Unit 1: Fables and Folk Tales - A Bottle of Dew (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 1: Fables and Folk Tales - The Raven and the Fox (Fable)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 1: Fables and Folk Tales - Rama to the Rescue (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Unit 2: Friendship - The Unlikely Best Friends (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: "Unit 2: Friendship - A Friend's Prayer (Poem)", subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 2: Friendship - The Chair (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Unit 3: Nurturing Nature - Neem Baba (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 3: Nurturing Nature - What a Bird Thought (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 3: Nurturing Nature - Spices that Heal Us (Informative)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Unit 4: Sports and Wellness - Change of Heart (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 4: Sports and Wellness - The Winner (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 4: Sports and Wellness - Yoga - A Way of Life (Informative)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Unit 5: Culture and Tradition - Hamara Bharat - Incredible India! (Informative)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 5: Culture and Tradition - The Kites (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 5: Culture and Tradition - Ila Sachani: Embroidering Dreams with Her Feet (Biographical)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 5: Culture and Tradition - National War Memorial (Informative)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  {
    title: 'Grammar: Class 6 CBSE - Poorvi',
    subtopics: [
      'Homophones',
      'Tenses - Simple Present',
      'Tenses - Simple Past',
      'Figures of Speech / Poetic Devices - Alliteration',
      'Vocabulary',
      'Adverbs - Adverbs of Manner',
      'Pronouns - Personal',
      'Pronouns - Possessive',
      'Pronouns - Reflexive',
      'Determiners - Articles',
      'Determiners - Quantifiers',
      'Subject-Verb Agreement',
      'Conjunctions (and, so, but)',
      'Prepositions',
      'Adjectives - Degrees of Comparison',
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass6EnglishSubject(subjectId) {
  return norm(subjectId).includes('english');
}

export function matchClass6EnglishChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_6_ENGLISH_POORVI_CHAPTERS);
}
