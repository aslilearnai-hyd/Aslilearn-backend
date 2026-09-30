import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOverallDifficulty } from '../controllers/detailedAIController.js';

test('analyzeOverallDifficulty returns empty buckets for invalid input', () => {
  assert.deepEqual(analyzeOverallDifficulty(null, null), {
    veryHard: 0,
    hard: 0,
    medium: 0,
    easy: 0,
    veryEasy: 0,
  });
});

test('analyzeOverallDifficulty assigns average scores to each bucket', () => {
  const exams = ['very-hard', 'hard', 'medium', 'easy', 'very-easy'].map((_id) => ({ _id }));
  const percentages = [20, 50, 70, 80, 95];
  const results = exams.map((exam, index) => ({
    examId: { _id: exam._id },
    percentage: percentages[index],
  }));

  assert.deepEqual(analyzeOverallDifficulty(exams, results), {
    veryHard: 1,
    hard: 1,
    medium: 1,
    easy: 1,
    veryEasy: 1,
  });
});
