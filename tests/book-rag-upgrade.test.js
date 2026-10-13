import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cosineSimilarity,
  retrievalTier,
  selectDiverseBookChunks,
} from '../ai/rag/books/book-rag-ranking.js';
import {
  chunkChapterText,
  extractDocxParagraphsFromXml,
} from '../ai/rag/books/book-ingestion-service.js';
import { parseMultimodalBookAssets } from '../ai/rag/books/book-multimodal-service.js';
import { buildBookContextForVariant, metadataMatchBonus } from '../ai/rag/books/book-rag-service.js';

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

