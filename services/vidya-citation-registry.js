/** Immutable citation registry for Vidya textbook answers. The model may only quote these IDs. */

export function isSourceFollowUp(question) {
  const q = String(question || '')
    .toLowerCase()
    .replace(/[?!.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q) return false;
  if (/\b(teach|chapter|solve|define|photosynthesis|equation)\b/.test(q) && !/\bsources?\b|\bcitations?\b|\breferences?\b/.test(q)) {
    return false;
  }
  return (
    /\bwhat (are|is) (these |those |the )?(sources|citations|references)\b/.test(q)
    || /\b(explain|list|show|tell me) (the |these |those )?(sources|citations|references)\b/.test(q)
    || /^(these |those )?(sources|citations|references)\??$/.test(q)
    || /\bwhat does \[?b\d+\]? (mean|refer|stand)\b/.test(q)
  );
}

export function parseCitationRegistryFromMessage(content = '') {
  const text = String(content || '');
  const parts = text.split(/\n+(?:\*{0,2}|#{1,3}\s*)Sources?:\s*\*{0,2}\s*\n/i);
  if (parts.length < 2) return [];
  const block = parts[parts.length - 1];
  const sources = [];
  for (const line of block.split('\n')) {
    const ids = [...line.matchAll(/\[(B\d+)\]/g)].map((m) => m[1]);
    if (!ids.length) continue;
    const label = line
      .replace(/^[\s•\-\*]+/, '')
      .replace(/\[B\d+\]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const [title, ...rest] = label.split(/\s+—\s+/);
    const chapter = rest.join(' — ');
    for (const id of ids) {
      if (!sources.some((s) => s.id === id)) {
        sources.push({ id, title: title || label, chapter });
      }
    }
  }
  return sources;
}

export function lastAssistantCitationRegistry(history = []) {
  const turn = [...(Array.isArray(history) ? history : [])].reverse().find((h) => h?.role === 'assistant');
  if (!turn) return [];
  if (Array.isArray(turn.citations) && turn.citations.length) {
    return turn.citations
      .map((s) => ({
        id: String(s.id || s.citation_id || ''),
        title: String(s.title || s.book || ''),
        chapter: String(s.chapter || s.chapter_title || ''),
        documentId: s.documentId || s.document_id || s.bookId || '',
        section: s.section,
      }))
      .filter((s) => s.id);
  }
  return parseCitationRegistryFromMessage(turn.content);
}

export function explainStoredSources(registry = []) {
  if (!registry.length) {
    return 'I cannot verify the source labels from the previous answer. The saved reference list is unavailable, so I will not guess another book or subject.';
  }
  const lines = registry.map((s) => {
    const chapter = s.chapter ? ` — ${s.chapter}` : '';
    return `• [${s.id}] ${s.title || 'Textbook'}${chapter}`;
  });
  return [
    'These are the textbook sections I used for my previous answer:',
    '',
    ...lines,
    '',
    'These references are unchanged from the previous answer. I did not search any other subject or book.',
  ].join('\n');
}

export function maybeExplainStoredSources(question, history = []) {
  if (!isSourceFollowUp(question)) return null;
  return explainStoredSources(lastAssistantCitationRegistry(history));
}
