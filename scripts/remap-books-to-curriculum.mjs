/**
 * Migrate already-indexed books to AI Tools curriculum mapping, then run
 * retrieval QA per subtopic (embedding call only; no Gemini generation).
 *
 *   node scripts/remap-books-to-curriculum.mjs --dry-run           # list books + current status
 *   node scripts/remap-books-to-curriculum.mjs --book=<id>         # one book
 *   node scripts/remap-books-to-curriculum.mjs --all [--limit=5]   # every indexed book
 *   node scripts/remap-books-to-curriculum.mjs --qa-only --book=<id>
 *   add --report=remap-report.json to save results
 *
 * Remapping rebuilds chunks from the stored full source (BookSourcePart) and
 * re-embeds them. Run --backfill of topic numbers first:
 *   node scripts/backfill-ai-topic-numbers.mjs --apply
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import Book from '../models/Book.js';
import { indexBook } from '../ai/rag/books/book-ingestion-service.js';
import { loadCurriculumTreeForBook } from '../ai/rag/books/book-curriculum-service.js';
import { findScopeMismatches } from '../ai/rag/books/book-curriculum-mapper.js';
import {
  buildBookRetrievalQuery,
  resolveCurriculumRetrievalRoute,
  searchRelevantChunks,
} from '../ai/rag/books/book-rag-service.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || '';
const dryRun = flag('dry-run');
const qaOnly = flag('qa-only');
const bookArg = value('book');
const limit = Math.max(0, Number(value('limit')) || 0);
const reportPath = value('report');
if (!bookArg && !flag('all') && !dryRun) {
  console.error('Pass --book=<id>, --all or --dry-run.');
  process.exit(1);
}

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';
if (!mongoUri) throw new Error('MONGODB_URI/MONGO_URI/DATABASE_URL is not configured.');
await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

async function qaBook(book) {
  const tree = await loadCurriculumTreeForBook(book);
  const results = [];
  for (const topic of tree.topics) {
    for (const sub of topic.subtopics) {
      const scope = {
        bookId: String(book._id),
        board: book.board,
        className: book.class,
        subjectName: book.subject,
        productCategory: book.productCategory || '',
        topicName: topic.topicName,
        subtopicName: sub.name,
      };
      const route = await resolveCurriculumRetrievalRoute(scope);
      if (route.mode !== 'strict') {
        results.push({ topic: topic.topicName, subtopic: sub.name, mode: route.mode, status: route.status || route.reason, chunks: 0 });
        continue;
      }
      const chunks = await searchRelevantChunks({
        query: buildBookRetrievalQuery(scope),
        bookId: scope.bookId,
        topK: 20,
        ...route.filter,
      });
      const mismatches = findScopeMismatches(chunks, route.invariant);
      results.push({
        topic: topic.topicName,
        subtopic: sub.name,
        mode: 'strict',
        chunks: chunks.length,
        mismatches: mismatches.length,
        status: mismatches.length ? 'RAG_SCOPE_MISMATCH' : chunks.length ? 'ok' : 'RAG_SCOPE_EMPTY',
      });
    }
  }
  return {
    subtopics: results.length,
    withContent: results.filter((r) => r.status === 'ok').length,
    empty: results.filter((r) => r.status === 'RAG_SCOPE_EMPTY').length,
    mismatches: results.filter((r) => r.status === 'RAG_SCOPE_MISMATCH').length,
    passed: results.every((r) => r.status !== 'RAG_SCOPE_MISMATCH'),
    results,
  };
}

const report = [];
try {
  const filter = bookArg ? { _id: bookArg } : { processingStatus: 'indexed' };
  let query = Book.find(filter).select('title board class subject productCategory processingStatus curriculumMapping chunkCount').sort({ updatedAt: -1 });
  if (limit) query = query.limit(limit);
  const books = await query.lean();
  console.log(`${books.length} book(s) selected.`);

  for (const book of books) {
    const entry = { bookId: String(book._id), title: book.title, before: book.curriculumMapping?.status || 'not_mapped' };
    if (dryRun) {
      report.push(entry);
      console.log(`- ${book.title}: ${entry.before} (${book.chunkCount} chunks)`);
      continue;
    }
    try {
      if (!qaOnly) {
        console.log(`Remapping "${book.title}"…`);
        const indexed = await indexBook(book._id);
        entry.chunkCount = indexed.chunkCount;
      }
      const fresh = await Book.findById(book._id).select('title board class subject productCategory curriculumMapping').lean();
      entry.mapping = fresh.curriculumMapping;
      entry.qa = await qaBook(fresh);
      console.log(
        `  mapping=${fresh.curriculumMapping?.status} coverage=${fresh.curriculumMapping?.coverage} ` +
        `subtopics ${entry.qa.withContent}/${entry.qa.subtopics} with content, ` +
        `${entry.qa.empty} empty, ${entry.qa.mismatches} mismatches`,
      );
    } catch (error) {
      entry.error = String(error?.message || error);
      console.error(`  failed: ${entry.error}`);
    }
    report.push(entry);
  }
  if (reportPath) {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report written to ${reportPath}`);
  }
} finally {
  await mongoose.disconnect();
}
