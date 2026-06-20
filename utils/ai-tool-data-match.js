/**
 * Shared Mongo filters for AI Tool Data ↔ AI Tool Topics / curriculum cascade.
 * Keeps student/teacher content lookup aligned with /api/curriculum/* and ai_tool_topics.
 */

import { boardMongoMatch, lockBoardKey } from './board-label.js';

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
    return { subject: { $in: ['Maths', 'Mathematics'] } };
  }
  if (lower === 'social science' || lower === 'social studies' || lower === 'sst') {
    return { subject: { $in: ['Social Science', 'Social Studies'] } };
  }
  const exact = buildCaseInsensitiveExactFilter(v);
  return exact ? { subject: exact } : { subject: v };
}

/** Topic variants (with/without "Label - " prefix from AI Tool Topics). */
export function buildTopicNameVariants(topic) {
  const tn = normalizeMatchText(topic);
  if (!tn) return [];
  const variants = new Set([tn]);
  const dashIdx = tn.indexOf(' - ');
  if (dashIdx > 0) {
    const suffix = tn.slice(dashIdx + 3).trim();
    const prefix = tn.slice(0, dashIdx).trim();
    if (suffix) variants.add(suffix);
    if (prefix) variants.add(prefix);
  }
  return [...variants];
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
  const st = normalizeMatchText(subtopic);
  if (!st) return { subtopic: '' };
  const exact = buildCaseInsensitiveExactFilter(st);
  return exact ? { subtopic: exact } : { subtopic: st };
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
  const storedNorm = normalizeMatchText(stored).toLowerCase();
  if (!storedNorm) return !normalizeMatchText(queried);
  return variants.some((v) => {
    const q = v.toLowerCase();
    return storedNorm === q || storedNorm.includes(q) || q.includes(storedNorm);
  });
}

export function resolveLookupBoard(board, classLabel) {
  const b = normalizeMatchText(board);
  if (b) return b;
  if (normalizeClassId(classLabel) === 'Class 6') return 'IIT';
  return '';
}
