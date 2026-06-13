/** Remove markdown markers so stored/displayed AI text reads as normal plain text. */
export function stripMarkdownSyntax(text) {
  let s = String(text || '').replace(/\r\n/g, '\n');

  for (let i = 0; i < 6; i += 1) {
    const prev = s;
    s = s
      .replace(/\*\*(.*?)\*\*/gs, '$1')
      .replace(/__(.*?)__/gs, '$1')
      .replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)/g, '$1');
    if (s === prev) break;
  }

  // Orphan ** / __ the model often leaves unpaired (e.g. "Title!**")
  s = s.replace(/\*\*/g, '').replace(/__/g, '');

  s = s
    .split('\n')
    .map((line) => {
      let l = line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*+]\s+/, '• ')
        .replace(/`+/g, '');
      l = l.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '');
      return l.trimEnd();
    })
    .join('\n');

  return s
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Recursively strip markdown from every string in structured JSON. */
export function deepStripMarkdownValues(value) {
  if (value == null) return value;
  if (typeof value === 'string') return stripMarkdownSyntax(value);
  if (Array.isArray(value)) return value.map((item) => deepStripMarkdownValues(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = deepStripMarkdownValues(nested);
    }
    return out;
  }
  return value;
}
