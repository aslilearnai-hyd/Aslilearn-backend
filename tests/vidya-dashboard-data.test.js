import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardDataTopic, timetableScope, answerStudentDashboardData } from '../services/vidya-student/dashboard-data.js';
import { answerByTopicAndShape } from '../services/vidya-student/student-app-query-router.js';
import { executeDynamicDbPlan } from '../services/vidya-ai-control/db-access-layer.js';
import { resolveModuleKey } from '../services/vidya-ai-control/module-registry.js';

test('dashboard adapters distinguish timetable, attendance and learning explanations', () => {
  assert.equal(dashboardDataTopic('show my timetable'), 'timetable');
  assert.equal(dashboardDataTopic('my attendance'), 'attendance');
  assert.equal(dashboardDataTopic('explain magnetic field'), null);
});
test('timetable requires school AND class; cannot fall back to entire school', () => {
  assert.equal(timetableScope({ assignedAdmin: 'school' }), null);
  const filter = timetableScope({ assignedAdmin: 'school', assignedClass: { _id: 'class', section: 'b' } });
  assert.equal(filter.schoolAdminId, 'school');
  assert.equal(filter.classId, 'class');
  assert.equal(filter.$or[0].sectionId, 'B');
});
test('result totals use database counts, not the latest 50/20 results', async () => {
  const count = n => ({ countDocuments: async filter => { assert.deepEqual(filter, { userId: 'student' }); return n; } });
  const answer = await answerStudentDashboardData({ studentId: 'student', question: 'how many exam attempts', models: { ExamResult: count(75), OmrResultRow: count(25) } });
  assert.match(answer, /\*\*100\*\*/);
});
test('failed desk lookup is not reported as empty subjects', () => {
  assert.match(answerByTopicAndShape('how many subjects', { desk: { unavailable: true } }), /couldn’t load/);
});
test('student Vidya answers teachers reports from the scoped app snapshot', () => {
  const facts = { desk: { teacherReports: [{
    title: 'Algebra revision',
    content: 'Completed linear equations and assigned practice questions.',
    teacherName: 'Ms Rao',
    classDisplay: 'Class 8 - A',
    dateLabel: '03 Sep 2026',
    forDate: '2026-09-03T00:00:00.000Z',
  }] } };
  const answer = answerByTopicAndShape('What are the teachers reports', facts);
  assert.match(answer, /Algebra revision/);
  assert.match(answer, /Ms Rao/);
  assert.doesNotMatch(answer, /do not have access|private internal portal/i);
});
test('new platform catalogs are denied to students and school admins before a query', async () => {
  for (const role of ['student', 'teacher', 'admin']) {
    const result = await executeDynamicDbPlan({ plan: { module: 'textbook_catalog' }, viewerRole: role, viewerUserId: '507f1f77bcf86cd799439011' });
    assert.equal(result.ok, false);
  }
  assert.equal(resolveModuleKey('ai tool topics'), 'curriculum_topics');
  assert.equal(resolveModuleKey('iit videos'), 'iit_video_catalog');
});
