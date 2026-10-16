/**
 * Fill AiToolTopic.topicNumber / subtopicNumber from existing labels
 * ("Chapter 3", "3.2 Evaporation") so book mapping can match by number.
 * Rows that already have numbers are left alone. Dry run by default.
 *
 *   node scripts/backfill-ai-topic-numbers.mjs            # report only
 *   node scripts/backfill-ai-topic-numbers.mjs --apply    # write
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import AiToolTopic from '../models/AiToolTopic.js';
import { deriveSubtopicNumber, deriveTopicNumber } from '../ai/rag/books/book-curriculum-mapper.js';

const apply = process.argv.includes('--apply');
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';
if (!mongoUri) throw new Error('MONGODB_URI/MONGO_URI/DATABASE_URL is not configured.');

await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
try {
  const rows = await AiToolTopic.find({ isActive: true })
    .select('board productCategory classLabel subject label topicName subTopic topicNumber subtopicNumber')
    .lean();
  const ops = [];
  let topicFilled = 0;
  let subtopicFilled = 0;
  let noTopicNumber = 0;
  let noSubtopicNumber = 0;
  for (const row of rows) {
    const set = {};
    const topicNumber = row.topicNumber || deriveTopicNumber(row);
    if (!row.topicNumber && topicNumber) {
      set.topicNumber = topicNumber;
      topicFilled += 1;
    }
    if (!topicNumber) noTopicNumber += 1;
    const subtopicNumber = row.subtopicNumber || deriveSubtopicNumber(row, topicNumber);
    if (!row.subtopicNumber && subtopicNumber) {
      set.subtopicNumber = subtopicNumber;
      subtopicFilled += 1;
    }
    if (!subtopicNumber) noSubtopicNumber += 1;
    if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: row._id }, update: { $set: set } } });
  }
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    activeRows: rows.length,
    topicNumbersToFill: topicFilled,
    subtopicNumbersToFill: subtopicFilled,
    rowsStillWithoutTopicNumber: noTopicNumber,
    rowsStillWithoutSubtopicNumber: noSubtopicNumber,
  }, null, 2));
  if (noSubtopicNumber) {
    console.log('Rows without a subtopic number fall back to title/embedding matching; add numbers in AI Tool Topics admin for best results.');
  }
  if (apply && ops.length) {
    const result = await AiToolTopic.bulkWrite(ops, { ordered: false });
    console.log(`Updated ${result.modifiedCount} rows.`);
  }
} finally {
  await mongoose.disconnect();
}
