import test from 'node:test';
import assert from 'node:assert/strict';
import { needsStudentNameClarification } from '../services/vidya-teacher/teacher-hybrid-chat-controller.js';
import {
  extractClassGroupQuery,
  extractPersonNameQuery,
  isClassGroupQuery,
} from '../services/vidya-ai-control/entity-detail-facts.js';
import { teacherAppOnlyReply } from '../services/vidya-teacher/teacher-app-desk-facts.js';

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

test('teacher class counts route to the requested class and section', () => {
  assert.deepEqual(extractClassGroupQuery('How many students are in 7B?'), {
    classNumber: '7',
    section: 'B',
  });
  assert.equal(isClassGroupQuery('How many students are in 7B?'), true);
  assert.equal(isClassGroupQuery('I want only 7B count'), true);
});

test('any other student requests a real name instead of searching for a fake person', () => {
  assert.equal(extractPersonNameQuery('Tell me about any other student').name, '');
  assert.equal(needsStudentNameClarification('Tell me about any other student'), true);
});

test('natural roster wording lists student names', () => {
  const reply = teacherAppOnlyReply('List out all student names, I will choose a name', {
    profile: { name: 'Teacher' },
    totals: { students: 2 },
    classes: [],
    students: [
      { name: 'A Harshitha', classNumber: '8', section: 'B' },
      { name: 'Ravi Kumar', classNumber: '7', section: 'B' },
    ],
  });
  assert.match(reply, /A Harshitha/);
  assert.match(reply, /Ravi Kumar/);
});
