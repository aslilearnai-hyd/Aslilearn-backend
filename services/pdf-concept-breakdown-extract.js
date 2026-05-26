/**
 * Regex-based Concept Breakdown Explainer extraction from PDF text (9-section template).
 * @module services/pdf-concept-breakdown-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const CONCEPT_MARKER = /^(?:Item|Concept|Topic)\s+\d+\b/i;

const SECTION_PATTERNS = [
  { key: 'concept_title', re: /^1\.?\s*Concept\s*Title\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'simple_definition', re: /^2\.?\s*Simple\s*Definition\s*[:\-—]?\s*$/i, type: 'text' },
  {
    key: 'breakdown_steps',
    re: /^3\.?\s*Step[\s-]*by[\s-]*step\s*Concept\s*Breakdown\s*[:\-—]?\s*$/i,
    type: 'list',
  },
  {
    key: 'real_life_examples',
    re: /^4\.?\s*Real[\s-]*life\s*(?:and\s*Indian\s*Context\s*)?Examples\s*[:\-—]?\s*$/i,
    type: 'list',
  },
  {
    key: 'important_terms',
    re: /^5\.?\s*Important\s*Terms\s*(?:and|&)\s*Keywords\s*[:\-—]?\s*$/i,
    type: 'terms',
  },
  { key: 'concept_check_questions', re: /^6\.?\s*Concept\s*Check\s*Questions\s*[:\-—]?\s*$/i, type: 'list' },
  {
    key: 'application_thinking_question',
    re: /^7\.?\s*Application[\s-]*based\s*Thinking\s*Question\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  {
    key: 'higher_order_thinking_prompt',
    re: /^8\.?\s*Higher[\s-]*order\s*Thinking\s*Prompt\s*[:\-—]?\s*$/i,
    type: 'text',
  },
  { key: 'quick_revision_summary', re: /^9\.?\s*Quick\s*Revision\s*Summary\s*[:\-—]?\s*$/i, type: 'text' },
];

function parseImportantTerms(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(?:\d+[\).]\s*)?(.+?)\s*[:\-—]\s*(.+)$/);
    if (m) {
      out.push({ term: m[1].trim(), definition: m[2].trim() });
      continue;
    }
    const bullet = line.replace(/^\s*[-*•]\s*/, '').trim();
    if (bullet.length > 2) out.push({ term: bullet, definition: '' });
  }
  return out;
}

function parseConceptBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const concept = {
    sl_no: index + 1,
    concept_title: '',
    concept_name: '',
    simple_definition: '',
    breakdown_steps: [],
    real_life_examples: [],
    important_terms: [],
    concept_check_questions: [],
    application_thinking_question: '',
    higher_order_thinking_prompt: '',
    quick_revision_summary: '',
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
        concept[currentKey] = bulletLines.length ? bulletLines : strArr(text);
        break;
      case 'terms':
        concept.important_terms = parseImportantTerms(bulletLines.length ? bulletLines : [text]);
        break;
      default:
        if (currentKey === 'concept_title') {
          concept.concept_title = text.split('\n')[0]?.trim() || text;
          concept.concept_name = concept.concept_title;
        } else {
          concept[currentKey] = text;
        }
    }
    buffer.length = 0;
  };

  for (const line of lines) {
    if (CONCEPT_MARKER.test(line)) continue;

    const section = SECTION_PATTERNS.find((s) => s.re.test(line));
    if (section) {
      flush();
      currentKey = section.key;
      currentType = section.type;
      const inline = line.replace(section.re, '').trim();
      if (inline) buffer.push(inline);
      continue;
    }

    if (!currentKey && !concept.concept_title && line.length >= 4 && line.length <= 200) {
      concept.concept_title = line;
      concept.concept_name = line;
      continue;
    }

    if (currentKey) buffer.push(line);
  }
  flush();

  if (!concept.concept_name) concept.concept_name = `Concept ${index + 1}`;
  if (!concept.concept_title) concept.concept_title = concept.concept_name;

  const hasBody =
    str(concept.simple_definition).length > 8 ||
    concept.breakdown_steps.length > 0 ||
    str(concept.quick_revision_summary).length > 8;

  if (!hasBody) return null;
  return concept;
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 */
export function extractConceptBreakdownItemsFromPdfText(text, limit = 100) {
  const blocks = splitPdfTextByMarkerLines(str(text), CONCEPT_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const row = parseConceptBlock(block, out.length);
    if (row) out.push(row);
  }

  if (!out.length) {
    const single = parseConceptBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
