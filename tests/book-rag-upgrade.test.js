import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cosineSimilarity,
  retrievalTier,
  selectDiverseBookChunks,
} from '../ai/rag/books/book-rag-ranking.js';
import {
  bookExtractionCorruptionStats,
  chunkChapterText,
  extractDocxParagraphsFromXml,
  saveContentLinkedBook,
  splitIntoChapters,
} from '../ai/rag/books/book-ingestion-service.js';

test('re-importing linked content replaces stale book metadata and file', async () => {
  let saves = 0;
  const existingBook = {
    _id: 'book-1',
    title: 'Old title',
    fileUrl: '/uploads/content/old.pdf',
    processingStatus: 'ready',
    async save() {
      saves += 1;
    },
  };

  const result = await saveContentLinkedBook({
    existingBook,
    sharedFields: {
      title: 'New title',
      fileUrl: '/uploads/content/new.pdf',
      processingStatus: 'pending',
      extractedText: '',
      chapters: [],
    },
  });

  assert.equal(result.alreadyImported, true);
  assert.equal(result.book, existingBook);
  assert.equal(existingBook.title, 'New title');
  assert.equal(existingBook.fileUrl, '/uploads/content/new.pdf');
  assert.equal(existingBook.processingStatus, 'pending');
  assert.equal(saves, 1);
});

test('book extraction flags replacement-glyph corruption without rejecting clean maths', () => {
  assert.equal(bookExtractionCorruptionStats('x² + y² = z² and √144 = 12').needsOcr, false);
  const damaged = `Quadratic formula ${'□'.repeat(12)} ${'ordinary textbook text '.repeat(20)}`;
  const stats = bookExtractionCorruptionStats(damaged);
  assert.equal(stats.needsOcr, true);
  assert.equal(stats.junkCount, 12);
});
import { parseMultimodalBookAssets } from '../ai/rag/books/book-multimodal-service.js';
import {
  buildBookContextForVariant,
  canUseWeakSelectedBookChunks,
  metadataMatchBonus,
  searchSelectedBookWithLegacyMetadataFallback,
} from '../ai/rag/books/book-rag-service.js';

test('true cosine similarity handles non-normalized vectors', () => {
  assert.equal(cosineSimilarity([2, 0], [7, 0]), 1);
  assert.equal(cosineSimilarity([2, 0], [0, 4]), 0);
  assert.equal(retrievalTier(0.1), 'weak');
});

test('MMR selection avoids near-identical chunks', () => {
  const chunks = [
    { _id: 'a', score: 0.9, embedding: [1, 0], chapter: 'One' },
    { _id: 'b', score: 0.89, embedding: [0.999, 0.001], chapter: 'One' },
    { _id: 'c', score: 0.75, embedding: [0, 1], chapter: 'Two' },
  ];
  const selected = selectDiverseBookChunks(chunks, 2, { lambda: 0.6, coveragePenalty: 0.1 });
  assert.deepEqual(selected.map((row) => row._id), ['a', 'c']);
});

test('authoritative corpus sources receive a bounded reranking preference', () => {
  const textbook = metadataMatchBonus({ sourcePriority: 10 }, {});
  const questionBank = metadataMatchBonus({ sourcePriority: 80 }, {});
  assert.ok(textbook > questionBank);
  assert.ok(textbook <= 0.06);
});

