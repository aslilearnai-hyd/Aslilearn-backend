import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClassRosterQuestion, formatClassRoster } from '../services/vidya-class-conversation.js';
import { parseCurriculumRequest } from '../services/vidya-curriculum.js';
import { buildClassGroupFacts } from '../services/vidya-ai-control/entity-detail-facts.js';
import Teacher from '../models/Teacher.js';
import ClassModel from '../models/Class.js';
import User from '../models/User.js';
import Exam from '../models/Exam.js';

test('screenshot roster follow-ups retain the requested section', () => {
  const history = [{ role: 'user', content: 'list out all the students in 7b' }];
  assert.equal(resolveClassRosterQuestion('7b', history), 'List students in class 7b');
  assert.equal(resolveClassRosterQuestion('list out all the 12 student names', history), 'list out all the 12 student names in class 7B');
  assert.equal(resolveClassRosterQuestion('list students in 8a', history), 'list students in 8a');
  assert.equal(resolveClassRosterQuestion('explain chemistry', history), 'explain chemistry');
});

test('class roster renders every supplied name without a model', () => {
  const students = Array.from({ length: 12 }, (_, i) => ({ name: `Learner ${i + 1}`, isActive: true }));
  const result = formatClassRoster('list all the 12 student names', { scope: 'class_group', classLabel: 'Class 7B', students });
  assert.match(result, /12 students/);
  for (const student of students) assert.ok(result.includes(student.name));
});

test('IIT class wording and split curriculum clarifications preserve grade and chapter', () => {
  const first = 'what are the topics in 6th iit chemistry alpha 1st chapter';
  assert.equal(parseCurriculumRequest(first).classNumber, '6');
  const parsed = parseCurriculumRequest('board: iit\ntrack: alpha\nchemistry', [{ role: 'user', content: first }]);
  assert.equal(parsed.classNumber, '6');
  assert.equal(parsed.chapter, 1);
  assert.equal(parsed.subject, 'chemistry');
  assert.equal(parsed.board, 'IIT/NEET');
});

test('teacher class lookup cannot widen to an unassigned section', async () => {
  const teacherId = '507f1f77bcf86cd799439011';
  const classId = '507f1f77bcf86cd799439012';
  const schoolId = '507f1f77bcf86cd799439013';
  const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
  const mocks = [
    mock.method(Teacher, 'findById', () => query({ adminId: schoolId, assignments: [{ classId }] })),
    mock.method(ClassModel, 'find', filter => {
      assert.equal(String(filter._id.$in[0]), classId);
      assert.equal(String(filter.assignedAdmin), schoolId);
      return query([]);
    }),
    mock.method(User, 'find', filter => {
      assert.deepEqual(filter.assignedClass.$in, []);
      assert.equal(filter.$or, undefined);
      return query([]);
    }),
    mock.method(Exam, 'countDocuments', async filter => {
      assert.equal(String(filter.$or[0].adminId), schoolId);
      return 0;
    }),
  ];
  try {
    const facts = await buildClassGroupFacts({ classNumber: '7', section: 'B', viewerRole: 'teacher', viewerUserId: teacherId });
    assert.deepEqual(facts.students, []);
  } finally { mocks.forEach(m => m.mock.restore()); }
});

test('student role cannot query a class roster', async () => {
  const facts = await buildClassGroupFacts({ classNumber: '7', viewerRole: 'student' });
  assert.match(facts.error, /cannot access/);
});
