/**
 * Ensure Subject unique index includes productCategory and backfill empty values.
 * Run: node scripts/migrate-product-category.js
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
  const db = mongoose.connection.db;

  for (const collName of ['subjects', 'contents', 'books', 'schools', 'users']) {
    const coll = db.collection(collName);
    if (collName === 'schools' || collName === 'users') {
      const r = await coll.updateMany(
        { iitCategories: { $exists: false } },
        { $set: { iitCategories: [] } }
      );
      console.log(`${collName}: backfilled iitCategories`, r.modifiedCount);
    } else {
      const r = await coll.updateMany(
        { $or: [{ productCategory: { $exists: false } }, { productCategory: null }] },
        { $set: { productCategory: '' } }
      );
      console.log(`${collName}: backfilled productCategory`, r.modifiedCount);
    }
  }

  const subjects = db.collection('subjects');
  try {
    await subjects.dropIndex('name_1_board_1_stateName_1');
    console.log('Dropped old subject unique index name_1_board_1_stateName_1');
  } catch (e) {
    console.log('Old subject index drop skipped:', e.message);
  }
  try {
    await subjects.createIndex(
      { name: 1, board: 1, stateName: 1, productCategory: 1 },
      { unique: true, name: 'name_1_board_1_stateName_1_productCategory_1' }
    );
    console.log('Created subject unique index with productCategory');
  } catch (e) {
    console.log('Create index:', e.message);
  }

  await mongoose.disconnect();
  console.log('Done');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
