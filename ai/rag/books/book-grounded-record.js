/**
 * Book-Based Generator rows in aitoolgenerations (legacy sourceType book_rag or metadata flags).
 */
export function bookGroundedMongoFilter(extra = {}) {
  const groundedOr = {
    $or: [
      { sourceType: 'book_rag' },
      { 'metadata.bookGenerator': true },
      { 'metadata.formatSource': 'bookRag' },
    ],
  };

  const extraKeys = Object.keys(extra || {}).filter((k) => {
    const v = extra[k];
    return v !== undefined && v !== null && v !== '';
  });
  if (extraKeys.length === 0) return groundedOr;

  const scoped = {};
  for (const k of extraKeys) scoped[k] = extra[k];
  return { $and: [groundedOr, scoped] };
}

export function buildBookScopeQuery(scope) {
  return bookGroundedMongoFilter({
    'metadata.bookId': String(scope.bookId || ''),
    toolName: scope.toolSlug,
    board: scope.board,
    classLabel: scope.className,
    subject: scope.subject,
    topic: scope.topic,
    subtopic: scope.subtopic,
  });
}

export function isBookGroundedRecord(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.sourceType === 'book_rag') return true;
  const meta = doc.metadata;
  if (!meta || typeof meta !== 'object') return false;
  return Boolean(meta.bookGenerator) || meta.formatSource === 'bookRag';
}
