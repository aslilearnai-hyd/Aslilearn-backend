/**
 * Central Board label helpers. Legacy data used the typo "CBSC"; treat it as "CBSE"
 * for queries and normalize new writes to "CBSE".
 */

function trimBoard(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Canonical display/storage label (fixes CBSC → CBSE; otherwise returns trimmed input).
 */
export function canonicalBoardLabel(raw) {
  const s = trimBoard(raw);
  if (!s) return '';
  const u = s.toUpperCase();
  if (u === 'CBSC') return 'CBSE';
  return s;
}

export function lockBoardKey(raw) {
  const s = trimBoard(raw);
  if (!s) return '';
  const compact = s.toUpperCase().replace(/[\s/\\-]+/g, '');
  if (compact.includes('IIT') || compact.includes('NEET') || compact.includes('JEE')) {
    return 'IIT/NEET';
  }
  return canonicalBoardLabel(s);
}

/** Alias for tree grouping (same normalization as lockBoardKey). */
export function normalizeBoardLabelForGrouping(raw) {
  return lockBoardKey(raw);
}

/** Normalize class labels for lock identity (6 → Class 6). */
export function normalizeClassLabelForLock(raw) {
  const s = trimBoard(raw);
  if (!s) return '';
  const digits = s.match(/\d+/)?.[0];
  if (digits) return `Class ${digits}`;
  return s;
}

/**
 * Canonical classLabel for AiToolGeneration rows (student/teacher rotation keys).
 * Always "Class N" — legacy IIT-6 / Class-6-IIT inputs normalize to Class 6.
 */
export function resolveClassLabelForAiToolStorage(className, _board) {
  const s = trimBoard(className);
  if (!s) return '';
  if (s === 'IIT-6' || s === 'Class-6-IIT') return 'Class 6';
  const digits = s.match(/\d+/)?.[0];
  if (digits) return `Class ${digits}`;
  return s;
}

/**
 * MongoDB filter for `board` when reading. Empty string matches only empty board.
 * CBSE/CBSC (any case) match either spelling in the database.
 */
export function boardMongoMatch(rawBoard) {
  const s = trimBoard(rawBoard);
  if (!s) return '';

  const compact = s.toUpperCase().replace(/[\s/\\-]+/g, '');
  if (compact === 'CBSE' || compact === 'CBSC') {
    return { $regex: /^(cbse|cbsc)$/i };
  }
  if (compact.includes('IIT') || compact.includes('NEET') || compact.includes('JEE')) {
    return { $regex: /iit|neet|jee/i };
  }
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return { $regex: new RegExp(`^${escaped}$`, 'i') };
}
