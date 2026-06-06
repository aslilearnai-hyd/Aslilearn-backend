/**
 * Quick count: legacy AiToolGeneration vs new PdfGeneration rows.
 * Usage: node scripts/count-pdf-records.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('No MONGODB_URI in .env');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

const legacy = await db.collection('aitoolgenerations').countDocuments({
  sourceType: 'ai_pdf',
  $or: [
    { 'metadata.pdfGenerationId': { $exists: false } },
    { 'metadata.pdfGenerationId': null },
    { 'metadata.pdfGenerationId': '' },
  ],
});
const synced = await db.collection('aitoolgenerations').countDocuments({
  sourceType: 'ai_pdf',
  'metadata.pdfGenerationId': { $exists: true, $nin: [null, ''] },
});
const pdfGens = await db.collection('pdfgenerations').countDocuments({});
const sources = await db.collection('aicontentenginesources').countDocuments({});

const orphanedSynced = await db.collection('aitoolgenerations').aggregate([
  {
    $match: {
      sourceType: 'ai_pdf',
      'metadata.pdfGenerationId': { $exists: true, $nin: [null, ''] },
    },
  },
  {
    $lookup: {
      from: 'pdfgenerations',
      let: { gid: '$metadata.pdfGenerationId' },
      pipeline: [
        {
          $match: {
            $expr: {
              $eq: [{ $toString: '$_id' }, '$$gid'],
            },
          },
        },
      ],
      as: 'gen',
    },
  },
  { $match: { gen: { $size: 0 } } },
  { $count: 'n' },
]).toArray();

console.log('PDF record counts in', db.databaseName);
console.log('  Legacy ai_pdf masters (no pdfGenerationId):', legacy);
console.log('  Synced ai_pdf masters (has pdfGenerationId):', synced);
console.log('  PdfGeneration documents:', pdfGens);
console.log('  AiContentEngineSource documents:', sources);
console.log('  Orphaned synced masters (PdfGeneration missing):', orphanedSynced[0]?.n || 0);

await mongoose.disconnect();
