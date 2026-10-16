/**
 * Book → AI Tools curriculum mapping.
 *
 * The AI Tools topic table (AiToolTopic) is the only allowed taxonomy. Book
 * headings are kept as provenance, but every chunk/asset is attached to an
 * existing AiToolTopic row (= subtopic) once at ingestion, so retrieval can
 * hard-filter by ID instead of guessing topics on every generation.
 *
 * Evidence order (cheapest and most reliable first):
 *   number_exact → title_exact → lexical → embedding → gemini → (manual review)
 *
 * Everything here is pure or takes injected `embed` / `classify` functions so it
 * can be unit tested without Mongo or Gemini.
 */
import crypto from 'crypto';
import { canonicalTopicKey, chapterNumberFromTopicLabel } from '../../shared/ai-tool-topic-order.js';

export const CURRICULUM_MAPPING_VERSION = 1;

export const MAPPING_STATUS = Object.freeze({
  AUTO: 'auto_mapped',
  REVIEWED: 'reviewed',
  NEEDS_REVIEW: 'needs_review',
  UNMAPPED: 'unmapped',
  REJECTED: 'rejected',
});

/** Chunks with these statuses may be served by ID-filtered retrieval. */
export const RETRIEVABLE_MAPPING_STATUSES = [MAPPING_STATUS.AUTO, MAPPING_STATUS.REVIEWED];

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function mappingThresholds() {
  return {
    auto: envNumber('BOOK_MAPPING_AUTO_CONFIDENCE', 0.9),
    review: envNumber('BOOK_MAPPING_REVIEW_CONFIDENCE', 0.75),
    // Two candidates closer than this are ambiguous, whatever the method.
    margin: envNumber('BOOK_MAPPING_MIN_MARGIN', 0.05),
    embeddingHigh: envNumber('BOOK_MAPPING_EMBEDDING_HIGH', 0.8),
    embeddingMid: envNumber('BOOK_MAPPING_EMBEDDING_MID', 0.65),
  };
}

/* ------------------------------------------------------------------ */
/* Curriculum tree                                                     */
/* ------------------------------------------------------------------ */

const NUMBER_PREFIX_RE = /^\s*(\d{1,2}(?:\.\d{1,2}){0,2})(?=[\s.):\-–—]|$)/;

function leadingSectionNumber(value = '') {
  const match = String(value || '').match(NUMBER_PREFIX_RE);
  return match ? match[1].replace(/\.$/, '') : '';
}

export function deriveTopicNumber(row = {}) {
  const explicit = String(row.topicNumber || '').trim();
  if (explicit) return explicit;
  const fromLabel = chapterNumberFromTopicLabel(row.label);
  if (fromLabel != null) return String(fromLabel);
  const fromName = chapterNumberFromTopicLabel(row.topicName);
  return fromName != null ? String(fromName) : '';
}

export function deriveSubtopicNumber(row = {}, topicNumber = '') {
  const explicit = String(row.subtopicNumber || '').trim();
  if (explicit) return explicit;
  const prefix = leadingSectionNumber(row.subTopic);
  if (prefix.includes('.')) return prefix;
  // "2 Evaporation" under chapter 3 → "3.2" only when the chapter is known.
  if (prefix && topicNumber) return `${topicNumber}.${prefix}`;
  return '';
}

/** Stable topic key: AiToolTopic has one row per subtopic and no topic document. */
export function buildAiTopicKey({ board, productCategory, classLabel, subject, topicName }) {
  return [board, productCategory || '', classLabel, subject, canonicalTopicKey(topicName)]
    .map((part) => String(part || '').trim().toLowerCase())
    .join('|');
}

/**
 * Group flat AiToolTopic rows into topics → subtopics, keeping admin order.
 * @returns {{ topics: Array, subtopicById: Map, topicByKey: Map }}
 */
export function buildCurriculumTree(rows = []) {
  const sorted = [...rows].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
      String(a.topicName || '').localeCompare(String(b.topicName || ''), 'en', { numeric: true }),
  );
  const topicByKey = new Map();
  const subtopicById = new Map();
  for (const row of sorted) {
    const topicKey = buildAiTopicKey(row);
    let topic = topicByKey.get(topicKey);
    if (!topic) {
      topic = {
        topicKey,
        topicName: String(row.topicName || '').trim(),
        topicNumber: deriveTopicNumber(row),
        subtopics: [],
      };
      topicByKey.set(topicKey, topic);
    }
    if (!topic.topicNumber) topic.topicNumber = deriveTopicNumber(row);
    const subtopic = {
      id: String(row._id),
      name: String(row.subTopic || '').trim(),
      number: deriveSubtopicNumber(row, topic.topicNumber),
      topicKey,
      topicName: topic.topicName,
    };
    topic.subtopics.push(subtopic);
    subtopicById.set(subtopic.id, subtopic);
  }
  return { topics: [...topicByKey.values()], subtopicById, topicByKey };
}

/* ------------------------------------------------------------------ */
/* Page split + boilerplate cleanup                                    */
/* ------------------------------------------------------------------ */

const PAGE_MARKER_RE = /\n?-- (\d+) of (\d+) --\n?/g;

/** pdf-parse appends "-- N of M --" after each page; recover per-page text. */
export function splitPdfPages(text = '') {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const pages = [];
  let last = 0;
  for (const match of source.matchAll(PAGE_MARKER_RE)) {
    pages.push({ page: Number(match[1]), text: source.slice(last, match.index) });
    last = match.index + match[0].length;
  }
  const tail = source.slice(last);
  if (tail.trim() || !pages.length) pages.push({ page: pages.length ? pages[pages.length - 1].page + 1 : null, text: tail });
  return pages;
}

function boilerplateKey(line = '') {
  return String(line || '')
    .trim()
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ');
}

const EDGE_LINES = 3;

/**
 * Remove running headers/footers, bare page numbers and QR/branding prompts.
 * A line is boilerplate when it sits in the top/bottom few lines of many pages.
 */
