import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answerAuditLogsBySchool,
  auditSchoolBreakdownTimeframe,
} from '../services/vidya-ai-control/ai-query-engine.js';
import { normalizeDynamicTimeframe } from '../services/vidya-ai-control/db-access-layer.js';
import { isReportsOverviewQuery } from '../services/vidya-ai-control/school-overview-facts.js';

test('platform overview quick question uses the deterministic overview path', () => {
  assert.equal(isReportsOverviewQuery('Platform overview — schools, students, teachers'), true);
});

test('audit-school intent normalizes common relative timeframe wording', () => {
  assert.equal(
    auditSchoolBreakdownTimeframe('How many audit log entries were recorded in the last 7 days, grouped by school?'),
    'last_7_days',
  );
  assert.equal(auditSchoolBreakdownTimeframe('Audit logs split per school this month'), 'this_month');
  assert.equal(auditSchoolBreakdownTimeframe('How many students by school?'), '');
});

test('database planner accepts common last-seven-days spellings', () => {
  assert.equal(normalizeDynamicTimeframe('last 7 days'), 'last_7_days');
  assert.equal(normalizeDynamicTimeframe('past_7_days'), 'last_7_days');
  assert.equal(normalizeDynamicTimeframe('last_7_days'), 'last_7_days');
  assert.equal(normalizeDynamicTimeframe('this week'), 'this_week');
  assert.equal(normalizeDynamicTimeframe('next week'), 'next week');
});

test('audit-school answer runs a fixed scoped aggregate and formats exact results', async () => {
  let received;
  const result = await answerAuditLogsBySchool({
    userMessage: 'How many audit log entries were recorded in the past 7 days, grouped by school?',
    viewerRole: 'super-admin',
    viewerUserId: 'root',
    execute: async request => {
      received = request;
      return {
        ok: true,
        facts: {
          module: 'audit_logs',
          operation: 'aggregate',
          rows: [
            { _id: { school: 'Alpha School' }, count: 8 },
            { _id: { school: 'Beta School' }, count: 3 },
          ],
        },
      };
    },
  });

  assert.equal(received.plan.timeframe, 'last_7_days');
  assert.equal(received.plan.dateField, 'at');
  assert.deepEqual(received.plan.groupBy, ['school']);
  assert.deepEqual(received.plan.aggregates, [{ func: 'count', field: '*', as: 'count' }]);
  assert.match(result.message, /11 across 2 school groups/);
  assert.match(result.message, /Alpha School: 8/);
  assert.equal(result.facts.total, 11);
});

test('audit-school database failure does not fall through to an unrelated planner', async () => {
  const result = await answerAuditLogsBySchool({
    userMessage: 'How many audit log entries were recorded in the last 7 days, grouped by school?',
    viewerRole: 'super-admin',
    viewerUserId: 'root',
    execute: async () => ({ ok: false, error: 'Unsupported timeframe.' }),
  });
  assert.equal(result.facts.unavailable, true);
  assert.equal(result.facts.timeframe, 'last_7_days');
  assert.match(result.message, /could not read the audit logs/i);
});
