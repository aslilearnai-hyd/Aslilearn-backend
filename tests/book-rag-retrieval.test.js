import assert from 'node:assert/strict';
import {
  buildBookRetrievalQuery,
  formatBookContextForPrompt,
  rerankBookChunks,
} from '../services/book-rag-service.js';

assert.match(
  buildBookRetrievalQuery({
    subjectName: 'Science',
    topicName: 'Electricity',
    subtopicName: 'Electric Power',
    toolSlug: 'quick-assignment-builder',
  }),
  /Science — Electricity — Electric Power/,
);

const formatted = formatBookContextForPrompt(
  [{ content: 'Electric power is the rate of energy transfer. P = VI.', chapter: 'Chapter 11', topic: 'Chapter 11', subtopic: '' }],
  { bookTitle: 'NCERT Science 10', subject: 'Science', class: '10' },
);
assert.match(formatted, /TEXTBOOK CONTENT \(PRIMARY SOURCE/);
assert.match(formatted, /Electric power is the rate/);

const ranked = rerankBookChunks(
  [
    {
      content: 'Photosynthesis converts light energy into chemical energy in plants.',
      score: 0.9,
      topic: 'Chapter 5',
    },
    {
      content: 'Electric power measures how fast electrical energy is used. P = VI relates power, voltage, and current.',
      score: 0.7,
      topic: 'Chapter 11 Electricity',
    },
  ],
  {
    subjectName: 'Science',
    topicName: 'Electricity',
    subtopicName: 'Electric Power',
  },
  1,
);

assert.match(String(ranked[0].content), /Electric power measures/);

console.log('PASS: book-rag-service retrieval');