export function removeRepeatedPageBoilerplate(pages = []) {
  const counts = new Map();
  const edgeLines = (lines) => {
    const nonEmpty = lines.map((l, i) => ({ l, i })).filter((x) => x.l.trim());
    // Short pages: only the outermost line can be a header/footer, so body
    // text is never treated as boilerplate.
    const n = Math.min(EDGE_LINES, Math.floor(nonEmpty.length / 3));
    if (!n) return [];
    return [...nonEmpty.slice(0, n), ...nonEmpty.slice(-n)];
  };
  const pageLines = pages.map((p) => String(p.text || '').split('\n'));
  for (const lines of pageLines) {
    const seen = new Set();
    for (const { l } of edgeLines(lines)) {
      const key = boilerplateKey(l);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  // Book-wide headers repeat on ~every page; per-chapter running headers
  // ("Chapter 4 ⇥ Atoms and Molecules") only on that chapter's pages, so a
  // short line seen at page edges 4+ times is also treated as a header.
  const minRepeats = Math.max(3, Math.ceil(pages.length * 0.3));
  const minShortRepeats = Math.max(3, Math.min(4, minRepeats));
  const junkLineRe = /^(?:page\s*)?#(?:\s*(?:of|\/)\s*#)?$|scan\s+(?:the\s+)?qr|^qr\s*code/i;
  let removedLines = 0;
  const cleaned = pages.map((page, index) => {
    const lines = pageLines[index];
    const edgeIdx = new Set(edgeLines(lines).map((x) => x.i));
    const kept = lines.filter((line, i) => {
      const key = boilerplateKey(line);
      if (!key) return true;
      const isEdge = edgeIdx.has(i);
      const repeats = counts.get(key) || 0;
      const shortHeader = key.length <= 80 && !DECIMAL_HEADING_RE.test(String(line).trim());
      const drop = isEdge && (repeats >= minRepeats || (shortHeader && repeats >= minShortRepeats) || junkLineRe.test(key));
      if (drop) removedLines += 1;
      return !drop;
    });
    return { ...page, text: kept.join('\n') };
  });
  return { pages: cleaned, removedLines };
}

/** Join cleaned pages into one text with page offset ranges. */
export function joinPages(pages = []) {
  let text = '';
  const ranges = [];
  for (const page of pages) {
    const body = String(page.text || '').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) continue;
    if (text) text += '\n';
    const start = text.length;
    text += body;
    ranges.push({ page: page.page, start, end: text.length });
  }
  return { text, ranges };
}

function pageAt(ranges = [], offset = 0) {
  if (!ranges.length) return null;
  let found = ranges[0].page;
  for (const range of ranges) {
    if (range.start <= offset) found = range.page;
    else break;
  }
  return found ?? null;
}

/* ------------------------------------------------------------------ */
/* Section detection (book-native structure)                           */
/* ------------------------------------------------------------------ */

const CHAPTER_HEADING_RE = /^(?:chapter|unit|lesson)\s+(\d{1,2}|[IVXLC]{1,6})\b[\s.:)\-–—]*(.{0,120})$/i;
const DECIMAL_HEADING_RE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?\.?\s+(.{2,110})$/;
const QUESTION_LEAD_RE = /^(?:if|find|solve|show|prove|evaluate|calculate|simplify|determine|write|choose|which|what|why|how|given|let|state|verify|draw|construct|classify|identify)\b/i;

