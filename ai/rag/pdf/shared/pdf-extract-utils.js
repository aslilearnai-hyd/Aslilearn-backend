/**
 * Shared helpers for regex-based PDF text extractors (no LLM).
 * @module services/pdf-extract-utils
 */

export function str(v) {
  return v == null ? '' : String(v).trim();
}

export function strArr(v) {
  return Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
}

export function splitLines(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim());
}

/**
 * Split PDF text into blocks when a line matches markerLineRe (line-by-line, no zero-width regex).
 * @param {string} text
 * @param {RegExp} markerLineRe — must test full trimmed lines (e.g. /^Item\s+\d+\b/i)
 * @param {number} [minChunkLen=40]
 */
export function splitPdfTextByMarkerLines(text, markerLineRe, minChunkLen = 40) {
  const raw = str(text);
  if (!raw) return [];

  const lines = raw.replace(/\r/g, '\n').split('\n');
  const chunks = [];
  let current = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (markerLineRe.test(trimmed)) {
      if (current.length) {
        const chunk = current.join('\n').trim();
        if (chunk.length >= minChunkLen) chunks.push(chunk);
      }
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length) {
    const chunk = current.join('\n').trim();
    if (chunk.length >= minChunkLen) chunks.push(chunk);
  }

  return chunks.length ? chunks : raw.length >= minChunkLen ? [raw.trim()] : [];
}

/** Parse "Label: value" or "Label - value" from a line. */
export function parseLabeledField(line, labels = []) {
  const t = str(line);
  if (!t) return '';
  for (const label of labels) {
    const re = new RegExp(`^${label}\\s*[:\\-—]\\s*(.+)$`, 'i');
    const m = t.match(re);
    if (m?.[1]) return str(m[1]);
  }
  return '';
}

/** Collect bullet / numbered lines into string array. */
export function bulletsFromLines(bodyLines) {
  const out = [];
  for (const line of bodyLines) {
    if (!line) continue;
    const bullet = str(line).replace(/^[-•*]\s*/, '').replace(/^\d+[\.)]\s*/, '');
    if (bullet) out.push(bullet);
  }
  return out;
}

/** Parse numbered section blocks inside a chunk: "1. Heading" → { 1: bodyLines[] } */
export function parseNumberedSections(block, maxSection = 20) {
  const lines = splitLines(block);
  const sections = new Map();
  let currentNum = 0;
  let body = [];

  const flush = () => {
    if (currentNum > 0) sections.set(currentNum, [...body]);
    body = [];
  };

  for (const line of lines) {
    const m = line.match(/^(\d+)[\.)]\s+(.+)$/);
    if (m) {
      const num = Number.parseInt(m[1], 10);
      if (num >= 1 && num <= maxSection) {
        flush();
        currentNum = num;
        const rest = str(m[2]);
        if (rest.length > 2) body.push(rest);
        continue;
      }
    }
    if (currentNum > 0) body.push(line);
  }
  flush();
  return sections;
}
