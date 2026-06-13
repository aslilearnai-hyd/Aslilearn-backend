/**
 * Backfill AiGenerationFingerprint from historical AiToolGeneration records.
 * Usage: npm run ai:fingerprint-backfill
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../config/database.js';
import AiToolGeneration from '../models/AiToolGeneration.js';
import AiGenerationFingerprint from '../models/AiGenerationFingerprint.js';
import { persistGenerationFingerprints } from '../services/ai-generator-fingerprint-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const BATCH_SIZE = Number(process.env.AI_FINGERPRINT_BACKFILL_BATCH) || 100;

async function generationHasFingerprints(generationId) {
  const count = await AiGenerationFingerprint.countDocuments({ generationId });
  return count > 0;
}

async function main() {
  await connectDB();

  const query = {
    sourceType: { $ne: 'ai_pdf' },
    'metadata.structuredContent': { $exists: true, $ne: null },
  };

  const total = await AiToolGeneration.countDocuments(query);
  console.log(`\n=== AI Generator Fingerprint Backfill ===`);
  console.log(`Processing ${total} records...\n`);

  let processed = 0;
  let skipped = 0;
  let created = 0;
  let failed = 0;
  let fingerprintRows = 0;

  const cursor = AiToolGeneration.find(query)
    .select('_id toolName board classLabel subject topic subtopic metadata')
    .sort({ createdAt: 1 })
    .cursor();

  for await (const doc of cursor) {
    processed += 1;
    console.log(`Record ${processed}/${total} — ${doc._id}`);

    try {
      const hasFp = await generationHasFingerprints(doc._id);
      if (hasFp) {
        skipped += 1;
        continue;
      }

      const structured = doc.metadata?.structuredContent;
      if (!structured || typeof structured !== 'object') {
        skipped += 1;
        continue;
      }

      const scope = {
        toolSlug: doc.toolName,
        board: doc.board,
        className: doc.classLabel,
        subject: doc.subject,
        topic: doc.topic,
        subtopic: doc.subtopic,
      };

      const meta = await persistGenerationFingerprints(
        doc.toolName,
        structured,
        scope,
        doc._id,
      );

      await AiToolGeneration.updateOne(
        { _id: doc._id },
        {
          $set: {
            'metadata.contentFingerprint': meta.contentFingerprint,
            'metadata.questionFingerprints': meta.questionFingerprints,
            'metadata.objectiveFingerprints': meta.objectiveFingerprints,
            'metadata.activityFingerprints': meta.activityFingerprints,
            'metadata.fingerprintBackfilledAt': new Date(),
          },
        },
      );

      created += 1;
      fingerprintRows += meta.questionFingerprints.length + meta.objectiveFingerprints.length + meta.activityFingerprints.length + (meta.contentFingerprint ? 1 : 0);
    } catch (err) {
      failed += 1;
      console.error(`  Failed: ${err?.message || err}`);
    }

    if (processed % BATCH_SIZE === 0) {
      console.log(`  Progress checkpoint: ${processed}/${total} (created=${created}, skipped=${skipped}, failed=${failed})`);
    }
  }

  const totalFingerprints = await AiGenerationFingerprint.countDocuments();

  console.log('\n=== Backfill completed ===');
  console.log(`Total records scanned: ${processed}`);
  console.log(`Fingerprints created for: ${created}`);
  console.log(`Skipped (existing or no structured): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Approx fingerprint units written: ${fingerprintRows}`);
  console.log(`Total AiGenerationFingerprint rows in DB: ${totalFingerprints}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
