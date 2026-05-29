/**
 * Regex-based Key Points Extractor extraction from PDF text (10-section template).
 * @module services/pdf-key-points-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const TOPIC_MARKER = /^(?:Item|Topic|Key\s*Points)\s+\d+\b/i;

const SECTION_PATTERNS = [
  { key: 'topic_title', re: /^1\.?\s*Topic\s*Title\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'important_concepts', re: /^2\.?\s*Most\s*Important\s*Concepts\s*[:\-—]?\s*$/i, type: 'concepts' },
  { key: 'essential_definitions', re: /^3\.?\s*Essential\s*Definitions\s*[:\-—]?\s*$/i, type: 'defs' },
  {
    key: 'formulae',
    re: /^4\.?\s*Important\s*Formulae?\s*(?:\/|\s*or\s*)\s*Rules\s*[:\-—]?\s*$/i,
    type: 'formulae',
  },
  {
    key: 'keywords_terminologies',
    re: /^5\.?\s*Keywords\s*(?:and|&)\s*Terminologies\s*[:\-—]?\s*$/i,
    type: 'keywords',
  },
  { key: 'must_remember_facts', re: /^6\.?\s*Must[\s-]*remember\s*Facts\s*[:\-—]?\s*$/i, type: 'list' },
  { key: 'real_life_connections', re: /^7\.?\s*Real[\s-]*life\s*Connections\s*[:\-—]?\s*$/i, type: 'list' },
  {
    key: 'frequently_asked_exam_points',
    re: /^8\.?\s*Frequently\s*Asked\s*Exam\s*Points\s*[:\-—]?\s*$/i,
    type: 'list',
  },
  { key: 'mnemonics_memory_tricks', re: /^9\.?\s*Mnemonics\s*(?:\/|\s*or\s*)\s*Memory\s*Tricks\s*[:\-—]?\s*$/i, type: 'list' },
  {
    key: 'one_minute_revision_summary',
    re: /^10\.?\s*One[\s-]*minute\s*Revision\s*Summary\s*[:\-—]?\s*$/i,
    type: 'text',
  },
];

function parseConceptLines(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(?:\d+[\).]\s*)?(?:\*\*)?([^*\-—–]+?)(?:\*\*)?\s*[-—–]\s*(.+)$/);
    if (m) {
      out.push({ name: m[1].trim(), explanation: m[2].trim() });
      continue;
    }
    const bullet = line.replace(/^\s*[-*•]\s*/, '').trim();
    if (bullet.length > 3) out.push({ name: bullet, explanation: '' });
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

function parseKeywords(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(?:\d+[\).]\s*)?(.+?)\s*[:\-—]\s*(.+)$/);
    if (m) out.push({ term: m[1].trim(), meaning: m[2].trim() });
    else {
      const b = line.replace(/^\s*[-*•]\s*/, '').trim();
      if (b) out.push({ term: b, meaning: '' });
    }
  }
  return out;
}

function parseKeyPointsBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const row = {
    sl_no: index + 1,
    topic_title: '',
    title: '',
    important_concepts: [],
    essential_definitions: [],
    formulae: [],
    keywords_terminologies: [],
    must_remember_facts: [],
    real_life_connections: [],
    frequently_asked_exam_points: [],
    mnemonics_memory_tricks: [],
    one_minute_revision_summary: '',
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
        row[currentKey] = bulletLines.length ? bulletLines : strArr(text);
        break;
      case 'concepts':
        row.important_concepts = parseConceptLines(bulletLines.length ? bulletLines : [text]);
        break;
      case 'defs':
        row.essential_definitions = parseDefinitions(bulletLines.length ? bulletLines : [text]);
        break;
      case 'formulae':
        row.formulae = parseFormulae(bulletLines.length ? bulletLines : [text]);
        break;
      case 'keywords':
        row.keywords_terminologies = parseKeywords(bulletLines.length ? bulletLines : [text]);
        break;
      default:
        if (currentKey === 'topic_title') {
          row.topic_title = text.split('\n')[0]?.trim() || text;
          row.title = row.topic_title;
        } else {
          row[currentKey] = text;
        }
    }
    buffer.length = 0;
  };

  for (const line of lines) {
    if (TOPIC_MARKER.test(line)) continue;

    const section = SECTION_PATTERNS.find((s) => s.re.test(line));
    if (section) {
      flush();
      currentKey = section.key;
      currentType = section.type;
      const inline = line.replace(section.re, '').trim();
      if (inline) buffer.push(inline);
      continue;
    }

    if (!currentKey && !row.topic_title && line.length >= 3 && line.length <= 200) {
      row.topic_title = line;
      row.title = line;
      continue;
    }

    if (currentKey) buffer.push(line);
  }
  flush();

  if (!row.title) row.title = `Topic ${index + 1}`;
  if (!row.topic_title) row.topic_title = row.title;

  const hasBody =
    row.important_concepts.length > 0 ||
    row.must_remember_facts.length > 0 ||
    row.formulae.length > 0 ||
    str(row.one_minute_revision_summary).length > 8;

  if (!hasBody) return null;
  return row;
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 */
export function extractKeyPointsItemsFromPdfText(text, limit = 100) {
  const blocks = splitPdfTextByMarkerLines(str(text), TOPIC_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const parsed = parseKeyPointsBlock(block, out.length);
    if (parsed) out.push(parsed);
  }

  if (!out.length) {
    const single = parseKeyPointsBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
