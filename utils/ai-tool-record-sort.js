/**
 * Sort AI tool generation rows for list UIs: newest first; variant is only a tie-breaker.
 */
export function generationVariantFromRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const v =
    record.generationVariant ??
    record.metadata?.generationVariant ??
    record.metadata?.extraParams?.generationVariant;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function compareAiToolRecordsByVariantThenDate(a, b) {
  const tb = new Date(b?.createdAt || 0).getTime();
  const ta = new Date(a?.createdAt || 0).getTime();
  if (tb !== ta) return tb - ta;

  const va = generationVariantFromRecord(a);
  const vb = generationVariantFromRecord(b);
  if (va != null && vb != null && va !== vb) return vb - va;
  if (va != null && vb == null) return -1;
  if (va == null && vb != null) return 1;
  return 0;
}

export function sortAiToolRecordsByVariantThenDate(records) {
  if (!Array.isArray(records)) return [];
  return [...records].sort(compareAiToolRecordsByVariantThenDate);
}

/** Sort records inside every subtopic bucket of a grouped generator tree. */
export function sortGroupedGeneratorRecords(grouped) {
  if (!Array.isArray(grouped)) return grouped;
  for (const toolNode of grouped) {
    for (const classNode of toolNode.classes || []) {
      for (const subjectNode of classNode.subjects || []) {
        for (const topicNode of subjectNode.topics || []) {
          for (const subtopicNode of topicNode.subtopics || []) {
            if (Array.isArray(subtopicNode.records)) {
              subtopicNode.records.sort(compareAiToolRecordsByVariantThenDate);
            }
          }
        }
      }
    }
  }
  return grouped;
}
