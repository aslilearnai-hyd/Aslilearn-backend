import assert from 'node:assert/strict';
import {
  conceptQuestionsForBand,
  countValidQuestionRows,
  isTemplateSectionHeaderLine,
  resolveScaffoldBand,
} from '../utils/subject-scaffold-profile.js';
import { padAiGeneratorCanonicalSections } from '../utils/ai-generator-section-pad.js';

assert.equal(resolveScaffoldBand('Science'), 'stem');
assert.equal(resolveScaffoldBand('English'), 'english');
assert.equal(resolveScaffoldBand('Social Science'), 'social');

assert.ok(isTemplateSectionHeaderLine('2. Learning Objectives'));
assert.ok(isTemplateSectionHeaderLine('Section A: MCQs'));
assert.ok(!isTemplateSectionHeaderLine('Define electric power and state its SI unit.'));

const stemQs = conceptQuestionsForBand('Electric Power', 'Science', 'stem');
assert.match(String(stemQs[0].question), /Define Electric Power/i);
assert.doesNotMatch(String(stemQs[0].question), /Summarise the main message/i);

const englishQs = conceptQuestionsForBand('The Last Leaf', 'English', 'english');
assert.match(String(englishQs[0].question), /Summarise the main message/i);

assert.equal(
  countValidQuestionRows(['2. Learning Objectives', '3. Instructions to Students', 'Q1. Define power.']),
  1,
);

const homework = padAiGeneratorCanonicalSections(
  'homework-creator',
  { learning_objectives: ['Apply formulas for electric power'] },
  { subject: 'Science', subTopic: '11.8 Electric Power' },
);
assert.doesNotMatch(String(homework.practice_questions?.[0]?.question || ''), /Summarise the central idea/i);

const mockTest = padAiGeneratorCanonicalSections(
  'mock-test-builder',
  {},
  { subject: 'Science', subTopic: 'Photosynthesis', topic: 'Life Processes' },
);
assert.ok(Object.keys(mockTest).length > 0);

console.log('PASS: subject-scaffold-profile');