test('selected books retry legacy chunks without broadening to other books', async () => {
  const calls = [];
  const result = await searchSelectedBookWithLegacyMetadataFallback({
    bookId: 'selected-book',
    strictScope: { board: 'IIT', class: 'Class 8', subject: 'Mathematics' },
    search: async (scope) => {
      calls.push(scope);
      return calls.length === 1 ? [] : [{ _id: 'legacy-chunk', bookId: 'selected-book' }];
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {});
  assert.equal(result.usedLegacyMetadataFallback, true);
  assert.equal(result.chunks[0].bookId, 'selected-book');
});

test('corpus-wide retrieval never retries without curriculum metadata', async () => {
  let calls = 0;
  const result = await searchSelectedBookWithLegacyMetadataFallback({
    bookId: '',
    strictScope: { board: 'IIT', class: 'Class 8', subject: 'Mathematics' },
    search: async () => {
      calls += 1;
      return [];
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.usedLegacyMetadataFallback, false);
});

test('weak passages may fall back only inside an explicitly selected book', () => {
  const passages = [{ content: 'A'.repeat(120) }];
  assert.equal(canUseWeakSelectedBookChunks({ bookId: 'selected-book' }, passages), true);
  assert.equal(canUseWeakSelectedBookChunks({}, passages), false);
  assert.equal(
    canUseWeakSelectedBookChunks({ bookId: 'selected-book' }, [{ content: 'too short' }]),
    false,
  );
});

test('DOCX extraction preserves paragraph boundaries', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Chapter 1</w:t></w:r></w:p><w:p><w:r><w:t>Atoms &amp; Molecules</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(extractDocxParagraphsFromXml(xml), 'Chapter 1\nAtoms & Molecules');
});

test('book chunks use max-window overlap rather than min-window stride', () => {
  const text = Array.from({ length: 2100 }, (_, index) => `w${index}`).join(' ');
  const chunks = chunkChapterText(text, { title: 'Test' });
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].content.split(' ')[0], 'w0');
  assert.equal(chunks[1].content.split(' ')[0], 'w920');
});

test('chapter detection does not turn numbered maths questions into chapters', () => {
  const words = (label, count) => Array.from({ length: count }, (_, index) => `${label}${index}`).join(' ');
  const text = [
    '1 Surds and Radical Expressions',
    words('surds', 240),
    '1. Find the zeroes of x² + 5x + 6',
    words('exercise', 240),
    '2 Polynomials',
    words('polynomial', 240),
  ].join('\n');
  const chapters = splitIntoChapters(text);
  assert.deepEqual(chapters.map((chapter) => chapter.title), [
    '1 Surds and Radical Expressions',
    '2 Polynomials',
  ]);
  assert.ok(chapters[0].text.includes('Find the zeroes'));
});

test('chapter detection ignores contents rows and decimal sub-sections', () => {
  const words = Array.from({ length: 220 }, (_, index) => `word${index}`).join(' ');
  const text = [
    'Chapter 1: Number Systems',
    words,
    '1.1 Basic Concepts',
    words,
    '2.4 Practice Set 112',
    words,
    'Chapter 2: Algebra',
    words,
  ].join('\n');
  assert.deepEqual(splitIntoChapters(text).map((chapter) => chapter.title), [
    'Chapter 1: Number Systems',
    'Chapter 2: Algebra',
  ]);
});

test('multimodal asset parser rejects unknown types and keeps canonical equations', () => {
  const rows = parseMultimodalBookAssets(JSON.stringify({
    assets: [
      {
        page: 4,
        type: 'equation',
        semanticText: 'friction equation',
        canonicalData: { latex: 'f = \\mu N' },
      },
      { page: 5, type: 'photo', semanticText: 'decorative' },
    ],
  }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].canonicalData.latex, 'f = \\mu N');
});

test('variant context preserves weak-context fail-closed behavior', () => {
  const result = buildBookContextForVariant(
    {
      hasBookPassages: false,
      retrievalStatus: 'weak_context',
      contextText: 'CURRICULUM ONLY',
      candidateChunks: [{ _id: 'weak-1', content: 'Weak passage', embedding: [1, 0], score: 0.1 }],
    },
    { board: 'CBSE', className: '10', subject: 'Science', topic: 'Light' },
    2,
  );
  assert.equal(result.contextText, 'CURRICULUM ONLY');
  assert.deepEqual(result.sourceChunkIds, []);
});

test('variant provenance IDs match the chunks included in its prompt', () => {
  const result = buildBookContextForVariant(
    {
      hasBookPassages: true,
      candidateChunks: [
        { _id: 'chunk-a', content: 'Force changes motion.', embedding: [1, 0], score: 0.9, chapter: 'Force' },
        { _id: 'chunk-b', content: 'Acceleration is change in velocity.', embedding: [0, 1], score: 0.8, chapter: 'Motion' },
      ],
      assets: [],
    },
    { board: 'CBSE', className: '9', subject: 'Physics', topic: 'Force and Motion' },
    2,
  );
  assert.deepEqual(new Set(result.sourceChunkIds), new Set(['chunk-a', 'chunk-b']));
  for (const id of result.sourceChunkIds) assert.match(result.contextText, new RegExp(`sourceChunkId=${id}`));
});

