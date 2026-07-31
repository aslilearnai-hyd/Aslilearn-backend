/**
 * Read-only audit: Class 6 AiToolGeneration topics vs ai_tool_topics.
 * Does not modify any data.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('NO_URI');
  process.exit(1);
}

await mongoose.connect(uri);
const col = mongoose.connection.db.collection('aitoolgenerations');
const total = await col.estimatedDocumentCount();
console.log('TOTAL_GENERATIONS', total);

const class6Match = {
  classLabel: { $regex: /^(Class\s*6|IIT-6|Class-6-IIT|6)$/i },
};

const class6 = await col
  .aggregate([
    { $match: class6Match },
    {
      $group: {
        _id: { board: '$board', subject: '$subject', topic: '$topic' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.subject': 1, '_id.topic': 1, count: -1 } },
  ])
  .toArray();

const bySubject = {};
for (const row of class6) {
  const subj = String(row._id.subject || '(empty)');
  if (!bySubject[subj]) {
    bySubject[subj] = { topics: new Map(), boards: new Set(), count: 0 };
  }
  const topic = String(row._id.topic || '(empty)');
  bySubject[subj].topics.set(topic, (bySubject[subj].topics.get(topic) || 0) + row.count);
  bySubject[subj].boards.add(String(row._id.board ?? ''));
  bySubject[subj].count += row.count;
}

console.log('CLASS6_GENERATION_SUBJECTS');
for (const s of Object.keys(bySubject).sort()) {
  const v = bySubject[s];
  const topics = [...v.topics.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
    .map(([topic, count]) => `${topic} (${count})`);
  console.log(
    JSON.stringify({
      subject: s,
      generationCount: v.count,
      topicCount: v.topics.size,
      boards: [...v.boards],
      topics,
    }),
  );
}

const topicsCol = mongoose.connection.db.collection('aitooltopics');
const tax = await topicsCol
  .aggregate([
    {
      $match: {
        isActive: { $ne: false },
        classLabel: { $regex: /^(Class\s*6|IIT-6|Class-6-IIT|6)$/i },
      },
    },
    {
      $group: {
        _id: {
          board: '$board',
          subject: '$subject',
          topic: {
            $trim: {
              input: {
                $cond: [
                  {
                    $and: [
                      { $ne: [{ $ifNull: ['$label', ''] }, ''] },
                      {
                        $not: {
                          $eq: [
                            { $indexOfCP: [{ $ifNull: ['$topicName', ''] }, { $concat: ['$label', ' - '] }] },
                            0,
                          ],
                        },
                      },
                    ],
                  },
                  { $concat: [{ $ifNull: ['$label', ''] }, ' - ', { $ifNull: ['$topicName', ''] }] },
                  { $ifNull: ['$topicName', ''] },
                ],
              },
            },
          },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.subject': 1, '_id.topic': 1 } },
  ])
  .toArray();

const taxBy = {};
for (const row of tax) {
  const subj = String(row._id.subject || '(empty)');
  if (!taxBy[subj]) taxBy[subj] = { topics: new Set(), boards: new Set(), count: 0 };
  taxBy[subj].topics.add(String(row._id.topic || ''));
  taxBy[subj].boards.add(String(row._id.board ?? ''));
  taxBy[subj].count += row.count;
}

console.log('CLASS6_TAXONOMY_SUBJECTS');
for (const s of Object.keys(taxBy).sort()) {
  const v = taxBy[s];
  console.log(
    JSON.stringify({
      subject: s,
      rowCount: v.count,
      topicCount: v.topics.size,
      boards: [...v.boards],
      topics: [...v.topics].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    }),
  );
}

const mathsGen = bySubject['Mathematics'] || bySubject['Maths'] || bySubject['maths'];
const chemGen = bySubject['Chemistry'] || bySubject['chemistry'];
console.log(
  'SUMMARY',
  JSON.stringify({
    mathsTopicsInGenerations: mathsGen ? mathsGen.topics.size : 0,
    chemistryTopicsInGenerations: chemGen ? chemGen.topics.size : 0,
    mathsTopicsInTaxonomy: (taxBy['Mathematics'] || taxBy['Maths'] || { topics: new Set() }).topics.size,
    chemistryTopicsInTaxonomy: (taxBy['Chemistry'] || { topics: new Set() }).topics.size,
  }),
);

await mongoose.disconnect();
