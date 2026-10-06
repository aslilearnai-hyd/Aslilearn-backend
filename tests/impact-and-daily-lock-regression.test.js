import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mergeTeacherIdentityRows } from '../utils/teacher-identity.js';

describe('weekly impact teacher identity merge', () => {
  it('keeps the User id when a legacy Teacher row has the same email', () => {
    const rows = mergeTeacherIdentityRows(
      [
        {
          _id: 'user-1',
          fullName: 'Active Teacher',
          email: 'Teacher@School.test',
          lastLogin: new Date('2026-10-06T08:00:00Z'),
        },
      ],
      [
        {
          _id: 'teacher-profile-1',
          name: 'Legacy Profile',
          email: 'teacher@school.test',
        },
      ],
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].teacherId, 'user-1');
    assert.equal(rows[0].name, 'Active Teacher');
  });

  it('retains a Teacher-only row when no User account matches it', () => {
    const rows = mergeTeacherIdentityRows([], [
      { _id: 'teacher-only', name: 'Teacher Only', email: 'only@school.test' },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].teacherId, 'teacher-only');
  });
});

describe('daily quiz lock response', () => {
  it('does not return a false 500 after the durable result has been saved', () => {
    const source = readFileSync(new URL('../routes/student/iqRank.js', import.meta.url), 'utf8');
    const catchStart = source.indexOf('catch (dailyErr)');
    const responseStart = source.indexOf('res.json({', catchStart);
    assert.ok(catchStart >= 0 && responseStart > catchStart, 'daily log catch block should be present');
    const catchBlock = source.slice(catchStart, responseStart);
    assert.doesNotMatch(catchBlock, /res\.status\(500\)/);
    assert.match(catchBlock, /dailyLogSynced\s*=\s*false/);
    assert.match(source, /lockedUntilTomorrow:\s*true/);
  });
});
