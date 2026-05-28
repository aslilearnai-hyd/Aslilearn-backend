/**
 * Regex-based Chapter Summary Creator extraction from PDF text (10-section template).
 * @module services/pdf-chapter-summary-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const SUMMARY_MARKER = /^(?:Item|Chapter|Topic)\s+\d+\b/i;

const SECTION_PATTERNS = [
  { key: 'chapter_summary_title', re: /^1\.?\s*Chapter\s*Summary\s*Title\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'chapter_overview', re: /^2\.?\s*Overview\s*of\s*the\s*Chapter\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'learning_objectives', re: /^3\.?\s*Learning\s*Objectives\s*[:\-—]?\s*$/i, type: 'list' },
  {
    key: 'important_concepts',
    re: /^4\.?\s*Important\s*Concepts\s*(?:and|&)\s*Explanations\s*[:\-—]?\s*$/i,
    type: 'concepts',
  },
  {
    key: 'definitions',
    re: /^5\.?\s*Key\s*Definitions\s*(?:and|&)\s*Terms\s*[:\-—]?\s*$/i,
    type: 'defs',
  },
  {
    key: 'formulae',
    re: /^6\.?\s*Formulae?\s*(?:\/|\s*or\s*)\s*Rules\s*(?:\/|\s*or\s*)\s*Important\s*Facts\s*[:\-—]?\s*$/i,
    type: 'formulae',
  },
  { key: 'concept_connections', re: /^7\.?\s*Concept\s*Connections\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'real_life_applications', re: /^8\.?\s*Real[\s-]*life\s*Applications\s*[:\-—]?\s*$/i, type: 'list' },
  { key: 'quick_revision_notes', re: /^(?:9|10)\.?\s*Quick\s*Revision\s*Notes\s*[:\-—]?\s*$/i, type: 'list' },
  { key: 'practice_recall_questions', re: /^(?:10|11)\.?\s*Practice\s*Recall\s*Questions\s*[:\-—]?\s*$/i, type: 'list' },
];

function parseConceptLines(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(?:\d+[\).]\s*)?(?:\*\*)?([^*—–-]+?)(?:\*\*)?\s*[—–-]\s*(.+)$/);
    if (m) {
      out.push({ name: m[1].trim(), explanation: m[2].trim() });
      continue;
    }
    const bullet = line.replace(/^\s*[-*•]\s*/, '').trim();
    if (bullet.length > 4) out.push({ name: bullet, explanation: '' });
  }
  return out;
}

function parseDefinitions(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(?:\d+[\).]\s*)?(.+?)\s*[:\-—]\s*(.+)$/);
    if (m) out.push({ term: m[1].trim(), definition: m[2].trim() });
    else {
      const b = line.replace(/^\s*[-*•]\s*/, '').trim();
      if (b) out.push({ term: b, definition: '' });
    }
  }
  return out;
}

function parseFormulae(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(?:\d+[\).]\s*)?(.+?)\s*[:=]\s*(.+?)(?:\s*\((.+)\))?$/);
    if (m) out.push({ name: m[1].trim(), formula: m[2].trim(), note: m[3]?.trim() || '' });
    else {
      const b = line.replace(/^\s*[-*•]\s*/, '').trim();
      if (b) out.push({ name: '', formula: b, note: '' });
    }
  }
  return out;
}

function parseSummaryBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const summary = {
    sl_no: index + 1,
    chapter_summary_title: '',
    chapter_title: '',
    title: '',
    chapter_overview: '',
    learning_objectives: [],
    important_concepts: [],
    definitions: [],
    formulae: [],
    concept_connections: '',
    real_life_applications: [],
    quick_revision_notes: [],
    practice_recall_questions: [],
    _fromPdf: true,
  };

  let currentKey = null;
  let currentType = 'text';
  const buffer = [];

  const flush = () => {
    if (!currentKey) return;
    const text = buffer.join('\n').trim();
    const bulletLines = bulletsFromLines(buffer.length ? buffer : text.split('\n'));

    switch (currentType) {
      case 'list':
        summary[currentKey] = bulletLines.length ? bulletLines : strArr(text);
        break;
      case 'concepts':
        summary.important_concepts = parseConceptLines(bulletLines.length ? bulletLines : [text]);
        break;
      case 'defs':
        summary.definitions = parseDefinitions(bulletLines.length ? bulletLines : [text]);
        break;
      case 'formulae':
        summary.formulae = parseFormulae(bulletLines.length ? bulletLines : [text]);
        break;
      default:
        if (currentKey === 'chapter_summary_title') {
          summary.chapter_summary_title = text.split('\n')[0]?.trim() || text;
          summary.chapter_title = summary.chapter_summary_title;
          summary.title = summary.chapter_summary_title;
        } else {
          summary[currentKey] = text;
        }
    }
    buffer.length = 0;
  };

  for (const line of lines) {
    if (SUMMARY_MARKER.test(line)) continue;

    const section = SECTION_PATTERNS.find((s) => s.re.test(line));
    if (section) {
      flush();
      currentKey = section.key;
      currentType = section.type;
      const inline = line.replace(section.re, '').trim();
      if (inline) buffer.push(inline);
      continue;
    }

    if (!currentKey && !summary.chapter_summary_title && line.length >= 4 && line.length <= 200) {
      summary.chapter_summary_title = line;
      summary.chapter_title = line;
      summary.title = line;
      continue;
    }

    if (currentKey) buffer.push(line);
  }
  flush();

  if (!summary.chapter_title) summary.chapter_title = `Chapter ${index + 1}`;
  if (!summary.chapter_summary_title) summary.chapter_summary_title = summary.chapter_title;

  const hasBody =
    str(summary.chapter_overview).length > 15 ||
    summary.important_concepts.length > 0 ||
    summary.quick_revision_notes.length > 0 ||
    str(summary.summary || summary.chapter_summary).length > 15;

  if (!hasBody && !summary.learning_objectives.length) return null;
  return summary;
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 */
export function extractChapterSummaryItemsFromPdfText(text, limit = 100) {
  const blocks = splitPdfTextByMarkerLines(str(text), SUMMARY_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const row = parseSummaryBlock(block, out.length);
    if (row) out.push(row);
  }

  if (!out.length) {
    const single = parseSummaryBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
