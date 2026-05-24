/**
 * Regex-based homework creator extraction from PDF text.
 * @module services/pdf-homework-extract
 */

import { extractWorksheetItemsFromPdfText } from './pdf-worksheet-extract.js';
import { splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const HOMEWORK_MARKER = /^(?:Homework|Assignment|Worksheet)\s+\d+\b/i;

function parseHomeworkBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let title = '';
  let instructions = '';
  let inInstructions = false;

  for (const line of lines) {
    if (HOMEWORK_MARKER.test(line)) continue;
    const titleMatch = line.match(/^Title\s*[:\-—]\s*(.+)$/i);
    if (titleMatch) {
      title = str(titleMatch[1]);
      continue;
    }
    if (/^Instructions?\s*[:\-—]?\s*$/i.test(line)) {
      inInstructions = true;
      continue;
    }
    if (/^Practice\s*Questions?\s*[:\-—]?\s*$/i.test(line)) {
      inInstructions = false;
      continue;
    }
    if (inInstructions) {
      instructions += (instructions ? '\n' : '') + line;
    } else if (!title && line.length >= 3 && line.length < 120 && !/^\d+[\.)]/.test(line)) {
      title = line;
    }
  }

  const practice_questions = extractWorksheetItemsFromPdfText(block, 60).map((q) => ({
    question: q.question,
    options: q.options || [],
    answer: q.answer || '',
  }));

  if (!practice_questions.length && !str(instructions) && !title) return null;

  return {
    sl_no: index + 1,
    title: title || `Homework ${index + 1}`,
    instructions: str(instructions),
    practice_questions,
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=50]
 */
export function extractHomeworkItemsFromPdfText(text, limit = 50) {
  const blocks = splitPdfTextByMarkerLines(str(text), HOMEWORK_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const hw = parseHomeworkBlock(block, out.length);
    if (hw) out.push(hw);
  }

  if (!out.length) {
    const single = parseHomeworkBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
