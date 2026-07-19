/**
 * Generate one record per tool through the real V2 save path and gate it.
 *
 * Writes records. Sequential (not parallel) to keep Gemini concurrency sane and
 * the cost line readable per tool.
 *
 * Usage:
 *   node sweep-all-tools.js
 *   node sweep-all-tools.js --only=mock-test-builder,my-study-decks
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import { AI_TOOL_ORDERED_SLUGS } from './config/aiToolTemplates.js';
import { generateBatchAndSave } from './services/ai-generator-batch-orchestrator.js';
import { validateDashboardAiToolDoc } from './services/ai-tool-dashboard-validation.js';
import AiToolGeneration from './models/AiToolGeneration.js';

const args = process.argv.slice(2);
const onlyRaw = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const ONLY = onlyRaw ? onlyRaw.split(',').map((s) => s.trim()).filter(Boolean) : null;

// Reading/language tools need a language subject or they fail on their own rules.
const SUBJECT_BY_TOOL = {
  'reading-practice-room': 'English',
  'story-passage-creator': 'English',
};

const BASE = {
  board: 'CBSE',
  className: 'Class 9',
  topicName: 'Matter in Our Surroundings',
  subtopicName: 'States of Matter',
};

const READING_CTX = {
  topicName: 'Prose',
  subtopicName: 'The Lost Child',
};

async function runTool(slug) {
  const subject = SUBJECT_BY_TOOL[slug] || 'Science';
  const ctx = SUBJECT_BY_TOOL[slug] ? { ...BASE, ...READING_CTX } : BASE;
  const before = await AiToolGeneration.countDocuments({ toolName: slug });

  let err = '';
  try {
    await generateBatchAndSave(
      { ...ctx, subjectName: subject, toolSlug: slug, toolName: slug, batchSize: 1 },
      { batchSize: 1, reqUser: { name: 'sweep' } },
    );
  } catch (e) {
    err = String(e?.message || e).slice(0, 70);
  }

  const after = await AiToolGeneration.countDocuments({ toolName: slug });
  if (after <= before) {
    return { slug, saved: 0, gate: 'NOT SAVED', detail: err || 'generation produced no record' };
  }

  const row = await AiToolGeneration.findOne({ toolName: slug }).sort({ createdAt: -1 }).lean();
  const content = String(row.content || row.generatedContent || '');
  const gate = validateDashboardAiToolDoc(slug, {
    toolName: slug,
    content,
    generatedContent: content,
    metadata: row.metadata,
  });
  return {
    slug,
    saved: after - before,
    chars: content.length,
    gate: gate.valid ? 'PASS' : 'FAIL',
    detail: gate.valid
      ? ''
      : (gate.missingSections || []).join(' | ') || String(gate.message || '').slice(0, 60),
  };
}

async function main() {
  const slugs = (ONLY || [...AI_TOOL_ORDERED_SLUGS]).filter(Boolean);
  console.log(`Sweep: 1 record per tool across ${slugs.length} tools. THIS WRITES RECORDS.\n`);
  await connectDB();

  const results = [];
  for (const slug of slugs) {
    process.stdout.write(`  ${slug.padEnd(32)} `);
    const r = await runTool(slug);
    results.push(r);
    console.log(
      `${r.gate.padEnd(10)} ${r.chars ? r.chars + ' chars' : ''} ${r.detail ? '\n      -> ' + r.detail : ''}`,
    );
  }

  const pass = results.filter((r) => r.gate === 'PASS');
  const fail = results.filter((r) => r.gate !== 'PASS');
  console.log(`\n${'='.repeat(64)}`);
  console.log(`PASS ${pass.length}/${results.length}`);
  if (fail.length) {
    console.log(`\nFAILING (${fail.length}):`);
    for (const f of fail) console.log(`  ${f.slug.padEnd(32)} ${f.gate}  ${f.detail}`);
  }

  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('Sweep failed:', e?.message || e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
