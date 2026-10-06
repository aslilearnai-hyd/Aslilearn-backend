import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTeacherProgressInsights } from '../services/teacher-progress-insights-service.js';

describe('teacher progress insight refresh', () => {
  it('rotates class priorities when the teacher refreshes', () => {
    const summary = {
      scopeLabel: 'Class 7',
      studentCount: 2,
      students: [
        {
          name: 'Asha',
          totalExams: 1,
          averagePercentage: 35,
          overallProgress: 20,
          dailyAverageWatchTime: 0,
          homeworkAssigned: 2,
          homeworkSubmitted: 0,
        },
        {
          name: 'Ravi',
          totalExams: 0,
          overallProgress: 10,
          dailyAverageWatchTime: 5,
          homeworkAssigned: 2,
          homeworkSubmitted: 1,
        },
      ],
    };

    const first = buildTeacherProgressInsights({ ...summary, refreshSeed: 0 });
    const refreshed = buildTeacherProgressInsights({ ...summary, refreshSeed: 1 });
    assert.notEqual(refreshed, first);
  });
});
