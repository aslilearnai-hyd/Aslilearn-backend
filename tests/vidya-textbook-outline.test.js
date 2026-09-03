import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTextbookOutline, textbookOutlineReply } from '../services/vidya-textbook-outline.js';
import { retrieveVidyaTextbookContext } from '../services/vidya-textbook-context.js';
const book = { _id: 'book', title: 'Ganitha Prakash', extractedText: 'Contents\n5.1 Introduction 70\n5.2 Number Patterns 73\nOther text\n5.1 Introduction\n5.2 Number Patterns\n6.1 Other chapter\n', chapters: [] };
test('full extracted text yields unique numbered sections, not chunk counts', () => {
  const outline = readTextbookOutline(book, 5);
  assert.equal(outline.sections.length, 2);
  assert.equal(outline.sections[0].title, 'Introduction');
  assert.match(textbookOutlineReply(outline), /2 numbered sections/);
  assert.doesNotMatch(textbookOutlineReply(outline), /Other chapter/);
});
test('missing extraction is never treated as zero lessons', () => {
  assert.equal(readTextbookOutline({ extractedText: '' }, 5), null);
  assert.equal(textbookOutlineReply(readTextbookOutline({ extractedText: 'An equation 5.2 = 2.6 times 2' }, 5)), '');
});
test('count questions read the extraction without querying six chunks', async () => {
  const chain = { select: () => chain, lean: async () => [book] };
  const result = await retrieveVidyaTextbookContext({ question: 'chapter 5 how many lessons', curriculum: { bookIds: ['book'], scopes: [{ board: 'CBSE', classNumber: '7', subject: 'mathematics', track: '' }] }, Books: { find: filter => { assert.deepEqual(filter._id.$in, ['book']); return chain; } }, Chunks: { find: () => { throw new Error('must not count chunks'); } } });
  assert.match(result.directAnswer, /2 numbered sections/);
});
test('readable chapter body is supplied when numbered outline cannot be parsed', () => {
  const text = 'Introduction\nPatterns and Examples\nChapter body.';
  const outline = readTextbookOutline({ title: 'Book', extractedText: text, chapters: [{ title: 'Chapter 5', startOffset: 0, endOffset: text.length }] }, 5);
  assert.equal(outline.chapterText, text);
});
