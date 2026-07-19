/**
 * Fix books.contentId unique index so multiple PDF uploads without a Content link work.
 * Old unique/sparse index still indexed contentId: null → E11000 on second upload.
 *
 * Run: node scripts/fix-book-contentid-index.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const coll = mongoose.connection.db.collection('books');

  const unset = await coll.updateMany(
    { $or: [{ contentId: null }, { contentId: { $type: 'null' } }] },
    { $unset: { contentId: '' } }
  );
  console.log('Unset null contentId on books:', unset.modifiedCount);

  for (const name of ['contentId_1', 'contentId_1_sparse']) {
    try {
      await coll.dropIndex(name);
      console.log('Dropped index', name);
    } catch (e) {
      console.log('Drop', name, 'skipped:', e.message);
    }
  }

  try {
    await coll.createIndex(
      { contentId: 1 },
      {
        unique: true,
        name: 'contentId_1_partial',
        partialFilterExpression: { contentId: { $exists: true, $type: 'objectId' } },
      }
    );
    console.log('Created partial unique index contentId_1_partial');
  } catch (e) {
    console.log('Create index:', e.message);
  }

  await mongoose.disconnect();
  console.log('Done — re-try Book Knowledge Base upload.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
