/** Preserve admin/book order for AI tool topic rows. */

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
  const seen = new Set();
  const result = [];
  for (const row of sorted) {
    const name = String(row?.subTopic || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

/** Unique topic labels in admin sortOrder (first row per topic wins). */
export function orderedUniqueTopics(rows, getTopicLabel) {
  const sorted = [...rows].sort(compareAiToolTopicRows);
  const seen = new Set();
  const result = [];
  for (const row of sorted) {
    const name = String(getTopicLabel(row) || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
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
