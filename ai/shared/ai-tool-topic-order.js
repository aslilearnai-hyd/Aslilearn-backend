/** Preserve admin/book order for AI tool topic rows. */

const CHAPTER_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function chapterNumberFromTopicLabel(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const chapterMatch = s.match(/\b(?:chapter|ch\.?|unit)\s*[-–—.#:]?\s*(\d+)\b/i);
  if (chapterMatch) {
    const n = parseInt(chapterMatch[1], 10);
    return Number.isNaN(n) ? null : n;
  }
  const leading = s.match(/^(\d+)\s*[.\):\-–—]?\s+/);
  if (leading) {
    const n = parseInt(leading[1], 10);
    return Number.isNaN(n) ? null : n;
  }
  const leadingTight = s.match(/^(\d+)\s*[.\):\-–—]/);
  if (leadingTight) {
    const n = parseInt(leadingTight[1], 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Same chapter identity for "Integers" and "Chapter 1 - Integers". */
export function canonicalTopicKey(value) {
  let s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');
  if (!s) return '';

  for (let i = 0; i < 3; i += 1) {
    const next = s
      .replace(/^(chapter|ch\.?|unit)\s*[-–—.#:]?\s*\d+\s*[-–—:.]?\s*/i, '')
      .replace(/^\d+\s*[.\):\-–—]?\s*/, '')
      .trim();
    if (next === s) break;
    s = next;
  }

  const dashParts = s.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    const first = dashParts[0];
    if (dashParts.every((p) => p === first)) s = first;
  }

  return s
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function topicLabelScore(value) {
  const s = String(value || '').trim();
  if (!s) return -1;
  let score = Math.min(s.length, 80);
  if (chapterNumberFromTopicLabel(s) != null) score += 1000;
  if (/^(chapter|ch\.?|unit)\b/i.test(s)) score += 100;
  if (!/\s-\s/.test(s) || chapterNumberFromTopicLabel(s) != null) score += 20;
  return score;
}

export function compareChapterWiseTopicLabels(a, b) {
  const aCh = chapterNumberFromTopicLabel(a);
  const bCh = chapterNumberFromTopicLabel(b);
  if (aCh != null && bCh != null && aCh !== bCh) return aCh - bCh;
  if (aCh != null && bCh == null) return -1;
  if (aCh == null && bCh != null) return 1;
  return CHAPTER_COLLATOR.compare(String(a), String(b));
}

export function dedupeChapterWiseTopicLabels(labels) {
  const byKey = new Map();
  for (const raw of labels || []) {
    const label = String(raw || '').trim();
    if (!label) continue;
    const key = canonicalTopicKey(label) || label.toLowerCase();
    const prev = byKey.get(key);
    if (!prev || topicLabelScore(label) > topicLabelScore(prev)) {
      byKey.set(key, label);
    }
  }
  return [...byKey.values()].sort(compareChapterWiseTopicLabels);
}

export function compareAiToolTopicRows(a, b) {
  const aSort = Number.isFinite(Number(a?.sortOrder)) ? Number(a.sortOrder) : Number.POSITIVE_INFINITY;
  const bSort = Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : Number.POSITIVE_INFINITY;
  if (aSort !== bSort) return aSort - bSort;

  const aCreated = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bCreated = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (aCreated !== bCreated) return aCreated - bCreated;

  const aId = String(a?._id || '');
  const bId = String(b?._id || '');
  if (aId && bId && aId !== bId) return aId.localeCompare(bId);

  return String(a?.subTopic || '').localeCompare(String(b?.subTopic || ''), 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

export function orderedUniqueSubTopics(rows) {
  const sorted = [...rows].sort(compareAiToolTopicRows);
  const names = [];
  for (const row of sorted) {
    const name = String(row?.subTopic || '').trim();
    if (!name) continue;
    names.push(name);
  }
  return dedupeChapterWiseTopicLabels(names);
}

/** Unique topic labels — prefer chapter-prefixed display names, chapter-wise order. */
export function orderedUniqueTopics(rows, getTopicLabel) {
  const sorted = [...rows].sort(compareAiToolTopicRows);
  const names = [];
  for (const row of sorted) {
    const name = String(getTopicLabel(row) || '').trim();
    if (!name) continue;
    names.push(name);
  }
  return dedupeChapterWiseTopicLabels(names);
}

export async function resolveSortOrderStart(AiToolTopic, filter, explicitStart) {
  if (explicitStart != null && Number.isFinite(Number(explicitStart))) {
    return Number(explicitStart);
  }

  const rows = await AiToolTopic.find({ ...filter, isActive: true }).select('sortOrder').lean();
  let max = 0;
  for (const row of rows) {
    const value = Number(row?.sortOrder);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max + 1;
}
