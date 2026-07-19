/**
 * Re-render stored records from metadata.structuredContent — ZERO token cost.
 *
 * Some records saved only their title into `content` (46-56 chars) because
 * mapV2StructuredToLegacy emitted key names the tool's template did not read.
 * The full V2 payload was still persisted to metadata.structuredContent, so the
 * content is recoverable WITHOUT regenerating anything: re-run the (now fixed)
 * mapper + formatter and write the result back.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed.
 *
 * Usage:
 *   node backfill-rerender-from-structured.js --tool=short-notes-summaries-maker
 *   node backfill-rerender-from-structured.js --tool=short-notes-summaries-maker --apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import AiToolGeneration from './models/AiToolGeneration.js';
import { mapV2StructuredToLegacy } from './utils/v2-structured-to-legacy.js';
import { formatStructuredToolOutput } from './config/aiToolTemplates.js';
import { validateDashboardAiToolDoc } from './services/ai-tool-dashboard-validation.js';

const args = process.argv.slice(2);
const argVal = (n, d = '') => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const APPLY = args.includes('--apply');
const TOOL = argVal('tool', 'short-notes-summaries-maker');

async function main() {
  console.log(
    `Re-render from metadata.structuredContent — tool="${TOOL}" — ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`,
  );
  await connectDB();

  const cursor = AiToolGeneration.find({ toolName: TOOL, sourceType: { $ne: 'ai_pdf' } })
    .select('toolName content generatedContent metadata')
    .lean()
    .cursor();

  const stats = {
    scanned: 0,
    alreadyValid: 0,
    noStructured: 0,
    unchanged: 0,
    wouldFix: 0,
    stillFails: 0,
    applied: 0,
  };
  const samples = [];

  for await (const row of cursor) {
    stats.scanned += 1;
    const before = String(row.content || row.generatedContent || '');

    const gateBefore = validateDashboardAiToolDoc(TOOL, {
      toolName: TOOL,
      content: before,
      generatedContent: before,
      metadata: row.metadata,
    });
    if (gateBefore.valid) {
      stats.alreadyValid += 1;
      continue;
    }

    const sc = row.metadata && row.metadata.structuredContent;
    if (!sc) {
      stats.noStructured += 1;
      continue;
    }

    let after = '';
    let legacy = null;
    try {
      legacy = mapV2StructuredToLegacy(TOOL, sc);
      if (legacy) after = String(formatStructuredToolOutput(TOOL, legacy) || '');
    } catch {
      after = '';
      legacy = null;
    }

    // Never replace real content with something shorter than what is already there.
    if (!after || after.length <= before.length) {
      stats.unchanged += 1;
      continue;
    }

    /*
     * metadata.legacyStructuredContent must be refreshed too, not just content.
     *
     * The validator reads the STORED legacyStructuredContent in preference to
     * re-deriving it from structuredContent. Those stored copies were written by
     * the old mapper and are missing the tool's canonical keys, so a record kept
     * failing even when re-rendered — validating against the stale copy rather
     * than the corrected one. Verified: same record FAILS with the stored copy
     * and PASSES with the refreshed one.
     */
    const refreshedMeta = legacy
      ? { ...row.metadata, legacyStructuredContent: legacy }
      : row.metadata;

    const gateAfter = validateDashboardAiToolDoc(TOOL, {
      toolName: TOOL,
      content: after,
      generatedContent: after,
      metadata: refreshedMeta,
    });

    if (!gateAfter.valid) {
      stats.stillFails += 1;
      continue;
    }

    stats.wouldFix += 1;
    if (samples.length < 5) {
      samples.push({ id: String(row._id).slice(-6), before: before.length, after: after.length });
    }

    if (APPLY) {
      await AiToolGeneration.updateOne(
        { _id: row._id },
        {
          $set: {
            content: after,
            generatedContent: after,
            ...(legacy ? { 'metadata.legacyStructuredContent': legacy } : {}),
            'metadata.rerenderedFromStructuredAt': new Date(),
          },
        },
      );
      stats.applied += 1;
    }
  }

  console.log('scanned            :', stats.scanned);
  console.log('already valid      :', stats.alreadyValid);
  console.log('no structured data :', stats.noStructured, '(cannot fix without regenerating)');
  console.log('no improvement     :', stats.unchanged);
  console.log('still fails gate   :', stats.stillFails);
  console.log('RECOVERABLE        :', stats.wouldFix, APPLY ? `(applied ${stats.applied})` : '(dry run — not written)');
  if (samples.length) {
    console.log('\nsamples:');
    for (const s of samples) console.log(`   ${s.id}: ${s.before} -> ${s.after} chars`);
  }
  if (!APPLY && stats.wouldFix) {
    console.log(`\nRe-run with --apply to write these ${stats.wouldFix} records.`);
  }

  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('Backfill failed:', e?.message || e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
