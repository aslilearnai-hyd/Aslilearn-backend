import { chapterNumberFromTopicLabel } from '../utils/ai-tool-topic-order.js';

export function isTextbookOutlineQuestion(question) {
  return /\b(how many|count|list|show|what are)\b/i.test(question) && /\b(lessons?|sections?|subtopics?|contents|topics)\b/i.test(question);
}

// Inspect the full stored extraction, not a top-k passage sample. The result
// describes numbered textbook sections; it never counts chunks as lessons.
export function readTextbookOutline(book, chapter) {
  const text = String(book.extractedText || '');
  if (!text || !Number.isInteger(chapter) || chapter < 1) return null;
  const boundaries = (book.chapters || []).filter(c =>
    chapterNumberFromTopicLabel(c.title || c.topic) === chapter &&
    Number.isInteger(c.startOffset) && Number.isInteger(c.endOffset) &&
    c.startOffset >= 0 && c.endOffset > c.startOffset && c.endOffset <= text.length);
  const boundary = boundaries.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset))[0];
  const chapterText = boundary ? text.slice(boundary.startOffset, boundary.endOffset) : '';
  const headings = new Map();
  const headingPattern = new RegExp(`^\\s*(${chapter}\\.\\d+)\\s+([\\p{L}][\\p{L}\\p{N} ,:'’()–—-]{2,120})\\s*$`, 'gmu');
  // Prefer the chapter body; when boundaries are absent scan the whole book,
  // which also includes its table of contents. Dedupe repeated running headings.
  for (const match of (chapterText || text).matchAll(headingPattern)) {
    const title = match[2].replace(/\s+\d+\s*$/, '').trim();
    if (!headings.has(match[1])) headings.set(match[1], title);
  }
  const sections = [...headings].sort(([a], [b]) => Number(a.split('.')[1]) - Number(b.split('.')[1])).map(([number, title]) => ({ number, title }));
  return { title: book.title, chapter, sections, chapterText, hasChapterBoundary: Boolean(boundary) };
}

export function textbookOutlineReply(outline) {
  if (!outline?.sections?.length) return '';
  const safe = text => String(text || '').replace(/[\r\n<>]/g, ' ').trim();
  return `In **${safe(outline.title)}, Chapter ${outline.chapter}**, I found **${outline.sections.length} numbered sections** in the stored textbook text:\n\n` +
    outline.sections.map(s => `• ${s.number} — ${safe(s.title)}`).join('\n') +
    '\n\nThese are textbook sections, not video lessons. Unnumbered headings are not included in this count.';
}
