/**
 * Shared Mongo filters for AI Tool Data ↔ AI Tool Topics / curriculum cascade.
 * Keeps student/teacher content lookup aligned with /api/curriculum/* and ai_tool_topics.
 */

import { boardMongoMatch, lockBoardKey } from '../../utils/board-label.js';

export function normalizeMatchText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeClassId(classId) {
  const s = normalizeMatchText(classId);
  if (!s) return '';
  if (s === 'Class-6-IIT' || s === 'IIT-6') return 'Class 6';
  const match = s.match(/(\d+)/);
  if (match) return `Class ${match[1]}`;
  return s;
}

export function buildCaseInsensitiveExactFilter(value) {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  return { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' };
}

/** Class label filter — same rules as curriculum + IIT legacy Class 6 rows. */
export function buildClassLabelMongoFilter(classLabel, board = '') {
  const normalized = normalizeClassId(classLabel);
  if (!normalized) return {};

  const boardKey = lockBoardKey(board);
  const isIitClass6 = boardKey === 'IIT/NEET' && normalized === 'Class 6';

  if (isIitClass6) {
    const iitBoardMatch = boardMongoMatch(board || 'IIT');
    return {
      $or: [
        { classLabel: { $in: ['IIT-6', 'Class-6-IIT'] } },
        { classLabel: 'Class 6', board: iitBoardMatch },
        { classLabel: 'Class 6', board: '' },
        { classLabel: 'Class 6', board: { $exists: false } },
      ],
    };
  }

  const digits = normalized.match(/\d+/)?.[0];
  if (!digits) return { classLabel: normalized };
  return {
    classLabel: { $in: [`Class ${digits}`, digits, `-${digits}`, normalized] },
  };
}

export function buildSubjectMongoFilter(subject) {
  const v = normalizeMatchText(subject);
  if (!v) return {};
  const lower = v.toLowerCase();
  if (lower === 'maths' || lower === 'mathematics' || lower === 'math') {
    // Case-insensitive — generations may be stored as Mathematics / Maths / MATHS
    return { subject: { $regex: '^(maths|mathematics|math)$', $options: 'i' } };
  }
  if (lower === 'social science' || lower === 'social studies' || lower === 'sst') {
    return { subject: { $regex: '^(social\\s*science|social\\s*studies|sst)$', $options: 'i' } };
  }
  const exact = buildCaseInsensitiveExactFilter(v);
  return exact ? { subject: exact } : { subject: v };
}

/** Topic variants (with/without "Label - " prefix from AI Tool Topics). */
export function buildTopicNameVariants(topic) {
  const tn = normalizeMatchText(topic);
  if (!tn) return [];
  const variants = new Set([tn]);

  const addDashParts = (value) => {
    const parts = String(value || '')
      .split(/\s+-\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) variants.add(part);
    // Progressive right-hand suffixes: "A - B - C" → "B - C", "C"
    for (let i = 1; i < parts.length; i++) {
      variants.add(parts.slice(i).join(' - '));
    }
  };

  addDashParts(tn);

  // "Book 1: Title - …" / "Book 1 Chapter 2 - …"
  const withoutBook = tn.replace(/^book\s*\d+\s*:\s*/i, '').trim();
  if (withoutBook && withoutBook !== tn) {
    variants.add(withoutBook);
    addDashParts(withoutBook);
  }
  const withoutBookChapter = tn.replace(/^book\s*\d+\s+/i, '').trim();
  if (withoutBookChapter && withoutBookChapter !== tn) {
    variants.add(withoutBookChapter);
    addDashParts(withoutBookChapter);
  }

  const withoutChapter = tn.replace(/^chapter\s+\d+\s*[-:]\s*/i, '').trim();
  if (withoutChapter && withoutChapter !== tn) variants.add(withoutChapter);

  return [...variants];
}

/** Subtopic variants — numbered prefixes, chapter crumbs, dash suffixes. */
export function buildSubtopicNameVariants(subtopic) {
  const st = normalizeMatchText(subtopic);
  if (!st) return [];
  const variants = new Set([st]);
  const parts = st.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) variants.add(part);
  for (let i = 1; i < parts.length; i++) {
    variants.add(parts.slice(i).join(' - '));
  }
  const withoutNumber = st
    .replace(/^(\d+[\.)]\s*)+/, '')
    .replace(/^chapter\s+\d+\s*[-:]\s*/i, '')
    .trim();
  if (withoutNumber) variants.add(withoutNumber);
  return [...variants];
}

function looseNormalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function looseIncludesEitherWay(a, b) {
  const x = looseNormalize(a);
  const y = looseNormalize(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** Mongo filter for AiToolGeneration.topic (or topicName on topics collection). */
export function buildTopicFieldMongoFilter(topic) {
  const variants = buildTopicNameVariants(topic);
  if (!variants.length) return { topic: '' };
  const clauses = variants
    .map((v) => {
      const exact = buildCaseInsensitiveExactFilter(v);
      return exact ? { topic: exact } : null;
    })
    .filter(Boolean);
  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
}

export function buildSubtopicFieldMongoFilter(subtopic) {
  const variants = buildSubtopicNameVariants(subtopic);
  if (!variants.length) return { subtopic: '' };
  const clauses = variants
    .map((v) => {
      const exact = buildCaseInsensitiveExactFilter(v);
      return exact ? { subtopic: exact } : null;
    })
    .filter(Boolean);
  if (clauses.length === 1) return clauses[0];
  if (!clauses.length) return { subtopic: normalizeMatchText(subtopic) };
  return { $or: clauses };
}

/** Strict board scope (same as curriculum API). */
export function buildBoardMongoFilter(board) {
  const b = normalizeMatchText(board);
  if (!b) return {};
  return { board: boardMongoMatch(b) };
}

export function mergeMongoFilters(...parts) {
  const clauses = parts.filter((p) => p && typeof p === 'object' && Object.keys(p).length > 0);
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

/** Merge classLabel constraints onto a base Mongo filter (handles IIT-6 $or safely). */
export function applyClassLabelMongoFilter(baseFilter, classLabel, board = '') {
  const classClause = buildClassLabelMongoFilter(classLabel, board);
  if (!classClause || !Object.keys(classClause).length) {
    const normalized = normalizeClassId(classLabel);
    if (normalized) baseFilter.classLabel = normalized;
    return baseFilter;
  }
  return mergeMongoFilters(baseFilter, classClause);
}

/** Scope filter: board + class + subject (no topic/subtopic/tool). */
export function buildAiToolDataScopeFilter({ classLabel, subject, board }) {
  return mergeMongoFilters(
    buildBoardMongoFilter(board),
    buildClassLabelMongoFilter(classLabel, board),
    buildSubjectMongoFilter(subject),
  );
}

export function topicTextMatches(stored, queried) {
  const variants = buildTopicNameVariants(queried);
  const storedLoose = looseNormalize(stored);
  if (!storedLoose) return !normalizeMatchText(queried);
  return variants.some((v) => {
    const q = looseNormalize(v);
    if (!q) return false;
    return storedLoose === q || storedLoose.includes(q) || q.includes(storedLoose);
  });
}

export function subtopicTextMatches(stored, queried) {
  const variants = buildSubtopicNameVariants(queried);
  const storedNorm = looseNormalize(stored);
  if (!storedNorm) return !normalizeMatchText(queried);
  return variants.some((v) => {
    const q = looseNormalize(v);
    if (!q) return false;
    return storedNorm === q || storedNorm.includes(q) || q.includes(storedNorm);
  });
}

export function resolveLookupBoard(board, classLabel) {
  const b = normalizeMatchText(board);
  if (b) return b;
  if (normalizeClassId(classLabel) === 'Class 6') return 'IIT';
  return '';
}
