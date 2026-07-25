/**
 * Tag uncategorized IIT AI Tool Generations / Topics as ALPHA.
 * (Older book/AI generations were produced for Alpha before track was required.)
 *
 * Run: node scripts/backfill-legacy-generations-to-alpha.js
 * Or it runs automatically once on API startup.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { backfillLegacyIitContentToAlpha } from '../utils/backfill-legacy-alpha.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const result = await backfillLegacyIitContentToAlpha({ force: true });
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
  console.log('Done');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
