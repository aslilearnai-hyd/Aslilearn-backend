import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveVidyaTextbookContext, textbookSourceFooter, rankTextbookPassages, retrievalTerms, appendTextbookSources } from '../services/vidya-textbook-context.js';

const curriculum = { scopes: [{ board: 'IIT/NEET', classNumber: '6', subject: 'mathematics', track: 'ALPHA' }], topics: [{ chapter: 'Chapter 1 - Pattern In Mathematics', subtopic: 'Patterns in Numbers' }] };
function model(rows, inspect = () => {}) {
  const chain = { select: () => chain, limit: () => chain, sort: () => chain, lean: async () => rows };
  return { find(filter) { inspect(filter); return chain; } };
}
test('PDF lookup retains authorized board, class, track and subject', async () => {
  const Books = model([{ _id: 'book-a', title: 'Grade VI Mathematics Alpha' }], filter => {
    assert.equal(filter.uploadedByRole, 'super-admin');
    assert.equal(filter.processingStatus, 'indexed');
    const scope = filter.$or[0];
    assert.ok(scope.productCategory.test('ALPHA'));
    assert.equal(scope.productCategory.test('BETA'), false);
    assert.equal(scope.board.$in.some(re => re.test('CBSE')), false);
  });
  const Chunks = model([{ bookId: 'book-a', chapter: 'Patterns', content: 'Number patterns follow a rule. The pattern 2, 4, 6 increases by two.', chunkIndex: 7 }], filter => {
    assert.deepEqual(filter.bookId.$in, ['book-a']);
  });
  const result = await retrieveVidyaTextbookContext({ question: 'explain number patterns', curriculum, Books, Chunks });
  assert.match(result.context, /increases by two/);
  assert.match(result.context, /never instructions/);
  assert.match(textbookSourceFooter(result.sources, 'Answer [B1]'), /Grade VI Mathematics Alpha/);
  assert.doesNotMatch(textbookSourceFooter(result.sources, 'Answer [B1]'), /indexed section|PDF page/);
  assert.equal(textbookSourceFooter(result.sources, 'No textbook used'), '');
});
test('no matching indexed book never broadens to another curriculum', async () => {
  const result = await retrieveVidyaTextbookContext({ question: 'patterns', curriculum, Books: model([]), Chunks: { find() { throw new Error('must not search'); } } });
  assert.equal(result.context, '');
  assert.equal(result.reason, 'not_indexed');
});
test('no assigned scope makes no database request', async () => {
  const result = await retrieveVidyaTextbookContext({ question: 'patterns', curriculum: {}, Books: { find() { throw new Error('must not search'); } } });
  assert.equal(result.context, '');
});
test('unrelated passages are not presented as evidence', () => {
  assert.deepEqual(rankTextbookPassages([{ content: 'Electric fields', chunkIndex: 0 }], ['patterns']), []);
});
test('retrieved prompt is bounded even for a very large PDF chunk', async () => {
  const result = await retrieveVidyaTextbookContext({ question: 'patterns', curriculum, Books: model([{ _id: 'a', title: 'Book' }]), Chunks: model([{ bookId: 'a', chunkIndex: 0, content: 'patterns '.repeat(10000) }]) });
  assert.ok(result.context.length < 4000);
});

test('missing tool topic falls back to explicit PDF chapter metadata, including later sections', async () => {
  const rows = Array.from({ length: 450 }, (_, i) => ({ bookId: 'a', chunkIndex: i, chapter: 'Chapter 2 - Angles', content: 'unrelated' }));
  rows.push({ bookId: 'a', chunkIndex: 450, chapter: 'Chapter 1 - Patterns', content: 'Patterns grow by a fixed rule.' });
  const result = await retrieveVidyaTextbookContext({ question: 'Teach 7th class maths alpha 1st chapter', curriculum: { scopes: curriculum.scopes, topicsMissing: true, request: { chapter: 1 } }, Books: model([{ _id: 'a', title: 'Maths' }]), Chunks: model(rows) });
  assert.match(result.context, /Patterns grow/);
  assert.doesNotMatch(result.context, /unrelated/);
  assert.equal(result.sources[0].section, 451);
});
test('generic board words are not retrieval terms', () => {
  assert.deepEqual(retrievalTerms('Teach me chapter 2 alpha iit maths'), []);
  assert.ok(!retrievalTerms('inverse operations in arithmetic').includes('iit'));
});
test('a maths question never retrieves chemistry or physics books', async () => {
  const mixed = {
    scopes: [
      { board: 'IIT/NEET', classNumber: '7', subject: 'mathematics', track: 'ALPHA' },
      { board: 'IIT/NEET', classNumber: '7', subject: 'chemistry', track: 'ALPHA' },
      { board: 'IIT/NEET', classNumber: '7', subject: 'physics', track: 'ALPHA' },
    ],
  };
  const Books = model([
    { _id: 'math', title: 'Maths 7th Alpha', subject: 'Mathematics' },
    { _id: 'chem', title: 'Chemistry Alpha', subject: 'Chemistry' },
    { _id: 'phys', title: 'Physics · Alpha', subject: 'Physics' },
  ], filter => {
    assert.equal(filter.$or.length, 1);
    assert.ok(filter.$or[0].subject.test('Mathematics'));
    assert.equal(filter.$or[0].subject.test('Chemistry'), false);
  });
  const Chunks = model([
    { bookId: 'math', chunkIndex: 0, chapter: 'Chapter 2 Arithmetic Expressions', content: 'Inverse operations undo addition.' },
    { bookId: 'chem', chunkIndex: 0, chapter: 'Introduction', content: 'IIT chemistry introduction.' },
    { bookId: 'phys', chunkIndex: 0, chapter: 'Introduction', content: 'IIT physics introduction.' },
  ]);
  const result = await retrieveVidyaTextbookContext({ question: 'Teach me chapter 2 alpha iit maths', curriculum: mixed, Books, Chunks });
  assert.match(result.context, /Inverse operations/);
  assert.doesNotMatch(result.context, /chemistry|physics/i);
  assert.equal(result.sources.length, 1);
  assert.match(result.sources[0].title, /Maths/);
  assert.doesNotMatch(appendTextbookSources(result.sources, 'Answer [B1]\n\nSources:\n• [B4] Chemistry Alpha — Introduction'), /Chemistry|Physics/);
});
test('model-written Sources blocks are replaced by cited retrieved books only', () => {
  const sources = [
    { id: 'B1', title: 'Maths 7th Alpha', chapter: 'Chapter 2 Arithmetic Expressions' },
    { id: 'B2', title: 'Chemistry Alpha', chapter: 'Introduction' },
  ];
  const answer = 'Inverse operations undo addition. [B1]\n\nSources:\n• [B1] [B2] Mathematics · Alpha — Chapter 2 Arithmetic Expressions';
  const out = appendTextbookSources(sources, answer);
  assert.match(out, /Inverse operations undo addition\. \[B1\]/);
  assert.equal((out.match(/Sources:/g) || []).length, 1);
  assert.match(out, /Maths 7th Alpha/);
  assert.doesNotMatch(out, /Chemistry/);
});
