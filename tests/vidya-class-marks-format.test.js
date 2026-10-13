import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOverviewFallback } from '../services/vidya-ai-control/response-formatter.js';

test('class performance uses marks rather than percentages', () => {
  const output = formatOverviewFallback(
    {
      scope: 'class_group',
      classLabel: 'Class 7',
      overview: {
        students: 34,
        activeStudents: 34,
        averagePercentage: 43.4,
        averageObtainedMarks: 17.4,
        averageTotalMarks: 40,
        examResultsLast30Days: 30,
      },
      topStudents: [
        {
          name: 'Student A',
          averagePercentage: 72.5,
          averageObtainedMarks: 29,
          averageTotalMarks: 40,
        },
      ],
    },
    'How is Class 7 performing?',
    'admin',
  );

  assert.match(output, /17\.4\/40 marks/);
  assert.match(output, /Student A 29\/40 marks/);
  assert.doesNotMatch(output, /43\.4%|72\.5%/);
});

test('student performance uses marks rather than percentages', () => {
  const output = formatOverviewFallback(
    {
      scope: 'person_student',
      personType: 'student',
      personLabel: 'Student A',
      overview: {
        examsTaken: 2,
        averagePercentage: 72.5,
        averageObtainedMarks: 29,
        averageTotalMarks: 40,
        latestPercentage: 75,
        latestObtainedMarks: 30,
        latestTotalMarks: 40,
        latestExamTitle: 'Science Test',
      },
      recentExams: [
        { examTitle: 'Science Test', percentage: 75, obtainedMarks: 30, totalMarks: 40 },
      ],
    },
    'Show Student A performance',
    'admin',
  );

  assert.match(output, /Average marks: 29\/40/);
  assert.match(output, /Latest exam: 30\/40 marks/);
  assert.match(output, /Science Test 30\/40 marks/);
  assert.doesNotMatch(output, /72\.5%|75%/);
});
