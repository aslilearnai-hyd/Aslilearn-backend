import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { extractWorksheetItemsFromPdfText } from '../services/pdf-worksheet-extract.js';

dotenv.config();

const uri = process.env.MONGO_URI;
await mongoose.connect(uri);
const col = mongoose.connection.db.collection('aicontentenginegenerations');

const doc = await col.findOne(
  {
    toolSlug: 'worksheet-mcq-generator',
    'structuredContent.extractedPdfText': { $exists: true, $ne: '' },
  },
  {
    sort: { createdAt: -1 },
    projection: {
      title: 1,
      topic: 1,
      'structuredContent.extractedPdfText': 1,
      'structuredContent.sections': 1,
      createdAt: 1,
    },
  },
);

if (!doc) {
  console.log('No worksheet doc with extractedPdfText');
  process.exit(0);
}

const text = doc.structuredContent?.extractedPdfText || '';
const secs = doc.structuredContent?.sections || [];
const storedQ = secs.reduce((n, s) => n + (s.questions?.length || 0), 0);
const extracted = extractWorksheetItemsFromPdfText(text, 500);

console.log('title:', doc.title || doc.topic);
console.log('created:', doc.createdAt);
console.log('textLen:', text.length);
console.log('questionMarks:', (text.match(/\?/g) || []).length);
console.log('storedQuestions:', storedQ);
console.log('regexExtracted:', extracted.length);

const bySection = {};
for (const q of extracted) {
  const s = q.section || 'unknown';
  bySection[s] = (bySection[s] || 0) + 1;
}
console.log('bySection:', bySection);

console.log('\n---HEAD (3000)---\n');
console.log(text.slice(0, 3000));
console.log('\n---SAMPLE MCQ BLOCK---\n');
const mcqIdx = text.search(/\d+[\.\)]\s+Which/i);
if (mcqIdx >= 0) console.log(text.slice(mcqIdx, mcqIdx + 800));

await mongoose.disconnect();
