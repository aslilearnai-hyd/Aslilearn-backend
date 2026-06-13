function normalizeUrl(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

function subjectKey(row) {
  const sub = row?.subjectId ?? row?.subject;
  if (!sub) return '';
  if (typeof sub === 'string') return sub.trim().toLowerCase();
  return String(sub.name || sub._id || '')
    .trim()
    .toLowerCase();
}

export function libraryContentDedupeKey(row) {
  const url = normalizeUrl(
    row?.fileUrl ||
      row?.videoUrl ||
      row?.youtubeUrl ||
      row?.driveLink ||
      (Array.isArray(row?.fileUrls) ? row.fileUrls[0] : '')
  );
  if (url) return `media:${url}`;

  const title = String(row?.title || '')
    .trim()
    .toLowerCase();
  const type = String(row?.type || '')
    .trim()
    .toLowerCase();
  const topic = String(row?.topic || '')
    .trim()
    .toLowerCase();
  return `meta:${type}|${title}|${topic}|${subjectKey(row)}`;
}

function rowRichness(row) {
  let score = 0;
  if (Number(row?.duration) > 0) score += 4;
  if (String(row?.description || '').trim()) score += 2;
  if (normalizeUrl(row?.fileUrl || row?.videoUrl || row?.youtubeUrl)) score += 3;
  if (Number(row?.views) > 0) score += 1;
  return score;
}

/** Drop duplicate catalog rows (same media URL or same title/type/topic). */
export function dedupeLibraryContents(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return rows || [];

  const byKey = new Map();

  for (const row of rows) {
    const key = libraryContentDedupeKey(row);
    const prev = byKey.get(key);
    if (!prev || rowRichness(row) > rowRichness(prev)) {
      byKey.set(key, row);
    }
  }

  const kept = new Set(byKey.values());
  return rows.filter((row) => kept.has(row));
}
