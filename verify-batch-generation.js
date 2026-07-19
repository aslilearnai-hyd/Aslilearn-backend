/**
 * Verification batch — generate a small number of REAL records through the V2
 * six-section save path and report whether they land complete.
 *
 * This writes records. It is the only way to exercise generateBatchAndSave,
 * which is where mapV2StructuredToLegacy runs at save time; the cheaper
 * measure-generation-cost.js only exercises the content-engine path and would
 * not prove the mapper/schema fixes work end to end.
 *
 * Usage:
 *   node verify-batch-generation.js --tool=lesson-planner --n=2
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import { generateBatchAndSave } from './services/ai-generator-batch-orchestrator.js';
import { validateDashboardAiToolDoc } from './services/ai-tool-dashboard-validation.js';
import AiToolGeneration from './models/AiToolGeneration.js';

const args = process.argv.slice(2);
const argVal = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const TOOL = argVal('tool', 'lesson-planner');
const N = Math.max(1, Math.min(3, parseInt(argVal('n', '2'), 10) || 2));

const PARAMS = {
  toolSlug: TOOL,
  toolName: TOOL,
  board: 'CBSE',
  className: 'Class 9',
  subjectName: 'Science',
  topicName: 'Matter in Our Surroundings',
  subtopicName: 'States of Matter',
  batchSize: N,
};

async function main() {
  console.log(`Verification batch — ${N} record(s) of "${TOOL}" — THIS WRITES RECORDS.\n`);
  await connectDB();

  const startedAt = Date.now();
  const result = await generateBatchAndSave(PARAMS, {
    batchSize: N,
    reqUser: { name: 'verification-batch' },
  });

  // generateBatchAndSave returns { records, savedCount, ... } — not savedRecords.
  const saved = Array.isArray(result?.records) ? result.records : [];
  console.log(`\nsaved: ${saved.length}/${N} | ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (result?.cost) {
    console.log(
      `cost : INR ${result.cost.inr} total | INR ${result.cost.perRecordInr ?? '-'} per record | ${result.cost.model}`,
    );
  }
  if (result?.errors?.length) {
    console.log('errors:', result.errors.slice(0, 3));
  }

  // Re-read from Mongo and gate each saved record — do not trust the in-memory copy.
  let pass = 0;
  for (const rec of saved) {
    const row = await AiToolGeneration.findById(rec._id).lean();
    if (!row) continue;
    const content = String(row.content || row.generatedContent || '');
    const gate = validateDashboardAiToolDoc(TOOL, {
      toolName: TOOL,
      content,
      generatedContent: content,
      metadata: row.metadata,
    });
    const missing = gate.missingSections || [];
    console.log(
      `\n  ${String(row._id).slice(-6)} | ${content.length} chars | ${gate.valid ? 'PASS' : 'FAIL'}`,
    );
    if (!gate.valid) {
      console.log(`     ${(gate.message || '').slice(0, 70)}`);
      console.log(`     missing: ${missing.join(' | ') || '(none named)'}`);
    }
    const sc = row.metadata?.structuredContent || {};
    const core = sc.core || {};
    const newField = TOOL === 'lesson-planner' ? 'homework' : 'creativeTask';
    const v = core[newField];
    console.log(
      `     new schema field core.${newField}: ${v ? JSON.stringify(v).slice(0, 90) : 'EMPTY'}`,
    );
    if (gate.valid) pass += 1;
  }

  console.log(`\n${'='.repeat(60)}\ngate pass: ${pass}/${saved.length} saved records`);
  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('Verification failed:', e?.message || e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