function romanToNumber(value = '') {
  const map = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  const chars = String(value).toLowerCase().split('');
  let total = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const cur = map[chars[i]] || 0;
    const next = map[chars[i + 1]] || 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

/** Table-of-contents rows: dot leaders or a trailing page number. */
export function isTocLine(line = '') {
  const s = String(line || '').trim();
  return /\.{3,}|…{2,}/.test(s) || /\s\d{1,4}$/.test(s);
}

function isTitleCase(title = '') {
  const words = String(title).split(/\s+/).filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 4);
  if (!words.length) return false;
  const capped = words.filter((w) => /^[A-Z“"'(]/.test(w)).length;
  return capped / words.length >= 0.6;
}

function isProseTitle(title = '') {
  const t = String(title || '').trim();
  if (t.length < 2) return false;
  // "1.2 What Governs the State of Matter?" is a heading; "1.2 Find the value
  // of x" is an exercise. Question-like leads must be short and Title Case.
  if (QUESTION_LEAD_RE.test(t) && !(isTitleCase(t) && t.split(/\s+/).length <= 10)) return false;
  if (/[=<>+*/{}[\]^]/.test(t) || /\?.+/.test(t)) return false;
  return /^[A-Z(“"']/.test(t);
}

// Leading bullet/arrow glyphs used by IIT foundation books ("▶1.2 Surds…").
const HEADING_GLYPH_RE = /^[▶►▸▹➤➢➔→»•●○■□▪▫◆◇★☆✦✧❖◼◾◽❯❱|]+\s*/u;
// End-of-chapter practice blocks. They belong to the chapter, never to the
// last numbered subtopic before them.
const EXERCISE_HEADING_RE = new RegExp(
  '^(?:' + [
    '(?:very short|short|long|single correct|multi(?:ple)? correct|integer|paragraph|matching|matrix match|' +
      'assertion\\s*(?:\\(a\\))?\\s*(?:and|&|[-–—])\\s*reason(?:\\s*\\(r\\))?|subjective|objective|numerical|comprehension|case[- ]based|' +
      'fill in the blanks|true or false|match the following)(?:\\s+answers?)?(?:\\s+type)?(?:\\s+questions?)?',
    'non[- ]routine questions?',
    'mind maps?',
    'exercises?(?:\\s*[-–:]?\\s*[0-9IVX.]+)?',
    'worksheets?(?:\\s*[-–:]?\\s*[0-9IVX.]+)?',
    'practice (?:questions|problems|set)',
    "previous years?'? (?:questions|papers)",
    'olympiad corner',
    'level\\s*[-–]?\\s*(?:[0-9]+|i{1,3}|iv|v)',
  // Optional "– MCQ" / "(Objective)" suffix: "Single Correct Answer Type – MCQ".
  ].join('|') + ')(?:\\s*[-–—(]\\s*(?:mcqs?|msqs?|objective|subjective)\\)?)?\\s*[:.]?\\s*$',
  'i',
);
const SYNOPSIS_HEADING_RE = /^synopsis\s*[-–—:]?\s*\d*\s*$/i;

export function parseHeadingLine(line = '') {
  const trimmed = String(line || '').trim().replace(HEADING_GLYPH_RE, '').replace(/\s*:\s*$/, '').trim();
  if (!trimmed || trimmed.length > 140) return null;
  if (trimmed.length <= 70 && EXERCISE_HEADING_RE.test(trimmed)) {
    return { level: 2, kind: 'exercise', number: '', chapterNumber: '', title: trimmed };
  }
  if (SYNOPSIS_HEADING_RE.test(trimmed)) {
    return { level: 1, kind: 'synopsis', number: '', chapterNumber: '', title: trimmed };
  }
  const chapter = trimmed.match(CHAPTER_HEADING_RE);
  // "Chapter 3" ends in a digit but is a heading; "Chapter 3 Matter … 30" is a TOC row.
  const chapterTitle = chapter ? chapter[2].trim() : '';
  // Prose that merely mentions a chapter ("Chapter 2, 'Arithmetic…', considers…").
  const proseMention = /^[,;'‘’"“(]/.test(chapterTitle) || chapterTitle.split(/\s+/).length > 12;
  if (chapter && !proseMention && !(chapterTitle && isTocLine(trimmed)) && !/\.{3,}|…{2,}/.test(trimmed)) {
    const raw = chapter[1];
    const number = /^\d+$/.test(raw) ? Number(raw) : romanToNumber(raw);
    return { level: 1, number: String(number), chapterNumber: String(number), title: chapter[2].trim() };
  }
  if (isTocLine(trimmed)) return null;
  const decimal = trimmed.match(DECIMAL_HEADING_RE);
  if (decimal && isProseTitle(decimal[4])) {
    const number = [decimal[1], decimal[2], decimal[3]].filter(Boolean).join('.');
    return { level: decimal[3] ? 3 : 2, number, chapterNumber: decimal[1], title: decimal[4].trim() };
  }
  return null;
}

function countWords(text = '') {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

export function buildSectionKey(section = {}) {
  return crypto
    .createHash('sha1')
    .update([section.level, section.number, section.title, section.startOffset].join('|'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Split cleaned book text into chapter (level 1) and numbered sub-sections
 * (level 2/3). Text before the first chapter heading becomes a level-0
 * "Front matter" section which is never mapped.
 */
export function detectBookSections(text = '', ranges = []) {
  const source = String(text || '');
  const lines = source.split('\n');
  const sections = [];
  let chapter = { number: '', title: '' };
  let previousChapter = chapter;
  let current = { level: 0, number: '', title: 'Front matter', chapterNumber: '', chapterTitle: '', startOffset: 0, lines: [] };
  let offset = 0;
  let pendingChapterTitle = false;

  const close = (endOffset) => {
    const body = current.lines.join('\n').trim();
    if (body || current.level > 0) {
      sections.push({
        level: current.level,
        kind: current.kind || '',
        number: current.number,
        title: current.title,
        chapterNumber: current.chapterNumber,
        chapterTitle: current.chapterTitle,
        startOffset: current.startOffset,
        endOffset,
        pageStart: pageAt(ranges, current.startOffset),
        pageEnd: pageAt(ranges, Math.max(current.startOffset, endOffset - 1)),
        text: body,
        wordCount: countWords(body),
      });
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    // Printed scratch boxes ("Rough Work") appear mid-page and carry no content.
    if (/^rough work$/i.test(trimmed)) {
      offset += line.length + 1;
      continue;
    }
    if (pendingChapterTitle && trimmed) {
      pendingChapterTitle = false;
      if (isTocLine(trimmed)) {
        // "Chapter 1" + "Large Numbers Around Us ⇥ 1" is a contents entry, not
        // the chapter itself: keep it as unmapped front matter.
        current.level = 0;
        current.title = 'Table of contents';
        chapter = previousChapter;
      } else if (!parseHeadingLine(trimmed) && trimmed.length <= 100) {
        current.title = trimmed;
        current.chapterTitle = trimmed;
        chapter.title = trimmed;
        offset += line.length + 1;
        continue;
      }
    }
    const heading = parseHeadingLine(trimmed);
    if (heading?.kind) {
      // Exercise / synopsis blocks only mean something inside a chapter;
      // consecutive exercise headings ("Integer Type", "Matching Type") are one block.
      if (!chapter.number || (heading.kind === 'exercise' && current.kind === 'exercise')) {
        current.lines.push(line);
      } else {
        close(offset);
        current = {
          level: heading.level, kind: heading.kind, number: '', title: heading.title,
          chapterNumber: chapter.number, chapterTitle: chapter.title, startOffset: offset, lines: [line],
        };
      }
      offset += line.length + 1;
      continue;
    }
    if (heading && heading.level === 1 && chapter.number && heading.chapterNumber === chapter.number && current.level > 0) {
      // Running header of the chapter we are already in — not a new section.
      offset += line.length + 1;
      continue;
    }
    if (heading && heading.level > 1 && chapter.number && Number(heading.chapterNumber) > Number(chapter.number)) {
      // "4.1 …" after chapter 3 with no detectable "Chapter 4" line (it was a
      // stripped running header): the next chapter has started.
      previousChapter = chapter;
      chapter = { number: heading.chapterNumber, title: '' };
    }
    const decimalOutsideChapter = heading && heading.level > 1 && chapter.number && heading.chapterNumber !== chapter.number;
    if (heading && heading.level === 1) {
      close(offset);
      previousChapter = chapter;
      chapter = { number: heading.chapterNumber, title: heading.title };
      current = {
        level: 1, number: heading.number, title: heading.title, chapterNumber: heading.chapterNumber,
        chapterTitle: heading.title, startOffset: offset, lines: [],
      };
      pendingChapterTitle = !heading.title;
    } else if (heading && !decimalOutsideChapter) {
      // A book without "Chapter N" headings still has chapter numbers in "3.2".
      if (!chapter.number) chapter = { number: heading.chapterNumber, title: '' };
      close(offset);
      current = {
        level: heading.level, number: heading.number, title: heading.title, chapterNumber: chapter.number,
        chapterTitle: chapter.title, startOffset: offset, lines: [],
      };
    } else {
      current.lines.push(line);
    }
    offset += line.length + 1;
  }
  close(offset);
  return sections.map((section) => ({ ...section, sectionKey: buildSectionKey(section) }));
}

/* ------------------------------------------------------------------ */
/* Lexical matching                                                    */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'with', 'by', 'its', 'their', 'our',
  'is', 'are', 'from', 'at', 'as', 'into', 'about', 'chapter', 'unit', 'lesson', 'part', 'section',
  'introduction', 'intro',
]);

function stem(token) {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function titleTokens(value = '') {
  return [...new Set(
    canonicalTopicKey(String(value || '').replace(NUMBER_PREFIX_RE, ''))
      .split(' ')
      .filter((t) => t && !STOPWORDS.has(t) && !/^\d+$/.test(t))
      .map(stem),
  )];
}

export function normalizedTitle(value = '') {
  return titleTokens(value).sort().join(' ');
}

/** 0..1 — Dice overlap, or containment when one title is a short subset of the other. */
export function lexicalSimilarity(a = '', b = '') {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  if (!shared) return 0;
  const dice = (2 * shared) / (ta.length + tb.length);
  const containment = shared / Math.min(ta.length, tb.length);
  return Math.max(dice, containment * 0.92);
}

/* ------------------------------------------------------------------ */
/* Candidate scoring                                                   */
/* ------------------------------------------------------------------ */

function pickBest(scored = []) {
  const ordered = [...scored].sort((a, b) => b.confidence - a.confidence);
  const [best, second] = ordered;
  return { best, second, ordered };
}

function applyMargin(result, second, margin) {
  if (!result || !second) return result;
  if (second.candidate.id === result.candidate.id) return result;
  if (result.confidence - second.confidence < margin) {
    // Ambiguous: never auto-accept, let the next evidence tier decide.
    return { ...result, confidence: Math.min(result.confidence, mappingThresholds().auto - 0.01), ambiguous: true };
  }
  return result;
}

/**
 * Deterministic matching of a heading against candidates.
 * candidates: [{ id, name, number }]
 */
export function deterministicMatch({ number = '', title = '' }, candidates = []) {
  const { margin } = mappingThresholds();
  if (!candidates.length) return null;
  const num = String(number || '').trim();
  if (num) {
    const byNumber = candidates.filter((c) => c.number && c.number === num);
    if (byNumber.length === 1) {
      const lex = title ? lexicalSimilarity(title, byNumber[0].name) : 1;
      // Number agrees; a title that clearly disagrees is a numbering mismatch
      // between book and DB, so drop to the review band.
      const confidence = !title || lex >= 0.3 ? 0.97 : 0.8;
      return { candidate: byNumber[0], confidence, method: 'number_exact', evidence: { number: num, lexical: lex } };
    }
  }
  const norm = normalizedTitle(title);
  if (norm) {
    const exact = candidates.filter((c) => normalizedTitle(c.name) === norm);
    if (exact.length === 1) {
      return { candidate: exact[0], confidence: 0.95, method: 'title_exact', evidence: { title } };
    }
  }
  if (!title) return null;
  const scored = candidates.map((candidate) => ({
    candidate,
    confidence: lexicalSimilarity(title, candidate.name),
    method: 'lexical',
  }));
  const { best, second } = pickBest(scored);
  if (!best || best.confidence <= 0) return null;
  return applyMargin({ ...best, evidence: { title, lexical: best.confidence } }, second, margin);
}

function embeddingConfidence(top, second) {
  const t = mappingThresholds();
  const gap = top - (second ?? 0);
  if (top >= t.embeddingHigh && gap >= t.margin) return 0.9;
  // A clear lead over every other candidate is strong evidence even below the
  // absolute bar (e.g. 0.795 vs 0.681 for a chapter described by its headings).
  if (top >= t.embeddingMid + 0.05 && gap >= envNumber('BOOK_MAPPING_EMBEDDING_LEAD', 0.08)) return 0.9;
  if (top >= t.embeddingMid) return 0.8;
  return Math.max(0, Math.min(0.7, top));
}

/** Cosine similarity; local copy keeps this module free of DB imports. */
export function cosine(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function createEmbeddingCache(embedFn) {
  const cache = new Map();
  return async (text) => {
    const key = String(text || '').slice(0, 2000);
    if (!key.trim() || typeof embedFn !== 'function') return [];
    if (!cache.has(key)) {
      cache.set(key, Promise.resolve(embedFn(key)).catch(() => []));
    }
    return cache.get(key);
  };
}

async function embeddingMatch(text, candidates, embed) {
  if (!embed || !String(text || '').trim() || !candidates.length) return null;
  const query = await embed(text);
  if (!query?.length) return null;
  const scored = [];
  for (const candidate of candidates) {
    const vector = await embed(candidate.embedText || candidate.name);
    scored.push({ candidate, similarity: cosine(query, vector) });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  const [best, second] = scored;
  if (!best) return null;
  return {
    candidate: best.candidate,
    confidence: embeddingConfidence(best.similarity, second?.similarity),
    method: 'embedding',
    evidence: { similarity: Number(best.similarity.toFixed(4)), runnerUp: second ? Number(second.similarity.toFixed(4)) : null },
    ranked: scored.map((s) => s.candidate),
  };
}

/** Prompt for the constrained Gemini classifier (allowed IDs only). */
export function buildMappingClassifierPrompt(sectionText = '', candidates = []) {
  const list = candidates.map((c) => `${c.id} — ${c.label || c.name}`).join('\n');
  return [
    'You map one textbook section to an EXISTING curriculum subtopic.',
    '',
    'BOOK SECTION:',
    `"${String(sectionText || '').slice(0, 1500)}"`,
    '',
    'ALLOWED SUBTOPICS:',
    list,
    '',
    'TASK:',
    'Return exactly one allowed subtopicId or NO_MATCH.',
    'Do not rename, merge or create topics.',
    'Return JSON only: {"subtopicId":"<id or NO_MATCH>","confidence":0.0,"reason":"short"}',
  ].join('\n');
}

export function parseMappingClassifierResponse(raw = '', candidates = []) {
  const text = String(raw || '').trim();
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || '';
  try {
    const parsed = JSON.parse(jsonText);
    const id = String(parsed.subtopicId || parsed.id || '').trim();
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    if (!id || id === 'NO_MATCH') return { noMatch: true, confidence, reason: String(parsed.reason || '') };
    const candidate = candidates.find((c) => c.id === id);
    // An ID outside the allowed list is treated as NO_MATCH, never trusted.
    if (!candidate) return { noMatch: true, invalidId: id, confidence: 0, reason: 'id not in allowed list' };
    return { candidate, confidence, reason: String(parsed.reason || '') };
  } catch {
    return { noMatch: true, confidence: 0, reason: 'unparseable classifier output' };
  }
}

function statusFor(confidence) {
  const t = mappingThresholds();
  if (confidence >= t.auto) return MAPPING_STATUS.AUTO;
  if (confidence >= t.review) return MAPPING_STATUS.NEEDS_REVIEW;
  return MAPPING_STATUS.UNMAPPED;
}

/**
 * Resolve one heading against a candidate list through all evidence tiers.
 * classify(prompt) → raw JSON string; budget.geminiCalls is decremented.
 */
async function resolveCandidate({ number, title, text, candidates, embed, classify, budget }) {
  const t = mappingThresholds();
  let result = deterministicMatch({ number, title }, candidates);
  if (result && result.confidence >= t.auto) return result;

  const sample = [title, String(text || '').split(/\s+/).slice(0, 120).join(' ')].filter(Boolean).join('\n');
  const emb = await embeddingMatch(sample, candidates, embed);
  if (emb && (!result || emb.confidence > result.confidence)) {
    // Embedding agreeing with a lexical guess strengthens it.
    if (result && emb.candidate.id === result.candidate.id) {
      return { ...result, confidence: Math.max(result.confidence, emb.confidence, t.auto), method: `${result.method}+embedding` };
    }
    result = emb;
  } else if (emb && result && emb.candidate.id === result.candidate.id && result.confidence >= t.review) {
    return { ...result, confidence: Math.max(result.confidence, t.auto), method: `${result.method}+embedding` };
  }
  if (result && result.confidence >= t.auto && !result.ambiguous) return result;

  // Only ambiguous sections reach Gemini, with a tiny allowed-ID list: either
  // the review band, or several plausible candidates tied on weak evidence.
  const plausible = result && (result.confidence >= t.review || (result.ambiguous && result.confidence >= 0.4));
  if (plausible && classify && budget && budget.geminiCalls > 0) {
    budget.geminiCalls -= 1;
    const shortlist = (emb?.ranked || candidates).slice(0, 4);
    if (!shortlist.some((c) => c.id === result.candidate.id)) shortlist.unshift(result.candidate);
    try {
      const raw = await classify(buildMappingClassifierPrompt(sample, shortlist));
      const parsed = parseMappingClassifierResponse(raw, shortlist);
      if (parsed.noMatch) {
        return { candidate: null, confidence: 0, method: 'gemini', evidence: { reason: parsed.reason, invalidId: parsed.invalidId } };
      }
      const confidence = Math.max(t.review, Math.min(0.95, parsed.confidence));
      return { candidate: parsed.candidate, confidence, method: 'gemini', evidence: { reason: parsed.reason } };
    } catch (error) {
      return { ...result, evidence: { ...(result.evidence || {}), classifierError: String(error?.message || error) } };
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Section → curriculum                                                */
/* ------------------------------------------------------------------ */

function emptyMapping(section, extra = {}) {
  return {
    ...section,
    aiTopicKey: '',
    aiTopicName: '',
    aiSubtopicId: '',
    aiSubtopicName: '',
    mappingStatus: MAPPING_STATUS.UNMAPPED,
    mappingConfidence: 0,
    mappingMethod: '',
    mappingEvidence: {},
    ...extra,
  };
}

/**
 * Per chapter (number|title): its numbered section headings and the start of
 * its text, used to identify chapters that have no title of their own.
 */
export function buildChapterEvidence(sections = []) {
  const byChapter = new Map();
  for (const section of sections) {
    if (!section.level || section.kind) continue;
    const key = `${section.chapterNumber}|${section.chapterTitle}`;
    const entry = byChapter.get(key) || { headings: [], text: [] };
    if (section.level >= 2 && section.title && entry.headings.length < 12) entry.headings.push(section.title);
    if (entry.text.join(' ').split(/\s+/).length < 150 && section.text) entry.text.push(section.text.split(/\s+/).slice(0, 80).join(' '));
    byChapter.set(key, entry);
  }
  return new Map([...byChapter.entries()].map(([key, e]) => [key, {
    headings: [...new Set(e.headings)].join('; '),
    text: e.text.join(' '),
  }]));
}

/**
 * Map detected sections onto the curriculum tree.
 *
 * - Level-1 chapters map to a topic (subtopic left empty → whole-chapter use).
 * - Level-2/3 headings map to a subtopic *inside* the chapter's topic.
 * - Level-3 headings inherit their level-2 parent unless confidently different
 *   (many-to-one: 3.2.1/3.2.2 → subtopic 3.2).
 * - overrides: Map(sectionKey → { aiSubtopicId } | { aiTopicKey } | { reject: true })
 */
export async function mapSectionsToCurriculum(sections = [], tree, options = {}) {
  const { embed: rawEmbed, classify, overrides = new Map() } = options;
  const embed = rawEmbed ? createEmbeddingCache(rawEmbed) : null;
  const budget = { geminiCalls: Math.max(0, Number(options.maxGeminiCalls ?? envNumber('BOOK_MAPPING_GEMINI_MAX_CALLS', 40))) };
  const t = mappingThresholds();
  const topicCandidates = tree.topics.map((topic) => ({
    id: topic.topicKey,
    name: topic.topicName,
    label: topic.topicName,
    number: topic.topicNumber,
    embedText: [topic.topicName, ...topic.subtopics.map((s) => s.name)].join('; '),
  }));

  const chapterMapping = new Map(); // chapterNumber|title → topic result
  const chapterEvidence = buildChapterEvidence(sections);
  const mapped = [];
  // Latest mapped level-2 section per book number ("4.1"), so "4.1.3" inherits
  // the book's own parent even after a chapter-opening topic list.
  const level2ByNumber = new Map();
  const rememberLevel2 = (entry) => {
    if (entry.level === 2 && entry.number && !entry.kind) level2ByNumber.set(`${entry.chapterNumber}|${entry.number}`, entry);
  };

  for (const section of sections) {
    const override = overrides.get(section.sectionKey);
    if (override) {
      mapped.push(applyOverride(section, override, tree));
      rememberLevel2(mapped[mapped.length - 1]);
      continue;
    }
    if (section.level === 0) {
      mapped.push(emptyMapping(section, { mappingMethod: 'front_matter' }));
      continue;
    }

    // 1) Topic for this section's chapter (memoised per chapter).
    const chapterKey = `${section.chapterNumber}|${section.chapterTitle}`;
    let topicResult = chapterMapping.get(chapterKey);
    if (!topicResult) {
      // Books without "Chapter N" title lines (only "1.1 …" headings) and
      // curricula whose topics carry no numbers give no number/title evidence;
      // describe the chapter by its own section headings and opening text.
      const evidence = chapterEvidence.get(chapterKey) || { headings: '', text: '' };
      topicResult = await resolveCandidate({
        number: section.chapterNumber,
        title: section.chapterTitle,
        text: [section.chapterTitle ? '' : evidence.headings, section.level === 1 ? section.text : evidence.text]
          .filter(Boolean)
          .join('\n'),
        candidates: topicCandidates,
        embed,
        classify,
        budget,
      });
      chapterMapping.set(chapterKey, topicResult || { candidate: null, confidence: 0 });
    }
    const topic = topicResult?.candidate ? tree.topicByKey.get(topicResult.candidate.id) : null;
    if (!topic || topicResult.confidence < t.review) {
      mapped.push(emptyMapping(section, {
        mappingConfidence: topicResult?.confidence || 0,
        mappingMethod: topicResult?.method || '',
        mappingEvidence: { topic: topicResult?.evidence || {} },
      }));
      continue;
    }
    const topicStatus = statusFor(topicResult.confidence);

    // Chapter intro, synopsis and end-of-chapter exercise blocks are chapter
    // (topic) level: usable for whole-chapter generation, never a subtopic.
    if (section.level === 1 || section.kind === 'exercise') {
      mapped.push(emptyMapping(section, {
        aiTopicKey: topic.topicKey,
        aiTopicName: topic.topicName,
        mappingStatus: topicStatus,
        mappingConfidence: topicResult.confidence,
        mappingMethod: section.kind === 'exercise' ? 'exercise_block' : topicResult.method,
        mappingEvidence: { topic: topicResult.evidence || {} },
      }));
      continue;
    }

    // 2) Subtopic inside that topic only.
    const subCandidates = topic.subtopics.map((s) => ({ id: s.id, name: s.name, label: s.name, number: s.number }));
    const isLevel3 = section.level === 3;
    const parentNumber = isLevel3 ? section.number.split('.').slice(0, 2).join('.') : '';
    const parent = isLevel3 ? level2ByNumber.get(`${section.chapterNumber}|${parentNumber}`) || null : null;
    // With a mapped parent only an exact own match can override it, so skip
    // the embedding/Gemini tiers (saves calls on books with many x.y.z headings).
    let subResult = parent?.aiSubtopicId
      ? deterministicMatch({ number: '', title: section.title }, subCandidates)
      : await resolveCandidate({
          number: isLevel3 ? '' : section.number,
          title: section.title,
          text: section.text,
          candidates: subCandidates,
          embed,
          classify,
          budget,
        });
    if (isLevel3 && !subResult?.candidate && section.number) {
      // "3.2.1" also matches DB subtopic "3.2" by number prefix.
      const prefix = section.number.split('.').slice(0, 2).join('.');
      const byPrefix = subCandidates.filter((c) => c.number === prefix);
      if (byPrefix.length === 1) subResult = { candidate: byPrefix[0], confidence: 0.93, method: 'number_exact', evidence: { number: prefix } };
    }
    // The book's own numbering beats a keyword match: "4.1.3 Series" sits
    // under "4.1 Basic Concepts…", whatever single words it shares elsewhere.
    const ownIsExact = subResult?.candidate && ['number_exact', 'title_exact'].includes(subResult.method);
    if (parent?.aiSubtopicId && !ownIsExact) {
      subResult = {
        candidate: { id: parent.aiSubtopicId, name: parent.aiSubtopicName },
        confidence: parent.mappingConfidence,
        method: 'inherited_parent',
        evidence: { parentSectionKey: parent.sectionKey },
      };
    }

    const subOk = subResult?.candidate && subResult.confidence >= t.review;
    // A subtopic can never be more certain than the topic it sits in.
    const confidence = subOk ? Math.min(subResult.confidence, topicResult.confidence) : topicResult.confidence;
    const entry = emptyMapping(section, {
      aiTopicKey: topic.topicKey,
      aiTopicName: topic.topicName,
      aiSubtopicId: subOk ? subResult.candidate.id : '',
      aiSubtopicName: subOk ? (tree.subtopicById.get(subResult.candidate.id)?.name || subResult.candidate.name) : '',
      // Topic known but subtopic not: usable for whole-chapter scope only.
      mappingStatus: subOk ? statusFor(confidence) : topicStatus,
      mappingConfidence: confidence,
      mappingMethod: subOk ? subResult.method : topicResult.method,
      mappingEvidence: { topic: topicResult.evidence || {}, subtopic: subResult?.evidence || {} },
    });
    mapped.push(entry);
    rememberLevel2(entry);
  }
  const windowSplit = options.windowSplit ?? String(process.env.BOOK_MAPPING_WINDOW_SPLIT ?? 'true').toLowerCase() !== 'false';
  const finalSections = windowSplit && embed
    ? await splitUnstructuredChapters(mapped, tree, embed, overrides)
    : mapped;
  const initialBudget = Math.max(0, Number(options.maxGeminiCalls ?? envNumber('BOOK_MAPPING_GEMINI_MAX_CALLS', 40)));
  return { sections: finalSections, geminiCallsUsed: initialBudget - budget.geminiCalls };
}

function paragraphWindows(text = '', targetWords = 150) {
  const paragraphs = String(text || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const windows = [];
  let current = [];
  let words = 0;
  for (const paragraph of paragraphs) {
    current.push(paragraph);
    words += countWords(paragraph);
    if (words >= targetWords) {
      windows.push(current.join('\n'));
      current = [];
      words = 0;
    }
  }
  if (current.length) {
    if (windows.length && words < targetWords / 3) windows[windows.length - 1] += `\n${current.join('\n')}`;
    else windows.push(current.join('\n'));
  }
  return windows;
}

/**
 * Chapters with no numbered sub-headings (common in workbooks/IIT modules)
 * would otherwise only be topic-level. Split them into ~150-word windows, label
 * each window with its nearest subtopic of the SAME topic when the embedding is
 * confident, smooth single gaps, and emit contiguous runs as sections. This is
 * also how one book section covering two DB subtopics gets split, rather than
 * duplicated into both.
 */
async function splitUnstructuredChapters(sections, tree, embed, overrides) {
  const t = mappingThresholds();
  const chaptersWithSubsections = new Set(
    sections.filter((s) => s.level >= 2).map((s) => s.aiTopicKey).filter(Boolean),
  );
  const out = [];
  for (const section of sections) {
    const topic = section.aiTopicKey ? tree.topicByKey.get(section.aiTopicKey) : null;
    const eligible = section.level === 1 &&
      topic && topic.subtopics.length > 0 &&
      isRetrievableMapping(section) &&
      !chaptersWithSubsections.has(section.aiTopicKey) &&
      section.wordCount >= 120 &&
      !overrides.has(section.sectionKey);
    if (!eligible) {
      out.push(section);
      continue;
    }
    const windows = paragraphWindows(section.text);
    const candidates = topic.subtopics.map((s) => ({ id: s.id, name: s.name }));
    const labels = [];
    for (const windowText of windows) {
      const match = await embeddingMatch(windowText, candidates, embed);
      labels.push(match && match.confidence >= t.auto ? match : null);
    }
    for (let i = 1; i < labels.length - 1; i += 1) {
      if (!labels[i] && labels[i - 1] && labels[i + 1] && labels[i - 1].candidate.id === labels[i + 1].candidate.id) {
        labels[i] = { ...labels[i - 1], method: 'embedding_smoothed' };
      }
    }
    if (!labels.some(Boolean)) {
      out.push(section);
      continue;
    }
    let cursor = section.startOffset;
    windows.forEach((windowText, index) => {
      const label = labels[index];
      const piece = {
        ...section,
        level: label ? 2 : 1,
        number: '',
        title: label ? label.candidate.name : section.title,
        text: windowText,
        wordCount: countWords(windowText),
        startOffset: cursor,
        endOffset: cursor + windowText.length,
        parentSectionKey: section.sectionKey,
        sectionKey: `${section.sectionKey}:w${index}`,
      };
      cursor += windowText.length + 1;
      const windowOverride = overrides.get(piece.sectionKey);
      if (windowOverride) {
        out.push(applyOverride(piece, windowOverride, tree));
        return;
      }
      out.push(label
        ? {
            ...piece,
            aiSubtopicId: label.candidate.id,
            aiSubtopicName: label.candidate.name,
            mappingStatus: statusFor(Math.min(label.confidence, section.mappingConfidence)),
            mappingConfidence: Math.min(label.confidence, section.mappingConfidence),
            mappingMethod: label.method === 'embedding_smoothed' ? 'embedding_smoothed' : 'embedding_window',
            mappingEvidence: { ...section.mappingEvidence, subtopic: label.evidence || {} },
          }
        : piece);
    });
  }
  return out;
}

function applyOverride(section, override, tree) {
  if (override.reject) {
    return emptyMapping(section, { mappingStatus: MAPPING_STATUS.REJECTED, mappingMethod: 'manual', mappingConfidence: 1 });
  }
  const sub = override.aiSubtopicId ? tree.subtopicById.get(String(override.aiSubtopicId)) : null;
  const topicKey = sub?.topicKey || override.aiTopicKey;
  const topic = topicKey ? tree.topicByKey.get(topicKey) : null;
  if (!topic) {
    // Override points at a deleted/renamed row: surface it for review again.
    return emptyMapping(section, { mappingStatus: MAPPING_STATUS.NEEDS_REVIEW, mappingMethod: 'manual_stale', mappingEvidence: { override } });
  }
  return emptyMapping(section, {
    aiTopicKey: topic.topicKey,
    aiTopicName: topic.topicName,
    aiSubtopicId: sub?.id || '',
    aiSubtopicName: sub?.name || '',
    mappingStatus: MAPPING_STATUS.REVIEWED,
    mappingConfidence: 1,
    mappingMethod: 'manual',
  });
}

/* ------------------------------------------------------------------ */
/* Chunk groups + health                                               */
/* ------------------------------------------------------------------ */

function mappingIdentity(section) {
  return [section.mappingStatus, section.aiTopicKey, section.aiSubtopicId].join('|');
}

/**
 * Merge adjacent sections with the same mapping so short headings are not
 * chunked alone. Groups never span two different subtopic IDs.
 */
export function groupMappedSectionsForChunking(sections = [], { minWords = 25 } = {}) {
  const groups = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last && mappingIdentity(last) === mappingIdentity(section)) {
      last.text = [last.text, section.text].filter(Boolean).join('\n');
      last.wordCount += section.wordCount;
      last.endOffset = section.endOffset;
      last.pageEnd = section.pageEnd ?? last.pageEnd;
      last.sectionKeys.push(section.sectionKey);
      last.headings.push([section.number, section.title].filter(Boolean).join(' '));
      continue;
    }
    groups.push({
      ...section,
      sectionKeys: [section.sectionKey],
      headings: [[section.number, section.title].filter(Boolean).join(' ')],
    });
  }
  return groups.filter((group) => group.wordCount >= minWords);
}

export function isRetrievableMapping(section = {}) {
  return RETRIEVABLE_MAPPING_STATUSES.includes(section.mappingStatus);
}

/**
 * Mapping health for admin UI and the readiness gate.
 */
export function computeMappingHealth(sections = [], tree, { chunks = [] } = {}) {
  const content = sections.filter((s) => s.level > 0);
  const totalWords = content.reduce((sum, s) => sum + (s.wordCount || 0), 0);
  // A numbered sub-section only counts as settled once it has a subtopic ID;
  // chapter intro text (level 1) is complete with a topic ID.
  const isSettled = (s) =>
    s.mappingStatus === MAPPING_STATUS.REJECTED ||
    (isRetrievableMapping(s) && (s.level === 1 || s.kind === 'exercise' || Boolean(s.aiSubtopicId)));
  const settledWords = content.filter(isSettled).reduce((sum, s) => sum + (s.wordCount || 0), 0);
  const retrievable = content.filter(isRetrievableMapping);
  const mappedTopics = new Set(retrievable.map((s) => s.aiTopicKey).filter(Boolean));
  // Count a subtopic only when real chunks carry it. A chapter-opening topic
  // list ("1.1 Basic Concepts" with 0 words) matches names but holds no text,
  // which previously reported 39/40 mapped while 23 subtopics were empty.
  const chunkSubtopics = new Set(
    chunks.filter((c) => !c.mappingStatus || RETRIEVABLE_MAPPING_STATUSES.includes(c.mappingStatus))
      .map((c) => c.aiSubtopicId).filter(Boolean),
  );
  const mappedSubtopics = chunks.length
    ? chunkSubtopics
    : new Set(retrievable.filter((s) => (s.wordCount || 0) >= 25).map((s) => s.aiSubtopicId).filter(Boolean));
  const totalSubtopics = tree?.subtopicById?.size || 0;
  const unmapped = content.filter((s) => s.mappingStatus === MAPPING_STATUS.UNMAPPED);
  const needsReview = content.filter((s) => s.mappingStatus === MAPPING_STATUS.NEEDS_REVIEW);
  // High-value = a real numbered section with meaningful text and no subtopic.
  const unmappedHighValue = content.filter(
    (s) => s.level >= 2 && s.kind !== 'exercise' && (s.wordCount || 0) >= 150 && !isSettled(s),
  );
  const bands = { high: 0, review: 0, low: 0 };
  const t = mappingThresholds();
  for (const s of content) {
    const c = Number(s.mappingConfidence) || 0;
    if (c >= t.auto) bands.high += 1;
    else if (c >= t.review) bands.review += 1;
    else bands.low += 1;
  }
  const chunksWithoutSubtopic = chunks.filter((c) => !c.aiSubtopicId).length;
  const coverage = totalWords ? settledWords / totalWords : 0;
  const minCoverage = envNumber('BOOK_MAPPING_MIN_COVERAGE', 0.95);
  let status = 'ready';
  if (!tree || !tree.topics.length) status = 'no_curriculum';
  else if (!retrievable.length) status = 'unmapped';
  else if (coverage < minCoverage || unmappedHighValue.length > 0) status = 'needs_review';
  // Text can all be "settled" at chapter level while almost no subtopic has
  // content (headings that don't match the AI Tools topics). Not ready.
  else if (totalSubtopics > 0 && mappedSubtopics.size / totalSubtopics < envNumber('BOOK_MAPPING_READY_MIN_SUBTOPIC_RATIO', 0.8)) status = 'needs_review';
  return {
    status,
    version: CURRICULUM_MAPPING_VERSION,
    coverage: Number(coverage.toFixed(4)),
    mappedTopics: mappedTopics.size,
    totalTopics: tree?.topics?.length || 0,
    mappedSubtopics: mappedSubtopics.size,
    totalSubtopics,
    sectionCount: content.length,
    unmappedSections: unmapped.length,
    needsReviewSections: needsReview.length,
    unmappedHighValueSections: unmappedHighValue.length,
    chunkCount: chunks.length,
    chunksWithoutSubtopic,
    confidenceBands: bands,
  };
}

/**
 * Pre-generation invariant: every retrieved chunk must carry the selected IDs.
 */
export function findScopeMismatches(chunks = [], { aiTopicKey = '', aiSubtopicId = '' } = {}) {
  return chunks.filter((chunk) => {
    if (aiSubtopicId && String(chunk.aiSubtopicId || '') !== String(aiSubtopicId)) return true;
    if (aiTopicKey && String(chunk.aiTopicKey || '') !== String(aiTopicKey)) return true;
    return false;
  });
}
