/**
 * Knowledge base projector — deterministic tool output from KB JSON (no PDF regex).
 */
import { normalizeEducationalKnowledgeBase, knowledgeBaseHasContent } from '../../services/educational-knowledge-schema.js';
import { projectKnowledgeBaseForTool } from '../../services/knowledge-projector.js';

const SAMPLE_KB = normalizeEducationalKnowledgeBase({
  chapter: 'Square Numbers',
  title: 'Square Numbers as Equal Groups',
  summary: 'Square numbers are formed when a number is multiplied by itself.',
  learningObjectives: [
    'Identify square numbers',
    'Check if a number is a perfect square',
  ],
  concepts: [
    { name: 'Perfect Square', description: 'A number that is the square of an integer.' },
    { name: 'Square Array', description: 'Equal rows and columns arrangement.' },
  ],
  definitions: [
    { term: 'Square Number', definition: 'A number of the form n².' },
  ],
  formulas: [
    { name: 'Square', expression: 'n² = n × n', explanation: 'Multiply number by itself' },
  ],
  questions: [
    { question: 'What is 7²?', type: 'short', answer: '49' },
    { question: 'Is 144 a perfect square?', type: 'short', answer: 'Yes, 12²' },
    { question: 'Which digit cannot end a perfect square?', options: ['2', '3', '7', '9'], answer: '7', type: 'mcq' },
  ],
  applications: [
    { title: 'Tile arrangement', scenario: 'Arrange 16 tiles in equal rows and columns.' },
  ],
  activities: [
    { title: 'Draw square arrays', description: 'Draw arrays for 1² to 5²', steps: ['Draw 1×1', 'Draw 2×2'] },
  ],
  misconceptions: [
    { misconception: 'Any even number is a square', correction: 'Only some even numbers are perfect squares' },
  ],
});

if (!knowledgeBaseHasContent(SAMPLE_KB)) {
  console.error('FAIL: sample KB empty');
  process.exit(1);
}

const worksheet = projectKnowledgeBaseForTool(SAMPLE_KB, 'worksheet-mcq-generator', { topic: 'Square Numbers' });
if (!worksheet.length || !(worksheet[0].questions?.length || worksheet[0].sections?.length)) {
  console.error('FAIL: worksheet projection empty');
  process.exit(1);
}

const assignment = projectKnowledgeBaseForTool(SAMPLE_KB, 'quick-assignment-builder', { subtopic: 'Square Numbers' });
if (!assignment.length || !assignment[0].concept_based_questions?.length) {
  console.error('FAIL: quick assignment projection empty');
  process.exit(1);
}
if (/generation\s+\d+/i.test(JSON.stringify(assignment[0]))) {
  console.error('FAIL: generation markers in KB projection');
  process.exit(1);
}

const flashcards = projectKnowledgeBaseForTool(SAMPLE_KB, 'flashcard-generator', {});
if (flashcards.length < 2) {
  console.error('FAIL: flashcard projection expected >= 2 cards');
  process.exit(1);
}

const concept = projectKnowledgeBaseForTool(SAMPLE_KB, 'concept-mastery-helper', {});
if (!concept.length) {
  console.error('FAIL: concept mastery projection empty');
  process.exit(1);
}

console.log('PASS: knowledge base projector');
console.log('  worksheet questions:', worksheet[0].questions?.length || 0);
console.log('  assignment questions:', assignment[0].concept_based_questions?.length);
console.log('  flashcards:', flashcards.length);
console.log('  concepts:', concept.length);
