/**
 * Regex-based short notes / summaries extraction from PDF text.
 * @module services/pdf-shortnotes-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const NOTE_MARKER = /^(?:Item|Topic|Note)\s+\d+\b/i;

function parseNoteBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let title = '';
  const summaryLines = [];
  const keyPointLines = [];
  let inKeyPoints = false;

  for (const line of lines) {
    if (NOTE_MARKER.test(line)) continue;
    if (/^Key\s*Points?\s*(?:to\s*Remember)?\s*[:\-—]?\s*$/i.test(line)) {
      inKeyPoints = true;
      continue;
    }
    if (/^Short\s*Note|^Summary|^Exam\s*Summary/i.test(line) && line.length < 40) continue;

    if (!title && line.length >= 4 && line.length <= 160 && !/^\d+[\.)]/.test(line)) {
      title = line;
      continue;
    }

    if (inKeyPoints || /^[-•*]\s+/.test(line)) {
      keyPointLines.push(line);
    } else if (line.length > 10) {
      summaryLines.push(line);
    }
  }

  const short_note_summary = summaryLines.join('\n').trim();
  const key_points = bulletsFromLines(keyPointLines);

  if (!short_note_summary && !key_points.length) return null;

  return {
    sl_no: index + 1,
    title: title || `Notes ${index + 1}`,
    concept_name: title || `Notes ${index + 1}`,
    short_note_summary: short_note_summary || key_points.join('; '),
    key_points_to_remember: key_points,
    key_points,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 */
export function extractShortNotesItemsFromPdfText(text, limit = 100) {
  const blocks = splitPdfTextByMarkerLines(str(text), NOTE_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const note = parseNoteBlock(block, out.length);
    if (note) out.push(note);
  }

  if (!out.length) {
    const single = parseNoteBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
