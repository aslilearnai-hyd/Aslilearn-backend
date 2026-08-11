/**
 * Soft-delete subjects that were auto-created by school timetable import / break editor
 * (and similar school-side creation), without touching Super Admin catalog subjects.
 *
 * Usage (from backend/):
 *   node scripts/cleanup-school-imported-subjects.js
 *   node scripts/cleanup-school-imported-subjects.js --dry-run
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { configureMongoDns } from '../config/mongo-dns.js';
configureMongoDns();

import Subject from '../models/Subject.js';
import { softDeleteSubject } from '../utils/subjectDelete.js';

const dryRun = process.argv.includes('--dry-run');

const IMPORT_DESCRIPTION_PATTERNS = [
  /Auto-created from class timetable grid import/i,
  /Break\/lunch slot from timetable editor/i,
  /Auto-created from.*timetable/i,
  /from timetable editor/i,
];

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(dryRun ? 'DRY RUN — no writes' : 'Connected — cleaning up…');

  const candidates = await Subject.find({
    isActive: { $ne: false },
    name: { $not: /__deleted__/ },
    $or: IMPORT_DESCRIPTION_PATTERNS.map((re) => ({ description: re })),
  })
    .select('_id name board description classIds createdAt')
    .lean();

  console.log(`Found ${candidates.length} school/imported subject(s) to remove:`);
  for (const s of candidates) {
    console.log(`  - ${s.name} [${s.board}] :: ${String(s.description || '').slice(0, 80)}`);
  }

  if (!candidates.length) {
    console.log('Nothing to clean.');
    await mongoose.disconnect();
    return;
  }

  if (dryRun) {
    console.log('Dry run complete. Re-run without --dry-run to delete.');
    await mongoose.disconnect();
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const row of candidates) {
    try {
      const doc = await Subject.findById(row._id);
      if (!doc || doc.isActive === false) continue;
      await softDeleteSubject(doc);
      ok += 1;
      console.log(`  deleted: ${row.name}`);
    } catch (err) {
      fail += 1;
      console.error(`  failed: ${row.name} — ${err?.message || err}`);
    }
  }

  console.log(`Done. Soft-deleted ${ok}, failed ${fail}.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
