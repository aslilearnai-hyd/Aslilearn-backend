import test from 'node:test';
import assert from 'node:assert/strict';
import { needsStudentNameClarification } from '../services/vidya-teacher/teacher-hybrid-chat-controller.js';
import { extractPersonNameQuery } from '../services/vidya-ai-control/entity-detail-facts.js';

test('teacher student-by-name suggestion asks for an actual name', () => {
  assert.equal(needsStudentNameClarification('Tell me about a student by name'), true);
  assert.equal(extractPersonNameQuery('Tell me about a student by name').name, '');
});

test('named student prompts continue to the live person lookup', () => {
  assert.equal(needsStudentNameClarification('Tell me about student Priya Sharma'), false);
  assert.equal(extractPersonNameQuery('Tell me about student Priya Sharma').name, 'Priya Sharma');
});

test('student roster prompts do not ask for one student name', () => {
  assert.equal(needsStudentNameClarification('List my students'), false);
  assert.equal(needsStudentNameClarification('How many students do I have?'), false);
});
