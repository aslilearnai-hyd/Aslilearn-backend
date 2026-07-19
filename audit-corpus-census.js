/**
 * Full-corpus completeness census — ZERO token cost.
 *
 * Runs the existing quality gate + section-gap validator over EVERY stored
 * record, with no sampling cap. The Super Admin scan in
 * ai-tool-data-audit-service.js caps at 3000 rows (scanLimit) and 100 items per
 * tool, so its "incomplete" counts are a sample, not a census — this script
 * exists to get the real repair queue before any repair spend is committed.
 *
 * Usage:
 *   node audit-corpus-census.js                  # all tools
 *   node audit-corpus-census.js --tool=lesson-planner
 *   node audit-corpus-census.js --out=census.json
 */

import mongoose from 'mongoose';
import { writeFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import AiToolGeneration from './models/AiToolGeneration.js';
import AIGeneratorRecord from './models/AIGeneratorRecord.js';
import { isDeprecatedAiToolIdentifier } from './config/aiToolTemplates.js';
import { validateDashboardAiToolDoc } from './services/ai-tool-dashboard-validation.js';
import { isPlaceholderText } from './services/ai-generator-quality-gate.js';

const MASTER_FIELDS =
  'toolName toolDisplayName sourceType board classLabel subject topic subtopic content generatedContent createdAt metadata';
const LEGACY_FIELDS =
  'toolSlug toolName className subjectName topicName subtopicName board generatedContent createdAt';

const args = process.argv.slice(2);
function argValue(name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

const onlyTool = argValue('tool');
const outPath = argValue('out') || 'corpus-census.json';

/** Parse stored content into a structured object where possible. */
function parseStructured(row) {
  const raw = row.content || row.generatedContent || '';
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Count placeholder/scaffold strings in a record — the "generic content" signal. */
function countScaffoldHits(structured) {
  let hits = 0;
  let strings = 0;
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'string') {
      strings += 1;
      if (v.trim().length >= 12 && isPlaceholderText(v)) hits += 1;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(structured);
  return { hits, strings };
}

function emptyBucket(toolName, displayName) {
  return {
    toolName,
    toolDisplayName: displayName || toolName,
    total: 0,
    incomplete: 0,
    scaffolded: 0,
    unparseable: 0,
    failedWithoutSections: 0,
    missingSectionCounts: {},
    failureCodes: {},
    failureMessages: {},
    sampleIncompleteIds: [],
  };
}

function auditable(row) {
  if (!row?.toolName || isDeprecatedAiToolIdentifier(row.toolName)) return false;
  if (isDeprecatedAiToolIdentifier(row.toolDisplayName)) return false;
  if (row.sourceType === 'ai_pdf') return false;
  return true;
}

function tally(byTool, row) {
  if (!auditable(row)) return;

  const bucket =
    byTool[row.toolName] ||
    (byTool[row.toolName] = emptyBucket(row.toolName, row.toolDisplayName));
  bucket.total += 1;

  const gate = validateDashboardAiToolDoc(row.toolName, {
    toolName: row.toolName,
    content: row.content || row.generatedContent || '',
    generatedContent: row.generatedContent || row.content || '',
    metadata: row.metadata,
  });

  if (!gate.valid) {
    bucket.incomplete += 1;
    for (const section of gate.missingSections || []) {
      bucket.missingSectionCounts[section] = (bucket.missingSectionCounts[section] || 0) + 1;
    }
    // Most failures come back with NO missingSections — validateDashboardAiToolDoc
    // returns a bare {valid:false, message} for content-quality failures. Without
    // the code+message we cannot tell a repairable section gap from a content
    // defect that needs regeneration, so tally both.
    const code = String(gate.code || 'NO_CODE');
    bucket.failureCodes[code] = (bucket.failureCodes[code] || 0) + 1;
    const msg = String(gate.message || '').slice(0, 90) || '(no message)';
    bucket.failureMessages[msg] = (bucket.failureMessages[msg] || 0) + 1;
    if (!(gate.missingSections || []).length) bucket.failedWithoutSections += 1;

    if (bucket.sampleIncompleteIds.length < 25) {
      bucket.sampleIncompleteIds.push(String(row._id));
    }
  }

  const structured = parseStructured(row);
  if (!structured) {
    bucket.unparseable += 1;
    return;
  }
  const { hits } = countScaffoldHits(structured);
  if (hits > 0) bucket.scaffolded += 1;
}

/** Stream a collection with a cursor so a 15k+ corpus never lands in memory at once. */
async function streamCollection(Model, filter, fields, mapRow, byTool, label) {
  let seen = 0;
  const cursor = Model.find(filter).select(fields).lean().cursor();
  for await (const doc of cursor) {
    tally(byTool, mapRow(doc));
    seen += 1;
    if (seen % 1000 === 0) process.stdout.write(`  ${label}: ${seen} scanned\n`);
  }
  return seen;
}

const mapMasterRow = (d) => ({
  _id: d._id,
  sourceType: d.sourceType || 'legacy',
  toolName: d.toolName || '',
  toolDisplayName: d.toolDisplayName || '',
  board: d.board || '',
  classLabel: d.classLabel || '',
  subject: d.subject || '',
  topic: d.topic || '',
  subtopic: d.subtopic || '',
  createdAt: d.createdAt || null,
  content: d.content || d.generatedContent || '',
  generatedContent: d.generatedContent || d.content || '',
  metadata: d.metadata && typeof d.metadata === 'object' ? d.metadata : undefined,
});

const mapLegacyRow = (d) => ({
  _id: d._id,
  sourceType: 'ai_generator',
  toolName: d.toolSlug || d.toolName || '',
  toolDisplayName: d.toolName || d.toolSlug || '',
  board: d.board || '',
  classLabel: d.className || '',
  subject: d.subjectName || '',
  topic: d.topicName || '',
  subtopic: d.subtopicName || '',
  createdAt: d.createdAt || null,
  content: d.generatedContent || '',
  generatedContent: d.generatedContent || '',
  metadata: { source: 'ai_generators_legacy_collection' },
});

async function main() {
  console.log('Corpus census — no LLM calls, no token cost.\n');
  await connectDB();

  /** @type {Record<string, ReturnType<typeof emptyBucket>>} */
  const byTool = {};

  const masterFilter = { sourceType: { $ne: 'ai_pdf' } };
  const legacyFilter = {};
  if (onlyTool) {
    masterFilter.toolName = onlyTool;
    legacyFilter.toolSlug = onlyTool;
  }

  const masterCount = await streamCollection(
    AiToolGeneration, masterFilter, MASTER_FIELDS, mapMasterRow, byTool, 'master',
  );
  const legacyCount = await streamCollection(
    AIGeneratorRecord, legacyFilter, LEGACY_FIELDS, mapLegacyRow, byTool, 'legacy',
  );

  const tools = Object.values(byTool).sort((a, b) => b.incomplete - a.incomplete);
  const totals = tools.reduce(
    (acc, t) => ({
      total: acc.total + t.total,
      incomplete: acc.incomplete + t.incomplete,
      scaffolded: acc.scaffolded + t.scaffolded,
    }),
    { total: 0, incomplete: 0, scaffolded: 0 },
  );

  console.log(`\nScanned ${masterCount} master + ${legacyCount} legacy rows.\n`);
  console.log('Tool                              Total  Incomplete  %   Scaffolded');
  console.log('-'.repeat(74));
  for (const t of tools) {
    const pct = t.total ? Math.round((t.incomplete / t.total) * 100) : 0;
    console.log(
      `${t.toolName.padEnd(34)}${String(t.total).padStart(5)}${String(t.incomplete).padStart(12)}${String(pct).padStart(4)}%${String(t.scaffolded).padStart(11)}`,
    );
  }
  console.log('-'.repeat(74));
  console.log(
    `${'TOTAL'.padEnd(34)}${String(totals.total).padStart(5)}${String(totals.incomplete).padStart(12)}${String(totals.total ? Math.round((totals.incomplete / totals.total) * 100) : 0).padStart(4)}%${String(totals.scaffolded).padStart(11)}`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    scanned: { master: masterCount, legacy: legacyCount },
    totals,
    byTool: tools,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report (with missing-section breakdown + repair ids) → ${outPath}`);

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error('Census failed:', err?.message || err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
