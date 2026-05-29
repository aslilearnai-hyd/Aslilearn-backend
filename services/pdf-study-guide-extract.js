/**
 * Regex-based Smart Study Guide extraction from PDF text (11-section template).
 * @module services/pdf-study-guide-extract
 */

import { bulletsFromLines, splitPdfTextByMarkerLines, str, strArr } from './pdf-extract-utils.js';

const GUIDE_MARKER = /^(?:Item|Study\s*Guide|Guide)\s+\d+\b/i;

const SECTION_PATTERNS = [
  { key: 'title', re: /^1\.?\s*Study\s*Guide\s*Title\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'chapter_subtopic_overview', re: /^2\.?\s*Chapter\s*(?:and|&)\s*Subtopic\s*Overview\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'learning_objectives', re: /^3\.?\s*Learning\s*Objectives\s*[:\-—]?\s*$/i, type: 'list' },
  { key: 'prior_knowledge_required', re: /^4\.?\s*Prior\s*Knowledge\s*Required\s*[:\-—]?\s*$/i, type: 'list' },
  { key: 'key_concepts', re: /^5\.?\s*Key\s*Concepts\s*(?:Explained\s*in\s*Simple\s*Language)?\s*[:\-—]?\s*$/i, type: 'concepts' },
  { key: 'definitions_and_formulae', re: /^6\.?\s*Important\s*Definitions\s*(?:and|&)\s*Formulae?\s*[:\-—]?\s*$/i, type: 'defs' },
  { key: 'concept_flow_mind_map', re: /^7\.?\s*Concept\s*Flow\s*(?:\/|\s*and\s*)\s*Mind\s*Map\s*Suggestion\s*[:\-—]?\s*$/i, type: 'text' },
  { key: 'real_life_examples', re: /^8\.?\s*Real[\s-]*life\s*Examples\s*(?:and|&)\s*Applications\s*[:\-—]?\s*$/i, type: 'list' },
  { key: 'quick_revision_notes', re: /^9\.?\s*Quick\s*Revision\s*Notes\s*[:\-—]?\s*$/i, type: 'list' },
  { key: 'practice_questions', re: /^10\.?\s*Practice\s*Questions\s*(?:\(.*\))?\s*[:\-—]?\s*$/i, type: 'questions' },
  { key: 'improvement_tips', re: /^11\.?\s*Tips\s*for\s*Further\s*Improvement\s*[:\-—]?\s*$/i, type: 'list' },
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
    if (bullet.length > 4) out.push({ name: bullet, explanation: '' });
  }
  return out;
}

function parseDefinitionsFormulae(lines) {
  const definitions = [];
  const formulae = [];
  let mode = 'both';
  for (const line of lines) {
    if (/^definitions?\s*[:\-—]?$/i.test(line)) {
      mode = 'definitions';
      continue;
    }
    if (/^formulae?\s*[:\-—]?$/i.test(line)) {
      mode = 'formulae';
      continue;
    }
    const defMatch = line.match(/^(?:\d+[\).]\s*)?(.+?)\s*[:\-—]\s*(.+)$/);
    const formulaMatch = line.match(/^(?:\d+[\).]\s*)?(.+?)\s*[:=]\s*(.+?)(?:\s*\((.+)\))?$/);
    if (mode === 'formulae' || (formulaMatch && /[=+\-*/^]/.test(formulaMatch[2]))) {
      if (formulaMatch) {
        formulae.push({
          name: formulaMatch[1].trim(),
          formula: formulaMatch[2].trim(),
          note: formulaMatch[3]?.trim() || '',
        });
      } else {
        const b = line.replace(/^\s*[-*•]\s*/, '').trim();
        if (b) formulae.push({ name: '', formula: b, note: '' });
      }
    } else if (defMatch) {
      definitions.push({ term: defMatch[1].trim(), definition: defMatch[2].trim() });
    } else {
      const b = line.replace(/^\s*[-*•]\s*/, '').trim();
      if (b) definitions.push({ term: b, definition: '' });
    }
  }
  return { definitions, formulae };
}

function parsePracticeQuestions(lines) {
  const out = [];
  let current = null;
  for (const line of lines) {
    const qMatch = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[\).:\-]\s*(.+)$/i);
    if (qMatch) {
      if (current) out.push(current);
      current = {
        question: qMatch[2].trim(),
        type: /objective|mcq|choose/i.test(line) ? 'objective' : 'subjective',
        answer: '',
        options: [],
      };
      continue;
    }
    if (!current) continue;
    if (/^answer\s*[:\-—]/i.test(line)) {
      current.answer = line.replace(/^answer\s*[:\-—]\s*/i, '').trim();
      continue;
    }
    const opt = line.match(/^[A-D][\).]\s*(.+)$/i);
    if (opt) {
      current.options = current.options || [];
      current.options.push(opt[1].trim());
      if (!current.type || current.type === 'subjective') current.type = 'objective';
    }
  }
  if (current) out.push(current);
  return out;
}

function parseGuideBlock(block, index) {
  const lines = String(block || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const guide = {
    sl_no: index + 1,
    title: '',
    chapter_subtopic_overview: '',
    learning_objectives: [],
    prior_knowledge_required: [],
    key_concepts: [],
    definitions: [],
    formulae: [],
    concept_flow_mind_map: '',
    real_life_examples: [],
    quick_revision_notes: [],
    practice_questions: [],
    improvement_tips: [],
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
        guide[currentKey] = bulletLines.length ? bulletLines : strArr(text);
        break;
      case 'concepts':
        guide.key_concepts = parseConceptLines(bulletLines.length ? bulletLines : [text]);
        break;
      case 'defs': {
        const parsed = parseDefinitionsFormulae(bulletLines.length ? bulletLines : [text]);
        guide.definitions = parsed.definitions;
        guide.formulae = parsed.formulae;
        break;
      }
      case 'questions':
        guide.practice_questions = parsePracticeQuestions(bulletLines.length ? bulletLines : [text]);
        break;
      default:
        if (currentKey === 'title') guide.title = text.split('\n')[0]?.trim() || text;
        else guide[currentKey] = text;
    }
    buffer.length = 0;
  };

  for (const line of lines) {
    if (GUIDE_MARKER.test(line)) continue;

    const section = SECTION_PATTERNS.find((s) => s.re.test(line));
    if (section) {
      flush();
      currentKey = section.key;
      currentType = section.type;
      const inline = line.replace(section.re, '').trim();
      if (inline) buffer.push(inline);
      continue;
    }

    if (!currentKey && !guide.title && line.length >= 4 && line.length <= 200) {
      guide.title = line;
      continue;
    }

    if (currentKey) buffer.push(line);
  }
  flush();

  const hasBody =
    guide.key_concepts.length > 0 ||
    guide.quick_revision_notes.length > 0 ||
    str(guide.chapter_subtopic_overview).length > 20 ||
    guide.learning_objectives.length > 0;

  if (!guide.title && !hasBody) return null;
  if (!guide.title) guide.title = `Study Guide ${index + 1}`;

  return guide;
}

/**
 * @param {string} text
 * @param {number} [limit=100]
 */
export function extractStudyGuideItemsFromPdfText(text, limit = 100) {
  const blocks = splitPdfTextByMarkerLines(str(text), GUIDE_MARKER, 40);
  const out = [];

  for (const block of blocks) {
    if (out.length >= limit) break;
    const guide = parseGuideBlock(block, out.length);
    if (guide) out.push(guide);
  }

  if (!out.length) {
    const single = parseGuideBlock(str(text), 0);
    if (single) out.push(single);
  }

  return out.slice(0, limit);
}
