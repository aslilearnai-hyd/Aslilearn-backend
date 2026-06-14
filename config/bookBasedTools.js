/** Tools enabled for Book-Based (RAG-grounded) AI generation. */
export const BOOK_BASED_TOOL_SLUGS = [
  'my-study-decks',
  'mock-test-builder',
  'smart-study-guide-generator',
  'concept-breakdown-explainer',
  'smart-qa-practice-generator',
  'key-points-formula-extractor',
  'worksheet-mcq-generator',
  'concept-mastery-helper',
  'lesson-planner',
  'short-notes-summaries-maker',
  'flashcard-generator',
  'exam-question-paper-generator',
  'homework-creator',
];

export const BOOK_BASED_TOOL_META = {
  'my-study-decks': { name: 'My Study Decks', description: 'Flashcard decks grounded in textbook content.' },
  'mock-test-builder': { name: 'Mock Test Builder', description: 'Exam-style mock tests from uploaded books.' },
  'smart-study-guide-generator': { name: 'Smart Study Guide Generator', description: 'Study guides aligned to textbook terminology.' },
  'concept-breakdown-explainer': { name: 'Concept Breakdown Explainer', description: 'Step-by-step concept breakdown from book passages.' },
  'smart-qa-practice-generator': { name: 'Smart Q&A Practice Generator', description: 'Practice Q&A sets using book definitions and examples.' },
  'key-points-formula-extractor': { name: 'Key Points Extractor', description: 'Formulae, facts, and keywords from textbook chunks.' },
  'worksheet-mcq-generator': { name: 'Worksheet & MCQ Generator', description: 'Worksheets and MCQs grounded in book content.' },
  'concept-mastery-helper': { name: 'Concept Mastery Helper', description: 'Concept mastery notes from textbook material.' },
  'lesson-planner': { name: 'Lesson Planner', description: 'Lesson plans aligned to uploaded textbook chapters.' },
  'short-notes-summaries-maker': { name: 'Short Notes & Summaries', description: 'Concise revision notes from book passages.' },
  'flashcard-generator': { name: 'Flash Card Generator', description: 'Teacher flashcard decks from textbook content.' },
  'exam-question-paper-generator': { name: 'Exam Question Paper Generator', description: 'Full exam papers using book terminology.' },
  'homework-creator': { name: 'Homework Creator', description: 'Homework tasks grounded in textbook material.' },
};

export function isBookBasedToolSlug(slug) {
  return BOOK_BASED_TOOL_SLUGS.includes(String(slug || '').trim());
}

export function getBookBasedToolDisplayName(slug) {
  return BOOK_BASED_TOOL_META[slug]?.name || slug;
}

/** Target unique records per subtopic per book (diversity engine). */
export const BOOK_GENERATOR_UNIQUENESS_TARGET = Number(process.env.BOOK_GENERATOR_UNIQUENESS_TARGET) || 50;

export const BOOK_GENERATOR_DEFAULT_BATCH_SIZE = Number(process.env.BOOK_GENERATOR_BATCH_SIZE) || 25;
