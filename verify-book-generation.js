/**
 * Verify BOOK-BASED (RAG) generation end to end.
 *
 * The book generator is a SEPARATE orchestrator from the normal batch path. It
 * shares mapV2StructuredToLegacy and formatStructuredToolOutput (so the mapper
 * fixes reach it) but it does NOT run the completeness gate before saving —
 * so a broken record still persists there. This script generates through the
 * real book path and then gates the result, to show the difference.
 *
 * Writes records.
 *
 * Usage: node verify-book-generation.js --tool=lesson-planner --book=<id>
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import connectDB from './config/database.js';
import Book from './models/Book.js';
import AiToolGeneration from './models/AiToolGeneration.js';
import { generateBookBatchAndSave } from './services/book-generator-batch-orchestrator.js';
import { validateDashboardAiToolDoc } from './services/ai-tool-dashboard-validation.js';

const args = process.argv.slice(2);
const argVal = (n, d = '') => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const TOOLS = (argVal('tool', 'lesson-planner') || '').split(',').map((s) => s.trim()).filter(Boolean);
const BOOK_ID = argVal('book', '');

async function main() {
  await connectDB();

  const book = BOOK_ID
    ? await Book.findById(BOOK_ID).lean()
    : await Book.findOne({ processingStatus: 'indexed', embeddingsCreated: true }).lean();
  if (!book) throw new Error('No indexed book found.');

  console.log(
    `Book: ${book.title} (${book.board} / ${book.class} / ${book.subject}) — THIS WRITES RECORDS.\n`,
  );

  for (const tool of TOOLS) {
    const before = await AiToolGeneration.countDocuments({ toolName: tool });
    process.stdout.write(`  ${tool.padEnd(32)} `);
    let err = '';
    try {
      await generateBookBatchAndSave(
        {
          toolSlug: tool,
          bookId: String(book._id),
          board: book.board,
          className: book.class,
          subjectName: book.subject,
          topicName: book.topic || 'Chapter 1',
          subtopicName: book.subtopic || '',
          batchSize: 1,
        },
        { reqUser: { name: 'book-verify' } },
      );
    } catch (e) {
      err = String(e?.message || e).slice(0, 80);
    }

    const after = await AiToolGeneration.countDocuments({ toolName: tool });
    if (after <= before) {
      console.log(`NOT SAVED  ${err || '(no record produced)'}`);
      continue;
    }

    const row = await AiToolGeneration.findOne({ toolName: tool })
      .sort({ createdAt: -1 })
      .lean();
    const content = String(row.content || row.generatedContent || '');
    const gate = validateDashboardAiToolDoc(tool, {
      toolName: tool,
      content,
      generatedContent: content,
      metadata: row.metadata,
    });
    const rag = row.metadata?.ragChunkCount ?? '?';
    const usedBook = row.metadata?.bookTextUsed ? 'yes' : 'NO';
    console.log(
      `${(gate.valid ? 'PASS' : 'FAIL').padEnd(6)} ${String(content.length).padStart(6)} chars | ragChunks=${rag} bookTextUsed=${usedBook}` +
        (gate.valid ? '' : `\n      -> ${(gate.missingSections || []).join(' | ') || (gate.message || '').slice(0, 70)}`),
    );
  }

  await mongoose.connection.close();
}

main().catch(async (e) => {
  console.error('Book verification failed:', e?.message || e);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
