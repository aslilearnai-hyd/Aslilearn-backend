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

/**
 * MongoDB filter for `board` when reading. Empty string matches only empty board.
 * CBSE/CBSC (any case) match either spelling in the database.
 */
export function boardMongoMatch(rawBoard) {
  const s = trimBoard(rawBoard);
  if (!s) return '';

  const u = s.toUpperCase();
  if (u === 'CBSE' || u === 'CBSC') {
    return { $regex: /^(cbse|cbsc)$/i };
  }
  return s;
}
