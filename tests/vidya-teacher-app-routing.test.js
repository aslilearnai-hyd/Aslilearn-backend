import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTeacherAppQuestion } from '../services/vidya-teacher/teacher-hybrid-chat-controller.js';
import { teacherAppOnlyReply } from '../services/vidya-teacher/teacher-app-desk-facts.js';

test('teacher latest exam requests always route to live app data', () => {
  assert.equal(isTeacherAppQuestion('List the latest exams'), true);
  assert.equal(isTeacherAppQuestion('show recent exams'), true);
});

test('teacher latest exams are listed from desk facts without mock tests', () => {
  const answer = teacherAppOnlyReply('List the latest exams', {
    profile: { name: 'Teacher' },
    totals: {}, classes: [], students: [],
    exams: { recent: [{ title: 'JEE Exam', subject: 'physics', classNumber: '7', startLabel: '04 Sep 2026' }] },
  });
  assert.match(answer, /JEE Exam/);
  assert.doesNotMatch(answer, /chronological|do not have access/i);
});
