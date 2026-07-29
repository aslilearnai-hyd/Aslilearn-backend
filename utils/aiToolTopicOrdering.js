/** Curriculum seed order for dropdowns (lower = earlier). */
export const SORT_ORDER_FALLBACK = 9_000_000;

export function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * @param {Array<{ topicName?: string, subTopic?: string, label?: string, sortOrder?: number }>} rows
 * @param {'topicName' | 'subTopic' | 'label'} field
 */
export function orderedUniqueBySortField(rows, field) {
  const orderFirst = new Map();
  for (const row of rows) {
    const key = normalizeText(row[field]);
    if (!key) continue;
    const raw = row.sortOrder;
    const o =
      raw != null && Number.isFinite(Number(raw)) ? Number(raw) : SORT_ORDER_FALLBACK;
    if (!orderFirst.has(key) || o < orderFirst.get(key)) {
      orderFirst.set(key, o);
    }
  }
  return [...orderFirst.entries()]
    .sort((a, b) => {
      const labelCmp = a[0].localeCompare(b[0], 'en', { numeric: true, sensitivity: 'base' });
      if (a[1] !== b[1]) {
        // Prefer chapter-wise label when both look like Chapter N (avoids 1,11,2 from bad sortOrder).
        const aCh = /\b(?:chapter|ch\.?|unit)\s*[#:]?\s*\d+\b/i.test(a[0]);
        const bCh = /\b(?:chapter|ch\.?|unit)\s*[#:]?\s*\d+\b/i.test(b[0]);
        if (aCh && bCh && labelCmp !== 0) return labelCmp;
        return a[1] - b[1];
      }
      return labelCmp;
    })
    .map(([k]) => k);
}
