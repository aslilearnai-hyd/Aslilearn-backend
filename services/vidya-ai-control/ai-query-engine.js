import { parseDynamicIntent } from './gemini-intent-service.js';
import { executeDynamicDbPlan } from './db-access-layer.js';
import { buildAuditSelect } from './dynamic-sql-builder.js';
import { formatDynamicResponse } from './response-formatter.js';
import { buildControlOverviewFacts } from './school-overview-facts.js';

export async function runDynamicAiQuery({
  userMessage,
  history = [],
  viewerRole,
  viewerUserId,
}) {
  const plan = await parseDynamicIntent({ userMessage, history });
  const notes = [];
  let facts = { mode: plan.mode };

  if (plan.mode === 'overview') {
    const overviewFacts = await buildControlOverviewFacts({ viewerRole, viewerUserId });
    facts = { mode: 'overview', ...overviewFacts };
    notes.push('School dashboard overview: multi-metric snapshot from scoped aggregates.');
  } else if (plan.mode === 'database') {
    const db = await executeDynamicDbPlan({
      plan,
      viewerRole,
      viewerUserId,
    });
    if (!db.ok) {
      return {
        ok: false,
        error: db.error || 'Database query planning failed.',
        plan,
        facts: {},
        auditQuery: '--',
      };
    }
    facts = db.facts || {};
    notes.push('Database Truth First: response must be grounded to DB facts only.');
  } else {
    notes.push('Handled as knowledge response (no DB query required by intent parser).');
  }

  const auditQuery = buildAuditSelect(plan, facts);
  const message = await formatDynamicResponse({
    userPrompt: userMessage,
    plan,
    facts,
    notes,
  });

  return { ok: true, plan, facts, auditQuery, message, notes };
}
