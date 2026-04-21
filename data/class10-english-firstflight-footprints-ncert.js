/**
 * Class X — English (NCERT: First Flight + Footprints Without Feet).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 10 + English.
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

export const CLASS_10_ENGLISH_NCERT_CHAPTERS = [
  { title: 'First Flight Prose 1: A Letter to God (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'First Flight Prose 2: Nelson Mandela - Long Walk to Freedom (Autobiography)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  {
    title: "First Flight Prose 3: Two Stories about Flying - His First Flight & Black Aeroplane (Story)",
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: 'First Flight Prose 4: From the Diary of Anne Frank (Diary)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Prose 5: Glimpses of India (Informative)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Prose 6: Mijbil the Otter (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Prose 7: Madam Rides the Bus (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'First Flight Prose 8: The Sermon at Benares (Religious/Philosophical)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: 'First Flight Prose 9: The Proposal (Play)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'First Flight Poem 1: Dust of Snow / Fire and Ice (Poems)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 2: A Tiger in the Zoo (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 3: How to Tell Wild Animals (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 4: The Ball Poem (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 5: Amanda! (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 6: The Trees (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 7: Fog (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 8: The Tale of Custard the Dragon (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'First Flight Poem 9: For Anne Gregory (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  { title: 'Footprints 1: A Triumph of Surgery (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: "Footprints 2: The Thief's Story (Story)", subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Footprints 3: The Midnight Visitor (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Footprints 4: A Question of Trust (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Footprints 5: Footprints Without Feet (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Footprints 6: The Making of a Scientist (Biographical)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Footprints 7: The Necklace (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Footprints 8: Bholi (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Footprints 9: The Book That Saved the Earth (Play)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },

  {
    title: 'Grammar: Tenses',
    subtopics: [
      'Present Tense - Simple Present Tense',
      'Present Tense - Present Continuous Tense',
      'Present Tense - Present Perfect Tense',
      'Present Tense - Present Perfect Continuous Tense',
      'Past Tense - Simple Past Tense',
      'Past Tense - Past Continuous Tense',
      'Past Tense - Past Perfect Tense',
      'Past Tense - Past Perfect Continuous Tense',
      'Future Tense - Simple Future Tense',
      'Future Tense - Future Continuous Tense',
      'Future Tense - Future Perfect Tense',
      'Future Tense - Future Perfect Continuous Tense',
    ],
  },
  {
    title: 'Grammar: Modals',
    subtopics: [
      'Can',
      'Could',
      'May',
      'Might',
      'Must',
      'Shall',
      'Should',
      'Will',
      'Would',
      'Ought to',
      'Need (as a modal)',
      'Dare (as a modal)',
    ],
  },
  {
    title: 'Grammar: Subject-Verb Agreement',
    subtopics: [
      'Basic Rule (Singular Subject - Singular Verb / Plural Subject - Plural Verb)',
      'Agreement with Compound Subjects',
      'Agreement with Indefinite Pronouns',
      'Agreement with Collective Nouns',
      'Agreement with Countable/Uncountable Nouns',
      'Agreement with "There is / There are"',
      'Agreement with Intervening Words/Phrases',
      'Agreement with Titles (Books, Movies, etc.)',
      'Agreement with Expressions of Quantity (a lot of, a number of, etc.)',
      'Agreement with "Either...or / Neither...nor"',
      'Agreement with Relative Pronouns (who, which, that)',
    ],
  },
  {
    title: 'Grammar: Determiners',
    subtopics: [
      'Articles (a, an, the)',
      'Demonstratives (this, that, these, those)',
      'Possessives (my, your, his, her, its, our, their)',
      'Quantifiers (some, any, much, many, few, little, several, etc.)',
      'Numbers (cardinal & ordinal)',
      'Distributives (each, every, either, neither)',
      'Interrogatives (which, what, whose)',
      'Pre-determiners (all, both, half, etc.)',
    ],
  },
  {
    title: 'Grammar: Reported Speech (Direct and Indirect Speech)',
    subtopics: [
      'Direct Speech',
      'Indirect Speech',
      'Reporting Verbs (said, told, asked, etc.)',
      'Change of Tense',
      'Change of Pronouns',
      'Change of Time and Place Expressions',
      'Statements (Assertive Sentences)',
      'Questions (Interrogative Sentences)',
      'Commands and Requests (Imperative Sentences)',
      'Exclamatory Sentences',
      'Use of "That", "If", "Whether"',
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass10EnglishSubject(subjectId) {
  const s = norm(subjectId);
  return s.includes('english');
}

export function matchClass10EnglishChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_10_ENGLISH_NCERT_CHAPTERS);
}
