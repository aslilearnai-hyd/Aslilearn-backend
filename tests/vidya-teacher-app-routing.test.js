import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTeacherAppQuestion } from '../services/vidya-teacher/teacher-hybrid-chat-controller.js';
import { teacherAppOnlyReply } from '../services/vidya-teacher/teacher-app-desk-facts.js';
import {
  isTeacherExamDataQuestion,
  isTeacherExamFollowUp,
  resolveTeacherExamQuestion,
} from '../services/vidya-teacher/teacher-query-routing.js';
import { classifyPlatformDataQuestion } from '../services/vidya-platform-data-firewall.js';

const now = new Date('2026-09-04T06:30:00+05:30');
const desk = {
  profile: { name: 'Teacher' },
  totals: {},
  classes: [],
  students: [],
  exams: {
    recent: [
      { title: 'JEE Exam', subject: 'physics', classNumber: '7', startIso: '2026-09-04T04:00:00.000Z', startLabel: '04 Sep 2026' },
      { title: 'August Unit Test', subject: 'maths', classNumber: '8', startIso: '2026-08-12T06:30:00+05:30', startLabel: '12 Aug 2026' },
      { title: 'Old Sample Paper', subject: 'english', classNumber: '7', startIso: '2024-09-12T06:30:00+05:30', startLabel: '12 Sep 2024' },
    ],
    open: [],
    upcoming: [],
  },
};

test('teacher exam list requests always route to live app data', () => {
  assert.equal(isTeacherAppQuestion('List the latest exams'), true);
  assert.equal(isTeacherAppQuestion('list all exams'), true);
  assert.equal(isTeacherAppQuestion('show recent exams'), true);
  assert.equal(isTeacherAppQuestion('exams last month'), true);
});

test('teacher latest exams are listed from desk facts without mock tutorials', () => {
  const answer = teacherAppOnlyReply('List the latest exams', desk, '', now);
  assert.match(answer, /JEE Exam/);
  assert.doesNotMatch(answer, /chronological|do not have access|Worked example|Filtering Process/i);
});

test('last-month exam lists use the current IST calendar, not a default 2024 year', () => {
  const answer = teacherAppOnlyReply('List exams last month', desk, '', now);
  assert.match(answer, /August Unit Test/);
  assert.match(answer, /August 2026/);
  assert.doesNotMatch(answer, /2024/);
  assert.doesNotMatch(answer, /JEE Exam|Old Sample Paper|Worked example|Filtering Process/i);
});

test('named-year filters only apply when the teacher asked for that year', () => {
  const answer = teacherAppOnlyReply('Show exams in September 2024', desk, '', now);
  assert.match(answer, /Old Sample Paper/);
  assert.doesNotMatch(answer, /JEE Exam|August Unit Test/);
});

test('teacher exam lists are treated as protected school data', () => {
  assert.equal(classifyPlatformDataQuestion('List the latest exams', 'teacher').protected, true);
  assert.equal(classifyPlatformDataQuestion('exams last month', 'teacher').protected, true);
});

test('short follow-ups after an exam list stay on live exam data', () => {
  const history = [
    { role: 'user', content: 'List the latest exams' },
    { role: 'assistant', content: '**Latest school exams:**\n1. JEE Exam' },
  ];
  assert.equal(isTeacherExamFollowUp('last month', history), true);
  assert.equal(isTeacherExamFollowUp('filter by September', history), true);
  assert.equal(resolveTeacherExamQuestion('last month', history), 'last month exams');
  const answer = teacherAppOnlyReply(resolveTeacherExamQuestion('last month', history), desk, '', now);
  assert.match(answer, /August Unit Test/);
  assert.doesNotMatch(answer, /2024|Worked example|Filtering Process/i);
});

test('student exam-score questions are not treated as the school exam catalog', () => {
  assert.equal(isTeacherExamDataQuestion("Priya's exam scores"), false);
  assert.equal(isTeacherExamDataQuestion('List the latest exams'), true);
});
