import { parseDynamicIntent } from './gemini-intent-service.js';
import { executeDynamicDbPlan } from './db-access-layer.js';
import { buildAuditSelect } from './dynamic-sql-builder.js';
import { formatDynamicResponse } from './response-formatter.js';
import {
  buildControlOverviewFacts,
  buildNamedSchoolDetailFacts,
  buildPublishedCatalogFacts,
} from './school-overview-facts.js';
import {
  buildNamedPersonDetailFacts,
  buildClassGroupFacts,
} from './entity-detail-facts.js';

export async function runDynamicAiQuery({
  userMessage,
  history = [],
  viewerRole,
  viewerUserId,
}) {
  const plan = await parseDynamicIntent({ userMessage, history });
  const notes = [];
  let facts = { mode: plan.mode };

  // Gemini flagged a required detail as missing (e.g. "students in Class" with
  // no number) — ask instead of running a query that would silently match nothing.
  if (plan.mode === 'database' && plan.clarification) {
    return {
      ok: true,
      plan,
      facts: { mode: 'clarification' },
      auditQuery: '--',
      message: plan.clarification,
      notes: ['Clarification requested before running a database query.'],
    };
  }

  if (plan.mode === 'overview') {
    const overviewFacts = await buildControlOverviewFacts({ viewerRole, viewerUserId });
    facts = { mode: 'overview', ...overviewFacts };
    notes.push('School dashboard overview: multi-metric snapshot from scoped aggregates.');
  } else if (plan.mode === 'catalog_counts') {
    const catalogFacts = await buildPublishedCatalogFacts({ viewerRole, viewerUserId });
    facts = { mode: 'catalog_counts', ...catalogFacts };
    notes.push('Published catalog: EduOTT videos, library video items, and published assessments.');
  } else if (plan.mode === 'school_detail') {
    const detailFacts = await buildNamedSchoolDetailFacts(plan.schoolNameQuery || '', {
      viewerRole,
      viewerUserId,
    });
    facts = { mode: 'school_detail', ...detailFacts };
    notes.push('Named school lookup: School collection + scoped live metrics.');
  } else if (plan.mode === 'person_detail') {
    const personFacts = await buildNamedPersonDetailFacts({
      personNameQuery: plan.personNameQuery || '',
      roleHint: plan.personRoleHint || '',
      viewerRole,
      viewerUserId,
    });
    facts = { mode: 'person_detail', ...personFacts };
    notes.push('Named person lookup: profile + exams/progress/classes within viewer scope.');
  } else if (plan.mode === 'class_detail') {
    const classFacts = await buildClassGroupFacts({
      classNumber: plan.classNumberQuery || '',
      section: plan.sectionQuery || '',
      viewerRole,
      viewerUserId,
    });
    facts = { mode: 'class_detail', ...classFacts };
    notes.push('Class/section group metrics within viewer scope.');
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
    viewerRole,
    history,
  });

  return { ok: true, plan, facts, auditQuery, message, notes };
}
