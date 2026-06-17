/** Tools enabled for Book-Based (RAG-grounded) AI generation — all student & teacher tools (21). */

export const BOOK_BASED_STUDENT_TOOL_SLUGS = [
  'smart-study-guide-generator',
  'smart-qa-practice-generator',
  'concept-breakdown-explainer',
  'chapter-summary-creator',
  'key-points-formula-extractor',
  'quick-assignment-builder',
  'my-study-decks',
  'mock-test-builder',
  'project-idea-lab',
  'reading-practice-room',
  'study-schedule-maker',
];

export const BOOK_BASED_TEACHER_TOOL_SLUGS = [
  'activity-project-generator',
  'worksheet-mcq-generator',
  'concept-mastery-helper',
  'lesson-planner',
  'exam-question-paper-generator',
  'daily-class-plan-maker',
  'homework-creator',
  'story-passage-creator',
  'short-notes-summaries-maker',
  'flashcard-generator',
];

export const BOOK_BASED_TOOL_SLUGS = [
  ...BOOK_BASED_STUDENT_TOOL_SLUGS,
  ...BOOK_BASED_TEACHER_TOOL_SLUGS,
];

export const BOOK_BASED_TOOL_META = {
  'smart-study-guide-generator': { name: 'Smart Study Guide Generator', description: 'Study guides aligned to textbook terminology.', audience: 'student' },
  'smart-qa-practice-generator': { name: 'Smart Q&A Practice Generator', description: 'Practice Q&A sets using book definitions and examples.', audience: 'student' },
  'concept-breakdown-explainer': { name: 'Concept Breakdown Explainer', description: 'Step-by-step concept breakdown from book passages.', audience: 'student' },
  'chapter-summary-creator': { name: 'Chapter Summary Creator', description: 'Chapter summaries with concepts and recall questions from textbook chunks.', audience: 'student' },
  'key-points-formula-extractor': { name: 'Key Points Extractor', description: 'Formulae, facts, and keywords from textbook chunks.', audience: 'student' },
  'quick-assignment-builder': { name: 'Quick Assignment Builder', description: 'Assignments with concept questions grounded in book material.', audience: 'student' },
  'my-study-decks': { name: 'My Study Decks', description: 'Flashcard decks grounded in textbook content.', audience: 'student' },
  'mock-test-builder': { name: 'Mock Test Builder', description: 'Exam-style mock tests from uploaded books.', audience: 'student' },
  'project-idea-lab': { name: 'Project Idea Lab', description: 'Student projects inspired by textbook topics and examples.', audience: 'student' },
  'reading-practice-room': { name: 'Reading Practice Room', description: 'Reading practice from book passages (English & Hindi only).', audience: 'student' },
  'study-schedule-maker': { name: 'Study Schedule Maker', description: 'Study schedules aligned to textbook chapters.', audience: 'student' },
  'activity-project-generator': { name: 'Activity / Project Generator', description: 'Teacher activity kits grounded in textbook content.', audience: 'teacher' },
  'worksheet-mcq-generator': { name: 'Worksheet & MCQ Generator', description: 'Worksheets and MCQs grounded in book content.', audience: 'teacher' },
  'concept-mastery-helper': { name: 'Concept Mastery Helper', description: 'Concept mastery notes from textbook material.', audience: 'teacher' },
  'lesson-planner': { name: 'Lesson Planner', description: 'Lesson plans aligned to uploaded textbook chapters.', audience: 'teacher' },
  'exam-question-paper-generator': { name: 'Exam Question Paper Generator', description: 'Full exam papers using book terminology.', audience: 'teacher' },
  'daily-class-plan-maker': { name: 'Daily Class Plan', description: 'Day-wise classroom plans from textbook chapters.', audience: 'teacher' },
  'homework-creator': { name: 'Homework Creator', description: 'Homework tasks grounded in textbook material.', audience: 'teacher' },
  'story-passage-creator': { name: 'Story and Passage Creator', description: 'Story and passage sets from book content (English & Hindi only).', audience: 'teacher' },
  'short-notes-summaries-maker': { name: 'Short Notes & Summaries', description: 'Concise revision notes from book passages.', audience: 'teacher' },
  'flashcard-generator': { name: 'Flash Card Generator', description: 'Teacher flashcard decks from textbook content.', audience: 'teacher' },
};

export function isBookBasedToolSlug(slug) {
  return BOOK_BASED_TOOL_SLUGS.includes(String(slug || '').trim());
}

export function getBookBasedToolDisplayName(slug) {
  return BOOK_BASED_TOOL_META[slug]?.name || slug;
}

/** Target unique records per subtopic per book (diversity engine). */
export const BOOK_GENERATOR_UNIQUENESS_TARGET = Number(process.env.BOOK_GENERATOR_UNIQUENESS_TARGET) || 50;

/** Records per batch run. */
export const BOOK_GENERATOR_DEFAULT_BATCH_SIZE = Number(process.env.BOOK_GENERATOR_BATCH_SIZE) || 25;

/** Optional hard cap on Gemini spend per batch (INR). Set 0 to disable. */
export const BOOK_GENERATOR_MAX_INR = Number(process.env.BOOK_GENERATOR_MAX_INR) || 0;
