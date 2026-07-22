/**
 * Match-the-Following helpers — shared shape for AI tools + viewers.
 */

/**
 * @typedef {{ left: string, right: string, leftKey?: string, rightKey?: string }} MatchPair
 */

function cleanItem(value) {
  return String(value || '')
    .replace(/^\s*[A-Za-z0-9]+[\).:\-]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === 'string') return cleanItem(v);
      if (v && typeof v === 'object') {
        return cleanItem(
          v.left ||
            v.right ||
            v.term ||
            v.item ||
            v.text ||
            v.label ||
            v.a ||
            v.b ||
            '',
        );
      }
      return '';
    })
    .filter(Boolean);
}

/**
 * Normalize a question-like object into matchPairs[].
 * @param {Record<string, unknown>} entry
 * @returns {MatchPair[]}
 */
export function normalizeMatchPairs(entry) {
  if (!entry || typeof entry !== 'object') return [];

  const rawPairs =
    entry.matchPairs ||
    entry.match_pairs ||
    entry.pairs ||
    entry.matches ||
    entry.matchingPairs ||
    entry.columnPairs;

  if (Array.isArray(rawPairs) && rawPairs.length) {
    return rawPairs
      .map((row, i) => {
        if (!row || typeof row !== 'object') return null;
        const left = cleanItem(
          row.left || row.a || row.columnA || row.term || row.item || row.key || '',
        );
        const right = cleanItem(
          row.right ||
            row.b ||
            row.columnB ||
            row.match ||
            row.value ||
            row.definition ||
            row.answer ||
            '',
        );
        if (!left || !right) return null;
        return {
          left,
          right,
          leftKey: String(row.leftKey || i + 1),
          rightKey: String(row.rightKey || String.fromCharCode(97 + i)),
        };
      })
      .filter(Boolean);
  }

  const columnA = asStringList(entry.columnA || entry.column_a || entry.leftItems || entry.listA);
  const columnB = asStringList(entry.columnB || entry.column_b || entry.rightItems || entry.listB);
  if (columnA.length && columnB.length && columnA.length === columnB.length) {
    // Prefer explicit answer key like "1-b, 2-a, 3-c"
    const answer = String(entry.answer || entry.correctAnswer || '').trim();
    const map = new Map();
    const pairRe = /(\d+)\s*[-:=)>]\s*([A-Za-z])/g;
    let m;
    while ((m = pairRe.exec(answer))) {
      map.set(Number(m[1]), m[2].toLowerCase());
    }
    if (map.size === columnA.length) {
      return columnA.map((left, i) => {
        const letter = map.get(i + 1) || String.fromCharCode(97 + i);
        const rightIdx = letter.charCodeAt(0) - 97;
        const right = columnB[rightIdx] || columnB[i];
        return {
          left,
          right,
          leftKey: String(i + 1),
          rightKey: letter,
        };
      });
    }
    // Assume parallel order (generator should shuffle columnB for display separately)
    return columnA.map((left, i) => ({
      left,
      right: columnB[i],
      leftKey: String(i + 1),
      rightKey: String.fromCharCode(97 + i),
    }));
  }

  return [];
}

export function isMatchQuestionType(type) {
  const t = String(type || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
  return t === 'MATCH' || t === 'MATCHING' || t === 'MATCHTHEFOLLOWING' || t === 'MATCHFOLLOWING';
}

export function isMatchStemText(text) {
  const q = String(text || '').trim();
  if (!q) return false;
  return /\bmatch\s+(?:the\s+)?following\b|\bcolumn\s*a\b[\s\S]{0,120}\bcolumn\s*b\b|\bmatch\s+(?:each|these|the)\s+(?:items?|terms?|words?)\b/i.test(
    q,
  );
}

export function questionHasMatchPayload(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return normalizeMatchPairs(entry).length >= 2;
}

/** Build a human answer key string: 1 → b, 2 → a, … */
export function formatMatchAnswerKey(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  return list
    .map((p, i) => {
      const left = p.leftKey || String(i + 1);
      const right = p.rightKey || String.fromCharCode(97 + i);
      return `${left} → ${right}`;
    })
    .join(', ');
}

/** Shuffle a copy of an array (Fisher–Yates). */
export function shuffleCopy(items) {
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
