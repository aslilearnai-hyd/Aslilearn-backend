/**
 * Sort AI tool generation rows for list UIs: Variant 1, 2, 3… then newest first for non-variant rows.
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
  const va = generationVariantFromRecord(a);
  const vb = generationVariantFromRecord(b);
  if (va != null && vb != null && va !== vb) return va - vb;
  if (va != null && vb == null) return -1;
  if (va == null && vb != null) return 1;
  return new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime();
}

export function sortAiToolRecordsByVariantThenDate(records) {
  if (!Array.isArray(records)) return [];
  return [...records].sort(compareAiToolRecordsByVariantThenDate);
}

function classNumberFromLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

/** Class 6, 7, 8, 10 — not Class 10 before Class 6. */
export function compareClassLabels(a, b) {
  const diff = classNumberFromLabel(a) - classNumberFromLabel(b);
  if (diff !== 0) return diff;
  return String(a || '').localeCompare(String(b || ''), 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

/** Sort records inside every subtopic bucket of a grouped generator tree. */
export function sortGroupedGeneratorRecords(grouped) {
  if (!Array.isArray(grouped)) return grouped;
  for (const toolNode of grouped) {
    if (Array.isArray(toolNode.classes)) {
      toolNode.classes.sort((a, b) => {
        const byClass = compareClassLabels(a?.className, b?.className);
        if (byClass !== 0) return byClass;
        return String(a?.boardName || '').localeCompare(String(b?.boardName || ''), 'en', {
          numeric: true,
          sensitivity: 'base',
        });
      });
    }
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
