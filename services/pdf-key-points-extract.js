/**
 * Regex-based key points / formulae extraction from PDF text.
 * @module services/pdf-key-points-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str } from './pdf-extract-utils.js';

const ITEM_MARKER = /^(?:Item|Topic|Key\s*Point|Formula)\s+\d+\b/i;

function parseKeyPointBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let title = '';
  const definitions = [];
  const formulae = [];
  const examPoints = [];
  let section = 'definitions';

  for (const line of lines) {
    if (ITEM_MARKER.test(line)) continue;
    if (/^definitions?\b/i.test(line)) {
      section = 'definitions';
      continue;
    }
    if (/^formulae?\b|^formulas?\b/i.test(line)) {
      section = 'formulae';
      continue;
    }
    if (/^exam\s*points?\b/i.test(line)) {
      section = 'exam';
      continue;
    }
    if (!title && line.length >= 4 && line.length <= 160) {
      title = line;
      continue;
    }
    if (section === 'formulae') formulae.push(line);
    else if (section === 'exam') examPoints.push(line);
    else definitions.push(line);
  }

  const key_points = bulletsFromLines(definitions);
  if (!title && !key_points.length && !formulae.length) return null;

  return {
    sl_no: index + 1,
    title: title || `Key Points ${index + 1}`,
    topic_title: title || `Key Points ${index + 1}`,
    key_points,
    definitions: key_points.map((d) => ({ term: '', definition: d })),
    formulae: formulae.map((f) => ({ name: '', formula: f, note: '' })),
    exam_points: examPoints,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=80]
 * @returns {unknown[]}
 */
export function extractKeyPointsItemsFromPdfText(text, limit = 80) {
  const blocks = splitPdfTextByMarkerLines(String(text || ''), ITEM_MARKER);
  if (!blocks.length) {
    const lines = String(text || '')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 20 && l.length <= 500);
    return lines.slice(0, limit).map((line, i) => ({
      sl_no: i + 1,
      title: str(line).slice(0, 80),
      topic_title: str(line).slice(0, 80),
      key_points: [line],
      _fromPdf: true,
    }));
  }
  return blocks
    .map((block, i) => parseKeyPointBlock(block, i))
    .filter(Boolean)
    .slice(0, limit);
}
