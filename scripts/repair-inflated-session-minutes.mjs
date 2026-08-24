/**
 * Clamp inflated UserSession.duration values caused by the
 * "minutes since midnight" pre-save bug.
 *
 * Usage:
 *   node scripts/repair-inflated-session-minutes.mjs
 *   node scripts/repair-inflated-session-minutes.mjs --dry-run
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import UserSession, { MAX_SESSION_DURATION_MINUTES } from '../models/UserSession.js';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const inflated = await UserSession.countDocuments({
    duration: { $gt: MAX_SESSION_DURATION_MINUTES },
  });
  console.log(
    `Found ${inflated} session row(s) with duration > ${MAX_SESSION_DURATION_MINUTES} min`,
  );

  if (!inflated) {
    await mongoose.disconnect();
    return;
  }

  if (dryRun) {
    const samples = await UserSession.find({ duration: { $gt: MAX_SESSION_DURATION_MINUTES } })
      .sort({ duration: -1 })
      .limit(10)
      .select('userId date duration startTime endTime')
      .lean();
    console.log('Dry run — top samples:', JSON.stringify(samples, null, 2));
    await mongoose.disconnect();
    return;
  }

  const result = await UserSession.updateMany(
    { duration: { $gt: MAX_SESSION_DURATION_MINUTES } },
    [{ $set: { duration: MAX_SESSION_DURATION_MINUTES } }],
  );
  console.log(`Clamped ${result.modifiedCount || result.nModified || 0} row(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
