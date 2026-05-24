/**
 * Regex-based story / passage extraction from PDF text.
 * @module services/pdf-story-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const STORY_MARKER = /^(?:Story|Passage|Item)\s+\d+\b/i;

function parseStoryBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  let title = '';
  const passageLines = [];
  const questionLines = [];
  let inQuestions = false;

  for (const line of lines) {
    if (!line || STORY_MARKER.test(line)) continue;
    const titleMatch = line.match(/^Title\s*[:\-—]\s*(.+)$/i);
    if (titleMatch) {
      title = str(titleMatch[1]);
      continue;
    }
    if (/^Questions?\s*[:\-—]?\s*$/i.test(line) || /^Comprehension\s*Questions?\b/i.test(line)) {
      inQuestions = true;
      continue;
    }
    if (/^\d+[\.)]\s+/.test(line) && inQuestions) {
      questionLines.push(line.replace(/^\d+[\.)]\s+/, '').trim());
      continue;
    }
    if (inQuestions && line.length > 3) {
      questionLines.push(line);
      continue;
    }
    if (!/^title\s*[:\-—]/i.test(line)) passageLines.push(line);
  }

  const passage = passageLines.join('\n').trim();
  if (!passage || passage.length < 40) return null;

  return {
    sl_no: index + 1,
    title: title || `Story ${index + 1}`,
    passage,
    questions: bulletsFromLines(questionLines),
    learning_objectives: [],
    vocabulary_support: [],
    _fromPdf: true,
  };
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 */
export function extractStoryPassageItemsFromPdfText(text, limit = 100) {
  const blocks = splitPdfTextByMarkerLines(str(text), STORY_MARKER, 80);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const story = parseStoryBlock(block, out.length);
    if (story) out.push(story);
  }

  if (!out.length) {
    const single = parseStoryBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.map((row, i) => ({
    ...row,
    sl_no: row.sl_no ?? i + 1,
    questions: strArr(row.questions),
    _fromPdf: true,
  }));
}
