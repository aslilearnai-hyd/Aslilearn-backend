import 'dotenv/config';
import mongoose from 'mongoose';

import Book from '../models/Book.js';
import { reextractAndIndexBook } from '../ai/rag/books/book-ingestion-service.js';

const apply = process.argv.includes('--apply');
const failedOnly = process.argv.includes('--failed-only');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const bookArg = process.argv.find((arg) => arg.startsWith('--book='));
const limit = Math.max(1, Math.min(10000, Number(limitArg?.slice('--limit='.length)) || 10000));
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!mongoUri) throw new Error('MONGODB_URI or MONGO_URI is required.');
await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

try {
  const filter = {};
  if (failedOnly) filter.processingStatus = { $in: ['failed', 'needs_ocr'] };
  if (bookArg) filter._id = bookArg.slice('--book='.length);
  const books = await Book.find(filter)
    .select('_id title fileUrl processingStatus extractedTextLength chunkCount updatedAt')
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  if (!apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      count: books.length,
      action: 'Re-read each original source, rebuild full source parts/assets/chunks/embeddings.',
      books,
    }, null, 2));
    process.exitCode = 0;
  } else {
    const results = [];
    for (const book of books) {
      try {
        const result = await reextractAndIndexBook(book._id);
        results.push({ bookId: String(book._id), title: book.title, ok: true, result });
      } catch (error) {
        results.push({ bookId: String(book._id), title: book.title, ok: false, error: error?.message || String(error) });
      }
    }
    console.log(JSON.stringify({
      mode: 'apply',
      processed: results.length,
      succeeded: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      results,
    }, null, 2));
    if (results.some((row) => !row.ok)) process.exitCode = 1;
  }
} finally {
  await mongoose.disconnect();
}
