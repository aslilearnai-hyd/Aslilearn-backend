/**
 * Class VIII — English (Poorvi / NCERT outline).
 * Used by /api/curriculum/topics and /api/curriculum/subtopics for Class 8 + English.
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

export const CLASS_8_ENGLISH_POORVI_CHAPTERS = [
  { title: 'Unit 1: Wit and Wisdom - The Wit That Won Hearts (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 1: Wit and Wisdom - A Concrete Example (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 1: Wit and Wisdom - Wisdom Pays the Way (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'Unit 2: Values and Dispositions - A Tale of Valour: Major Somnath Sharma and the Battle of Badgam (Biographical)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: "Unit 2: Values and Dispositions - Somebody's Mother (Poem)", subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'Unit 2: Values and Dispositions - Verghese Kurien - The Man Who Had A Dream (Biographical)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
  },
  { title: 'Unit 3: Mystery and Magic - The Case of the Fifth Word (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 3: Mystery and Magic - The Magic Brush of Drummers (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 3: Mystery and Magic - Spectacular Wonders (Informative)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 4: Environment - The Cherry Tree - Ruskin Bond (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 4: Environment - Harvest Hymn (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 4: Environment - Waiting for the Rain (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 5: Science and Curiosity - Feathered Friend - Arthur C. Clarke (Story)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  { title: 'Unit 5: Science and Curiosity - Magnifying Glass (Poem)', subtopics: [...COMMON_LITERATURE_SUBTOPICS] },
  {
    title: 'Unit 5: Science and Curiosity - Bibha Chowdhuri: The Beam of Light that Lit the Path for Women in Indian Science (Biographical)',
    subtopics: [...COMMON_LITERATURE_SUBTOPICS],
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
    title: 'Grammar: Adverb',
    subtopics: [
      'Adverbs of Time',
      'Adverbs of Place',
      'Adverbs of Manner',
      'Adverbs of Frequency',
      'Adverbs of Degree',
      'Adverbs of Reason',
      'Interrogative Adverbs',
      'Relative Adverbs',
      'Formation of Adverbs',
      'Comparison of Adverbs',
      'Position of Adverbs in a Sentence',
    ],
  },
  {
    title: 'Grammar: Adjective',
    subtopics: [
      'Kinds of Adjectives',
      'Adjectives of Quality',
      'Adjectives of Quantity',
      'Adjectives of Number',
      'Demonstrative Adjectives',
      'Possessive Adjectives',
      'Interrogative Adjectives',
      'Distributive Adjectives',
      'Degrees of Comparison',
      'Formation of Adjectives',
      'Order of Adjectives',
    ],
  },
  {
    title: 'Grammar: Articles',
    subtopics: [
      'Types of Articles (Definite & Indefinite)',
      'Use of "A"',
      'Use of "An"',
      'Use of "The"',
      'Omission of Articles',
      'Repetition of Articles',
      'Articles with Proper Nouns',
      'Articles with Common Nouns',
      'Articles with Unique Things',
      'Articles with Superlatives and Ordinals',
    ],
  },
  {
    title: 'Grammar: Relative Clauses',
    subtopics: [
      'Defining Relative Clauses',
      'Non-defining Relative Clauses',
      'Relative Pronouns (who, whom, whose, which, that)',
      'Relative Adverbs (where, when, why)',
      'Restrictive vs Non-restrictive Clauses',
      'Omission of Relative Pronouns',
    ],
  },
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
    title: 'Grammar: Active and Passive Voice',
    subtopics: [
      'Active Voice',
      'Passive Voice',
      'Structure of Active and Passive Sentences',
      'Rules for Changing Active to Passive',
      'Tense-wise Conversion (Present, Past, Future)',
      'Use of "by + doer"',
      'Omission of the Doer',
      'Imperative Sentences in Passive Voice',
      'Interrogative Sentences in Passive Voice',
      'Modals in Passive Voice',
    ],
  },
  {
    title: 'Grammar: Gerunds and Infinitives',
    subtopics: [
      'Gerunds',
      'Infinitives',
      'Gerunds as Subject',
      'Gerunds as Object',
      'Infinitives with "to"',
      'Bare Infinitives',
      'Verbs followed by Gerunds',
      'Verbs followed by Infinitives',
      'Difference between Gerunds and Infinitives',
    ],
  },
  {
    title: 'Grammar: Conjunctions',
    subtopics: [
      'Coordinating Conjunctions',
      'Subordinating Conjunctions',
      'Correlative Conjunctions',
      'Conjunctions of Addition',
      'Conjunctions of Contrast',
      'Conjunctions of Cause and Effect',
      'Conjunctions of Condition',
      'Conjunctions of Time',
    ],
  },
  {
    title: 'Grammar: Phrases',
    subtopics: [
      'Noun Phrase',
      'Verb Phrase',
      'Adjective Phrase',
      'Adverb Phrase',
      'Prepositional Phrase',
      'Participial Phrase',
      'Infinitive Phrase',
      'Gerund Phrase',
    ],
  },
  {
    title: 'Grammar: Clauses',
    subtopics: [
      'Main Clause',
      'Subordinate Clause',
      'Noun Clause',
      'Adjective Clause',
      'Adverb Clause',
      'Conditional Clauses',
      'Relative Clauses',
      'Clause of Reason',
      'Clause of Time',
      'Clause of Purpose',
    ],
  },
  {
    title: 'Grammar: Temporals',
    subtopics: [
      'Use of "when"',
      'Use of "while"',
      'Use of "before"',
      'Use of "after"',
      'Use of "till / until"',
      'Use of "as soon as"',
      'Sequence of Tenses in Time Clauses',
      'Present Tense for Future Time',
    ],
  },
  {
    title: 'Grammar: Conditionals',
    subtopics: [
      'Zero Conditional',
      'First Conditional',
      'Second Conditional',
      'Third Conditional',
      'Mixed Conditionals',
      'If-Clause and Main Clause',
      'Use of "unless"',
      'Use of "provided that / as long as"',
    ],
  },
  {
    title: 'Grammar: Transformation of Sentences',
    subtopics: [
      'Degree of Comparison (Positive, Comparative, Superlative)',
      'Simple, Complex, Compound Sentences',
      'Removal of "Too...to"',
      'Use of "So...that"',
      'Use of "Not only... but also"',
      'Use of "Either...or / Neither...nor"',
      'Transformation using "No sooner...than"',
    ],
  },
  {
    title: 'Grammar: Punctuation',
    subtopics: [
      'Capital Letters',
      'Full Stop (.)',
      'Comma (,)',
      'Question Mark (?)',
      'Exclamation Mark (!)',
      "Apostrophe ('s)",
      'Quotation Marks (" ")',
      'Colon (:)',
      'Semicolon (;)',
      'Hyphen (-)',
      'Dash (-)',
      'Brackets / Parentheses ( )',
      'Ellipsis (...)',
    ],
  },
];

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isClass8EnglishSubject(subjectId) {
  const s = norm(subjectId);
  return s.includes('english');
}

export function matchClass8EnglishChapter(topicId) {
  return matchNcertChapter(topicId, CLASS_8_ENGLISH_POORVI_CHAPTERS);
}
