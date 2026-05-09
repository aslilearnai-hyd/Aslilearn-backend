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
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0], 'en', { numeric: true, sensitivity: 'base' });
    })
    .map(([k]) => k);
}
